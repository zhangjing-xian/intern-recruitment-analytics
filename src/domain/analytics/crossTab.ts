/**
 * 二维交叉表（步骤9，docs/PRD.md 8 章「渠道与推荐人」「HR 效能」）。
 *
 * 为什么单独一个函数：分组聚合只回答「某个维度上各值的表现」，而这类页面要求
 * 「渠道 × 推荐类型」「HR × 岗位结构」的二维分布——用两个维度分别聚合再拼表，
 * 会出现「行合计 + 列合计 ≠ 总数」的口径错误。这里每一格都用同一个
 * `summarizeRecords` 汇总，因此：
 * - `Σ 各格 N = 全部记录数`（一个记录只落进一格，不是两套统计拼起来）；
 * - 行合计 / 列合计 / 全表合计也各自**重新汇总**，不从其他格子相加率；
 * - 「未知」永远排在最后并保留为正常取值，不被丢弃。
 *
 * 边界：本模块只做分组与汇总，不复制任何率 / 分位的公式（公式在 ./rates.ts、./quantile.ts）。
 */

import { UNKNOWN } from '../enums'
import type { NormalizedRecord } from '../types'

import {
  aggregateByDimension,
  dimensionValueOf,
  sortGroupsByDenominator,
  summarizeRecords,
  type GroupDimension,
  type GroupSummary,
  type GroupingOptions,
} from './grouping'

/** 通用交叉表口径提示（调用方可直接展示；行 / 列维度是两个维度，不能合并成一个） */
export const CROSS_TAB_NOTE =
  '交叉表每一格都是「行维度值 × 列维度值」记录的完整汇总（N / J / P / A / R / D、各率、有效周期 n）；行合计、列合计与全表合计也各自重新汇总，不把两套统计拼在一起。'

/** 渠道 × 推荐类型的专项口径（PRD 8 章：两者不是同一个维度） */
export const CHANNEL_REFERRAL_NOTE =
  '渠道（官网 / Boss / 实习僧 / 内推）与推荐类型（内推 / HR 推）是两个维度，不能合并为一个；格子里的 0 表示该组合在本次筛选下没有记录，不是缺失。渠道质量只代表 offer 阶段表现，不能称为渠道 ROI。'

/** 一格：行维度值 × 列维度值（组合内没有记录时是 N = 0 的正常分组，不是缺失） */
export type CrossTabCell = {
  readonly rowKey: string
  readonly columnKey: string
  readonly summary: GroupSummary
}

export type CrossTabResult = {
  readonly rowDimension: GroupDimension
  readonly columnDimension: GroupDimension
  /** 行取值（按 D 降序排列，「未知」固定最后） */
  readonly rowKeys: readonly string[]
  /** 列取值（同上） */
  readonly columnKeys: readonly string[]
  readonly cells: readonly CrossTabCell[]
  readonly rowTotals: readonly GroupSummary[]
  readonly columnTotals: readonly GroupSummary[]
  /** 全表合计（= 传入的全部记录） */
  readonly total: GroupSummary
  readonly note: string
}

/** 取值顺序：按 D 降序 → N 降序 → 取值升序；「未知」固定排在最后，避免被当成异常值消失 */
function orderedKeys(
  records: readonly NormalizedRecord[],
  dimension: GroupDimension,
  options: GroupingOptions,
): readonly string[] {
  const groups = sortGroupsByDenominator(aggregateByDimension(records, dimension, options))
  const known: string[] = []
  const unknown: string[] = []
  for (const group of groups) {
    if (group.key === UNKNOWN) {
      unknown.push(group.key)
    } else {
      known.push(group.key)
    }
  }
  return [...known, ...unknown]
}

/**
 * 按两个维度做交叉汇总。
 *
 * `options` 与 `aggregateByDimension` 同源（目前是薪资分档边界），这样筛选、分组、
 * 交叉表三处对同一个取值（如薪资区间标签）的判定完全一致。
 */
export function crossTabulate(
  records: readonly NormalizedRecord[],
  rowDimension: GroupDimension,
  columnDimension: GroupDimension,
  options: GroupingOptions = {},
): CrossTabResult {
  const rowKeys = orderedKeys(records, rowDimension, options)
  const columnKeys = orderedKeys(records, columnDimension, options)

  const buckets = new Map<string, Map<string, NormalizedRecord[]>>()
  for (const record of records) {
    const rowKey = dimensionValueOf(record, rowDimension, options)
    const columnKey = dimensionValueOf(record, columnDimension, options)
    let row = buckets.get(rowKey)
    if (row === undefined) {
      row = new Map<string, NormalizedRecord[]>()
      buckets.set(rowKey, row)
    }
    const cell = row.get(columnKey)
    if (cell === undefined) {
      row.set(columnKey, [record])
    } else {
      cell.push(record)
    }
  }

  const cells: CrossTabCell[] = []
  for (const rowKey of rowKeys) {
    for (const columnKey of columnKeys) {
      cells.push({
        rowKey,
        columnKey,
        summary: summarizeRecords(rowKey, buckets.get(rowKey)?.get(columnKey) ?? []),
      })
    }
  }

  return {
    rowDimension,
    columnDimension,
    rowKeys,
    columnKeys,
    cells,
    rowTotals: rowKeys.map((rowKey) =>
      summarizeRecords(
        rowKey,
        columnKeys.flatMap((columnKey) => buckets.get(rowKey)?.get(columnKey) ?? []),
      ),
    ),
    columnTotals: columnKeys.map((columnKey) =>
      summarizeRecords(
        columnKey,
        rowKeys.flatMap((rowKey) => buckets.get(rowKey)?.get(columnKey) ?? []),
      ),
    ),
    total: summarizeRecords('全部', records),
    note: CROSS_TAB_NOTE,
  }
}

/** 取某一格的汇总；不在网格内（维度值不属于本次结果）返回 null */
export function crossTabCellOf(
  result: CrossTabResult,
  rowKey: string,
  columnKey: string,
): GroupSummary | null {
  return (
    result.cells.find((cell) => cell.rowKey === rowKey && cell.columnKey === columnKey)?.summary ??
    null
  )
}
