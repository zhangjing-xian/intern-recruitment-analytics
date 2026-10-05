/**
 * 分维度分析的**纯逻辑层**（步骤9）。
 *
 * 为什么单独一层：把「哪些维度可切换」「TopN 与全表怎么切」「图表点击对应哪个筛选值」
 * 「合并组能不能下钻」「模块是否被禁用」这类规则集中到可单测的纯函数里，
 * 避免它们在 8 个 section 组件里各写一遍（同一个「其他（N 个分组合并）」被误当成城市值下钻就是典型事故）。
 *
 * 边界：**不含任何指标公式**——率、分位、周期、覆盖需求数一律来自 `domain/analytics`；
 * 本模块只做「取哪些分组、怎么标记、点了要筛什么」。
 */

import {
  AUTO_CONCLUSION_MIN_DENOMINATOR,
  sampleSufficiencyOf,
  type AnalysisModule,
  type GroupDimension,
  type GroupSummary,
  type MetricAvailability,
  type SampleSufficiencyTag,
} from '../../domain'

/** 「岗位 / 序列 / 部门」三选一切换用的维度（PRD 8 章：可切换维度排行） */
export const STRUCTURE_DIMENSIONS: readonly GroupDimension[] = ['position', 'jobFamily', 'department']

/** TopN + 其他 的默认 N（图表用；表格可切「全表」） */
export const DEFAULT_TOP_N = 8

/** 排行表展示模式：TopN + 其他 / 完整表 */
export const RANK_TABLE_MODES = ['topN', 'all'] as const
export type RankTableMode = (typeof RANK_TABLE_MODES)[number]

export const RANK_TABLE_MODE_LABELS: Readonly<Record<RankTableMode, string>> = {
  topN: `Top ${DEFAULT_TOP_N} + 其他`,
  all: '完整表',
}

/** 学校长尾的上榜数量（PRD 8 章「学校长尾 Top10 + 其他，附全表」） */
export const SCHOOL_TOP_N = 10

/**
 * 是否为 `topNWithOther` 生成的**合并组**。
 * 合并组不是一个真实的维度取值，不能作为筛选值下钻，否则会把「其他（3 个分组合并）」
 * 当成一个城市 / 岗位值写进筛选快照。
 */
export function isMergedGroupKey(key: string): boolean {
  return /^其他（\d+ 个分组合并）$/.test(key)
}

/** 该分组的可下钻筛选值；合并组返回 null（不下钻，也不显示按钮） */
export function drilldownValueOf(group: GroupSummary): string | null {
  return isMergedGroupKey(group.key) ? null : group.key
}

/**
 * 各分组的「拒 offer 率」0–1 比率（用户需求 ③：渠道 / HR 的图上要叠一条率线）。
 *
 * 值**直接取引擎**的 `rates.rejectionRate.value`：
 * 分母为 0 时引擎给 `null`，图上就断开（ECharts 收到 null 不画点），
 * 因此「绝不把无样本画成 0%」这条硬规则在折线上同样成立。
 * 放在本模块而不是图表组件里：它是「取哪些数」的口径，不是渲染细节。
 */
export function rejectionRatesOf(groups: readonly GroupSummary[]): readonly (number | null)[] {
  return groups.map((group) => group.rates.rejectionRate.value)
}

/* ------------------------------------------------- 图表通用：指标取值 / 排序 / 标签（2026-09-27） */

/** 柱状图能画的指标（每一个都直接读引擎给的 `GroupSummary`，本层不算任何公式） */
export type GroupBarMetric =
  | 'total'
  | 'coreDenominator'
  | 'joined'
  | 'pending'
  | 'rejected'
  /** 实际招聘周期的中位数（天）；有效样本为 0 时是 `null`（图上留空，不画成 0 天） */
  | 'cycleMedianDays'

/**
 * 取某个分组在该指标上的值。
 *
 * 与 `GroupBarChart` 的图例文案一一对应：改这里必须同时看图例，否则「柱子画的是 D、
 * 标题写的是 N」这种错误看不出问题（它不会报错，只会让人读错数）。
 */
export function metricValueOf(group: GroupSummary, metric: GroupBarMetric): number | null {
  switch (metric) {
    case 'total':
      return group.counts.total
    case 'coreDenominator':
      return group.counts.coreDenominator
    case 'joined':
      return group.counts.joined
    case 'pending':
      return group.counts.pending
    case 'rejected':
      return group.counts.rejected
    case 'cycleMedianDays':
      return group.cycles.actual.medianDays
  }
}

