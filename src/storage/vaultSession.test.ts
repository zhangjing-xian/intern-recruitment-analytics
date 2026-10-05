/**
 * 应用级会话守卫的集成测试（fake-indexeddb + 真实 Web Crypto + 假时钟，步骤6）。
 *
 * 为什么只假造 `Date` / `setTimeout`：
 * 「闲置 5 分钟自动锁定」不能靠真等，必须能确定性推进；但 fake-indexeddb 与 Dexie 的
 * 事务调度依赖 `setImmediate` 与微任务，一并假造会让仓的读写永远不 resolve
 * （测试挂死而不是失败），因此只假造计时所需的最小集合。
 * 夹具全部是合成数据；这里只断言「锁定后内存里还留着什么」，不接触任何明文落盘。
 */
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDefaultCleaningSettings } from '../cleaning'
import { MIN_PBKDF2_ITERATIONS, hasVaultKeys } from '../crypto'
import type { NormalizedDataset, RawSheet } from '../domain'
import {
  clearCleaningSettingsDraft,
  clearImportSession,
  commitNormalizedDataset,
  getCleaningSession,
  getImportSession,
  saveCleaningSettingsDraft,
  setImportSheet,
} from './sessionStore'
import { clearVault, createVault, lockVault } from './vault'
import { emitVaultEvent, subscribeVaultEvents, type VaultEvent } from './vaultEvents'
import {
  activeVaultSessionGuard,
  mountVaultSession,
  mountVaultSessionGuard,
  readVaultIdleRemainingMs,
} from './vaultSession'

/** 测试用迭代次数取下限：本用例验证的是计时与清理，不该背上 60 万次 PBKDF2 的成本 */
const ITERATIONS = MIN_PBKDF2_ITERATIONS
const PASSWORD = 'vault-session-password-1234'
const IDLE_MINUTES = 5
const IDLE_MS = IDLE_MINUTES * 60_000

/** 只假造计时相关的 API（见文件头注释）；`setImmediate` / 微任务保持真实 */
const FAKE_TIMER_APIS = ['Date', 'setTimeout', 'clearTimeout'] as const

/** 真实宏任务：让动态 import 与 IndexedDB 的异步链路跑完，且不受假定时器影响 */
const realSetTimeout = globalThis.setTimeout
async function settle(ticks = 12): Promise<void> {
  for (let index = 0; index < ticks; index += 1) {
    await new Promise<void>((resolve) => {
      realSetTimeout(() => {
        resolve()
      }, 0)
    })
  }
}

/** 合成表：字段值只为验证「锁定后内存里还留着什么」，不含任何真实名单内容 */
const SHEET: RawSheet = {
  sourceKind: 'csv',
  sourceSheet: '合成表',
  sourceFileName: '合成_名单.csv',
  header: { sourceKind: 'csv', sourceSheet: '合成表', sourceRow: 1, headers: ['姓名', 'offer状态'], hidden: false },
  rows: [
    {
      sourceKind: 'csv',
      sourceSheet: '合成表',
      sourceRow: 2,
      cells: ['合成姓名', '已入职'],
      emptyRow: false,
      hidden: false,
      parseNotes: [],
    },
  ],
  physicalRowCount: 2,
  columnCount: 2,
  emptyRowCount: 0,
  hiddenRowCount: 0,
  hiddenColumnIndexes: [],
  sheetHidden: false,
  formulaWithoutCacheCount: 0,
  skippedSheets: [],
  issues: [],
  date1904: null,
  encoding: 'utf-8',
  delimiter: ',',
}

/** 清洗设置草稿：属于用户配置，锁定 / 清空后必须保留 */
const SETTINGS = createDefaultCleaningSettings({ dataAsOf: '2026-09-26' })

/** 会话只持有引用、不读数据集内部字段：窄桩即可（`as unknown as` 是刻意的） */
const DATASET = { metadata: { dataAsOf: '2026-09-26' } } as unknown as NormalizedDataset


/** 解锁并写满内存业务数据，供「锁定后清掉什么」的用例复用 */
async function unlockWithBusinessData(): Promise<void> {
  await createVault(PASSWORD, { iterations: ITERATIONS, idleLockMinutes: IDLE_MINUTES })
  setImportSheet(SHEET)
  saveCleaningSettingsDraft(SETTINGS)
  commitNormalizedDataset(DATASET)
  // 等「从仓元数据同步闲置分钟数」这条异步链路跑完，否则计时器还停在默认 15 分钟
  await settle()
}

const handles: Array<() => void> = []

/** 会话（内存）与仓（IndexedDB）都是模块级单例：每个用例前后都清干净 */
async function resetAll(): Promise<void> {
  vi.useRealTimers()
  while (handles.length > 0) {
    const stop = handles.pop()
    if (stop !== undefined) {
      stop()
    }
  }
  clearImportSession()
  clearCleaningSettingsDraft()
  lockVault('manual')
  await clearVault()
}

