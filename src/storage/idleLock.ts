/**
 * 闲置自动锁定（纯逻辑，**不依赖 Dexie / React**，步骤6）。
 *
 * 需求来自 docs/PRD.md 10.3：「手动锁定、刷新、默认闲置 15 分钟锁定」。
 * 之所以把这一层写成纯函数：
 * - 计时行为必须能在 Node 里用假时钟确定性验证（不需要真等 15 分钟，也不引入定时器 mock 库）；
 * - 它会被应用外壳在启动时挂载，因此**不能**牵入 Dexie —— 否则首屏包会重新变大；
 * - 「到点做什么」由调用方通过 `onIdleLock` 注入，这里只负责计时与节流，职责单一。
 *
 * 计时口径：
 * - `start()` 记下当前时刻并排一个「剩余毫秒数」的定时器；
 * - `noteActivity()` 刷新活动时刻；
 *   为避免指针移动造成定时器反复创建，重排受 `activityThrottleMs`（默认 1 秒）节流；
 * - 定时器醒来时若发现实际已闲置足够久才真正锁定（防止系统休眠 / 标签页被挂起导致的早触发）。
 */

import { DEFAULT_IDLE_LOCK_MINUTES, normalizeIdleLockMinutes } from './vaultMeta'

export type IdleLockTimer = {
  readonly set: (callback: () => void, delayMs: number) => unknown
  readonly clear: (handle: unknown) => void
}

/** 生产环境使用的定时器（浏览器 / Node 都可用） */
export const SYSTEM_IDLE_TIMER: IdleLockTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

export type IdleLockController = {
  readonly start: () => void
  readonly stop: () => void
  readonly isRunning: () => boolean
  readonly noteActivity: () => void
  readonly setMinutes: (minutes: number) => void
  readonly getMinutes: () => number
  /** 距离锁定还剩多少毫秒；未运行时返回 0（界面据此不显示倒计时） */
  readonly getRemainingMs: () => number
}

export function createIdleLockController(options: {
  readonly onIdleLock: () => void
  readonly minutes?: number
  readonly timer?: IdleLockTimer
  readonly now?: () => number
  readonly activityThrottleMs?: number
}): IdleLockController {
  const timer = options.timer ?? SYSTEM_IDLE_TIMER
  const now = options.now ?? ((): number => Date.now())
  const activityThrottleMs = options.activityThrottleMs ?? 1000

  let minutes = normalizeIdleLockMinutes(options.minutes, DEFAULT_IDLE_LOCK_MINUTES)
  let running = false
  let handle: unknown = null
  let lastActivityAt = now()
  let lastRescheduleAt = now()

  const timeoutMs = (): number => minutes * 60_000

  function clearHandle(): void {
    if (handle !== null) {
      timer.clear(handle)
      handle = null
    }
  }

  function elapsed(): number {
    return Math.max(0, now() - lastActivityAt)
  }

  function schedule(): void {
    clearHandle()
    handle = timer.set(onTimer, Math.max(0, timeoutMs() - elapsed()))
    lastRescheduleAt = now()
  }

  function onTimer(): void {
    handle = null
    if (!running) {
      return
    }
    if (elapsed() >= timeoutMs()) {
      running = false
      options.onIdleLock()
      return
    }
    // 提前醒来（休眠 / 挂起 / 节流）：按真实闲置时长重新排一次
    schedule()
  }

  return {
    start: () => {
      if (running) {
        return
      }
      running = true
      lastActivityAt = now()
      schedule()
    },
    stop: () => {
      running = false
      clearHandle()
    },
    isRunning: () => running,
    noteActivity: () => {
      lastActivityAt = now()
      if (!running || now() - lastRescheduleAt < activityThrottleMs) {
        return
      }
      schedule()
    },
    setMinutes: (next: number) => {
      const normalized = normalizeIdleLockMinutes(next, minutes)
      if (normalized === minutes) {
        return
      }
      minutes = normalized
      if (running) {
        schedule()
      }
    },
    getMinutes: () => minutes,
    getRemainingMs: () => (running ? Math.max(0, timeoutMs() - elapsed()) : 0),
  }
}
