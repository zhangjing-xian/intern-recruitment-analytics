import type { RejectionDimensionView } from '../../insights'
import GroupSummaryTable from '../dimensions/GroupSummaryTable'

import { DIMENSION_EMPTY_NOTE } from './rejectionText'

type DimensionComparisonTableProps = {
  readonly view: RejectionDimensionView
  /**
   * 下钻回调（可选）：收到的是**该分组的取值**。
   *
   * 拒 offer 专项页面**不传**这个属性——本页没有自己的筛选快照（见 `DRILLDOWN_DISABLED_NOTE`）。
   * 保留这个可选口子是为了让将来把本表嵌进带筛选快照的页面时无需改组件，
   * 也保证「下钻维度必须由表自己声明」这条规则不被破坏：调用方明确知道自己在改哪个维度。
   */
  readonly onDrilldown?: (dimension: RejectionDimensionView['dimension'], value: string) => void
}

/**
 * 单个维度的拒 offer 对比表（docs/PRD.md 9.1）。
 *
 * 直接复用步骤9 的通用分组表，并打开 `showGroupComposition`：
 * - **特征内结果**：该取值的 N / J / P / A / R / D、入职率、拒 offer 率（分母是该取值的 D，
 *   待入职仍在 D 内）——全部由引擎的 `aggregateByDimension` 产出；
 * - **组内构成**：`拒 offer 组（/R）` 与 `入职组（/J）` 两列，说明该取值在两组里的画像分布。
 *
 * 合计行用 `view.total`（引擎对**全量记录**重新汇总的结果），不是把各分组相加——
 * 分组表自己也从不把分组的率平均。
 */
export default function DimensionComparisonTable({
  view,
  onDrilldown,
}: DimensionComparisonTableProps) {
  if (view.groups.length === 0) {
    return (
      <section className="rounded border border-dashed border-slate-300 p-3">
        <h4 className="text-xs font-medium text-slate-700">{view.label}</h4>
        <p className="mt-1 text-xs leading-5 text-slate-600">{DIMENSION_EMPTY_NOTE}</p>
      </section>
    )
  }

  return (
    <GroupSummaryTable
      // 维度名作为首列表头；caption 用引擎给的组内构成说明，界面不改写
      caption={`${view.compositionNote} 合计行 = 当前筛选下的全量口径（含待入职与审批中），不是两组之和。`}
      dimensionLabel={view.label}
      groups={view.groups}
      onDrilldown={
        onDrilldown === undefined
          ? undefined
          : (value) => {
              onDrilldown(view.dimension, value)
            }
      }
      showGroupComposition
      totalRow={view.total}
    />
  )
}
