import { targetLabel, type ImportMappingEntry, type RawSheet } from '../../domain'
import { formatInteger } from '../../lib/format'

const PREVIEW_ROWS = 5
const PREVIEW_COLUMNS = 12

type RowPreviewPanelProps = {
  readonly sheet: RawSheet
  readonly entries: readonly ImportMappingEntry[]
}

/**
 * 前 5 行预览：把「源表头 → 目标字段」直接对到数据上看一眼，确认没有把错的列当成姓名 / 薪资 / 状态。
 * 只在本机显示前若干行，完整数据由清洗预览页（步骤5）处理。
 */
export default function RowPreviewPanel({ sheet, entries }: RowPreviewPanelProps) {
  if (sheet.rows.length === 0) {
    return null
  }

  const visibleEntries = entries.slice(0, PREVIEW_COLUMNS)
  const rows = sheet.rows.filter((row) => !row.emptyRow).slice(0, PREVIEW_ROWS)

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">前 {formatInteger(rows.length)} 行预览</h2>
        <span className="text-xs text-slate-500">
          仅本机显示（
          {formatInteger(PREVIEW_COLUMNS)} 列以内）；完整数据在清洗预览页核对。
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">没有非空数据行。</p>
      ) : (
        <div className="mt-3 overflow-auto rounded-md border border-slate-200">
          <table className="border-collapse text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-2 py-1 text-right font-medium">行号</th>
                {visibleEntries.map((entry) => (
                  <th
                    className="whitespace-nowrap border-l border-slate-200 px-2 py-1 text-left font-medium"
                    key={entry.columnIndex}
                  >
                    <span className="block text-slate-500">
                      {entry.sourceHeader === '' ? '（空表头）' : entry.sourceHeader}
                    </span>
                    <span className="block text-slate-800">
                      → {targetLabel(entry.targetField, entry.targetExtension)}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-slate-100" key={row.sourceRow}>
                  <td className="whitespace-nowrap bg-slate-50 px-2 py-1 text-right text-slate-400">
                    {formatInteger(row.sourceRow)}
                    {row.hidden ? '（隐藏）' : ''}
                  </td>
                  {visibleEntries.map((entry) => {
                    const cell = row.cells[entry.columnIndex] ?? null
                    return (
                      <td
                        className="max-w-[14rem] truncate whitespace-nowrap border-l border-slate-100 px-2 py-1 text-slate-700"
                        key={entry.columnIndex}
                      >
                        {cell === null || cell === '' ? '—' : String(cell)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
