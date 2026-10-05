import {
  EXTENSION_FIELDS,
  MATCH_LEVEL_LABELS,
  STANDARD_FIELDS,
  targetKeyOf,
  type ColumnMatchLevel,
  type HeaderTargetSuggestion,
  type ImportMappingEntry,
  type MappingColumnSummary,
  type MappingConflict,
  type MappingTargetChoice,
} from '../../domain'
import { formatInteger } from '../../lib/format'

const MATCH_LEVEL_STYLES: Readonly<Record<ColumnMatchLevel, string>> = {
  exact: 'bg-emerald-100 text-emerald-800',
  normalized: 'bg-emerald-50 text-emerald-700',
  alias: 'bg-amber-100 text-amber-800',
  template: 'bg-sky-100 text-sky-800',
  fuzzy: 'bg-orange-100 text-orange-800',
  manual: 'bg-slate-200 text-slate-700',
  ignored: 'bg-slate-100 text-slate-500',
}

/** 下拉选项值编码：空串 = 忽略，`field:*` = 标准字段，`extension:*` = 扩展列 */
function encodeTarget(entry: ImportMappingEntry): string {
  return targetKeyOf(entry) ?? ''
}

function decodeTarget(value: string): MappingTargetChoice | null {
  const [kind, key] = value.split(':', 2)
  if (kind === 'field' && key !== undefined) {
    return { targetField: key as MappingTargetChoice['targetField'], targetExtension: null }
  }
  if (kind === 'extension' && key !== undefined) {
    return { targetField: null, targetExtension: key as MappingTargetChoice['targetExtension'] }
  }
  return null
}

type MappingTableProps = {
  readonly entries: readonly ImportMappingEntry[]
  readonly summaries: readonly MappingColumnSummary[]
  readonly suggestions: readonly HeaderTargetSuggestion[]
  readonly conflicts: readonly MappingConflict[]
  readonly onChange: (columnIndex: number, choice: MappingTargetChoice | null) => void
  readonly onConfirmColumn: (columnIndex: number, confirmed: boolean) => void
}

/**
 * 表头 → 标准字段的一对一映射表。
 *
 * 只读展示 + 明确改写：任何一列都可以被用户改成别的目标或「忽略」；
 * 别名 / 模糊 / 冲突列必须逐列确认，避免「自动识别」被当成「自动决定」。
 */
