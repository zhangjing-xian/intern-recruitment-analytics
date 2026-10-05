/**
 * 周期与等待时长（docs/PRD.md 6.1、9.3）。
 *
 * 口径分三种，**绝不能混用**：
 * 1. 实际招聘周期：`入职日期 − 启动日期`，**只对已入职记录**、日历日、合法且非负；
 * 2. 待入职计划周期：待入职记录的「入职时间」是**计划**日期，单独统计、单独展示；
 * 3. 当前等待时长：待入职 / 审批中的 `截至日 − 启动日`，只能叫「当前等待时长」。
 *
 * 另外两条红线：
 * - **不使用计划入职日计算拒 offer 的决策耗时**（附件缺拒绝日期 → 历史等待时长一律「未知」）；
 * - 日期缺失 / 非法 / 为负一律 `null`（**不当 0 天**），并计入 `excludedCount` 而不是静默丢弃。
 */

import {
  AWAITING_APPROVAL_STATUS,
  JOINED_STATUS,
  PENDING_JOINING_STATUS,
  type TriState,
} from '../enums'
import type { DateOnly, NormalizedRecord } from '../types'

import { calendarDaysBetween } from './calendar'
import { quantile, sortNumbersAscending } from './quantile'

/** 招聘周期超长提示阈值默认值（与清洗设置同源；只提示，**不**自动截尾或删除） */
export const DEFAULT_CYCLE_TOO_LONG_DAYS = 180

/** 两端日期都存在且日历差非负时返回天数差；否则 null（缺失、非法、为负都不算周期） */
function cycleBetween(from: DateOnly | null, to: DateOnly | null): number | null {
  if (from === null || to === null) {
    return null
  }
  const days = calendarDaysBetween(from, to)
  if (days === null || days < 0) {
    return null
  }
  return days
}

/**
 * 实际招聘周期（天）：仅「已入职」记录。
 * 清洗层已算过时以它为唯一来源（同一口径），缺失时才由本引擎用日期重算，
 * 便于合成数据或历史数据在未经过清洗层时也能得到一致结果。
 */
export function actualCycleDays(record: NormalizedRecord): number | null {
  if (record.offerStatus !== JOINED_STATUS) {
    return null
  }
  const derived = record.derived?.recruitmentCycleDays
  if (typeof derived === 'number' && Number.isFinite(derived)) {
    return derived >= 0 ? derived : null
  }
  return cycleBetween(record.recruitmentStartDate, record.joiningDate)
}

/** 待入职计划周期（天）：仅「待入职」记录；「入职时间」列此时是计划日期 */
export function plannedCycleDays(record: NormalizedRecord): number | null {
  if (record.offerStatus !== PENDING_JOINING_STATUS) {
    return null
  }
  return cycleBetween(record.recruitmentStartDate, record.joiningDate)
}

/** 预计实习天数（天）= 预计离职 − 入职；**仅计划口径**，不能称实际留存 */
export function expectedInternshipDays(record: NormalizedRecord): number | null {
  return cycleBetween(record.joiningDate, record.expectedEndDate)
}

/** 一组周期的统计结果：P25 / 中位数 / P75 / 均值 + 有效 n + 被排除数（分位口径见 ./quantile.ts） */
export type CycleStats = {
  readonly n: number
  readonly meanDays: number | null
  /** P25；步骤9 的「周期分位表」用它，页面不得自己算分位 */
  readonly p25Days: number | null
  readonly medianDays: number | null
  readonly p75Days: number | null
  /** 未进入样本的记录数（状态不符、日期缺失 / 非法 / 为负） */
  readonly excludedCount: number
  readonly note: string
}

const EMPTY_CYCLE_STATS: CycleStats = {
  n: 0,
  meanDays: null,
  p25Days: null,
  medianDays: null,
  p75Days: null,
  excludedCount: 0,
  note: '无有效样本：显示「—/无有效样本」，不显示 0 天',
}

/** 由有效天数样本构造统计；`excludedCount` 与 `note` 必须由调用方给出真实口径 */
export function summarizeCycles(
  samples: readonly number[],
  options: { readonly excludedCount: number; readonly note: string },
): CycleStats {
  const sorted = sortNumbersAscending(samples)
  if (sorted.length === 0) {
    return { ...EMPTY_CYCLE_STATS, excludedCount: options.excludedCount, note: options.note }
  }

  const total = sorted.reduce((sum, days) => sum + days, 0)
  return {
    n: sorted.length,
    meanDays: total / sorted.length,
    p25Days: quantile(sorted, 0.25),
    medianDays: quantile(sorted, 0.5),
    p75Days: quantile(sorted, 0.75),
    excludedCount: options.excludedCount,
    note: options.note,
  }
}

