import {
  CHANNEL_REFERRAL_NOTE,
  type CrossTabResult,
  type GroupSummary,
  type MetricAvailability,
} from '../../domain'

import CrossTabTable from './CrossTabTable'
import GroupBarChart from './GroupBarChart'
import GroupSummaryTable from './GroupSummaryTable'
import SectionShell from './SectionShell'
import { CHART_HINT, MODULE_DISABLED_PREFIX, SECTION_TITLES } from './analysisText'
import { moduleUnavailableReason, rejectionRatesOf } from './dimensionViews'

type ChannelSectionProps = {
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
  readonly crossTab: CrossTabResult
  readonly availability: readonly MetricAvailability[]
  readonly onDrilldown: (value: string) => void
}

/**
 * 渠道与推荐人（docs/PRD.md 8 章「渠道与推荐人」）。
 *
 * - 渠道表：渠道 N / J / R / D 与各率；
 * - 渠道 × 推荐类型交叉表：两个维度分别成行 / 成列，**禁止**混为同一个维度；
 * - 渠道质量只代表 offer 阶段表现，不能称为渠道 ROI（文案来自引擎）。
 */
export default function ChannelSection({
  groups,
  total,
  crossTab,
  availability,
  onDrilldown,
}: ChannelSectionProps) {
  const disabledReason = moduleUnavailableReason(availability, '渠道对比')

  return (
    <SectionShell
      notes={[
        CHANNEL_REFERRAL_NOTE,
        `${crossTab.note} 行合计与列合计都由引擎对各自的记录重新汇总。`,
        CHART_HINT,
        ...(disabledReason === null ? [] : [`${MODULE_DISABLED_PREFIX}：${disabledReason}`]),
      ]}
      title={SECTION_TITLES.channel}
    >
      {/* 用户需求 ③：先看图（各渠道量 + 拒 offer 率），再看表；点柱子可下钻 */}
      <GroupBarChart
        ariaDescription="各渠道的记录数与拒 offer 率"
        groups={groups}
        metric="total"
        onSelectCategory={onDrilldown}
        rateLines={[{ label: '拒 offer 率（R/D）', values: rejectionRatesOf(groups) }]}
        xAxisName="渠道"
      />

      <GroupSummaryTable
        caption="渠道量率表：渠道（官网 / Boss / 实习僧 / 内推 / 其他 / 未知）与「推荐类型」是两个维度，本表只看渠道。"
        dimensionLabel="渠道"
        groups={groups}
        onDrilldown={onDrilldown}
        totalRow={total}
      />

      <CrossTabTable
        caption="渠道 × 推荐类型交叉表：每格是该组合的完整汇总（0 表示组合内没有记录，不是缺失）；「未知」排在最后。"
        cornerLabel="渠道 \ 推荐类型"
        crossTab={crossTab}
      />
    </SectionShell>
  )
}
