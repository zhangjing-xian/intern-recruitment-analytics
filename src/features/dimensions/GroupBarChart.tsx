import { useMemo } from 'react'

import type { GroupSummary } from '../../domain'
import EChart from '../dashboard/charts/EChart'
import type { EChartOption } from '../dashboard/charts/echartsLoader'

import {
  CHART_CATEGORY_MAX_LENGTH,
  metricValueOf,
  sortGroupsForChart,
  truncateCategoryLabel,
  type GroupBarMetric,
} from './dimensionViews'

/**
 * 按维度分组的通用柱状图（用户需求 ③，2026-09-27；同日按用户反馈调整排序与布局）。
 *
 * ## 为什么做成一个共享组件
 *
 * 需求要求给渠道、HR、需求类型、画像（学校 / 学历 / 年级 / GPT）、时间效率都补上图表。
 * 这五处的数据形状完全一样（都是引擎产出的 `GroupSummary[]`），
 * 若每个 section 各写一份 option，就会出现「五份几乎相同但细节不同」的图：
 * 有的带 drilldown、有的忘了 aria、有的率精度不一样——这类漂移最难发现。
 * 因此这里只写一次：**数据全部由调用方从引擎取**，本组件只负责把数字摆成柱子。
 *
 * ## 四条纪律
 *
 * 1. **组件不做任何统计**：柱高直接读 `GroupSummary`（`metricValueOf`）；
 *    率直接读 `GroupSummary.rates.*.value`，只把 0–1 比率换算成百分数刻度
 *    （`Math.round(rate * 10000) / 100`，与 `PositionSection` 的散点、以及下方数据表的
 *    `formatPercent(…, 2)` **同精度**）——这是展示换算，不是重算口径。
 * 2. **分母为 0 的分组不进率线**（值为 `null`）：ECharts 会断开折线，而不是画成 0%
 *    （「绝不显示 0%」这条硬规则在图上同样成立）。
 * 3. **按柱高从高到低排**（`value-desc`，默认）：用户看的是「谁高谁低」，
 *    因此不沿用数据表的引擎顺序；无有效样本的排最后。数据表顺序不受影响（见 `dimensionViews`）。
 * 4. **类目名放不下就换横向**（`layout="horizontal"`）：中文岗位名 / 学校名常超过 10 个字，
 *    纵向类目轴放不下会**整条丢掉**（ECharts 默认行为，表现为「横轴显示不全」）。
 *    横向图把类目放在左侧、文字从左往右排，并且超长文本截断成 `前 12 字…`（完整名在提示框里）。
 *    横向图**不支持率线**（右轴叠在横向上会同时挤占两个方向），需要率线的图保持纵向。
 */

type RateLine = {
  readonly label: string
  readonly values: readonly (number | null)[]
}

type GroupBarChartProps = {
  /** 图注（同时用于 aria 描述：读屏用户需要知道这张图画的是什么） */
  readonly ariaDescription: string
  readonly groups: readonly GroupSummary[]
  readonly metric: GroupBarMetric
  /**
   * 右轴叠加的百分率折线（0–1 比率来自引擎；分母为 0 的点断开）。
   * 支持多条：渠道 / HR 只有拒 offer 率一条，拒 offer 专项页要同时看拒 offer 率与入职率。
   * **横向布局不支持率线**（见文件头说明）。
   */
  readonly rateLines?: readonly RateLine[]
  readonly xAxisName: string
  readonly heightPx?: number
  readonly layout?: 'vertical' | 'horizontal'
  /** 默认按柱高降序；传 `input` 保持调用方给的顺序（极少数需要固定顺序的场景） */
  readonly sortBy?: 'value-desc' | 'input'
  readonly onSelectCategory?: (value: string) => void
}

const METRIC_LABELS: Readonly<Record<GroupBarMetric, string>> = {
  total: 'N（含审批中）',
  coreDenominator: '核心分母 D',
  joined: 'J 已入职',
  pending: 'P 待入职',
  rejected: 'R 拒绝合计',
  cycleMedianDays: '实际周期中位数（天）',
}

