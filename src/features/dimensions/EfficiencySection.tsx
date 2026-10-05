import { EFFICIENCY_NOTE, type CycleStats, type GroupSummary } from '../../domain'
import { EMPTY_VALUE, formatDays, formatInteger } from '../../lib/format'

import GroupBarChart from './GroupBarChart'
import SectionShell from './SectionShell'
import { CHART_HINT, SECTION_TITLES } from './analysisText'
import { isMergedGroupKey } from './dimensionViews'

type EfficiencySectionProps = {
  /** 实际招聘周期（仅已入职，日历日） */
  readonly actual: CycleStats
  /** 待入职计划周期（**计划**日期，不能与实际混排） */
  readonly planned: CycleStats
  /**
   * 岗位差异（TopN + 其他 的结构分组，周期直接取分组汇总里的 cycles）。
   * 注意：这个分组跟着「岗位 / 序列 / 一级部门」的当前切换走，所以表头文案也必须跟着变，
   * 否则切到「序列」后表格会拿序列值冒充岗位（文案与数据矛盾）。
   */
  readonly positions: readonly GroupSummary[]
  /** 当前结构维度的中文名（来自引擎的 `GROUP_DIMENSION_LABELS`） */
  readonly dimensionLabel: string
}

/** 周期统计表：P25 / 中位数 / P75 / 均值 + 有效 n + 被排除数（全部来自引擎） */
function CycleStatsTable({
  caption,
  stats,
}: {
  readonly caption: string
  readonly stats: CycleStats
}) {
  return (
    <table className="w-full min-w-[32rem] border-collapse text-xs">
      <caption className="pb-2 text-left text-slate-500">
        {caption}（{stats.note}）
      </caption>
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-500">
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
          <th className="py-1 pr-3 font-medium" scope="col">
            均值
          </th>
          <th className="py-1 font-medium" scope="col">
            被排除
          </th>
        </tr>
      </thead>
      <tbody>
        <tr className="border-b border-slate-100 tabular-nums">
          <td className="py-1 pr-3">{formatInteger(stats.n)}</td>
          <td className="py-1 pr-3">{formatDays(stats.p25Days)}</td>
          <td className="py-1 pr-3">{formatDays(stats.medianDays)}</td>
          <td className="py-1 pr-3">{formatDays(stats.p75Days)}</td>
          <td className="py-1 pr-3">{formatDays(stats.meanDays)}</td>
          <td className="py-1">{formatInteger(stats.excludedCount)}</td>
        </tr>
      </tbody>
    </table>
  )
}

/**
 * 时间效率（docs/PRD.md 8 章「时间效率」）。
 *
 * 三类周期必须分开看：实际招聘周期（已入职）、待入职计划周期（计划日期）、预计实习天数（计划）；
 * 拒 offer 记录缺拒绝日期，因此这里**不**计算决策耗时（引擎的 `EFFICIENCY_NOTE` 说明这一点）。
 */
export default function EfficiencySection({
  actual,
  planned,
  positions,
  dimensionLabel,
}: EfficiencySectionProps) {
  // 只展示至少有一侧有效样本的分组，避免渲染一整片「—」的假空行
  const rows = positions.filter(
    (group) => group.cycles.actual.n > 0 || group.cycles.planned.n > 0,
  )
  /**
   * 图表用的分组：**排除合并行**（「其他（N 个分组合并）」）。
   *
   * 合并行是若干不同岗位凑在一起的中位数，画成一根柱子会让人以为那是一个岗位；
   * 它仍然留在下方数据表里（口径见 `docs/DECISIONS.md` D-042 一系的规矩）。
   */
  const chartGroups = rows.filter((group) => !isMergedGroupKey(group.key))

  return (
    <SectionShell notes={[EFFICIENCY_NOTE, CHART_HINT]} title={SECTION_TITLES.efficiency}>
      {/* 用户需求 ③：周期差异先看图；有效样本为 0 的分组不画柱子（不是 0 天） */}
      {chartGroups.length === 0 ? null : (
        <GroupBarChart
          ariaDescription={`各${dimensionLabel}的实际招聘周期中位数（仅已入职且日期合法的记录）；合并分组不进图`}
          groups={chartGroups}
          // 岗位 / 序列 / 部门名常见 10 字以上，纵向类目轴放不下会整条丢掉 → 用横向条形图
          layout="horizontal"
          metric="cycleMedianDays"
          xAxisName={dimensionLabel}
        />
      )}

      <CycleStatsTable caption="实际招聘周期（入职日期 − 启动日期）" stats={actual} />
      <CycleStatsTable caption="待入职计划周期（「入职时间」列是计划日期）" stats={planned} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-xs">
          <caption className="pb-2 text-left text-slate-500">
            {dimensionLabel}差异：实际周期只统计已入职记录，计划周期只统计待入职记录，两列不可互相替代。
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-1 pr-3 font-medium" scope="col">
                {dimensionLabel}
              </th>
              <th className="py-1 pr-3 font-medium" scope="col">
                实际 n
              </th>
              <th className="py-1 pr-3 font-medium" scope="col">
                实际 P25
              </th>
              <th className="py-1 pr-3 font-medium" scope="col">
                实际中位数
              </th>
              <th className="py-1 pr-3 font-medium" scope="col">
                实际 P75
              </th>
              <th className="py-1 pr-3 font-medium" scope="col">
                计划 n
              </th>
              <th className="py-1 font-medium" scope="col">
                计划中位数
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td className="py-2 text-slate-500" colSpan={7}>
                  当前筛选下没有可用的周期样本（缺日期或状态不符的记录不进样本）：不显示 0 天。
                </td>
              </tr>
            )}
            {rows.map((group) => (
              <tr className="border-b border-slate-100 tabular-nums" key={group.key}>
                <th className="py-1 pr-3 text-left font-normal" scope="row">
                  {group.key}
                  {isMergedGroupKey(group.key) && (
                    <span className="ml-1 text-xs font-normal text-slate-400">（合并分组）</span>
                  )}
                </th>
                <td className="py-1 pr-3">{formatInteger(group.cycles.actual.n)}</td>
                <td className="py-1 pr-3">
                  {group.cycles.actual.n === 0 ? EMPTY_VALUE : formatDays(group.cycles.actual.p25Days)}
                </td>
                <td className="py-1 pr-3">
                  {group.cycles.actual.n === 0
                    ? EMPTY_VALUE
                    : formatDays(group.cycles.actual.medianDays)}
                </td>
                <td className="py-1 pr-3">
                  {group.cycles.actual.n === 0 ? EMPTY_VALUE : formatDays(group.cycles.actual.p75Days)}
                </td>
                <td className="py-1 pr-3">{formatInteger(group.cycles.planned.n)}</td>
                <td className="py-1">
                  {group.cycles.planned.n === 0
                    ? EMPTY_VALUE
                    : formatDays(group.cycles.planned.medianDays)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionShell>
  )
}
