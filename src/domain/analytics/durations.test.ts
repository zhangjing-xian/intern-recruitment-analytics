/**
 * 周期与等待时长单测（docs/PRD.md 6.1 / 9.3 + 12.2）。
 * 基准：两条已入职周期 10 / 20 天 → 平均 15 天；其余状态日期不进实际周期；
 * 待入职的计划周期单独统计；拒 offer 的历史等待时长一律「未知」。
 */

import { describe, expect, it } from 'vitest'

import { calendarDaysBetween, compareDateOnly, isCalendarDateOnly } from './calendar'
import { PRD_12_2_RECORDS, syntheticRecords } from './fixtures'
import {
  DEFAULT_CYCLE_TOO_LONG_DAYS,
  actualCycleDays,
  actualCycleStats,
  cycleTooLongCount,
  expectedInternshipDays,
  expectedInternshipStats,
  isWaitingTooLong,
  plannedCycleDays,
  plannedCycleStats,
  waitingDurationFor,
} from './durations'

describe('日历日工具', () => {
  it('按日历日相减：同日为 0 天，跨月跨年不偏移', () => {
    expect(calendarDaysBetween('2026-01-05', '2026-01-15')).toBe(10)
    expect(calendarDaysBetween('2026-01-15', '2026-01-15')).toBe(0)
    expect(calendarDaysBetween('2025-12-31', '2026-01-01')).toBe(1)
  })

  it('非法日期返回 null（不猜、不当 0 天）', () => {
    expect(isCalendarDateOnly('2026-02-30')).toBe(false)
    expect(calendarDaysBetween('2026-02-30', '2026-03-02')).toBeNull()
    expect(calendarDaysBetween('2026/03/02', '2026-03-05')).toBeNull()
  })

  it('日期先后比较：任一端非法返回 null', () => {
    expect(compareDateOnly('2026-01-01', '2026-01-02')).toBe(-1)
    expect(compareDateOnly('2026-01-02', '2026-01-01')).toBe(1)
    expect(compareDateOnly('2026-01-01', '2026-01-01')).toBe(0)
    expect(compareDateOnly('不是日期', '2026-01-01')).toBeNull()
  })
})

describe('实际招聘周期（仅已入职）', () => {
  it('PRD 12.2：两条已入职周期 10 / 20 天，平均 15 天', () => {
    const [first, second] = PRD_12_2_RECORDS
    expect(actualCycleDays(first)).toBe(10)
    expect(actualCycleDays(second)).toBe(20)

    const stats = actualCycleStats(PRD_12_2_RECORDS)
    expect(stats.n).toBe(2)
    expect(stats.meanDays).toBe(15)
    expect(stats.p25Days).toBe(12.5)
    expect(stats.medianDays).toBe(15)
    expect(stats.p75Days).toBe(17.5)
    expect(stats.excludedCount).toBe(4)
  })

  it('非已入职状态、日期缺失、周期为负一律 null（不计入样本）', () => {
    const [pending, rejected] = syntheticRecords([
      { offerStatus: '待入职', recruitmentStartDate: '2026-03-01', joiningDate: '2026-03-21' },
      { offerStatus: '拒绝offer', recruitmentStartDate: '2026-03-01', joiningDate: '2026-03-21' },
    ])
    expect(actualCycleDays(pending)).toBeNull()
    expect(actualCycleDays(rejected)).toBeNull()

    const [noDates, negative, sameDay] = syntheticRecords([
      { offerStatus: '已入职' },
      { offerStatus: '已入职', recruitmentStartDate: '2026-03-10', joiningDate: '2026-03-01' },
      { offerStatus: '已入职', recruitmentStartDate: '2026-03-10', joiningDate: '2026-03-10' },
    ])
    expect(actualCycleDays(noDates)).toBeNull()
    expect(actualCycleDays(negative)).toBeNull()
    expect(actualCycleDays(sameDay)).toBe(0)
  })

  it('清洗层已算出的派生周期优先（同一口径，不重复计算）', () => {
    const [record] = syntheticRecords([
      {
        offerStatus: '已入职',
        recruitmentStartDate: '2026-03-01',
        joiningDate: '2026-03-21',
        derived: {
          recruitmentCycleDays: 7,
          actualCycleEligible: true,
          plannedCycleEligible: false,
          isAccepted: true,
          isRejected: false,
          countedInCoreDenominator: true,
          salaryBenchmark: null,
          salaryPercentileRank: null,
          isBelowMedian: null,
          dataQualityFlags: [],
        },
      },
    ])
    expect(actualCycleDays(record)).toBe(7)
  })
})

