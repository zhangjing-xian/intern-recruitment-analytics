import type { RejectionDimensionView } from '../../insights'
import SectionShell from '../dimensions/SectionShell'

import DimensionComparisonTable from './DimensionComparisonTable'
import { DIMENSIONS_HEADING, DIMENSIONS_NOTE, DRILLDOWN_DISABLED_NOTE, SECTION_TITLES } from './rejectionText'

type DimensionComparisonPanelProps = {
  /** 引擎产出的各维度对比（顺序即 `REJECTION_DIMENSIONS`，界面不再排序、不再筛选） */
  readonly dimensions: readonly RejectionDimensionView[]
  /** 当前筛选下的记录数；为 0 时不渲染任何维度表（不画空表、不显示 0%） */
  readonly recordCount: number
}

/**
 * 分维度对比面板（docs/PRD.md 9.1）。
 *
 * 逐维度渲染 `DimensionComparisonTable`。**不在这里做任何聚合**：
 * `insight.dimensions` 已经是 `aggregateByDimension` 的结果（每个维度的分组、合计、组内构成都算好了），
 * 本组件只负责版式与「没有分组时怎么说」。
 *
 * 「该维度在当前筛选下没有分组」是**正常状态**（例如全表都没有映射「序列」列，
 * 或筛选后只剩一个取值之外的空集），必须逐维度明说，不能用一张空表糊过去。
 */
export default function DimensionComparisonPanel({
  dimensions,
  recordCount,
}: DimensionComparisonPanelProps) {
  const emptyDimensions = dimensions.filter((view) => view.groups.length === 0)

  return (
    <SectionShell
      notes={[
        DIMENSIONS_NOTE,
        DRILLDOWN_DISABLED_NOTE,
        recordCount === 0
          ? '当前筛选下没有记录，因此没有任何维度分组可以对比。'
          : emptyDimensions.length === 0
            ? '以下每个维度都已有分组。'
            : `其中 ${emptyDimensions.length} 个维度当前没有分组（见下方各自说明）：${emptyDimensions
                .map((view) => view.label)
                .join('、')}。`,
      ]}
      title={SECTION_TITLES.dimensions}
    >
      <h4 className="text-xs font-medium text-slate-700">{DIMENSIONS_HEADING}</h4>
      <div className="space-y-4">
        {dimensions.map((view) => (
          <DimensionComparisonTable key={view.dimension} view={view} />
        ))}
      </div>
    </SectionShell>
  )
}
