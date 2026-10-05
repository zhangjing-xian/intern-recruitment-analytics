/**
 * 通用分组聚合（docs/PRD.md 6.3「分层维度」、8 章「各分析模块」）。
 *
 * 一个分组函数服务所有维度：城市、渠道、推荐类型、HR、岗位、序列、部门、需求类型、毕业年级、
 * 学历、学校、GPT、薪资区间、房补类型**全部复用**同一套 N/J/P/A/R/D、各率、有效周期 n 与均值，
 * 组件不得自己写公式，也不得自己决定「缺失算哪个组」。
 *
 * 口径约定：
 * - 缺失 / 不可识别一律归 `未知`（独立可选值，不是被过滤掉）；「其他」与「未知」分开；
 * - 「未知」分组照常参与计数与展示，但**不**自动参与优劣结论（由步骤10 的规则处理）；
 * - 分组后的汇总率由 `buildCoreRates` 重新按合计分子分母计算，**不是**平均各分组百分比。
 */

import { UNKNOWN, type TriState } from '../enums'
import type { NormalizedRecord } from '../types'

import { actualCycleStats, plannedCycleStats, type CycleStats } from './durations'
import { rejectionGroupOf } from './rejection'
import { buildCoreRates, type CoreRateSummary } from './rates'
import { countStatuses, type StatusCounts } from './statusCounts'

/** 可分组 / 可筛选的维度（与 PRD 6.3 列表一致；薪资区间需要调用方给出区间边界） */
export const GROUP_DIMENSIONS = [
  'city',
  'channel',
  'referralType',
  'recruiter',
  'position',
  'jobFamily',
  'department',
  'requirementType',
  'graduationYear',
  'education',
  'school',
  'isGptSchool',
  'housingType',
  'salaryBand',
] as const
export type GroupDimension = (typeof GROUP_DIMENSIONS)[number]

export const GROUP_DIMENSION_LABELS: Readonly<Record<GroupDimension, string>> = {
  city: '城市',
  channel: '渠道',
  referralType: '推荐类型',
  recruiter: '招聘HR',
  position: '岗位',
  jobFamily: '序列',
  department: '一级部门',
  requirementType: '需求类型',
  graduationYear: '毕业年级',
  education: '学历',
  school: '学校',
  isGptSchool: 'GPT',
  housingType: '房补类型',
  salaryBand: '薪资区间',
}

/** 三值显示标签：GPT 等三值字段的分组值 */
export const GPT_YES_LABEL = '是'
export const GPT_NO_LABEL = '否'

export type GroupingOptions = {
  /** 薪资区间边界（升序不必预排）；未配置时该维度全部归「未知」 */
  readonly salaryBandEdges?: readonly number[]
}

/** 数值 → 区间标签（如 `3000–3999` / `<3000` / `≥5000`）；null 表示无法分类 */
export function bandOf(value: number | null, edges: readonly number[]): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }
  const sortedEdges = [...new Set(edges)]
    .filter((edge) => Number.isFinite(edge))
    .sort((a, b) => a - b)
  if (sortedEdges.length === 0) {
    return null
  }

  for (let index = sortedEdges.length - 1; index >= 0; index -= 1) {
    const lower = sortedEdges[index]
    if (value >= lower) {
      const upper = sortedEdges[index + 1]
      return upper === undefined ? `≥${lower}` : `${lower}–${upper - 1}`
    }
  }
  return `<${sortedEdges[0]}`
}

function triStateLabel(value: TriState): string {
  if (value === true) {
    return GPT_YES_LABEL
  }
  if (value === false) {
    return GPT_NO_LABEL
  }
  return UNKNOWN
}

function textOrUnknown(value: string | null): string {
  if (value === null || value.trim() === '') {
    return UNKNOWN
  }
  return value
}

/** 单条记录在某维度上的分组值；缺失 / 不可识别统一为「未知」（不是 null，也不被丢弃） */
export function dimensionValueOf(
  record: NormalizedRecord,
  dimension: GroupDimension,
  options: GroupingOptions = {},
): string {
  switch (dimension) {
    case 'city':
    case 'channel':
    case 'referralType':
    case 'requirementType':
    case 'education':
    case 'housingType':
      return record[dimension]
    case 'recruiter':
      return textOrUnknown(record.recruiter)
    case 'position':
      return textOrUnknown(record.position)
    case 'jobFamily':
      return textOrUnknown(record.jobFamily)
    case 'department':
      return textOrUnknown(record.department)
    case 'school':
      return textOrUnknown(record.school)
    case 'graduationYear':
      return record.graduationYear === null ? UNKNOWN : String(record.graduationYear)
    case 'isGptSchool':
      return triStateLabel(record.isGptSchool)
    case 'salaryBand': {
      const edges = options.salaryBandEdges ?? []
      const band = bandOf(
        record.salaryAmount === null || !Number.isFinite(record.salaryAmount)
          ? null
          : Math.max(record.salaryAmount, 0),
        edges,
      )
      return band ?? UNKNOWN
    }
    default:
      return UNKNOWN
  }
}

/**
 * 名单覆盖需求数：`countDistinct(非空需求ID)`。
 * **不是**公司全部在招需求数；HR 内按本 HR 记录去重，跨 HR 相加可能超过全局（PRD 6.1 / 9 章）。
 */
export type RequirementCoverage = {
  readonly distinctRequirementCount: number
  /** 需求 ID 缺失的记录数（这些记录不进覆盖需求数） */
  readonly missingRequirementIdCount: number
  readonly recordCount: number
  readonly note: string
}