describe('待入职计划周期与实际周期分开', () => {
  it('计划周期只取待入职记录，单独统计', () => {
    const stats = plannedCycleStats(PRD_12_2_RECORDS)
    expect(stats.n).toBe(1)
    expect(stats.meanDays).toBe(20)
    expect(stats.excludedCount).toBe(5)
    expect(stats.note).toContain('与实际周期分开显示')
  })

  it('计划日期早于启动日期时不可用（不进样本，也不当 0）', () => {
    const [record] = syntheticRecords([
      { offerStatus: '待入职', recruitmentStartDate: '2026-03-21', joiningDate: '2026-03-01' },
    ])
    expect(plannedCycleDays(record)).toBeNull()
    expect(plannedCycleStats([record]).n).toBe(0)
  })

  it('实际周期与计划周期不相加：两份统计的样本互不混入', () => {
    expect(actualCycleStats(PRD_12_2_RECORDS).n).toBe(2)
    expect(plannedCycleStats(PRD_12_2_RECORDS).n).toBe(1)
  })
})

describe('预计实习天数（计划口径）', () => {
  it('预计离职 − 入职，仅作计划展示', () => {
    const [record] = syntheticRecords([
      { offerStatus: '待入职', joiningDate: '2026-03-21', expectedEndDate: '2026-06-19' },
    ])
    expect(expectedInternshipDays(record)).toBe(90)
    expect(expectedInternshipStats([record]).n).toBe(1)
    expect(expectedInternshipStats([record]).note).toContain('不能称实际留存')
  })

  it('预计离职缺失时不计入，n = 0', () => {
    const [record] = syntheticRecords([{ offerStatus: '待入职', joiningDate: '2026-03-21' }])
    expect(expectedInternshipDays(record)).toBeNull()
    expect(expectedInternshipStats([record]).n).toBe(0)
  })
})

describe('等待时长与超阈判定', () => {
  it('已入职取实际周期；待入职 / 审批中取当前等待时长（截至日 − 启动日）', () => {
    const joined = waitingDurationFor(PRD_12_2_RECORDS[0], '2026-09-26')
    expect(joined.kind).toBe('actualCycle')
    expect(joined.days).toBe(10)

    const pending = waitingDurationFor(PRD_12_2_RECORDS[2], '2026-03-31')
    expect(pending.kind).toBe('currentWaiting')
    expect(pending.days).toBe(30)
    expect(pending.note).toContain('当前等待时长')

    const approving = waitingDurationFor(PRD_12_2_RECORDS[3], '2026-04-09')
    expect(approving.kind).toBe('currentWaiting')
    expect(approving.days).toBe(30)
  })

  it('拒 offer 的历史等待时长一律未知（附件缺拒绝日期，不用计划日推算）', () => {
    const rejected = waitingDurationFor(PRD_12_2_RECORDS[4], '2026-09-26')
    expect(rejected.kind).toBe('unknown')
    expect(rejected.days).toBeNull()
    expect(rejected.note).toContain('缺拒绝日期')
  })

  it('天数未知时超阈判定返回 null（未知保持 unknown，不当未超时）', () => {
    expect(isWaitingTooLong(waitingDurationFor(PRD_12_2_RECORDS[4], '2026-09-26'), 30)).toBeNull()
    expect(isWaitingTooLong(waitingDurationFor(PRD_12_2_RECORDS[2], '2026-03-31'), 30)).toBe(false)
    expect(isWaitingTooLong(waitingDurationFor(PRD_12_2_RECORDS[2], '2026-04-01'), 30)).toBe(true)
  })
})

describe('超长周期计数', () => {
  it('只统计并提示，不修改数据', () => {
    const records = syntheticRecords([
      { offerStatus: '已入职', recruitmentStartDate: '2026-01-01', joiningDate: '2026-07-01' },
      { offerStatus: '已入职', recruitmentStartDate: '2026-01-01', joiningDate: '2026-01-11' },
    ])
    expect(cycleTooLongCount(records)).toBe(1)
    expect(DEFAULT_CYCLE_TOO_LONG_DAYS).toBe(180)
    expect(cycleTooLongCount(records, 365)).toBe(0)
  })
})