describe('应用级会话守卫（步骤6：解锁计时 / 闲置锁定 / 锁定清数据）', () => {
  beforeEach(resetAll)
  afterEach(resetAll)

  it('外壳未挂载时读到 null 与 0：界面不假装在计时', () => {
    expect(activeVaultSessionGuard()).toBeNull()
    expect(readVaultIdleRemainingMs()).toBe(0)
  })

  it('解锁即开始计时、闲置分钟数从仓元数据同步，手动锁定后停表', async () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMER_APIS] })
    const guard = mountVaultSessionGuard()
    handles.push(guard.stop)
    expect(activeVaultSessionGuard()).toBe(guard)
    // 还没解锁：不排定时器，避免把「没有仓」当成「已解锁在计时」
    expect(readVaultIdleRemainingMs()).toBe(0)

    await createVault(PASSWORD, { iterations: ITERATIONS, idleLockMinutes: IDLE_MINUTES })
    await settle()

    // 默认 15 分钟被仓里存的 5 分钟覆盖（两份真相只留仓这一份）
    expect(guard.getIdleLockMinutes()).toBe(IDLE_MINUTES)
    expect(readVaultIdleRemainingMs()).toBe(IDLE_MS)

    lockVault('manual')
    expect(hasVaultKeys()).toBe(false)
    expect(readVaultIdleRemainingMs()).toBe(0)
    // 守卫本身仍在挂载（只是停表）：外壳不需要因为一次锁定就重建它
    expect(activeVaultSessionGuard()).toBe(guard)
  })

  it('闲置到点：按 idle 理由自动锁定，清掉内存业务数据但保留用户配置', async () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMER_APIS] })
    const guard = mountVaultSessionGuard({ minutes: IDLE_MINUTES })
    handles.push(guard.stop)
    await unlockWithBusinessData()
    expect(getImportSession().sheet).not.toBeNull()

    const events: VaultEvent[] = []
    subscribeVaultEvents((event) => {
      events.push(event)
    })

    vi.advanceTimersByTime(IDLE_MS)

    expect(hasVaultKeys()).toBe(false)
    expect(events.filter((event) => event.type === 'locked')).toEqual([{ type: 'locked', reason: 'idle' }])
    // 业务数据（导入的表格 / 已提交数据集）必须离开内存
    expect(getImportSession().sheet).toBeNull()
    expect(getCleaningSession().dataset).toBeNull()
    // 用户配置（清洗设置草稿）保留：自动锁定不该顺手弄丢设置
    expect(getCleaningSession().settings).toEqual(SETTINGS)
    expect(readVaultIdleRemainingMs()).toBe(0)

    // 已锁定：活动刷新与继续等待都不会产生第二次锁定事件
    guard.noteActivity()
    vi.advanceTimersByTime(IDLE_MS * 10)
    expect(events.filter((event) => event.type === 'locked')).toHaveLength(1)
  })

  it('过期会话 / 仓被清空 / 连接被关闭：同样清掉内存业务数据（配置保留）', () => {
    const guard = mountVaultSessionGuard({ minutes: IDLE_MINUTES })
    handles.push(guard.stop)
    const events: readonly VaultEvent[] = [
      { type: 'stale-session' },
      { type: 'cleared' },
      { type: 'connection-closed', reason: '其他标签页已改密' },
    ]

    for (const event of events) {
      setImportSheet(SHEET)
      saveCleaningSettingsDraft(SETTINGS)
      commitNormalizedDataset(DATASET)

      emitVaultEvent(event)

      expect(getImportSession().sheet).toBeNull()
      expect(getCleaningSession().dataset).toBeNull()
      expect(getCleaningSession().settings).toEqual(SETTINGS)
    }
  })

  it('卸载守卫后：不再计时，也不再因事件清数据（外壳卸载路径）', async () => {
    vi.useFakeTimers({ toFake: [...FAKE_TIMER_APIS] })
    const guard = mountVaultSessionGuard({ minutes: IDLE_MINUTES })
    await createVault(PASSWORD, { iterations: ITERATIONS, idleLockMinutes: IDLE_MINUTES })
    guard.stop()

    expect(activeVaultSessionGuard()).toBeNull()
    expect(readVaultIdleRemainingMs()).toBe(0)

    vi.advanceTimersByTime(IDLE_MS)
    // 计时器已停：即使真等到闲置时长也不会自动锁定
    expect(hasVaultKeys()).toBe(true)

    setImportSheet(SHEET)
    emitVaultEvent({ type: 'stale-session' })
    expect(getImportSession().sheet).not.toBeNull()
  })

  it('mountVaultSession：无 DOM 环境下活动监视为空操作，卸载函数可重复调用', async () => {
    expect(typeof globalThis.window).toBe('undefined')
    const unmount = mountVaultSession({ minutes: IDLE_MINUTES })
    await createVault(PASSWORD, { iterations: ITERATIONS, idleLockMinutes: IDLE_MINUTES })
    expect(activeVaultSessionGuard()).not.toBeNull()

    unmount()
    unmount()

    expect(activeVaultSessionGuard()).toBeNull()
    expect(readVaultIdleRemainingMs()).toBe(0)
  })
})
