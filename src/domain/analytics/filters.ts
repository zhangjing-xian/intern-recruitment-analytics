/**
 * 筛选快照与过滤规则（docs/PRD.md 6.3）。
 *
 * 规则（唯一实现，页面不得自行判断）：
 * - **不同字段之间 AND，同一字段多选 OR**；某字段未选择 = 不过滤；
 * - 「未知」是**可选的独立值**，不是被自动排除的脏数据；
 * - 状态筛选会改变 D，必须提示「**当前子集率**」（见 `statusSubset`）；
 * - 时间**默认不筛选**；用户选择时默认按「启动招聘日期」，可切换「入职日期」，并在顶部显示选中基准；
 *   日期缺失的记录单列计数，由用户决定是否纳入（`includeMissingDate`）；
 * - 去重策略只排除**显式判为** `removedAsDuplicate` 的记录；尚未确认的重复行保留并单独计数。
 */

import type { OfferStatus } from '../enums'
import type { DateOnly, NormalizedRecord } from '../types'

import { compareDateOnly } from './calendar'
import {
  GROUP_DIMENSIONS,
  GROUP_DIMENSION_LABELS,
  dimensionValueOf,
  type GroupDimension,
  type GroupingOptions,
} from './grouping'

export const TIME_BASES = ['recruitmentStartDate', 'joiningDate'] as const
export type TimeBasis = (typeof TIME_BASES)[number]

export const TIME_BASIS_LABELS: Readonly<Record<TimeBasis, string>> = {
  recruitmentStartDate: '启动招聘日期',
  joiningDate: '入职日期',
}

/** 时间筛选；`from` / `to` 为 null 表示该端不限制（按日历日，含端点） */
export type TimeFilter = {
  readonly basis: TimeBasis
  readonly from: DateOnly | null
  readonly to: DateOnly | null
  /** 是否把基准日期缺失的记录纳入（默认否：缺失单独计数，不当成落区间内） */
  readonly includeMissingDate: boolean
}

/** 一次筛选快照：会随报告与 AI 摘要一起冻结，避免「结论对应哪次筛选」说不清 */
export type AnalysisFilters = {
  readonly dimensions: Readonly<Partial<Record<GroupDimension, readonly string[]>>>
  /** 状态筛选（空数组 = 不过滤）；单组筛选会显示「当前子集率」提示 */
  readonly statuses: readonly OfferStatus[]
  readonly time: TimeFilter | null
}

export const EMPTY_FILTERS: AnalysisFilters = {
  dimensions: {},
  statuses: [],
  time: null,
}

/** 是否启用了状态筛选（启用后所有率都是「当前子集率」，必须提示） */
export function isStatusSubsetFilter(filters: AnalysisFilters): boolean {
  return filters.statuses.length > 0
}

/** 去重策略的保留规则：只排除显式判为移重的记录，**不**静默删除未确认的重复行 */
export function retainedRecords(records: readonly NormalizedRecord[]): readonly NormalizedRecord[] {
  return records.filter((record) => record.dedupDecision.action !== 'removedAsDuplicate')
}

/** 尚未确认去重的重复行数（保留在分析集中，但必须在质量提示里说明） */
export function unconfirmedDuplicateCount(records: readonly NormalizedRecord[]): number {
  return records.filter((record) => record.dedupDecision.action === 'pendingUserConfirmation')
    .length
}

/** 日期是否落在区间内；缺失 / 非法返回 null（调用方据此单独计数） */
function isDateInRange(date: DateOnly | null, time: TimeFilter): boolean | null {
  if (date === null) {
    return null
  }
  if (time.from !== null) {
    const afterFrom = compareDateOnly(date, time.from)
    if (afterFrom === null) {
      return null
    }
    if (afterFrom < 0) {
      return false
    }
  }
  if (time.to !== null) {
    const afterTo = compareDateOnly(date, time.to)
    if (afterTo === null) {
      return null
    }
    if (afterTo > 0) {
      return false
    }
  }
  return true
}

/** 筛选结果：既给记录，也给「为什么少了 / 少了多少」，页面直接展示 */
export type FilterOutcome = {
  readonly records: readonly NormalizedRecord[]
  readonly totalCount: number
  readonly retainedCount: number
  readonly matchedCount: number
  readonly excludedByStatus: number
  readonly missingDateCount: number
  readonly droppedDuplicateCount: number
  readonly statusSubset: boolean
}

/**
 * 应用筛选快照：先去重规则 → 维度（AND/OR）→ 状态 → 时间。
 * 顺序固定，保证「同一筛选快照得到同一结果」。
 */
export function applyFilters(
  records: readonly NormalizedRecord[],
  filters: AnalysisFilters = EMPTY_FILTERS,
  options: GroupingOptions = {},
): FilterOutcome {
  const retained = retainedRecords(records)
  let matched: readonly NormalizedRecord[] = retained

  for (const dimension of GROUP_DIMENSIONS) {
    const selected = filters.dimensions[dimension]
    if (selected === undefined || selected.length === 0) {
      continue
    }
    const allowed = new Set<string>(selected)
    matched = matched.filter((record) =>
      allowed.has(dimensionValueOf(record, dimension, options)),
    )
  }

  let excludedByStatus = 0
  if (filters.statuses.length > 0) {
    const allowed = new Set<OfferStatus>(filters.statuses)
    const before = matched.length
    matched = matched.filter((record) => allowed.has(record.offerStatus))
    excludedByStatus = before - matched.length
  }

  let missingDateCount = 0
  const time = filters.time
  if (time !== null && (time.from !== null || time.to !== null)) {
    const kept: NormalizedRecord[] = []
    for (const record of matched) {
      const inRange = isDateInRange(record[time.basis], time)
      if (inRange === true) {
        kept.push(record)
      } else if (inRange === null) {
        missingDateCount += 1
        if (time.includeMissingDate) {
          kept.push(record)
        }
      }
    }
    matched = kept
  }

  return {
    records: matched,
    totalCount: records.length,
    retainedCount: retained.length,
    matchedCount: matched.length,
    excludedByStatus,
    missingDateCount,
    droppedDuplicateCount: records.length - retained.length,
    statusSubset: isStatusSubsetFilter(filters),
  }
}

/** 当前生效筛选的可读描述（顶部状态条与报告导出共用，避免组件各写一份） */
export function describeActiveFilters(filters: AnalysisFilters): readonly string[] {
  const descriptions: string[] = []

  for (const dimension of GROUP_DIMENSIONS) {
    const selected = filters.dimensions[dimension]
    if (selected !== undefined && selected.length > 0) {
      descriptions.push(`${GROUP_DIMENSION_LABELS[dimension]}：${selected.join('、')}`)
    }
  }

  if (filters.statuses.length > 0) {
    descriptions.push(`offer 状态：${filters.statuses.join('、')}（当前为子集率）`)
  }

  const time = filters.time
  if (time !== null && (time.from !== null || time.to !== null)) {
    const from = time.from ?? '不限'
    const to = time.to ?? '不限'
    const missing = time.includeMissingDate ? '已纳入日期缺失记录' : '日期缺失记录不纳入'
    descriptions.push(`时间基准：${TIME_BASIS_LABELS[time.basis]} ${from} 至 ${to}（${missing}）`)
  }

  return descriptions
}
