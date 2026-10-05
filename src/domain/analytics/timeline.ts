/**
 * 分月趋势聚合（docs/PRD.md 6.3 末段与 8 章「总览」）。
 *
 * 为什么单独一个模块，而不是复用 `aggregateByDimension`：
 * - 趋势的横轴不是 `GROUP_DIMENSIONS` 里的业务维度（城市 / 渠道 / HR…），
 *   拿业务维度冒充时间轴会让「哪个月」说不清；
 * - 横轴口径必须写死：**只按合法日期分月**。日期缺失或非法的记录单列计数，
 *   既不当 0，也不悄悄塞进某个月份（PRD 6.1「不显示 0% 掩盖」的同一原则）；
 * - 每个月份批次复用 `summarizeRecords`，N/J/P/A/R/D、各率与周期口径和 KPI 卡片完全一致，
 *   这里**不**另写任何公式（AGENTS.md §2.3）。
 *
 * 红线（PRD 6.3）：附件里没有 offer 发出时间，所以这里的月份**不是**「发 offer 趋势」；
 * 按入职日期切分也**不能**说成「发 offer 批次表现」。两种基准的口径提示由 `timelineNote()` 统一给出，
 * 组件只需原样展示，不得自己编文案。
 */

import type { DateOnly, NormalizedRecord } from '../types'

import { isCalendarDateOnly } from './calendar'
import { TIME_BASIS_LABELS, type TimeBasis } from './filters'
import { summarizeRecords, type GroupSummary } from './grouping'

/** 一个月份的聚合结果；`summary` 与分组聚合同结构，页面只展示、不再计算 */
export type TimelineBucket = {
  /** 月份键：`YYYY-MM`（由合法日历日截取，不是按系统时区推算） */
  readonly periodKey: string
  readonly summary: GroupSummary
}

/** 一次趋势聚合的结果（含口径与「没进趋势的记录数」，避免只给一张图） */
export type TimelineResult = {
  readonly basis: TimeBasis
  readonly buckets: readonly TimelineBucket[]
  /** 基准日期缺失或非法、未纳入任何月份的记录数（单独计数，不当 0 也不丢） */
  readonly missingDateCount: number
  /** 口径提示：界面与报告都取这里，禁止各自发挥 */
  readonly note: string
}

/**
 * 取月份键；`null` 表示该记录没有可用的基准日期（缺失或非法）。
 * 非法日期（如 `2026-02-30`、`2026-13-05`）一律返回 null，**不**取前 7 位凑一个月份出来。
 */
export function periodKeyOf(date: DateOnly | null): string | null {
  if (date === null || !isCalendarDateOnly(date)) {
    return null
  }
  return date.slice(0, 7)
}

/** 趋势口径提示（PRD 6.3：不得把启动 / 入职日期说成「发 offer 趋势」） */
export function timelineNote(basis: TimeBasis): string {
  return basis === 'recruitmentStartDate'
    ? '按「启动招聘日期」分月统计（启动批次）：附件没有 offer 发出时间，不能当作「发 offer 趋势」'
    : '按「入职日期」分月统计（实际到岗）：不是发 offer 批次表现，也不能反推审批时点'
}

/**
 * 按时间基准分月聚合。
 *
 * 顺序与口径固定：只按合法日期分月 → 月份键升序 → 每批复用 `summarizeRecords`。
 * 同一份记录与基准必然得到同一结果（可作为报告与 AI 摘要的稳定输入）。
 */
export function aggregateByMonth(
  records: readonly NormalizedRecord[],
  basis: TimeBasis = 'recruitmentStartDate',
): TimelineResult {
  const buckets = new Map<string, NormalizedRecord[]>()
  let missingDateCount = 0

  for (const record of records) {
    const periodKey = periodKeyOf(record[basis])
    if (periodKey === null) {
      missingDateCount += 1
      continue
    }
    const bucket = buckets.get(periodKey)
    if (bucket === undefined) {
      buckets.set(periodKey, [record])
    } else {
      bucket.push(record)
    }
  }

  const ordered = [...buckets.entries()]
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0))
    .map(([periodKey, bucketRecords]) => ({
      periodKey,
      summary: summarizeRecords(periodKey, bucketRecords),
    }))

  return {
    basis,
    buckets: ordered,
    missingDateCount,
    note: `${timelineNote(basis)}；基准为「${TIME_BASIS_LABELS[basis]}」`,
  }
}

/** 各月份 N 之和 + 未纳入记录数是否等于记录总数（不成立说明趋势漏算，必须暴露） */
export function timelineCoversAllRecords(
  result: TimelineResult,
  totalCount: number,
): boolean {
  const counted = result.buckets.reduce((sum, bucket) => sum + bucket.summary.counts.total, 0)
  return counted + result.missingDateCount === totalCount
}
