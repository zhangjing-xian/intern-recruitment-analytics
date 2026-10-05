import { useMemo } from 'react'

import {
  CITY_NOTE,
  countOfStatus,
  type GroupSummary,
  type NormalizedRecord,
} from '../../domain'
import { formatDays, formatInteger } from '../../lib/format'
import EChart from '../dashboard/charts/EChart'
import type { EChartOption } from '../dashboard/charts/echartsLoader'
import { STATUS_COLORS, TREND_STATUS_ORDER } from '../dashboard/statusPalette'

import GroupSummaryTable from './GroupSummaryTable'
import SectionShell from './SectionShell'
import { CHART_HINT, SECTION_TITLES } from './analysisText'

type CitySectionProps = {
  readonly records: readonly NormalizedRecord[]
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
  readonly onDrilldown: (value: string) => void
}

/**
 * 城市对比（docs/PRD.md 8 章「城市」）。
 *
 * - 图表：各城市记录数按状态堆叠（与 KPI 卡片同一份读数）；
 * - 表格：计数 + 率并列（N / J / P / A / R / D、入职率、拒 offer 率），「其他城市」「未知城市」各自成行；
 * - 周期分位表：P25 / 中位数 / P75 只对「已入职且日期合法」的有效样本计算（引擎给出，界面不算）。
 */
export default function CitySection({
  records,
  groups,
  total,
  onDrilldown,
}: CitySectionProps) {
  const cityKeys = groups.map((group) => group.key)
  // 依赖直接用 `groups`：它由 `DimensionAnalysisPanel` 用 `useMemo` 冻结，
  // 只有筛选/数据变化时身份才变，所以 memo 能正常命中；`cityKeys` 由它派生，不单独进依赖。
  const option = useMemo<EChartOption>(() => {
    const axisKeys = groups.map((group) => group.key)
    return {
      aria: { enabled: true, label: { description: '各城市记录数（按 offer 状态堆叠）' } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      legend: { bottom: 0, type: 'scroll' },
      grid: { left: 8, right: 16, top: 16, bottom: 56, containLabel: true },
      xAxis: { type: 'category', data: axisKeys, name: '城市' },
      yAxis: { type: 'value', name: '记录数' },
      series: TREND_STATUS_ORDER.map((status) => ({
        name: status,
        type: 'bar' as const,
        stack: 'status',
        itemStyle: { color: STATUS_COLORS[status] },
        data: groups.map((group) => countOfStatus(group.counts, status)),
      })),
    }
  }, [groups])

  return (
    <SectionShell notes={[CITY_NOTE, CHART_HINT]} title={SECTION_TITLES.city}>
      <EChart
        ariaLabel={`城市对比：${cityKeys.join('、')} 的记录数，共 ${formatInteger(
          records.length,
        )} 条；同数数据表见下方`}
        heightPx={280}
        onSelectCategory={(category) => {
          if (cityKeys.includes(category)) {
            onDrilldown(category)
          }
        }}
        option={option}
      />

      <GroupSummaryTable
        caption="城市计数与率并列表：每行都给出 N / J / P / A / R / D 与分子分母；「其他城市」「未知城市」单列，不并入三地。"
        dimensionLabel="城市"
        groups={groups}
        onDrilldown={onDrilldown}
        totalRow={total}
      />

      <details className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          周期分位表（仅已入职记录，日历日）
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-xs">
            <caption className="pb-2 text-left text-slate-500">
              实际招聘周期 = 入职日期 − 启动日期；日期缺失、非法或为负的记录不进样本（也不能当 0 天）。
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-3 font-medium" scope="col">
                  城市
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  有效 n
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  P25
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  中位数
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  P75
                </th>
                <th className="py-1 font-medium" scope="col">
                  被排除
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const actual = group.cycles.actual
                return (
                  <tr className="border-b border-slate-100" key={group.key}>
                    <th className="py-1 pr-3 text-left font-normal" scope="row">
                      {group.key}
                    </th>
                    <td className="py-1 pr-3 tabular-nums">{formatInteger(actual.n)}</td>
                    <td className="py-1 pr-3 tabular-nums">{formatDays(actual.p25Days)}</td>
                    <td className="py-1 pr-3 tabular-nums">{formatDays(actual.medianDays)}</td>
                    <td className="py-1 pr-3 tabular-nums">{formatDays(actual.p75Days)}</td>
                    {/* 被排除数是**已知计数**（引擎在 n = 0 时也会给出真实值），
                        所以「整组都被排除」时更要显示它，不能显示成「—」 */}
                    <td className="py-1 tabular-nums">{formatInteger(actual.excludedCount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>
    </SectionShell>
  )
}
