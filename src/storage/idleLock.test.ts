import { describe, expect, it } from 'vitest'

import { createIdleLockController, type IdleLockController, type IdleLockTimer } from './idleLock'
import { DEFAULT_IDLE_LOCK_MINUTES, MAX_IDLE_LOCK_MINUTES } from './vaultMeta'

type FakeClock = {
  readonly timer: IdleLockTimer
  readonly advance: (ms: number) => void
  readonly now: () => number
  /** 当前排定的定时器延迟（毫秒）；没有待触发定时器时为 null */
  readonly pending: () => number | null
  /** 触发当前定时器（一次性语义：触发后即无待触发定时器） */
  readonly fire: () => void
}

/**
 * 假时钟 + 假定时器：让「闲置 15 分钟」在测试里完全确定，不真等、不依赖真实计时器精度。
 * 只实现被 `createIdleLockController` 用到的三个语义：单次定时、可取消、可查询延迟。
 */
function createFakeClock(): FakeClock {
  let current = 0
  let callback: (() => void) | null = null
  let delay: number | null = null
  const clear = (): void => {
    callback = null
    delay = null
  }
  return {
    timer: {
      set: (next, delayMs) => {
        callback = next
        delay = delayMs
        return 1
      },
      clear,
    },
    advance: (ms) => {
      current += ms
    },
    now: () => current,
    pending: () => delay,
    fire: () => {
      const run = callback
      clear()
      if (run !== null) {
        run()
      }
    },
  }
}

function build(minutes?: number): {
  readonly controller: IdleLockController
  readonly clock: FakeClock
  readonly locks: () => number
} {
  const clock = createFakeClock()
  let lockCount = 0
  const controller = createIdleLockController({
    onIdleLock: () => {
      lockCount += 1
    },
    minutes,
    timer: clock.timer,
    now: clock.now,
    activityThrottleMs: 0,
  })
  return { controller, clock, locks: () => lockCount }
}

describe('闲置自动锁定计时器', () => {
  it('默认闲置 15 分钟；未运行时倒计时为 0（界面据此不显示倒计时）', () => {
    const { controller, clock } = build()
    expect(controller.getMinutes()).toBe(DEFAULT_IDLE_LOCK_MINUTES)
    expect(controller.getRemainingMs()).toBe(0)
    controller.start()
    expect(controller.isRunning()).toBe(true)
    expect(clock.pending()).toBe(DEFAULT_IDLE_LOCK_MINUTES * 60_000)
    expect(controller.getRemainingMs()).toBe(DEFAULT_IDLE_LOCK_MINUTES * 60_000)
  })

  it('到点触发一次锁定并停止计时', () => {
    const { controller, clock, locks } = build(1)
    controller.start()
    clock.advance(60_000)
    clock.fire()
    expect(locks()).toBe(1)
    expect(controller.isRunning()).toBe(false)
    // 已停止：没有待触发定时器，再触发也不会重复锁定
    expect(clock.pending()).toBeNull()
    clock.fire()
    expect(locks()).toBe(1)
  })

  it('活动刷新活动时刻并按新的剩余时间重排', () => {
    const { controller, clock, locks } = build(1)
    controller.start()
    clock.advance(50_000)
    controller.noteActivity()
    expect(controller.getRemainingMs()).toBe(60_000)
    // 旧的「早到」定时器醒来时发现还没到闲置上限，于是重排而不是锁定
    clock.advance(10_000)
    clock.fire()
    expect(locks()).toBe(0)
    expect(controller.isRunning()).toBe(true)
    expect(controller.getRemainingMs()).toBe(50_000)
  })

  it('提前唤醒（休眠 / 标签页被挂起）不会误锁，按真实闲置时长重排', () => {
    const { controller, clock, locks } = build(2)
    controller.start()
    clock.advance(1_000)
    clock.fire()
    expect(locks()).toBe(0)
    expect(controller.isRunning()).toBe(true)
    expect(controller.getRemainingMs()).toBe(2 * 60_000 - 1_000)
  })

  it('未运行时活动不会启动计时；stop 后到点也不锁定', () => {
    const { controller, clock, locks } = build(1)
    controller.noteActivity()
    expect(controller.isRunning()).toBe(false)
    controller.start()
    controller.stop()
    clock.advance(120_000)
    clock.fire()
    expect(locks()).toBe(0)
    expect(controller.getRemainingMs()).toBe(0)
  })

  it('分钟数变更会重排；非法值沿用当前设置（不静默改成别的值）', () => {
    const { controller, clock } = build(15)
    controller.start()
    controller.setMinutes(30)
    expect(controller.getMinutes()).toBe(30)
    expect(clock.pending()).toBe(30 * 60_000)
    controller.setMinutes(0)
    expect(controller.getMinutes()).toBe(30)
    controller.setMinutes(MAX_IDLE_LOCK_MINUTES + 1)
    expect(controller.getMinutes()).toBe(30)
  })
})

