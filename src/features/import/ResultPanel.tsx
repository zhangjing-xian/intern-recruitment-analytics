import { Link } from 'react-router-dom'

import {
  ISSUE_TITLES,
  hasBlockingIssue,
  summarizeIssues,
  type DataQualityIssueCode,
  type DataQualitySeverity,
  type RawSheet,
} from '../../domain'
import { formatInteger } from '../../lib/format'

const SOURCE_KIND_LABELS: Readonly<Record<string, string>> = {
  xlsx: 'Excel 工作簿',
  csv: 'CSV / TSV 文件',
  'tsv-paste': '粘贴内容',
}

const SEVERITY_STYLES: Readonly<Record<DataQualitySeverity, string>> = {
  阻断: 'bg-red-100 text-red-800',
  字段错误: 'bg-orange-100 text-orange-800',
  警告: 'bg-amber-100 text-amber-800',
}

const PREVIEW_ROWS = 8
const PREVIEW_COLUMNS = 12

type ResultPanelProps = {
  readonly sheet: RawSheet
  readonly onRestart: () => void
}

/** 解析结果概览：只展示计数、问题与少量行预览，绝不把整份数据打印到控制台或日志 */
export default function ResultPanel({ sheet, onRestart }: ResultPanelProps) {
  const blocking = hasBlockingIssue(sheet.issues)
  const summary = summarizeIssues(sheet.issues)

  const noteCounts = new Map<DataQualityIssueCode, number>()
  for (const row of sheet.rows) {
    for (const code of row.parseNotes) {
      noteCounts.set(code, (noteCounts.get(code) ?? 0) + 1)
    }
  }

  const counts: readonly { readonly label: string; readonly value: number }[] = [
    { label: '物理行数', value: sheet.physicalRowCount },
    { label: '数据行', value: sheet.rows.length },
    { label: '空行', value: sheet.emptyRowCount },
    { label: '隐藏行', value: sheet.hiddenRowCount },
    { label: '隐藏列', value: sheet.hiddenColumnIndexes.length },
    { label: '公式无缓存', value: sheet.formulaWithoutCacheCount },
    { label: '跳过空表', value: sheet.skippedSheets.length },
  ]

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">解析结果</h2>
          <p className="mt-1 text-xs text-slate-600">
            来源：{SOURCE_KIND_LABELS[sheet.sourceKind] ?? sheet.sourceKind} · {sheet.sourceSheet} · 表头第
            {' '}
            {formatInteger(sheet.header.sourceRow)} 行 · 数据 {formatInteger(sheet.rows.length)} 行
            {sheet.encoding === null ? '' : ` · 编码 ${sheet.encoding}`}
            {sheet.delimiter === null ? '' : ` · 分隔符 ${sheet.delimiter === '\t' ? '制表符' : sheet.delimiter}`}
          </p>
        </div>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          onClick={onRestart}
          type="button"
        >
          重新选择来源
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {counts.map((item) => (
          <div key={item.label} className="rounded-md bg-slate-50 px-3 py-2">
            <dt className="text-xs text-slate-500">{item.label}</dt>
            <dd className="mt-0.5 text-base font-semibold text-slate-900">{formatInteger(item.value)}</dd>
          </div>
        ))}
      </dl>

      <div className="space-y-2">
        <p className="text-xs text-slate-600">
          问题汇总：阻断 {formatInteger(summary.阻断)} · 字段错误 {formatInteger(summary.字段错误)} · 警告
          {' '}
          {formatInteger(summary.警告)}；行级提示 {formatInteger(noteCounts.size)} 类。
        </p>
        {sheet.issues.length === 0 && noteCounts.size === 0 && (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            读取阶段没有发现问题；缺失单元格一律记为「缺失」（null），不是 0。
          </p>
        )}

        {sheet.issues.map((issue, index) => (
          <div
            key={`${issue.code}-${index}`}
            className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-xs"
          >
            <span className={`rounded-full px-2 py-0.5 font-medium ${SEVERITY_STYLES[issue.severity]}`}>
              {issue.severity}
            </span>
            <span className="font-medium text-slate-800">{issue.message}</span>
            <span className="text-slate-500">
              {issue.sourceSheet === null ? '' : `工作表 ${issue.sourceSheet} · `}
              {issue.sourceRow === null ? '' : `第 ${formatInteger(issue.sourceRow)} 行`}
            </span>
          </div>
        ))}

        {noteCounts.size > 0 && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
            行级提示：
            {[...noteCounts.entries()]
              .map(([code, count]) => `${ISSUE_TITLES[code]}（${formatInteger(count)} 行）`)
              .join('；')}
            。逐行详情在清洗预览页处理。
          </p>
        )}

        {blocking && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
            存在阻断级问题：请先按上面的说明修正来源文件或读取设置，再进入字段映射。
          </p>
        )}
      </div>

      {sheet.rows.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-700">
            行预览（前 {Math.min(PREVIEW_ROWS, sheet.rows.length)} 行 / 前 {PREVIEW_COLUMNS} 列，仅本机显示）
          </p>
          <div className="mt-1 max-h-64 overflow-auto rounded-md border border-slate-200">
            <table className="border-collapse text-xs">
              <tbody>
                <tr className="bg-slate-50">
                  <td className="px-2 py-1 text-right text-slate-400">行号</td>
                  {sheet.header.headers.slice(0, PREVIEW_COLUMNS).map((header, index) => (
                    <td key={index} className="whitespace-nowrap border-l border-slate-200 px-2 py-1 font-medium text-slate-700">
                      {header === '' ? '（空表头）' : header}
                    </td>
                  ))}
                </tr>
                {sheet.rows.slice(0, PREVIEW_ROWS).map((row) => (
                  <tr key={row.sourceRow} className="border-t border-slate-100">
                    <td className="whitespace-nowrap bg-slate-50 px-2 py-1 text-right text-slate-400">
                      {formatInteger(row.sourceRow)}
                      {row.hidden ? '（隐藏）' : ''}
                    </td>
                    {row.cells.slice(0, PREVIEW_COLUMNS).map((cell, index) => (
                      <td key={index} className="whitespace-nowrap border-l border-slate-100 px-2 py-1 text-slate-700">
                        {cell === null ? '—' : String(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sheet.rows.length > PREVIEW_ROWS && (
            <p className="mt-1 text-xs text-slate-500">仅显示前 {PREVIEW_ROWS} 行；完整数据显示在清洗预览页。</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
        <Link
          className={`inline-flex items-center rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            blocking
              ? 'pointer-events-none bg-slate-200 text-slate-500'
              : 'bg-slate-900 text-white hover:bg-slate-700'
          }`}
          aria-disabled={blocking}
          tabIndex={blocking ? -1 : 0}
          to="/mapping"
        >
          下一步：字段映射
        </Link>
        <span className="text-xs text-slate-500">
          本次解析结果只保存在内存中（临时模式）：刷新或关闭页面即清除，字段映射页会直接使用它；
          重新选择来源会一并丢弃当前解析结果与已确认的字段映射。
        </span>
      </div>
    </section>
  )
}