/**
 * 图上按**柱高从高到低**排列（用户需求，2026-09-27）。
 *
 * 为什么与数据表顺序不同：数据表按引擎的既定顺序（例如核心分母 D 降序）排，那是核对口径用的；
 * 图是用来「一眼看出谁高谁低」的，所以按它自己画的那个指标降序才对。
 * 实测用户的反馈就是时间效率图按 D 排序后，周期中位数的柱子高矮乱跳（36 → 19 → 56 → 17）。
 *
 * 三条规则：
 * 1. 值大的在前；`null`（无有效样本）一律排最后——它不是 0，不该混在低位里；
 * 2. 值相同保持**传入顺序**（稳定排序，避免同一份数据两次渲染顺序不同）；
 * 3. 只重排图的显示顺序，**不改任何分组本身**（数据表与报告读到的是同一个数组）。
 */
export function sortGroupsForChart(
  groups: readonly GroupSummary[],
  metric: GroupBarMetric,
): readonly GroupSummary[] {
  const indexed = groups.map((group, index) => ({ group, index }))
  indexed.sort((left, right) => {
    const leftValue = metricValueOf(left.group, metric)
    const rightValue = metricValueOf(right.group, metric)
    if (leftValue === null && rightValue === null) {
      return left.index - right.index
    }
    if (leftValue === null) {
      return 1
    }
    if (rightValue === null) {
      return -1
    }
    if (rightValue !== leftValue) {
      return rightValue - leftValue
    }
    return left.index - right.index
  })
  return indexed.map((entry) => entry.group)
}

/** 类目名过长时截断（中文岗位名 / 学校名常见 10 字以上，长文本在类目轴上放不下会被整条丢掉） */
export const CHART_CATEGORY_MAX_LENGTH = 12

export function truncateCategoryLabel(
  label: string,
  maxLength: number = CHART_CATEGORY_MAX_LENGTH,
): string {
  return label.length <= maxLength ? label : `${label.slice(0, maxLength)}…`
}

/** 分组的样本门槛判定（包装引擎的 `sampleSufficiencyOf`，组件不自己比 10） */
export function sampleTagOf(
  group: GroupSummary,
  minDenominator: number = AUTO_CONCLUSION_MIN_DENOMINATOR,
): SampleSufficiencyTag {
  return sampleSufficiencyOf(group.counts.coreDenominator, minDenominator).tag
}

export type ScatterPoint = {
  readonly name: string
  /** 横轴：核心分母 D（率的可比基数） */
  readonly denominator: number
  /** 纵轴：拒 offer 率（比率 0–1；分母 0 的分组不进图） */
  readonly rejectionRate: number
  /** 记录总数 N（含审批中） */
  readonly total: number
  /** 拒 offer 数 R（分子，与 `denominator` 一起可手工复核图中的纵坐标） */
  readonly rejected: number
  /** 点的视觉大小依据（记录数），由调用方决定怎么用 */
  readonly symbolSize: number
}

/**
 * 量率散点数据点：只保留**真实取值且分母有效**的分组。
 *
 * 两类分组必须排除：
 * 1. 分母 0 的分组——画在图上会变成「拒率 0%」的假点；
 * 2. `topNWithOther` 生成的**合并组**（「其他（N 个分组合并）」）——它不是一个真实取值，
 *    画上去既会在图例里冒充一个岗位 / 序列值，点击时还会被当成筛选值下钻。
 *    合并组仍照常出现在下方的数据表里（合计数不能丢）。
 *
 * 点大小按记录数缩放（4–28 px），避免小样本被视觉放大。
 */
export function scatterPointsOf(
  groups: readonly GroupSummary[],
  options: { readonly minSymbolSize?: number; readonly maxSymbolSize?: number } = {},
): readonly ScatterPoint[] {
  const minSize = options.minSymbolSize ?? 4
  const maxSize = options.maxSymbolSize ?? 28
  const points: ScatterPoint[] = []
  for (const group of groups) {
    if (isMergedGroupKey(group.key)) {
      continue
    }
    const rate = group.rates.rejectionRate.value
    if (rate === null) {
      continue
    }
    points.push({
      name: group.key,
      denominator: group.counts.coreDenominator,
      rejectionRate: rate,
      total: group.counts.total,
      rejected: group.counts.rejected,
      symbolSize: minSize,
    })
  }

  const maxTotal = points.reduce((max, point) => Math.max(max, point.total), 0)
  return points.map((point) => ({
    ...point,
    symbolSize:
      maxTotal === 0
        ? minSize
        : Math.round(minSize + (maxSize - minSize) * (point.total / maxTotal)),
  }))
}

/** 某分析模块是否被数据集标记为不可用（原因来自清洗阶段的有效样本说明） */
export function moduleUnavailableReason(
  availability: readonly MetricAvailability[],
  module: AnalysisModule,
): string | null {
  const matched = availability.find((item) => item.module === module)
  if (matched === undefined || matched.available) {
    return null
  }
  return matched.reason ?? '口径未确认，已在导入阶段禁用该模块'
}

/** 从「禁用模块名」列表判断（数据集元数据里的 `disabledModules` 与 `metricAvailability` 同源） */
export function isModuleDisabled(
  disabledModules: readonly AnalysisModule[],
  module: AnalysisModule,
): boolean {
  return disabledModules.includes(module)
}
