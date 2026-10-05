/**
 * 看板筛选的**纯逻辑层**（步骤8，docs/PRD.md 6.3）。
 *
 * 为什么单独一层：筛选规则（字段间 AND、字段内 OR、未知是独立可选值、时间默认不筛选、
 * 「日期缺失」是否纳入、清空按钮清到什么程度、趋势下钻换算成哪个区间）必须可单测，
 * 否则这些规则会散落在各个下拉框里，同一份筛选在两处表现不一致。
 *
 * 边界：
 * - 本模块**只**做「选择状态 → `AnalysisFilters`」的转换与展示辅助，**不**复制任何指标公式；
 *   真正的过滤与统计仍由 `domain/analytics` 的 `applyFilters` / `analyzeRecords` 完成；
 * - 所有日期都按 `YYYY-MM-DD` 文本校验，非法输入**不**被采用（退回「不限」），绝不猜一个日期；
 * - 「薪资区间」的分档边界由用户显式配置（引擎不发明分档，见 docs/DECISIONS.md D-036）。
 */

import {
  GROUP_DIMENSIONS,
  GROUP_DIMENSION_LABELS,
  UNKNOWN,
  describeActiveFilters,
  dimensionValueOf,
  isCalendarDateOnly,
  type AnalysisFilters,
  type GroupDimension,
  type GroupingOptions,
  type NormalizedRecord,
  type OfferStatus,
  type TimeBasis,
} from '../../domain'

/** 筛选面板的选择状态（时间用输入框原文，便于用户输入中间态不被打断） */
export type DashboardFilterDraft = {
  readonly dimensions: Readonly<Partial<Record<GroupDimension, readonly string[]>>>
  readonly statuses: readonly OfferStatus[]
  readonly timeBasis: TimeBasis
  /** 起始日输入框原文；空串 = 不限 */
  readonly timeFrom: string
  /** 结束日输入框原文；空串 = 不限 */
  readonly timeTo: string
  /** 基准日期缺失的记录是否纳入区间（默认否：缺失单独计数） */
  readonly includeMissingDate: boolean
  /** 薪资区间分档边界（逗号分隔原文）；未配置时「薪资区间」维度全部归「未知」 */
  readonly salaryBandEdgesText: string
}

/** 时间筛选默认基准：启动招聘日期（PRD 6.3） */
export const DEFAULT_TIME_BASIS: TimeBasis = 'recruitmentStartDate'

export const EMPTY_DASHBOARD_FILTERS: DashboardFilterDraft = {
  dimensions: {},
  statuses: [],
  timeBasis: DEFAULT_TIME_BASIS,
  timeFrom: '',
  timeTo: '',
  includeMissingDate: false,
  salaryBandEdgesText: '',
}

/* ------------------------------------------------------------------ 薪资分档 */

export type SalaryBandEdgesParse = {
  readonly edges: readonly number[]
  /** 无法解析的输入片段（原样回显给用户，不静默丢弃） */
  readonly invalidTokens: readonly string[]
}

/** 解析薪资分档边界：逗号（中英文均可）分隔，去重升序；非法片段单独报出 */
export function parseSalaryBandEdges(text: string): SalaryBandEdgesParse {
  const tokens = text
    .split(/[,，]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  const edges: number[] = []
  const invalidTokens: string[] = []
  for (const token of tokens) {
    const value = Number(token)
    if (!Number.isFinite(value)) {
      invalidTokens.push(token)
      continue
    }
    edges.push(value)
  }

  return {
    edges: [...new Set(edges)].sort((left, right) => left - right),
    invalidTokens,
  }
}

/* ------------------------------------------------------------------ 状态转换 */

/** 切换某个维度值（同字段多选 = OR；再次点击取消） */
export function toggleDimensionValue(
  draft: DashboardFilterDraft,
  dimension: GroupDimension,
  value: string,
): DashboardFilterDraft {
  const current = draft.dimensions[dimension] ?? []
  const next = current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value]
  const dimensions = { ...draft.dimensions }
  if (next.length === 0) {
    delete dimensions[dimension]
  } else {
    dimensions[dimension] = next
  }
  return { ...draft, dimensions }
}