function mount(
  clock: { readonly timer: IdleLockTimer; readonly advance: (ms: number) => void },
  now: () => number,
  onIdleLock: () => void,
  minutes?: number,
): IdleLockController {
  return createIdleLockController({
    onIdleLock,
    minutes,
    timer: clock.timer,
    now,
    activityThrottleMs: 0,
  })
}

describe('闲置自动锁定计时器', () => {
  const build = (
    minutes?: number,
  ): {
    readonly controller: IdleLockController
    readonly clock: FakeClock
    readonly locks: () => number
    readonly now: () => number
  } => {
    let now = 0
    let lockCount = 0
    const clock = createFakeClock()
    const controller = mount(
      clock,
      () => now,
      () => {
        lockCount += 1
      },
      minutes,
    )
    return {
      controller,
      clock: { ...clock, advance: (ms: number) => { now += ms; clock.advance(0) } } as FakeClock,
      locks: () => lockCount,
      now: () => now,
    }
  }

  it('默认闲置 15 分钟；运行时倒计时等于配置时长', () => {
    const { controller, clock } = build()
    expect(controller.getMinutes()).toBe(DEFAULT_IDLE_LOCK_MINUTES)
    expect(controller.getRemainingMs()).toBe(0)
    controller.start()
    expect(controller.isRunning()).toBe(true)
    expect(clock.pending()).toBe(DEFAULT_IDLE_LOCK_MINUTES * 60_000)
    expect(controller.getRemainingMs()).toBe(DEFAULT_IDLE_LOCK_MINUTES * 60_000)
  })

  it('到点触发一次锁定并停止计时', () => {
    const harness = build(1)
    harness.controller.start()
    harness.clock.advance(60_000)
    harness.clock.fire()
    expect(harness.locks()).toBe(1)
    expect(harness.controller.isRunning()).toBe(false)
    // 定时器已停：再次触发不会重复锁定
    harness.clock.fire()
    expect(harness.locks()).toBe(1)
  })

  it('活动会刷新活动时刻，并按新的剩余时间重排', () => {
    const harness = build(1)
    harness.controller.start()
    harness.clock.advance(50_000)
    harness.controller.noteActivity()
    expect(harness.controller.getRemainingMs()).toBe(60_000)
    // 旧的「早到」定时器醒来时会发现还没到闲置上限，于是重排而不是锁定
    harness.clock.advance(10_000)
    harness.clock.fire()
    expect(harness.locks()).toBe(0)
    expect(harness.controller.isRunning()).toBe(true)
    expect(harness.controller.getRemainingMs()).toBe(50_000)
  })

  it('系统休眠导致的提前唤醒不会误锁（按真实闲置时长判断）', () => {
    const harness = build(2)
    harness.controller.start()
    harness.clock.advance(1_000)
    harness.clock.fire()
    expect(harness.locks()).toBe(0)
    expect(harness.controller.isRunning()).toBe(true)
  })

  it('未运行时 noteActivity 不会启动计时；stop 后不再锁定', () => {
    const harness = build(1)
    harness.controller.noteActivity()
    expect(harness.controller.isRunning()).toBe(false)
    harness.controller.start()
    harness.controller.stop()
    harness.clock.advance(120_000)
    harness.clock.fire()
    expect(harness.locks()).toBe(0)
  })

  it('分钟数变更会重排；非法值沿用当前设置且被夹在允许区间内', () => {
    const harness = build(15)
    harness.controller.start()
    harness.controller.setMinutes(30)
    expect(harness.controller.getMinutes()).toBe(30)
    expect(harness.clock.pending()).toBe(30 * 60_000)
    harness.controller.setMinutes(0)
    expect(harness.controller.getMinutes()).toBe(30)
    harness.controller.setMinutes(MAX_IDLE_LOCK_MINUTES + 1)
    expect(harness.controller.getMinutes()).toBe(30)
  })
})
