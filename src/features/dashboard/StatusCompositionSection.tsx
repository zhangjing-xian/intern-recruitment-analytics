import { useMemo } from 'react'

import { statusComposition, type AnalysisResult, type OfferStatus } from '../../domain'
import { EMPTY_VALUE, formatInteger, formatPercent } from '../../lib/format'

import EChart from './charts/EChart'
import type { EChartOption } from './charts/echartsLoader'
import { NOT_FULL_FUNNEL_NOTE, STATUS_NOTES } from './dashboardText'
import ReturnToAllButton from './ReturnToAllButton'
import { STATUS_COLORS } from './statusPalette'

type StatusCompositionSectionProps = {
  readonly analysis: AnalysisResult
  /** 点击图表分段 / 表格行 → 只看该状态（会变成子集率，界面另有提示） */
  readonly onDrilldownStatus: (status: OfferStatus) => void
  /** 是否有筛选生效（看板用 `hasActiveFilters` 判定后传入，组件不自己判断） */
  readonly filtersActive?: boolean
  /** 清空全部筛选（看板传的必须是 `clearFilters`） */
  readonly onReturnToAll?: () => void
}

/**
 * 状态结构（docs/PRD.md 6.1「状态结构占比」、8 章「总览」）。
 *
 * 分母固定为 N：每个状态都按「该状态数 / 总记录数」展示，**计数为 0 的状态也保留在表里**
 * （PRD 6.1 处理规则：图表需要保留计数为 0 的状态）。
 * 「其他」与「未知」分开两行，不合并成一个桶。
 *
 * 同数数据表永远渲染：既是读屏 / 键盘用户的等价入口，也是图表加载失败时的兜底。
 */
export default function StatusCompositionSection({
  analysis,
  onDrilldownStatus,
  filtersActive = false,
  onReturnToAll,
}: StatusCompositionSectionProps) {
  const composition = useMemo(
    () => statusComposition(analysis.statusCounts),
    [analysis.statusCounts],
  )
  const total = analysis.statusCounts.total

  const option = useMemo<EChartOption>(
    () => ({
      aria: {
        enabled: true,
        label: { description: `offer 状态结构堆叠条形图，总记录 ${total} 条` },
      },
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, type: 'scroll' },
      grid: { left: 8, right: 16, top: 8, bottom: 56, containLabel: true },
      xAxis: { type: 'value', name: '记录数', nameGap: 8 },
      yAxis: { type: 'category', data: ['全部记录'] },
      series: composition.map((item) => ({
        name: item.status,
        type: 'bar' as const,
        stack: 'status',
        barMaxWidth: 44,
        itemStyle: { color: STATUS_COLORS[item.status] },
        label: { show: item.count > 0, position: 'inside' as const },
        data: [item.count],
      })),
    }),
    [composition, total],
  )

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">状态结构（分母 = N）</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-slate-500">{NOT_FULL_FUNNEL_NOTE}</span>
          {/* 点图上的状态会改全局筛选；这里给出同一个出口（用户需求 4）。未传入时不渲染。 */}
          {onReturnToAll === undefined ? null : (
            <ReturnToAllButton filtersActive={filtersActive} onReturnToAll={onReturnToAll} />
          )}
        </div>
      </div>

      <EChart
        ariaLabel={`各状态记录数：${composition
          .filter((item) => item.count > 0)
          .map((item) => `${item.status} ${item.count} 条`)
          .join('，')}；同数数据表见下方`}
        onSelectCategory={(category) => {
          const status = composition.find((item) => item.status === category)
          if (status !== undefined && status.count > 0) {
            onDrilldownStatus(status.status)
          }
        }}
        option={option}
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <caption className="pb-2 text-left text-xs text-slate-500">
            状态结构与图表同源；点击「只看该状态」会加状态筛选（此后所有率都是当前子集率）。
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium">状态</th>
              <th className="py-2 pr-3 font-medium">记录数</th>
              <th className="py-2 pr-3 font-medium">占 N</th>
              <th className="py-2 pr-3 font-medium">口径</th>
              <th className="py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {composition.map((item) => (
              <tr className="border-b border-slate-100" key={item.status}>
                <th className="py-2 pr-3 text-left font-normal" scope="row">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-3 w-3 rounded-sm"
                      style={{ backgroundColor: STATUS_COLORS[item.status] }}
                    />
                    {item.status}
                  </span>
                </th>
                <td className="py-2 pr-3 tabular-nums text-slate-900">
                  {formatInteger(item.count)}
                </td>
                <td className="py-2 pr-3 tabular-nums text-slate-900">
                  {item.share === null ? EMPTY_VALUE : formatPercent(item.share, 2)}
                </td>
                <td className="py-2 pr-3 text-xs leading-5 text-slate-600">
                  {STATUS_NOTES[item.status]}
                </td>
                <td className="py-2">
                  <button
                    className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={item.count === 0}
                    onClick={() => onDrilldownStatus(item.status)}
                    type="button"
                  >
                    只看该状态
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs leading-5 text-slate-500">
        合计：{formatInteger(total)} 条（N）。审批中 {formatInteger(analysis.statusCounts.approving)} 条
        （占 N {formatPercent(analysis.rates.approvingShareRate.value, 2)}，分母与核心率不同）；
        已接受未到岗 {formatInteger(analysis.statusCounts.pending)} 条。审批中尚未进入核心分母 D，
        不能当作已接受或已入职。
      </p>
    </section>
  )
}
