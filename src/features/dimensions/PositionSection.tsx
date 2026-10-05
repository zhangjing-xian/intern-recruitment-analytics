import { useMemo } from 'react'

import {
  GROUP_DIMENSION_LABELS,
  POSITION_RANK_NOTE,
  type GroupDimension,
  type GroupSummary,
} from '../../domain'
import { formatInteger } from '../../lib/format'
import EChart from '../dashboard/charts/EChart'
import type { EChartOption } from '../dashboard/charts/echartsLoader'

import GroupSummaryTable from './GroupSummaryTable'
import SectionShell from './SectionShell'
import { CHART_HINT, DRILLDOWN_LABEL, RANK_MODE_NOTE, SECTION_TITLES } from './analysisText'
import {
  RANK_TABLE_MODES,
  RANK_TABLE_MODE_LABELS,
  STRUCTURE_DIMENSIONS,
  scatterPointsOf,
  type RankTableMode,
} from './dimensionViews'

type PositionSectionProps = {
  readonly dimension: GroupDimension
  readonly mode: RankTableMode
  onChangeDimension: (dimension: GroupDimension) => void
  onChangeMode: (mode: RankTableMode) => void
  /** TopN + 其他（图表与默认表用） */
  readonly groups: readonly GroupSummary[]
  /** 完整分组（「完整表」模式用） */
  readonly allGroups: readonly GroupSummary[]
  readonly total: GroupSummary
  readonly onDrilldown: (value: string) => void
}

/**
 * 岗位 / 序列 / 部门（docs/PRD.md 8 章「岗位 / 序列 / 部门」）。
 *
 * - 维度可切换（岗位 / 序列 / 一级部门），全部走同一个 `aggregateByDimension`；
 * - 量率散点：横轴是核心分母 D（率的可比基数），纵轴是拒 offer 率；
 *   引擎里的率**始终是 0–1 比率**，这里的 `Math.round(rate * 10000) / 100` 只是把刻度换算成
 *   「百分数保留 2 位小数」以便纵轴读作 %，与下方数据表的 `formatPercent(..., 2)` **同精度**
 *   （纯展示换算，不是重新计算指标；率的分子分母仍来自引擎）；
 *   点大小按记录数缩放（由 `scatterPointsOf` 给出，本组件不算）；
 * - 排行默认 TopN + 其他，可切「完整表」；合并行不能下钻（不是真实取值）。
 */
export default function PositionSection({
  dimension,
  mode,
  onChangeDimension,
  onChangeMode,
  groups,
  allGroups,
  total,
  onDrilldown,
}: PositionSectionProps) {
  const points = useMemo(() => scatterPointsOf(groups), [groups])
  const dimensionLabel = GROUP_DIMENSION_LABELS[dimension]

  const option = useMemo<EChartOption>(
    () => ({
      aria: { enabled: true, label: { description: `${dimensionLabel}量率散点图` } },
      tooltip: { trigger: 'item' },
      grid: { left: 8, right: 24, top: 24, bottom: 40, containLabel: true },
      xAxis: { type: 'value', name: '核心分母 D' },
      yAxis: { type: 'value', name: '拒 offer 率（%）' },
      series: [
        {
          name: `${dimensionLabel}（点大小 = 记录数）`,
          type: 'scatter',
          data: points.map((point) => ({
            name: point.name,
            // PRD 8 章要求「量大入职少 / 拒 offer 高必须同时展示 N、D、R」：
            // 点大小只能表达一个量，因此把 N / D / R 一起放进数据点，
            // 用 ECharts **默认**提示框逐点读出（默认是文本节点，不会把分组值当 HTML 解析；
            // 自定义 HTML formatter 会把分组原文注入 DOM，属禁止用法）。
            // 三个数字全部来自引擎的 `scatterPointsOf`，这里只做排版，不重新计算任何指标。
            value: [
              point.denominator,
              // 与下方数据表同精度（表用 formatPercent(..., 2)）：0–1 比率是引擎给的，
              // 这里只做「比率 → 百分数」的显示换算，不重新计算指标。
              Math.round(point.rejectionRate * 10000) / 100,
              point.total,
              point.rejected,
            ],
            symbolSize: point.symbolSize,
          })),
        },
      ],
    }),
    [dimensionLabel, points],
  )

  return (
    <SectionShell
      actions={
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span>维度：</span>
          {STRUCTURE_DIMENSIONS.map((item) => (
            <button
              aria-pressed={item === dimension}
              className={`rounded border px-2 py-1 transition-colors ${
                item === dimension
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
              key={item}
              onClick={() => onChangeDimension(item)}
              type="button"
            >
              {GROUP_DIMENSION_LABELS[item]}
            </button>
          ))}
        </div>
      }
      notes={[POSITION_RANK_NOTE, RANK_MODE_NOTE, CHART_HINT]}
      title={SECTION_TITLES.position}
    >
      {points.length === 0 ? (
        <p className="text-xs leading-5 text-slate-600">
          当前筛选下没有「分母有效」的分组（D = 0 的分组不进散点图，避免画出假装「拒率 0%」的点）；
          数据表仍会显示这些分组的计数。
        </p>
      ) : (
        <EChart
          ariaLabel={`${dimensionLabel}量率散点图：横轴核心分母 D、纵轴拒 offer 率（%），共 ${formatInteger(
            points.length,
          )} 个点；同数数据表见下方`}
          heightPx={300}
          onSelectCategory={(category) => {
            if (points.some((point) => point.name === category)) {
              onDrilldown(category)
            }
          }}
          option={option}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>表格范围：</span>
        {RANK_TABLE_MODES.map((item) => (
          <button
            aria-pressed={item === mode}
            className={`rounded border px-2 py-1 transition-colors ${
              item === mode
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-300 text-slate-700 hover:bg-slate-100'
            }`}
            key={item}
            onClick={() => onChangeMode(item)}
            type="button"
          >
            {RANK_TABLE_MODE_LABELS[item]}
          </button>
        ))}
        <span className="text-slate-500">
          {DRILLDOWN_LABEL}：点开即把全局筛选设为该取值。
        </span>
      </div>

      <GroupSummaryTable
        caption={
          mode === 'topN'
            ? `${dimensionLabel}排行（${RANK_TABLE_MODE_LABELS.topN}）：量大入职少、拒 offer 高必须同时看 N、D、R。`
            : `${dimensionLabel}完整分组表（未合并任何分组）：小样本分组只显示率并标注门槛，不参与自动排名。`
        }
        dimensionLabel={dimensionLabel}
        groups={mode === 'topN' ? groups : allGroups}
        onDrilldown={onDrilldown}
        totalRow={total}
      />
    </SectionShell>
  )
}
