import { useMemo } from 'react'

import {
  TIME_BASES,
  TIME_BASIS_LABELS,
  countOfStatus,
  type TimelineResult,
  type TimeBasis,
} from '../../domain'
import { formatInteger, formatPercent } from '../../lib/format'

import EChart from './charts/EChart'
import type { EChartOption } from './charts/echartsLoader'
import ReturnToAllButton from './ReturnToAllButton'
import { STATUS_COLORS, TREND_STATUS_ORDER } from './statusPalette'

type TrendSectionProps = {
  readonly timeline: TimelineResult
  /** 切换时间基准（与全局筛选面板是**同一个**状态，不是两份真相） */
  readonly onChangeBasis: (basis: TimeBasis) => void
  /** 点击某个批次 → 把时间筛选定为该月 */
  readonly onDrilldownPeriod: (periodKey: string) => void
  /** 是否有筛选生效（看板用 `hasActiveFilters` 判定后传入，组件不自己判断） */
  readonly filtersActive?: boolean
  /** 清空全部筛选（看板传的必须是 `clearFilters`） */
  readonly onReturnToAll?: () => void
}

/**
 * 时间趋势（docs/PRD.md 6.3、8 章「总览」）。
 *
 * 口径全部来自引擎的 `aggregateByMonth`：
 * - 只按**合法日期**分月，日期缺失 / 非法的记录单列计数，不塞进任何月份；
 * - 口径提示（「启动批次 ≠ 发 offer 趋势」）直接用引擎返回的 `note`，组件不自己编；
 * - 柱状图按状态堆叠，因此每个批次的 N / J / P / A / R 与 KPI 卡片同口径（同一份读数）。
 *
 * 下方数据表永远渲染：图表可键盘关联到数据表，且图表库加载失败也能看数。
 */
export default function TrendSection({
  timeline,
  onChangeBasis,
  onDrilldownPeriod,
  filtersActive = false,
  onReturnToAll,
}: TrendSectionProps) {
  const periodKeys = timeline.buckets.map((bucket) => bucket.periodKey)

  const option = useMemo<EChartOption>(
    () => ({
      aria: {
        enabled: true,
        label: { description: `${TIME_BASIS_LABELS[timeline.basis]}分月趋势图` },
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, type: 'scroll' },
      grid: { left: 8, right: 16, top: 16, bottom: 56, containLabel: true },
      xAxis: { type: 'category', data: periodKeys, name: '月份', nameGap: 8 },
      yAxis: { type: 'value', name: '记录数' },
      series: TREND_STATUS_ORDER.map((status) => ({
        name: status,
        type: 'bar' as const,
        stack: 'status',
        itemStyle: { color: STATUS_COLORS[status] },
        data: timeline.buckets.map((bucket) => countOfStatus(bucket.summary.counts, status)),
      })),
    }),
    [periodKeys, timeline.buckets, timeline.basis],
  )

  const hasBuckets = timeline.buckets.length > 0

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          时间趋势（{TIME_BASIS_LABELS[timeline.basis]}）
        </h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>时间基准（与全局筛选同一开关）：</span>
          {TIME_BASES.map((basis) => (
            <button
              aria-pressed={basis === timeline.basis}
              className={`rounded border px-2 py-1 transition-colors ${
                basis === timeline.basis
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
              key={basis}
              onClick={() => onChangeBasis(basis)}
              type="button"
            >
              {TIME_BASIS_LABELS[basis]}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs leading-5 text-slate-600">{timeline.note}</p>

      {/* 点图上的月份 / 表里的「筛选该月」会改全局筛选；这里给出同一个出口（用户需求 4） */}
      {onReturnToAll === undefined ? null : (
        <ReturnToAllButton filtersActive={filtersActive} onReturnToAll={onReturnToAll} />
      )}

      {hasBuckets ? (
        <EChart
          ariaLabel={`${TIME_BASIS_LABELS[timeline.basis]}分月趋势，共 ${timeline.buckets.length} 个月份；同数数据表见下方`}
          heightPx={300}
          onSelectCategory={(category) => {
            if (periodKeys.includes(category)) {
              onDrilldownPeriod(category)
            }
          }}
          option={option}
        />
      ) : (
        <p className="rounded border border-dashed border-slate-300 p-4 text-sm leading-6 text-slate-600">
          当前记录里没有可用的「{TIME_BASIS_LABELS[timeline.basis]}」，因此不画趋势图；
          这不等于「趋势为 0」
          {timeline.missingDateCount > 0
            ? `（该字段缺失或非法 ${formatInteger(timeline.missingDateCount)} 条）`
            : ''}
          。
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="pb-2 text-left text-xs text-slate-500">
            点击图表中的月份，或点表格里的「筛选该月」，会把时间筛选设为该月（基准同上）；趋势、卡片与数据表同口径。
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium">月份</th>
              <th className="py-2 pr-3 font-medium">N</th>
              <th className="py-2 pr-3 font-medium">J</th>
              <th className="py-2 pr-3 font-medium">P</th>
              <th className="py-2 pr-3 font-medium">A</th>
              <th className="py-2 pr-3 font-medium">R</th>
              <th className="py-2 pr-3 font-medium">D</th>
              <th className="py-2 pr-3 font-medium">拒 offer 率</th>
              <th className="py-2 pr-3 font-medium">入职率</th>
              <th className="py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {timeline.buckets.map((bucket) => (
              <tr className="border-b border-slate-100" key={bucket.periodKey}>
                <th className="py-2 pr-3 text-left font-normal tabular-nums" scope="row">
                  {bucket.periodKey}
                </th>
                <td className="py-2 pr-3 tabular-nums">
                  {formatInteger(bucket.summary.counts.total)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatInteger(bucket.summary.counts.joined)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatInteger(bucket.summary.counts.pending)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatInteger(bucket.summary.counts.approving)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatInteger(bucket.summary.counts.rejected)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatInteger(bucket.summary.counts.coreDenominator)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatPercent(bucket.summary.rates.rejectionRate.value, 2)}
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatPercent(bucket.summary.rates.joinedRate.value, 2)}
                </td>
                <td className="py-2">
                  <button
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100"
                    onClick={() => onDrilldownPeriod(bucket.periodKey)}
                    type="button"
                  >
                    筛选该月
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-5 text-slate-500">
        日期缺失或非法、未纳入趋势的记录：
        {timeline.missingDateCount === 0 ? '无' : `${formatInteger(timeline.missingDateCount)} 条`}
        （单列计数：既不当成 0 条，也不落进任何月份）。月内各率仍是「合计分子分母后再相除」。
      </p>
    </section>
  )
}
