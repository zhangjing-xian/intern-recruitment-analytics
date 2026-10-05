import {
  HR_COVERAGE_NOTE,
  type CrossTabResult,
  type GroupSummary,
  type MetricAvailability,
  type RecruiterRankingAvailability,
} from '../../domain'

import CrossTabTable from './CrossTabTable'
import GroupBarChart from './GroupBarChart'
import GroupSummaryTable from './GroupSummaryTable'
import SectionShell from './SectionShell'
import { CHART_HINT, MODULE_DISABLED_PREFIX, SECTION_TITLES } from './analysisText'
import { moduleUnavailableReason, rejectionRatesOf } from './dimensionViews'

type RecruiterSectionProps = {
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
  /** HR 排名可用性（1 位 HR 时不排名，判定来自引擎） */
  readonly ranking: RecruiterRankingAvailability
  /** HR × 岗位结构交叉表 */
  readonly structure: CrossTabResult
  readonly availability: readonly MetricAvailability[]
  readonly onDrilldown: (value: string) => void
}

/**
 * HR 效能（docs/PRD.md 8 章「HR 效能」）。
 *
 * - 覆盖需求数单列（只在 HR 内去重，跨 HR 相加可能超过全局需求数，因此引擎的 note 必须展示）；
 * - 仅 1 位 HR 时不做排名（`ranking.canRank = false`，界面不显示「排名」字样）；
 * - 岗位结构用交叉表，便于看出「量率差异可能来自岗位构成」，避免直接当个人绩效结论。
 */
export default function RecruiterSection({
  groups,
  total,
  ranking,
  structure,
  availability,
  onDrilldown,
}: RecruiterSectionProps) {
  const disabledReason = moduleUnavailableReason(availability, 'HR效能')

  return (
    <SectionShell
      notes={[
        ranking.note,
        HR_COVERAGE_NOTE,
        `HR × 岗位结构：${structure.note}`,
        CHART_HINT,
        ...(disabledReason === null ? [] : [`${MODULE_DISABLED_PREFIX}：${disabledReason}`]),
      ]}
      title={SECTION_TITLES.recruiter}
    >
      {/* 用户需求 ③：HR 量 + 拒 offer 率一张图看完；点柱子下钻到该 HR */}
      <GroupBarChart
        ariaDescription="各招聘 HR 的记录数与拒 offer 率"
        groups={groups}
        metric="total"
        onSelectCategory={onDrilldown}
        rateLines={[{ label: '拒 offer 率（R/D）', values: rejectionRatesOf(groups) }]}
        xAxisName="招聘 HR"
      />

      <GroupSummaryTable
        caption="HR 效能表：覆盖需求数只在单个 HR 内去重（countDistinct(非空需求 ID)），跨 HR 相加不等于全局需求数。"
        dimensionLabel="招聘 HR"
        groups={groups}
        onDrilldown={onDrilldown}
        showCoverage
        totalRow={total}
      />

      <CrossTabTable
        caption="HR × 岗位结构：每格是该 HR 在该岗位上的记录数、核心分母与拒 offer 率；「未知」排在最后。"
        cornerLabel="招聘 HR \ 岗位"
        crossTab={structure}
      />
    </SectionShell>
  )
}
