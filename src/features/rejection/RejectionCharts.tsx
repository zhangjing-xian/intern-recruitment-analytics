import { useMemo } from 'react'

import {
  REJECTION_REASON_CATEGORIES,
  type GroupSummary,
  type RejectionReasonDistribution,
} from '../../domain'
import { formatInteger } from '../../lib/format'
import EChart from '../dashboard/charts/EChart'
import type { EChartOption } from '../dashboard/charts/echartsLoader'
import GroupBarChart from '../dimensions/GroupBarChart'
import { rejectionRatesOf } from '../dimensions/dimensionViews'

import { REASON_CHART_NOTE, REJECTION_CHART_HINT } from './rejectionText'

/**
 * 拒 offer 专项页的图表（用户需求 ③，2026-09-27）。
 *
 * 这个页面此前**一张图都没有**（只有卡片与表格）。这里补两张最直接有用的：
 *
 * 1. **拒绝原因分布**：横向柱状图。分母恒为**全部拒 offer 记录 R**（含「未填写」）——
 *    这一点必须写在图上，否则「薪酬占 40%」会被误读成「已填原因里的 40%」。
 *    「未分类」与「未填写」分开留存，不合并（PRD 9.2）。
 * 2. **按维度的拒 offer 率与入职率对比**：柱子是核心分母 D，两条率线共用右轴；
 *    分母为 0 的分组两条线都断开（绝不画成 0%）。
 *
 * 纪律：本文件**不做任何统计**——计数与率全部来自 `insights/rejection` 已算好的结果
 * （分布来自 `rejectionReasonDistribution`，率来自引擎的 `GroupSummary.rates`）；
 * 这里只负责把它们摆成图。图表加载仍是懒加载（`EChart` → 动态 import ECharts）。
 */
export default function RejectionCharts({
  reasons,
  dimensionLabel,
  groups,
}: {
  readonly reasons: RejectionReasonDistribution
  /** 当前展示的对比维度名（渠道 / HR / 城市…），由页面传入 */
  readonly dimensionLabel: string
  readonly groups: readonly GroupSummary[]
}) {
  const reasonOption = useMemo<EChartOption>(() => {
    /*
     * 顺序固定为 `REJECTION_REASON_CATEGORIES`（计数为 0 的也保留），
     * 与下方原因表逐行对应：图与表顺序不同会让人以为是两份数据。
     */
    const ordered = REJECTION_REASON_CATEGORIES.map(
      (category) => reasons.categories.find((item) => item.category === category)?.count ?? 0,
    )
    return {
      aria: {
        enabled: true,
        label: { description: `拒绝原因分布（分母为全部拒 offer 记录 R = ${String(reasons.denominator)}）` },
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 24, top: 16, bottom: 24, containLabel: true },
      xAxis: { type: 'value', name: '记录数' },
      yAxis: { type: 'category', data: [...REJECTION_REASON_CATEGORIES].reverse() },
      series: [
        {
          name: '记录数',
          type: 'bar' as const,
          barMaxWidth: 20,
          data: [...ordered].reverse(),
          label: { show: true, position: 'right' as const },
        },
      ],
    }
  }, [reasons])

  const hasDimension = groups.length > 0

  return (
    <>
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">拒绝原因分布</h2>
        <p className="text-xs leading-5 text-slate-600">
          {reasons.note} 分母 R = {formatInteger(reasons.denominator)}，其中已填写{' '}
          {formatInteger(reasons.filledCount)} 条（命中字典 {formatInteger(reasons.matchedCount)} 条，
          字典外 {formatInteger(reasons.unclassifiedCount)} 条）。{REASON_CHART_NOTE}
        </p>
        <EChart
          ariaLabel={`拒绝原因分布：分母为全部拒 offer 记录 ${formatInteger(reasons.denominator)} 条；同数数据表见下方`}
          heightPx={Math.max(220, REJECTION_REASON_CATEGORIES.length * 32)}
          option={reasonOption}
        />
      </section>

      {hasDimension && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            {dimensionLabel}的拒 offer 率与入职率（柱 = 核心分母 D）
          </h2>
          <p className="text-xs leading-5 text-slate-600">
            两个率的分母都是核心分母 D（J + P + R，不含审批中 / 其他 / 未知）；
            分母为 0 的分组不画点。「拒 offer 率」与「入职率」不是互补关系，
            两者之间还隔着待入职。{REJECTION_CHART_HINT}
          </p>
          <GroupBarChart
            ariaDescription={`各${dimensionLabel}的核心分母与拒 offer 率、入职率；合并分组不进图`}
            groups={groups}
            metric="coreDenominator"
            rateLines={[
              { label: '拒 offer 率（R/D）', values: rejectionRatesOf(groups) },
              {
                label: '入职率（J/D）',
                values: groups.map((group) => group.rates.joinedRate.value),
              },
            ]}
            xAxisName={dimensionLabel}
          />
        </section>
      )}
    </>
  )
}
