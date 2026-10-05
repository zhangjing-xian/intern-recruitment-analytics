/**
 * 存储层统一出口（步骤6 建立）。
 *
 * 两类内容刻意分开导出：
 * 1. **轻量、无依赖**（错误、事件、仓元数据契约、闲置锁定、配额、会话守卫）：
 *    界面可以随意静态 import，不会把 Dexie 拉进首屏包；
 * 2. **会牵入 Dexie 的实现**（`vault.ts` / `backup.ts` / `db.ts`）：
 *    只通过类型（编译期擦除）与 `encryptedVault` 懒门面（动态 import）接触。
 *    需要直接调用 `createVault` / `unlockVault` 等函数时，请用门面，
 *    或在你自己的动态 import 里加载 `./vault`，不要静态引入。
 *
 * 内存会话（sessionStore）继续由本桶原样转发：临时模式与加密模式共用同一份会话状态。
 */

export * from './errors'
export * from './idleLock'
export * from './quota'
export * from './sessionStore'
export * from './vaultEvents'
export * from './vaultMeta'
export * from './vaultSession'

export { encryptedVault, type EncryptedVault } from './vaultFacade'
export type {
  BackupContent,
  BackupCreateResult,
  BackupObjectRecord,
  BackupParseResult,
  BackupRestoreMode,
  BackupRestoreResult,
  EncryptedBackupFile,
} from './backup'
export type { SaveVaultObjectResult, VaultObjectRecord, VaultState, VaultStatus } from './vault'