/** 清空某一个维度的选择 */
export function clearDimension(
  draft: DashboardFilterDraft,
  dimension: GroupDimension,
): DashboardFilterDraft {
  if (draft.dimensions[dimension] === undefined) {
    return draft
  }
  const dimensions = { ...draft.dimensions }
  delete dimensions[dimension]
  return { ...draft, dimensions }
}

/** 直接设定某个维度的选择（用于图表下钻） */
export function setDimensionValues(
  draft: DashboardFilterDraft,
  dimension: GroupDimension,
  values: readonly string[],
): DashboardFilterDraft {
  const dimensions = { ...draft.dimensions }
  if (values.length === 0) {
    delete dimensions[dimension]
  } else {
    dimensions[dimension] = [...values]
  }
  return { ...draft, dimensions }
}

/** 切换 offer 状态（单组状态筛选会改变 D，必须提示「当前子集率」） */
export function toggleStatus(
  draft: DashboardFilterDraft,
  status: OfferStatus,
): DashboardFilterDraft {
  const next = draft.statuses.includes(status)
    ? draft.statuses.filter((item) => item !== status)
    : [...draft.statuses, status]
  return { ...draft, statuses: next }
}

/** 直接设定状态筛选（用于状态结构图下钻「只看该状态」） */
export function setStatusValues(
  draft: DashboardFilterDraft,
  statuses: readonly OfferStatus[],
): DashboardFilterDraft {
  return { ...draft, statuses: [...statuses] }
}

/* ------------------------------------------------------------------ 转换与校验 */

/** 时间输入是否可用；返回不可用的说明（空数组表示没有非法输入） */
export function timeInputIssues(draft: DashboardFilterDraft): readonly string[] {
  const issues: string[] = []
  const from = draft.timeFrom.trim()
  const to = draft.timeTo.trim()
  if (from !== '' && !isCalendarDateOnly(from)) {
    issues.push(`起始日「${from}」不是合法的 YYYY-MM-DD，已按「不限」处理`)
  }
  if (to !== '' && !isCalendarDateOnly(to)) {
    issues.push(`结束日「${to}」不是合法的 YYYY-MM-DD，已按「不限」处理`)
  }
  return issues
}

/**
 * 选择状态 → `AnalysisFilters`（引擎唯一认可的筛选快照）。
 * 两端都不限时不生成时间筛选对象（保持 `time: null`），避免界面显示一个空区间条件。
 */
export function toAnalysisFilters(draft: DashboardFilterDraft): AnalysisFilters {
  const issues = timeInputIssues(draft)
  const fromInvalid = issues.some((issue) => issue.startsWith('起始日'))
  const toInvalid = issues.some((issue) => issue.startsWith('结束日'))
  const from = fromInvalid ? '' : draft.timeFrom.trim()
  const to = toInvalid ? '' : draft.timeTo.trim()

  return {
    dimensions: draft.dimensions,
    statuses: draft.statuses,
    time:
      from === '' && to === ''
        ? null
        : {
            basis: draft.timeBasis,
            from: from === '' ? null : from,
            to: to === '' ? null : to,
            includeMissingDate: draft.includeMissingDate,
          },
  }
}

/** 分组维度聚合需要的选项（薪资区间分档边界）；非法分档一律当未配置，避免半套分档 */
export function groupingOptionsOf(draft: DashboardFilterDraft): GroupingOptions {
  const parsed = parseSalaryBandEdges(draft.salaryBandEdgesText)
  if (parsed.invalidTokens.length > 0 || parsed.edges.length === 0) {
    return {}
  }
  return { salaryBandEdges: parsed.edges }
}

/** 是否有任何筛选条件生效（用于「无符合筛选数据」与清空按钮的禁用态） */
export function hasActiveFilters(draft: DashboardFilterDraft): boolean {
  const filters = toAnalysisFilters(draft)
  return (
    Object.keys(filters.dimensions).length > 0 ||
    filters.statuses.length > 0 ||
    filters.time !== null
  )
}

/** 生效筛选的中文描述；时间与分档口径统一由这里补充，避免各组件各写一份 */
export function activeFilterSummary(draft: DashboardFilterDraft): readonly string[] {
  const descriptions = [...describeActiveFilters(toAnalysisFilters(draft))]
  const parsed = parseSalaryBandEdges(draft.salaryBandEdgesText)
  if (parsed.edges.length > 0) {
    descriptions.push(`薪资分档边界：${parsed.edges.join(' / ')}（由用户配置，界面与报告共用）`)
  }
  return descriptions
}