export function requirementCoverageOf(records: readonly NormalizedRecord[]): RequirementCoverage {
  const requirementIds = new Set<string>()
  let missing = 0
  for (const record of records) {
    const requirementId = record.requirementId
    if (requirementId === null || requirementId.trim() === '') {
      missing += 1
      continue
    }
    requirementIds.add(requirementId)
  }
  return {
    distinctRequirementCount: requirementIds.size,
    missingRequirementIdCount: missing,
    recordCount: records.length,
    note: '名单覆盖需求数 = countDistinct(非空需求ID)；HR 内去重，跨 HR 相加可能超过全局，不等于完整需求完成率',
  }
}

/* ------------------------------------------------------------------ 分组汇总 */

/** 一个分组 / 一次筛选结果的完整汇总；页面只展示、不再计算 */
export type GroupSummary = {
  /** 分组值（维度值或 `全部`）；「未知」是正常分组，必须展示 */
  readonly key: string
  readonly records: readonly NormalizedRecord[]
  readonly counts: StatusCounts
  readonly rates: CoreRateSummary
  readonly cycles: {
    readonly actual: CycleStats
    readonly planned: CycleStats
  }
  readonly coverage: RequirementCoverage
  /**
   * 两组比较人群的**组内构成**（PRD 9.1：某特征在拒 offer 组的记录数 / R，对比在入职组的 / J）。
   * 这是**画像构成**，不是该特征的拒 offer 率；特征内的率看 `rates.rejectionRate`。
   * 不在比较人群内的记录（待入职 / 审批中 / 其他 / 未知）两者都不计入。
   */
  readonly groupComposition: {
    readonly rejectedGroupCount: number
    readonly joinedGroupCount: number
    /** 两组比较人群合计（= 上面两项之和）；与 `counts.total` 的差就是未进组记录 */
    readonly comparedCount: number
  }
}

/** 对任意记录集合做同一套汇总（分组、单组、TopN 合并都复用） */
export function summarizeRecords(key: string, records: readonly NormalizedRecord[]): GroupSummary {
  const counts = countStatuses(records)
  let rejectedGroupCount = 0
  let joinedGroupCount = 0
  for (const record of records) {
    const group = rejectionGroupOf(record)
    if (group === 'rejected') {
      rejectedGroupCount += 1
    } else if (group === 'joined') {
      joinedGroupCount += 1
    }
  }
  return {
    key,
    records,
    counts,
    rates: buildCoreRates(counts),
    cycles: {
      actual: actualCycleStats(records),
      planned: plannedCycleStats(records),
    },
    coverage: requirementCoverageOf(records),
    groupComposition: {
      rejectedGroupCount,
      joinedGroupCount,
      comparedCount: rejectedGroupCount + joinedGroupCount,
    },
  }
}

/** 通用 groupBy：选择器返回分组值，调用方负责把缺失映射成「未知」 */
export function groupRecords(
  records: readonly NormalizedRecord[],
  selectValue: (record: NormalizedRecord) => string,
): readonly { readonly key: string; readonly records: readonly NormalizedRecord[] }[] {
  const buckets = new Map<string, NormalizedRecord[]>()
  for (const record of records) {
    const key = selectValue(record)
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, [record])
    } else {
      bucket.push(record)
    }
  }
  return [...buckets.entries()].map(([key, grouped]) => ({ key, records: grouped }))
}

/** 按维度分组并汇总（每个分组都带 N/J/P/A/R/D、各率、有效周期 n 与覆盖需求数） */
export function aggregateByDimension(
  records: readonly NormalizedRecord[],
  dimension: GroupDimension,
  options: GroupingOptions = {},
): readonly GroupSummary[] {
  return groupRecords(records, (record) => dimensionValueOf(record, dimension, options)).map(
    (group) => summarizeRecords(group.key, group.records),
  )
}

/** 分组排序：核心分母 D 降序 → N 降序 → 分组值升序（稳定，便于表格与图表对照） */
export function sortGroupsByDenominator(groups: readonly GroupSummary[]): readonly GroupSummary[] {
  return [...groups].sort((left, right) => {
    if (right.counts.coreDenominator !== left.counts.coreDenominator) {
      return right.counts.coreDenominator - left.counts.coreDenominator
    }
    if (right.counts.total !== left.counts.total) {
      return right.counts.total - left.counts.total
    }
    if (left.key === right.key) {
      return 0
    }
    return left.key < right.key ? -1 : 1
  })
}

/**
 * TopN + 其他：取前 N 组（默认按 D 排序），其余**合并**为一组并**重新汇总**。
 * 合并组的率由合计分子分母重新相除得到，绝不平均各分组百分比（PRD 6.1）。
 */
export function topNWithOther(
  groups: readonly GroupSummary[],
  topN: number,
  options: { readonly otherKey?: string } = {},
): readonly GroupSummary[] {
  if (!Number.isInteger(topN) || topN <= 0 || groups.length <= topN) {
    return sortGroupsByDenominator(groups)
  }

  const sorted = sortGroupsByDenominator(groups)
  const head = sorted.slice(0, topN)
  const tail = sorted.slice(topN)
  const merged = summarizeRecords(
    options.otherKey ?? `其他（${tail.length} 个分组合并）`,
    tail.flatMap((group) => group.records),
  )
  return [...head, merged]
}
