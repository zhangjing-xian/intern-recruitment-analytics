/**
 * 本地仓事件（跨模块 / 跨标签页的最小通知通道，步骤6）。
 *
 * 为什么要单独一层：锁定必须能**立刻**通知界面清空内存状态（docs/PRD.md 10.3
 * 「锁定时清空可控状态和图表缓存」），改密 / 清空也必须让其他标签页停止用旧密钥写入
 * （「先通知并关闭其他标签页连接」）。这一层不依赖 Dexie、不依赖 React，
 * 因此可以安全地被界面、会话守卫与数据库层共同引用，而不会把 Dexie 拉进首屏包。
 *
 * 注意：这里只传**非敏感**信息（事件类型、仓 ID、版本号、原因枚举），
 * 绝不传数据内容。
 */

export type VaultLockReason =
  /** 用户主动点击锁定 */
  | 'manual'
  /** 闲置超时自动锁定 */
  | 'idle'
  /** 其他标签页改密 / 清空 */
  | 'tab'
  /** 本地仓被清空 */
  | 'cleared'

export type VaultEvent =
  | { readonly type: 'unlocked'; readonly vaultId: string; readonly revision: number }
  | { readonly type: 'locked'; readonly reason: VaultLockReason }
  | { readonly type: 'revision-changed'; readonly vaultId: string; readonly revision: number }
  | { readonly type: 'stale-session' }
  | { readonly type: 'cleared' }
  | { readonly type: 'connection-closed'; readonly reason: string }

type VaultEventListener = (event: VaultEvent) => void

const listeners = new Set<VaultEventListener>()

export function subscribeVaultEvents(listener: VaultEventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 同步广播；某个监听器抛错不影响其他监听器（事件本身不能成为失败来源） */
export function emitVaultEvent(event: VaultEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event)
    } catch {
      // 监听器异常不影响仓状态：忽略（界面下一轮读取状态即可自愈）
    }
  }
}
