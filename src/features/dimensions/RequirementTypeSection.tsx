import { REQUIREMENT_TYPE_NOTE, type GroupSummary } from '../../domain'
import { formatInteger } from '../../lib/format'

import GroupBarChart from './GroupBarChart'
import GroupSummaryTable from './GroupSummaryTable'
import SectionShell from './SectionShell'
import { CHART_HINT, SECTION_TITLES } from './analysisText'

type RequirementTypeSectionProps = {
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
  /** 未拆分需求类型（「替补 / 替换」写在一起）的记录数，由引擎计数 */
  readonly unsplitCount: number
  readonly onDrilldown: (value: string) => void
}

/**
 * 需求类型（docs/PRD.md 8 章「需求类型」）。
 *
 * 附件里「替补 / 替换」往往没有拆分：引擎把这类值统一归到「替补替换未拆分」并单独成组，
 * 因此本页只能比较「新增招聘」与「未拆分」，**不**宣称替补优于替换。
 */
export default function RequirementTypeSection({
  groups,
  total,
  unsplitCount,
  onDrilldown,
}: RequirementTypeSectionProps) {
  return (
    <SectionShell
      notes={[
        REQUIREMENT_TYPE_NOTE,
        `本次筛选中被归为「替补替换未拆分」的记录：${formatInteger(unsplitCount)} 条。`,
        CHART_HINT,
      ]}
      title={SECTION_TITLES.requirementType}
    >
      {/* 用户需求 ③：需求类型的量一眼可见；点柱子下钻到该类型 */}
      <GroupBarChart
        ariaDescription="各需求类型的记录数"
        groups={groups}
        metric="total"
        onSelectCategory={onDrilldown}
        xAxisName="需求类型"
      />

      <GroupSummaryTable
        caption="需求类型量率表：可选值包含新增招聘 / 替补 / 替换 / 替补替换未拆分 / 其他 / 未知；周期列只看已入职记录。"
        dimensionLabel="需求类型"
        groups={groups}
        onDrilldown={onDrilldown}
        totalRow={total}
      />
    </SectionShell>
  )
}