/* ------------------------------------------------------------------ 选项列表 */

export type DimensionOption = {
  readonly value: string
  readonly count: number
  readonly selected: boolean
}

/**
 * 某维度的可选值清单。
 *
 * 口径：取值来自**传入的记录集合**（调用方传全部保留记录），这样其他筛选生效时选项也不会边点边消失；
 * 「未知」永远排在最后并单独标注，它是可选的独立值，不是被排除的脏数据。
 */
export function dimensionOptions(
  records: readonly NormalizedRecord[],
  dimension: GroupDimension,
  draft: DashboardFilterDraft,
  options: GroupingOptions = {},
): readonly DimensionOption[] {
  const selected = new Set(draft.dimensions[dimension] ?? [])
  const counts = new Map<string, number>()
  for (const record of records) {
    const value = dimensionValueOf(record, dimension, options)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  const entries = [...counts.entries()].filter(([value]) => value !== UNKNOWN)
  entries.sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1]
    }
    return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0
  })

  const listed: DimensionOption[] = entries.map(([value, count]) => ({
    value,
    count,
    selected: selected.has(value),
  }))
  const unknownCount = counts.get(UNKNOWN)
  if (unknownCount !== undefined) {
    listed.push({ value: UNKNOWN, count: unknownCount, selected: selected.has(UNKNOWN) })
  }
  return listed
}

/** 提供筛选选项的维度（与引擎的 `GROUP_DIMENSIONS` 同源，界面不得自造维度） */
export function filterableDimensions(): readonly GroupDimension[] {
  return GROUP_DIMENSIONS
}

export function dimensionLabel(dimension: GroupDimension): string {
  return GROUP_DIMENSION_LABELS[dimension]
}

/* ------------------------------------------------------------------ 趋势下钻 */

const PERIOD_KEY_PATTERN = /^(\d{4})-(\d{2})$/

/**
 * 月份键 → 该月的闭区间（图表点击下钻到「这个月」）。
 * 非法键返回 null；月末天数用 UTC 计算，避免本地时区把月末算错一天。
 */
export function timeRangeOfPeriod(
  periodKey: string,
): { readonly from: string; readonly to: string } | null {
  const matched = PERIOD_KEY_PATTERN.exec(periodKey)
  if (matched === null) {
    return null
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  if (month < 1 || month > 12) {
    return null
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return {
    from: `${matched[1]}-${matched[2]}-01`,
    to: `${matched[1]}-${matched[2]}-${String(lastDay).padStart(2, '0')}`,
  }
}

/* ------------------------------------------------------------------ 时间与清空（输入态） */

/** 切换时间基准（区间文本保留：用户切基准时不希望刚填的区间被清掉，选中基准会显示在顶部） */
export function setTimeBasis(
  draft: DashboardFilterDraft,
  basis: TimeBasis,
): DashboardFilterDraft {
  return { ...draft, timeBasis: basis }
}

export function setTimeRange(
  draft: DashboardFilterDraft,
  from: string,
  to: string,
): DashboardFilterDraft {
  return { ...draft, timeFrom: from, timeTo: to }
}

export function setIncludeMissingDate(
  draft: DashboardFilterDraft,
  include: boolean,
): DashboardFilterDraft {
  return { ...draft, includeMissingDate: include }
}

export function setSalaryBandEdgesText(
  draft: DashboardFilterDraft,
  text: string,
): DashboardFilterDraft {
  return { ...draft, salaryBandEdgesText: text }
}

/**
 * 清空按钮：清掉**筛选条件**（维度、状态、时间区间、日期缺失纳入），
 * **保留**薪资分档边界与时间基准——它们是口径配置而不是筛选条件，
 * 顺手清掉会让用户以为「薪资区间」维度坏了（与 PRD 6.3「未知是可选的独立值」同一思路：口径要可解释）。
 */
export function clearFilters(draft: DashboardFilterDraft): DashboardFilterDraft {
  return {
    ...draft,
    dimensions: {},
    statuses: [],
    timeFrom: '',
    timeTo: '',
    includeMissingDate: false,
  }
}
