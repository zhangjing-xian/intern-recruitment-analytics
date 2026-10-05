/**
 * 应用级会话守卫（**不依赖 Dexie**，步骤6）。
 *
 * 它把三件事接在一起，避免界面各自实现（docs/PRD.md 10.3、10.5）：
 * 1. 解锁 → 启动闲置计时；锁定 → 停止计时；
 * 2. 闲置到点 → `lockActiveVault('idle')`（丢弃内存密钥并广播事件）；
 * 3. 收到锁定 / 清空 / 会话过期事件 → 清空**内存中的业务数据**（导入的表格、已提交数据集、
 *    映射草稿），保留用户配置（清洗设置草稿与映射模板）——这样「锁定」不会顺手弄丢配置，
 *    但也不会让敏感明细留在内存里。
 *
 * 为什么不用静态 import 仓模块：本文件会被应用外壳在启动时挂载，
 * 而 `./vault` 静态引入 Dexie（约 90 kB）。所以只有「解锁后需要读元数据里的闲置分钟数」
 * 这一处会 `import('./vault')`，且失败时沿用默认 15 分钟，绝不因为读配置失败就不锁定。
 */

import { dropVaultKeys, hasVaultKeys, subscribeKeyState } from '../crypto'
import { createIdleLockController, type IdleLockController } from './idleLock'
import { clearImportSession } from './sessionStore'
import { emitVaultEvent, subscribeVaultEvents, type VaultLockReason } from './vaultEvents'
import { DEFAULT_IDLE_LOCK_MINUTES } from './vaultMeta'

export type VaultSessionGuard = {
  readonly stop: () => void
  readonly noteActivity: () => void
  readonly getIdleLockMinutes: () => number
  readonly setIdleLockMinutes: (minutes: number) => void
  readonly getRemainingMs: () => number
}

/**
 * 当前挂载的会话守卫（模块级单例）。
 *
 * 为什么要暴露它：设置页要显示「还有多久自动锁定」，并在改设置后立刻把新的分钟数同步给计时器。
 * 让界面各自再建一个计时器就会出现两份真相（一份改了、另一份没改），所以只允许外壳挂一个，
 * 界面通过下面两个只读入口取用。注意：这里只暴露**计时状态**，不暴露任何密钥或数据。
 */
let activeSessionGuard: VaultSessionGuard | null = null

/** 应用外壳尚未挂载时返回 null（界面据此显示「未在计时」，不假装有计时器） */
export function activeVaultSessionGuard(): VaultSessionGuard | null {
  return activeSessionGuard
}

/** 距自动锁定的剩余毫秒数；未挂载或未解锁时返回 0 */
export function readVaultIdleRemainingMs(): number {
  return activeSessionGuard === null ? 0 : activeSessionGuard.getRemainingMs()
}

/** 纯逻辑锁定：丢弃内存密钥 + 广播事件；未解锁时是空操作（不重复广播） */
export function lockActiveVault(reason: VaultLockReason = 'manual'): void {
  if (!hasVaultKeys()) {
    return
  }
  dropVaultKeys()
  emitVaultEvent({ type: 'locked', reason })
}

function syncIdleLockMinutes(controller: IdleLockController): void {
  void import('./vault')
    .then((module) => module.readVaultIdleLockMinutes())
    .then((minutes) => {
      controller.setMinutes(minutes)
    })
    .catch(() => {
      // 读不到配置就沿用默认值（15 分钟）：宁可早锁，不能因为读配置失败而不锁
    })
}

/**
 * 挂载会话守卫：解锁即计时、闲置即锁定、锁定即清空业务数据。
 * 返回的函数用于卸载（应用卸载时调用）。
 */
export function mountVaultSessionGuard(options: { readonly minutes?: number } = {}): VaultSessionGuard {
  const controller = createIdleLockController({
    minutes: options.minutes ?? DEFAULT_IDLE_LOCK_MINUTES,
    onIdleLock: () => {
      lockActiveVault('idle')
    },
  })

  const unsubscribeKeys = subscribeKeyState((snapshot) => {
    if (snapshot.unlocked) {
      controller.start()
      syncIdleLockMinutes(controller)
    } else {
      controller.stop()
    }
  })

  // 订阅不会回放当前状态：挂载时若已经解锁（外壳挂载晚于解锁），也必须立刻开始计时
  if (hasVaultKeys()) {
    controller.start()
    syncIdleLockMinutes(controller)
  }

  const unsubscribeEvents = subscribeVaultEvents((event) => {
    if (
      event.type === 'locked' ||
      event.type === 'cleared' ||
      event.type === 'stale-session' ||
      event.type === 'connection-closed'
    ) {
      clearImportSession()
    }
  })

  const guard: VaultSessionGuard = {
    stop: () => {
      unsubscribeKeys()
      unsubscribeEvents()
      controller.stop()
      if (activeSessionGuard === guard) {
        // 卸载后界面不应再读到过时的倒计时
        activeSessionGuard = null
      }
    },
    noteActivity: () => {
      controller.noteActivity()
    },
    getIdleLockMinutes: () => controller.getMinutes(),
    setIdleLockMinutes: (minutes: number) => {
      controller.setMinutes(minutes)
    },
    getRemainingMs: () => controller.getRemainingMs(),
  }

  activeSessionGuard = guard
  return guard
}

/** 监听用户活动（指针 / 键盘 / 焦点 / 标签页回到前台）；非浏览器环境为空操作 */
export function mountVaultActivityListeners(guard: VaultSessionGuard): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {}
  }
  const noteActivity = (): void => {
    guard.noteActivity()
  }
  const events = ['pointerdown', 'keydown', 'focus'] as const
  for (const event of events) {
    window.addEventListener(event, noteActivity, { passive: true })
  }
  const onVisibilityChange = (): void => {
    if (!document.hidden) {
      noteActivity()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    for (const event of events) {
      window.removeEventListener(event, noteActivity)
    }
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** 应用外壳调用的唯一入口：装上守卫与活动监听，返回卸载函数 */
export function mountVaultSession(options: { readonly minutes?: number } = {}): () => void {
  const guard = mountVaultSessionGuard(options)
  const unsubscribeActivity = mountVaultActivityListeners(guard)
  return () => {
    unsubscribeActivity()
    guard.stop()
  }
}