export default function MappingTable({
  entries,
  summaries,
  suggestions,
  conflicts,
  onChange,
  onConfirmColumn,
}: MappingTableProps) {
  const unresolvedGroups = new Set(conflicts.map((conflict) => conflict.groupId))

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">源表头 → 标准字段</h2>
        <span className="text-xs text-slate-500">
          样例只在本机显示；未映射的列默认忽略，不会出现在分析或导出中。
        </span>
      </div>

      <div className="mt-3 max-h-[32rem] overflow-auto rounded-md border border-slate-200">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2 text-left font-medium">列</th>
              <th className="px-2 py-2 text-left font-medium">源表头</th>
              <th className="px-2 py-2 text-left font-medium">样例（最多 3 个）</th>
              <th className="px-2 py-2 text-left font-medium">目标字段</th>
              <th className="px-2 py-2 text-left font-medium">匹配级别</th>
              <th className="px-2 py-2 text-left font-medium">确认</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const groupId = entry.conflictGroupId
              return (
                <MappingRow
                  conflict={groupId !== null && unresolvedGroups.has(groupId)}
                  entry={entry}
                  key={entry.columnIndex}
                  onChange={onChange}
                  onConfirmColumn={onConfirmColumn}
                  suggestion={suggestions[entry.columnIndex]}
                  summary={summaries[entry.columnIndex]}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

type MappingRowProps = {
  readonly entry: ImportMappingEntry
  readonly summary: MappingColumnSummary | undefined
  readonly suggestion: HeaderTargetSuggestion | undefined
  readonly conflict: boolean
  readonly onChange: (columnIndex: number, choice: MappingTargetChoice | null) => void
  readonly onConfirmColumn: (columnIndex: number, confirmed: boolean) => void
}

function MappingRow({
  entry,
  summary,
  suggestion,
  conflict,
  onChange,
  onConfirmColumn,
}: MappingRowProps) {
  const ignored = targetKeyOf(entry) === null
  const autoLevel = entry.matchLevel === 'exact' || entry.matchLevel === 'normalized'
  const rowClass = conflict
    ? 'bg-red-50'
    : ignored
      ? 'bg-slate-50/70'
      : ''

  return (
    <tr className={`border-t border-slate-100 align-top ${rowClass}`}>
      <td className="px-2 py-2 text-slate-400">
        {formatInteger(entry.columnIndex + 1)}
        {summary?.hidden === true && <span className="ml-1 text-amber-700">隐藏列</span>}
      </td>
      <td className="px-2 py-2 font-medium text-slate-800">
        {entry.sourceHeader === '' ? '（空表头）' : entry.sourceHeader}
        {suggestion !== undefined && suggestion.blockedReason !== null && (
          <span className="mt-0.5 block font-normal text-amber-700">{suggestion.blockedReason}</span>
        )}
      </td>
      <td className="px-2 py-2 text-slate-600">
        {summary === undefined || summary.samples.length === 0 ? (
          <span className="text-slate-400">（无非空值）</span>
        ) : (
          <>
            {summary.samples.map((sample) => (
              <span
                key={sample}
                className="mr-1 inline-block max-w-[12rem] truncate rounded bg-slate-100 px-1.5 py-0.5 align-middle"
              >
                {sample}
              </span>
            ))}
            <span className="block text-slate-400">
              非空 {formatInteger(summary.nonEmptyCount)} 个
              {summary.sampleTruncated ? '（样例已截断）' : ''}
            </span>
          </>
        )}
      </td>
      <td className="px-2 py-2">
        <select
          className="w-44 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
          onChange={(event) => {
            onChange(entry.columnIndex, decodeTarget(event.target.value))
          }}
          value={encodeTarget(entry)}
        >
          <option value="">忽略该列</option>
          <optgroup label="标准字段（21 列）">
            {STANDARD_FIELDS.map((field) => (
              <option key={field.key} value={`field:${field.key}`}>
                {field.header}
              </option>
            ))}
          </optgroup>
          <optgroup label="扩展列（可选）">
            {EXTENSION_FIELDS.map((field) => (
              <option key={field.key} value={`extension:${field.key}`}>
                {field.header}
              </option>
            ))}
          </optgroup>
        </select>
      </td>
      <td className="px-2 py-2">
        <span className={`inline-block rounded px-1.5 py-0.5 ${MATCH_LEVEL_STYLES[entry.matchLevel]}`}>
          {MATCH_LEVEL_LABELS[entry.matchLevel]}
        </span>
        {entry.matchLevel === 'fuzzy' && suggestion !== undefined && (
          <span className="mt-0.5 block text-slate-500">
            相似度 {(entry.confidence * 100).toFixed(0)}%
            {suggestion.matchedHeader === null ? '' : `（接近「${suggestion.matchedHeader}」）`}
          </span>
        )}
        {entry.matchLevel === 'alias' && suggestion !== undefined && suggestion.matchedHeader !== null && (
          <span className="mt-0.5 block text-slate-500">来自别名「{suggestion.matchedHeader}」</span>
        )}
        {conflict && <span className="mt-0.5 block text-red-700">目标冲突待解决</span>}
      </td>
      <td className="px-2 py-2">
        {entry.requiresConfirmation ? (
          <label className="flex items-center gap-1 text-slate-700">
            <input
              checked={false}
              onChange={() => {
                onConfirmColumn(entry.columnIndex, true)
              }}
              type="checkbox"
            />
            确认
          </label>
        ) : ignored ? (
          <span className="text-slate-400">—</span>
        ) : autoLevel ? (
          <span className="text-slate-400">不需要</span>
        ) : (
          <span className="text-emerald-700">
            已确认
            <button
              className="ml-1 text-slate-500 underline"
              onClick={() => {
                onConfirmColumn(entry.columnIndex, false)
              }}
              type="button"
            >
              撤销
            </button>
          </span>
        )}
      </td>
    </tr>
  )
}
