/**
 * 加密仓的**懒门面**（界面唯一入口，步骤6）。
 *
 * 为什么需要它：`./vault` 与 `./backup` 都静态引入 Dexie，直接静态 import 会让首屏包
 * 从 ~320 kB 涨到 400 kB 以上（与本项目「首屏只留必要代码」的既有约定一致：
 * 解析器、SheetJS 也是这么处理的）。因此门面里所有方法都是
 * `await import(...)`，只有真正调用加密仓功能时才会加载 Dexie 那一段 chunk。
 *
 * 类型用 `import type` 引入：编译期擦除，不会把实现拉进包里。
 * `lock()` 例外——它只需要丢弃内存密钥，走纯逻辑模块（无需加载任何 chunk）。
 */

import type {
  BackupCreateResult,
  BackupParseResult,
  BackupRestoreMode,
  BackupRestoreResult,
} from './backup'
import { formatBytes, readStorageEstimate, requestPersistentStorage, type StorageEstimate } from './quota'
import type { SaveVaultObjectResult, VaultObjectRecord, VaultStatus } from './vault'
import type { VaultLockReason } from './vaultEvents'
import { lockActiveVault } from './vaultSession'
import type { VaultObjectKind, VaultSecretSlot } from './vaultMeta'

const vaultModule = () => import('./vault')
const backupModule = () => import('./backup')

export const encryptedVault = {
  /** 现状：有没有仓、是否解锁、版本、计数（不需要密码） */
  status: async (): Promise<VaultStatus> => (await vaultModule()).readVaultStatus(),

  create: async (
    password: string,
    options?: { readonly iterations?: number; readonly idleLockMinutes?: number },
  ): Promise<VaultStatus> => (await vaultModule()).createVault(password, options),

  unlock: async (password: string): Promise<VaultStatus> =>
    (await vaultModule()).unlockVault(password),

  /** 锁定：丢弃内存密钥即可，不需要加载 Dexie */
  lock: (reason: VaultLockReason = 'manual'): void => {
    lockActiveVault(reason)
  },

  changePassword: async (
    oldPassword: string,
    newPassword: string,
    options?: { readonly iterations?: number },
  ): Promise<VaultStatus> => (await vaultModule()).changeVaultPassword(oldPassword, newPassword, options),

  saveObject: async <T>(
    kind: VaultObjectKind,
    payload: T,
    options?: { readonly id?: string },
  ): Promise<SaveVaultObjectResult> => (await vaultModule()).saveVaultObject(kind, payload, options),

  /** 追加（每次新 id，绝不覆盖已有对象）；AI 历史的写入路径走这里 */
  appendObject: async <T>(kind: VaultObjectKind, payload: T): Promise<SaveVaultObjectResult> =>
    (await vaultModule()).appendVaultObject(kind, payload),

  loadObject: async <T>(kind: VaultObjectKind, id: string): Promise<T | null> =>
    (await vaultModule()).loadVaultObject<T>(kind, id),

  listObjects: async <T>(kind: VaultObjectKind): Promise<readonly VaultObjectRecord<T>[]> =>
    (await vaultModule()).listVaultObjects<T>(kind),

  deleteObject: async (kind: VaultObjectKind, id: string): Promise<number> =>
    (await vaultModule()).deleteVaultObject(kind, id),

  clearObjects: async (kind?: VaultObjectKind): Promise<number> =>
    (await vaultModule()).clearVaultObjects(kind),

  hasSecret: async (slot: VaultSecretSlot): Promise<boolean> =>
    (await vaultModule()).hasVaultSecret(slot),

  saveSecret: async (slot: VaultSecretSlot, value: string): Promise<void> => {
    await (await vaultModule()).saveVaultSecret(slot, value)
  },

  loadSecret: async (slot: VaultSecretSlot): Promise<string | null> =>
    (await vaultModule()).loadVaultSecret(slot),

  deleteSecret: async (slot: VaultSecretSlot): Promise<number> =>
    (await vaultModule()).deleteVaultSecret(slot),

  clearSecrets: async (): Promise<number> => (await vaultModule()).clearVaultSecrets(),

  setIdleLockMinutes: async (minutes: number): Promise<VaultStatus> =>
    (await vaultModule()).updateVaultIdleLockMinutes(minutes),

  getIdleLockMinutes: async (): Promise<number> => (await vaultModule()).readVaultIdleLockMinutes(),

  /** 清空整个本地仓（忘记密码时的自救路径；界面必须先二次确认） */
  clearAll: async (): Promise<void> => {
    await (await vaultModule()).clearVault()
  },

  /** 存储占用与是否已申请持久化（无 navigator.storage 时返回 supported: false） */
  estimate: (): Promise<StorageEstimate> => readStorageEstimate(),

  requestPersistent: (): Promise<StorageEstimate> => requestPersistentStorage(),

  formatBytes,

  /** 加密备份（步骤12 接界面；此处先提供可测试的接口） */
  createBackup: async (
    password: string,
    options?: { readonly kdfIterations?: number; readonly kinds?: readonly VaultObjectKind[] },
  ): Promise<BackupCreateResult> => (await backupModule()).createEncryptedBackup(password, options),

  parseBackup: async (text: string): Promise<BackupParseResult> =>
    (await backupModule()).parseEncryptedBackup(text),

  restoreBackup: async (
    text: string,
    password: string,
    options?: { readonly mode?: BackupRestoreMode },
  ): Promise<BackupRestoreResult> =>
    (await backupModule()).restoreEncryptedBackup(text, password, options),
} as const

export type EncryptedVault = typeof encryptedVault