/** 各记录取一个代表值，跳过 null 并统计被排除数 */
function collectDays(
  records: readonly NormalizedRecord[],
  pick: (record: NormalizedRecord) => number | null,
): { readonly samples: readonly number[]; readonly excludedCount: number } {
  const samples: number[] = []
  for (const record of records) {
    const days = pick(record)
    if (days !== null) {
      samples.push(days)
    }
  }
  return { samples, excludedCount: records.length - samples.length }
}

/** 平均实际招聘周期：Σ 合法周期 / 有效已入职样本数（默认**仅** J） */
export function actualCycleStats(records: readonly NormalizedRecord[]): CycleStats {
  const { samples, excludedCount } = collectDays(records, actualCycleDays)
  return summarizeCycles(samples, {
    excludedCount,
    note: '仅已入职记录；日期缺失、非法或为负的记录不进样本，也不能当作 0 天',
  })
}

/** 待入职计划周期：P 中合法日期差的均值 / 中位数，**单独显示**，不能混入实际周期 */
export function plannedCycleStats(records: readonly NormalizedRecord[]): CycleStats {
  const { samples, excludedCount } = collectDays(records, plannedCycleDays)
  return summarizeCycles(samples, {
    excludedCount,
    note: '仅待入职记录，使用「入职时间」列的计划日期；与实际周期分开显示',
  })
}

/** 预计实习天数统计（可选指标）：预计离职 − 入职，仅计划口径 */
export function expectedInternshipStats(records: readonly NormalizedRecord[]): CycleStats {
  const { samples, excludedCount } = collectDays(records, expectedInternshipDays)
  return summarizeCycles(samples, {
    excludedCount,
    note: '预计实习天数 = 预计离职 − 入职；只是计划，不能称实际留存',
  })
}

/** 等待时长的两种合法口径，未取得时为 `unknown` */
export type WaitingKind = 'actualCycle' | 'currentWaiting' | 'unknown'

export type RecordWaitingDuration = {
  readonly kind: WaitingKind
  /** 天数；`unknown` 时为 null（**不**当 0，也**不**当「未超时」） */
  readonly days: number | null
  readonly note: string
}

/**
 * 单条记录的等待时长（docs/PRD.md 9.3 时间条件）：
 * 已入职 → 实际周期（可做事后描述）；待入职 / 审批中 → 当前等待时长；拒 offer / 其他 / 未知 → 未知。
 */
export function waitingDurationFor(
  record: NormalizedRecord,
  dataAsOf: DateOnly,
): RecordWaitingDuration {
  if (record.offerStatus === JOINED_STATUS) {
    const days = actualCycleDays(record)
    return {
      kind: days === null ? 'unknown' : 'actualCycle',
      days,
      note: '已入职：实际周期可用于事后描述，不能作为预测特征',
    }
  }

  if (
    record.offerStatus === PENDING_JOINING_STATUS ||
    record.offerStatus === AWAITING_APPROVAL_STATUS
  ) {
    const days = cycleBetween(record.recruitmentStartDate, dataAsOf)
    return {
      kind: days === null ? 'unknown' : 'currentWaiting',
      days,
      note: '当前等待时长 = 截至日 − 启动日；不是历史拒 offer 周期',
    }
  }

  return {
    kind: 'unknown',
    days: null,
    note: '拒 offer / 其他 / 未知：附件缺拒绝日期，历史等待时长未知（不得当 0 或未超时）',
  }
}

/** 是否超过等待阈值；天数未知时返回 null（未知条件保持 unknown） */
export function isWaitingTooLong(duration: RecordWaitingDuration, thresholdDays: number): TriState {
  if (duration.days === null) {
    return null
  }
  return duration.days > thresholdDays
}

/** 实际周期超过阈值的记录数（只计数，不修改数据） */
export function cycleTooLongCount(
  records: readonly NormalizedRecord[],
  thresholdDays: number = DEFAULT_CYCLE_TOO_LONG_DAYS,
): number {
  let count = 0
  for (const record of records) {
    const days = actualCycleDays(record)
    if (days !== null && days > thresholdDays) {
      count += 1
    }
  }
  return count
}
