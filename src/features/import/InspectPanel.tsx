import {
  DELIMITERS,
  DELIMITER_LABELS,
  TEXT_ENCODINGS,
  TEXT_ENCODING_LABELS,
  type Delimiter,
  type ImportInspection,
  type TextEncoding,
} from '../../importers'
import { formatInteger } from '../../lib/format'

export type ParseOptions = {
  readonly sheetName: string | null
  readonly headerRowNumber: number
  readonly encoding: TextEncoding
  readonly delimiter: Delimiter | 'auto'
  readonly excludeHiddenRows: boolean
}

const ENCODING_SOURCE_LABELS: Readonly<Record<string, string>> = {
  bom: '按文件 BOM',
  'utf8-valid': '按 UTF-8 合法性判断',
  fallback: '按回退规则判断（可能不是 UTF-8）',
  user: '按你的选择',
  paste: '粘贴文本不涉及编码',
}

const DELIMITER_SOURCE_LABELS: Readonly<Record<string, string>> = {
  auto: '自动识别',
  user: '按你的选择',
  fallback: '未能识别，按来源默认',
}

type InspectPanelProps = {
  readonly inspection: ImportInspection
  readonly options: ParseOptions
  readonly busy: boolean
  readonly onChange: (patch: Partial<ParseOptions>) => void
  readonly onParse: () => void
}

/**
 * 读取设置：工作表 / 表头行 / 编码 / 分隔符都在这里由用户确认。
 * 预览只在本机显示前若干行，用于核对编码与分隔符是否正确。
 */
export default function InspectPanel({ inspection, options, busy, onChange, onParse }: InspectPanelProps) {
  const selectedSheet =
    inspection.kind === 'xlsx' ? (inspection.sheets.find((sheet) => sheet.name === options.sheetName) ?? null) : null

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">读取设置</h2>
        <span className="text-xs text-slate-500">
          {inspection.kind === 'delimited'
            ? `读到 ${formatInteger(inspection.rowCount)} 行 × ${formatInteger(inspection.columnCount)} 列`
            : `工作簿共 ${formatInteger(inspection.sheets.length)} 张工作表`}
        </span>
      </div>

      {inspection.kind === 'delimited' ? (
        <div className="space-y-3">
          <p className="text-xs leading-5 text-slate-600">
            编码：{TEXT_ENCODING_LABELS[inspection.encoding]}（
            {ENCODING_SOURCE_LABELS[inspection.encodingSource] ?? '未知'}
            {inspection.hasBom ? '，含 BOM 已去除' : ''}）；分隔符：
            {DELIMITER_LABELS[inspection.delimiter].split('（')[0]}（
            {DELIMITER_SOURCE_LABELS[inspection.delimiterSource] ?? '未知'}）。
            {inspection.emptyRowCount > 0 ? ` 空行 ${formatInteger(inspection.emptyRowCount)} 行（跳过但计数）。` : ''}
          </p>
          {inspection.encodingHint !== null && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">{inspection.encodingHint}</p>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              文本编码
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
                onChange={(event) => {
                  onChange({ encoding: event.target.value as TextEncoding })
                }}
                value={options.encoding}
              >
                {TEXT_ENCODINGS.map((encoding) => (
                  <option key={encoding} value={encoding}>
                    {TEXT_ENCODING_LABELS[encoding]}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-slate-700">
              分隔符
              <select
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
                onChange={(event) => {
                  onChange({ delimiter: event.target.value as Delimiter | 'auto' })
                }}
                value={options.delimiter}
              >
                <option value="auto">自动识别（推荐）</option>
                {DELIMITERS.map((delimiter) => (
                  <option key={delimiter} value={delimiter}>
                    {DELIMITER_LABELS[delimiter]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <p className="text-xs font-medium text-slate-700">
              原文预览（仅本机显示，前 {inspection.preview.lines.length} 行）
            </p>
            <div className="mt-1 max-h-40 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-2 font-mono text-xs leading-5 text-slate-700">
              {inspection.preview.lines.map((line, index) => (
                <div key={index} className="whitespace-pre">
                  {line === '' ? '（空行）' : line}
                </div>
              ))}
            </div>
            {(inspection.preview.truncatedLines || inspection.preview.truncatedChars) && (
              <p className="mt-1 text-xs text-slate-500">预览已截断，仅用于确认编码与分隔符。</p>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-700">
            工作表
            <select
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
              onChange={(event) => {
                onChange({ sheetName: event.target.value })
              }}
              value={options.sheetName ?? ''}
            >
              {inspection.sheets.map((sheet) => (
                <option key={sheet.name} value={sheet.name}>
                  {sheet.name}
                  {sheet.hidden ? '（隐藏工作表）' : ''}
                  {sheet.empty
                    ? '（空表，没有内容）'
                    : `（${formatInteger(sheet.rowCount)} 行 × ${formatInteger(sheet.columnCount)} 列）`}
                </option>
              ))}
            </select>
          </label>

          {selectedSheet !== null && selectedSheet.hidden && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              所选工作表在源文件里是隐藏的。隐藏工作表不会被自动排除，需要你确认是否要读它。
            </p>
          )}
          {inspection.sheets.some((sheet) => sheet.empty) && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              已跳过空工作表：
              {inspection.sheets
                .filter((sheet) => sheet.empty)
                .map((sheet) => sheet.name)
                .join('、')}
            </p>
          )}

          {inspection.previewRows.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-700">
                预览（工作表「{inspection.previewSheetName}」前 {inspection.previewRows.length} 行，仅本机显示）
              </p>
              <div className="mt-1 max-h-44 overflow-auto rounded-md border border-slate-200">
                <table className="w-full border-collapse text-xs">
                  <tbody>
                    {inspection.previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b border-slate-100 last:border-b-0">
                        <td className="whitespace-nowrap bg-slate-50 px-2 py-1 text-right text-slate-400">
                          {rowIndex + 1}
                        </td>
                        {row.map((cell, columnIndex) => (
                          <td
                            key={columnIndex}
                            className="whitespace-nowrap border-l border-slate-100 px-2 py-1 text-slate-700"
                          >
                            {cell === '' ? '—' : cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs leading-5 text-slate-600">
            工作簿日期系统：{inspection.date1904 ? '1904（清洗阶段按此换算）' : '1900（清洗阶段按此换算）'}；
            本步只读取单元格原始值：不计算公式、不执行宏、不更新外部链接、不激活单元格链接。
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4 border-t border-slate-100 pt-3">
        <label className="block text-xs font-medium text-slate-700">
          表头行（源文件物理行号）
          <input
            className="mt-1 w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
            min={1}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10)
              onChange({ headerRowNumber: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 })
            }}
            type="number"
            value={options.headerRowNumber}
          />
        </label>

        {inspection.kind === 'xlsx' && selectedSheet !== null && selectedSheet.hiddenRowCount > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              checked={options.excludeHiddenRows}
              onChange={(event) => {
                onChange({ excludeHiddenRows: event.target.checked })
              }}
              type="checkbox"
            />
            排除隐藏行（{formatInteger(selectedSheet.hiddenRowCount)} 行；默认包含）
          </label>
        )}

        <button
          className="ml-auto inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={busy || (inspection.kind === 'xlsx' && options.sheetName === null)}
          onClick={onParse}
          type="button"
        >
          开始解析
        </button>
      </div>
    </section>
  )
}
