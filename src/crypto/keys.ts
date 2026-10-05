/**
 * Key 槽位：解锁后的密钥**只驻留内存**的唯一持有者。
 *
 * 为什么集中在一处：
 * - 密钥不可导出（见 kdf.deriveVaultKeys），所以「谁能拿到它」只能靠模块边界约束；
 *   业务代码一律通过 `requireSlotKey()` 取用，任何地方都不缓存 CryptoKey；
 * - 锁定只需要把这里的引用丢掉，随后所有读写都会拿到 `locked` 错误——
 *   不需要挨个通知调用方（docs/PRD.md 10.3「手动锁定、刷新、默认闲置 15 分钟锁定」）；
 * - `vaultId` / `revision` 与密钥放在一起：多标签页里另一个标签改密后，本标签的
 *   revision 会对不上仓元数据，因此**必须**拒绝写入，而不是用旧密钥写坏数据。
 *
 * 诚实边界：JavaScript 无法保证物理内存取证级擦除。丢弃引用只是让密钥不再可达，
 * 因此界面文案不得承诺「内存已彻底擦除」（docs/PRD.md 10.3）。
 */

import { CryptoError } from './errors'

export type VaultKeySlot = 'data' | 'secret'

export type VaultKeySet = {
  readonly vaultId: string
  /** 与仓元数据一致的版本号；不一致即视为过期会话 */
  readonly revision: number
  readonly kdfIterations: number
  readonly unlockedAt: string
  readonly keys: Readonly<Record<VaultKeySlot, CryptoKey>>
}

export type KeyStateSnapshot = {
  readonly unlocked: boolean
  readonly vaultId: string | null
  readonly revision: number | null
}

let currentKeys: VaultKeySet | null = null
const listeners = new Set<(snapshot: KeyStateSnapshot) => void>()

function notify(): void {
  const snapshot = keyStateSnapshot()
  for (const listener of listeners) {
    listener(snapshot)
  }
}

export function keyStateSnapshot(): KeyStateSnapshot {
  return {
    unlocked: currentKeys !== null,
    vaultId: currentKeys?.vaultId ?? null,
    revision: currentKeys?.revision ?? null,
  }
}

/** 安装（或替换）解锁后的密钥集合；改密后也走这里，保证同一时刻只有一套密钥 */
export function installVaultKeys(next: VaultKeySet): void {
  currentKeys = next
  notify()
}

/** 丢弃内存中的密钥（锁定 / 收到其他标签页改密或清空通知时调用） */
export function dropVaultKeys(): void {
  if (currentKeys === null) {
    return
  }
  currentKeys = null
  notify()
}

export function hasVaultKeys(): boolean {
  return currentKeys !== null
}

/** 只读快照；调用方**不得**长期持有返回的 CryptoKey 引用 */
export function activeVaultKeys(): VaultKeySet | null {
  return currentKeys
}

export function requireVaultKeys(): VaultKeySet {
  if (currentKeys === null) {
    throw new CryptoError('locked', '本地仓已锁定，请重新解锁后再操作')
  }
  return currentKeys
}

export function requireSlotKey(slot: VaultKeySlot): CryptoKey {
  return requireVaultKeys().keys[slot]
}

/** 订阅解锁 / 锁定状态变更；返回取消订阅函数 */
export function subscribeKeyState(listener: (snapshot: KeyStateSnapshot) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