export default function GroupBarChart({
  ariaDescription,
  groups,
  metric,
  rateLines,
  xAxisName,
  heightPx,
  layout = 'vertical',
  sortBy = 'value-desc',
  onSelectCategory,
}: GroupBarChartProps) {
  const horizontal = layout === 'horizontal'
  /** 横向图不画率线（没有第二个方向的轴可放）；纵向图按需画 */
  const usableRateLines = horizontal ? undefined : rateLines
  const hasRate = usableRateLines !== undefined && usableRateLines.length > 0

  /**
   * 排序后的分组 + 与之一一对应的率线取值。
   *
   * 率线的 `values` 是按**传入顺序**给的，重排柱子时必须同步重排率线——
   * 否则折线的点会挂到别的类目上（那种错最像「数据算错了」，其实只是展示错位）。
   */
  const { chartGroups, chartRateLines } = useMemo(() => {
    if (sortBy === 'input') {
      return { chartGroups: groups, chartRateLines: usableRateLines }
    }
    const order = groups
      .map((group, index) => ({ group, index }))
      .sort((left, right) => {
        const leftValue = metricValueOf(left.group, metric) ?? Number.NEGATIVE_INFINITY
        const rightValue = metricValueOf(right.group, metric) ?? Number.NEGATIVE_INFINITY
        if (rightValue !== leftValue) {
          return rightValue - leftValue
        }
        return left.index - right.index
      })
      .map((entry) => entry.index)
    return {
      // 排序规则只写在 `dimensionViews.sortGroupsForChart`（同一条规则单测覆盖）
      chartGroups: sortGroupsForChart(groups, metric),
      chartRateLines: usableRateLines?.map((line) => ({
        label: line.label,
        values: order.map((index) => line.values[index] ?? null),
      })),
    }
  }, [groups, metric, sortBy, usableRateLines])

  const axisKeys = useMemo(
    () => chartGroups.map((group) => truncateCategoryLabel(group.key, CHART_CATEGORY_MAX_LENGTH)),
    [chartGroups],
  )

  const option = useMemo<EChartOption>(() => {
    const categoryAxis = {
      type: 'category' as const,
      data: axisKeys,
      name: xAxisName,
      // 类目轴不丢标签（长文本已截断，完整名在提示框里）
      axisLabel: { interval: 0 as const },
    }
    const valueAxis = { type: 'value' as const, name: METRIC_LABELS[metric] }
    const rateAxis = { type: 'value' as const, name: '百分率', axisLabel: { formatter: '{value} %' } }

    const barSeries = {
      name: METRIC_LABELS[metric],
      type: 'bar' as const,
      barMaxWidth: horizontal ? 18 : 36,
      // 有效样本为 0（周期中位数）时给 null：图上留空，绝不画成 0
      data: chartGroups.map((group) => metricValueOf(group, metric)),
    }
    const lineSeries = (chartRateLines ?? []).map((line) => ({
      name: line.label,
      type: 'line' as const,
      yAxisIndex: 1,
      // 分母为 0 → null：图上断开，绝不画成 0%
      data: line.values.map((value) =>
        value === null ? null : Math.round(value * 10000) / 100,
      ),
      connectNulls: false,
    }))

    if (horizontal) {
      return {
        aria: { enabled: true, label: { description: ariaDescription } },
        tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
        grid: { left: 8, right: 32, top: 16, bottom: 24, containLabel: true },
        legend: { bottom: 0, type: 'scroll' },
        xAxis: valueAxis,
        // inverse：排序后的第一项（最高的）画在最上面，符合「从上到下由高到低」的读法
        yAxis: { ...categoryAxis, inverse: true },
        series: [barSeries],
      }
    }

    return {
      aria: { enabled: true, label: { description: ariaDescription } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: hasRate ? 56 : 16, top: 24, bottom: 32, containLabel: true },
      legend: { bottom: 0, type: 'scroll' },
      xAxis: categoryAxis,
      // 率线共用一个右轴；`axisLabel` 直接带 % 号，避免读图时误把 23 当成 23 条
      yAxis: hasRate ? [valueAxis, rateAxis] : valueAxis,
      series: [barSeries, ...lineSeries],
    }
  }, [ariaDescription, axisKeys, chartGroups, hasRate, horizontal, metric, chartRateLines, xAxisName])

  /** 横向图的行数决定高度：一行一根柱子，太挤就看不清类目名 */
  const resolvedHeight =
    heightPx ?? (horizontal ? Math.max(220, chartGroups.length * 30 + 60) : 260)

  return (
    <EChart
      ariaLabel={`${ariaDescription}；按该指标从高到低排列；同数数据表见下方`}
      heightPx={resolvedHeight}
      {...(onSelectCategory === undefined
        ? {}
        : {
            onSelectCategory: (category: string, dataIndex?: number) => {
              /*
               * 下钻必须用**完整取值**：类目轴上显示的是截断后的文本（`前 12 字…`），
               * 拿它当筛选值会把「全球渠道发行实习生(七日世界)」写成「全球渠道发行实习生(七日…」。
               * 因此优先用 ECharts 给的下标回查原始分组，下标缺失时才退回按显示文本比对。
               */
              const byIndex = dataIndex === undefined ? undefined : chartGroups[dataIndex]
              if (byIndex !== undefined) {
                onSelectCategory(byIndex.key)
                return
              }
              const matched = chartGroups.find(
                (group) => truncateCategoryLabel(group.key, CHART_CATEGORY_MAX_LENGTH) === category,
              )
              if (matched !== undefined) {
                onSelectCategory(matched.key)
              }
            },
          })}
      option={option}
    />
  )
}
