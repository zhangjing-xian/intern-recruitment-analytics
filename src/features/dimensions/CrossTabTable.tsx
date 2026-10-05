import { crossTabCellOf, type CrossTabResult, type GroupSummary } from '../../domain'
import { EMPTY_VALUE, formatInteger, formatPercent } from '../../lib/format'

type CrossTabTableProps = {
  readonly caption: string
  /** 左上角表头，如「渠道 \ 推荐类型」 */
  readonly cornerLabel: string
  readonly crossTab: CrossTabResult
  /** 行合计列的表头（null 表示不显示行合计列） */
  readonly rowTotalLabel?: string | null
  readonly columnTotalLabel?: string
}

/** 交叉表里的一格：N / D 与拒 offer 率（分母 0 显示「—」，不显示 0%） */
function Cell({ summary }: { readonly summary: GroupSummary | null }) {
  if (summary === null) {
    return <td className="py-2 pr-3 text-xs text-slate-400">{EMPTY_VALUE}</td>
  }
  return (
    <td className="py-2 pr-3 align-top text-xs tabular-nums">
      <div>
        N {formatInteger(summary.counts.total)}
        <span className="ml-1 text-slate-400">
          （D {formatInteger(summary.counts.coreDenominator)}）
        </span>
      </div>
      <div className="text-slate-500" title="拒 offer 率 = R / D">
        拒率 {formatPercent(summary.rates.rejectionRate.value, 2)}
      </div>
    </td>
  )
}

/**
 * 通用交叉表（步骤9，渠道 × 推荐类型 / HR × 岗位结构共用）。
 *
 * 每一格、行合计、列合计与全表合计都直接取引擎 `crossTabulate` 的结果：
 * 界面不把格子相加，也不平均百分比（PRD 6.1）。
 */
export default function CrossTabTable({
  caption,
  cornerLabel,
  crossTab,
  rowTotalLabel = '行合计',
  columnTotalLabel = '列合计',
}: CrossTabTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="pb-2 text-left text-xs text-slate-500">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-2 pr-3 font-medium" scope="col">
              {cornerLabel}
            </th>
            {crossTab.columnKeys.map((columnKey) => (
              <th className="py-2 pr-3 font-medium" key={columnKey} scope="col">
                {columnKey}
              </th>
            ))}
            {rowTotalLabel !== null && (
              <th className="py-2 font-medium" scope="col">
                {rowTotalLabel}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {crossTab.rowKeys.map((rowKey) => (
            <tr className="border-b border-slate-100" key={rowKey}>
              <th className="py-2 pr-3 text-left font-normal" scope="row">
                {rowKey}
              </th>
              {crossTab.columnKeys.map((columnKey) => (
                <Cell key={`${rowKey}-${columnKey}`} summary={crossTabCellOf(crossTab, rowKey, columnKey)} />
              ))}
              {rowTotalLabel !== null && (
                <Cell summary={crossTab.rowTotals.find((group) => group.key === rowKey) ?? null} />
              )}
            </tr>
          ))}
          <tr className="border-b border-slate-200 bg-slate-50">
            <th className="py-2 pr-3 text-left" scope="row">
              {columnTotalLabel}
            </th>
            {crossTab.columnKeys.map((columnKey) => (
              <Cell
                key={`total-${columnKey}`}
                summary={crossTab.columnTotals.find((group) => group.key === columnKey) ?? null}
              />
            ))}
            {rowTotalLabel !== null && <Cell summary={crossTab.total} />}
          </tr>
        </tbody>
      </table>
    </div>
  )
}
