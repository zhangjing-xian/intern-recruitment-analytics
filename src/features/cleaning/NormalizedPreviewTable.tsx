import { useMemo, useState } from 'react'

import { ISSUE_TITLES, getStandardField, type NormalizedRecord } from '../../domain'
import { EMPTY_VALUE, formatDate, formatInteger } from '../../lib/format'

const PAGE_SIZE = 50

/** 预览列：21 列太宽，先展示最常用来核对清洗结果的字段（其余字段在展开的原值对照里可见） */
const PREVIEW_FIELDS = [
  'requirementId',
  'candidateName',
  'city',
  'position',
  'recruitmentStartDate',
  'joiningDate',
  'offerStatus',
  'education',
  'school',
  'graduationYear',
  'salaryAmount',
  'housingRaw',
  'isGptSchool',
] as const

type NormalizedPreviewTableProps = {
  readonly records: readonly NormalizedRecord[]
}

/**
 * 规范化结果预览（docs/PRD.md 5.5）：默认分页展示，展开某一行可以看到**每个字段的原值 → 清洗值**
 * 与命中的规则、来源、是否推断、关联问题码。
 *
 * 这样任何结论都能回到原值：缺失显示「—」，不用 0 或「无」冒充；代号只是展示用，不是身份依据。
 */
export default function NormalizedPreviewTable({ records }: NormalizedPreviewTableProps) {
  const [page, setPage] = useState(0)
  const [expandedRecordId, setExpandedRecordId] = useState<string | null>(null)
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = useMemo(
    () => records.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE),
    [records, currentPage],
  )

  if (records.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">规范化结果预览</h2>
        <p className="mt-2 text-xs text-slate-600">
          当前没有保留任何记录：请先看质量报告里的阻断原因（例如 offer 状态列缺失或全部行被显式剔除）。
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">规范化结果预览</h2>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <span>
            第 {formatInteger(currentPage + 1)} / {formatInteger(pageCount)} 页 · 共{' '}
            {formatInteger(records.length)} 行
          </span>
          <button
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
            disabled={currentPage === 0}
            onClick={() => {
              setPage(currentPage - 1)
            }}
            type="button"
          >
            上一页
          </button>
          <button
            className="rounded-md border border-slate-300 px-2 py-1 disabled:opacity-40"
            disabled={currentPage >= pageCount - 1}
            onClick={() => {
              setPage(currentPage + 1)
            }}
            type="button"
          >
            下一页
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[64rem] text-left text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="py-1 pr-3 font-medium">行号</th>
              <th className="py-1 pr-3 font-medium">代号</th>
              {PREVIEW_FIELDS.map((field) => (
                <th className="py-1 pr-3 font-medium" key={field}>
                  {getStandardField(field).header}
                </th>
              ))}
              <th className="py-1 pr-3 font-medium">重复处理</th>
              <th className="py-1 font-medium">质量标记</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {visible.map((record) => (
              <PreviewRow
                expanded={expandedRecordId === record.recordId}
                key={record.recordId}
                onToggle={() => {
                  setExpandedRecordId(expandedRecordId === record.recordId ? null : record.recordId)
                }}
                record={record}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** 单元格文本：空值统一显示「—」，数字与日期分别格式化（**不**把 null 显示成 0） */
function cellText(record: NormalizedRecord, field: (typeof PREVIEW_FIELDS)[number]): string {
  const value = record[field]
  if (value === null || value === undefined) {
    return EMPTY_VALUE
  }
  if (field === 'graduationYear') {
    return formatInteger(Number(value))
  }
  if (field === 'recruitmentStartDate' || field === 'joiningDate') {
    return formatDate(String(value))
  }
  if (field === 'salaryAmount') {
    return formatInteger(Number(value))
  }
  return String(value)
}

const DEDUP_ACTION_LABELS: Readonly<Record<string, string>> = {
  kept: '保留',
  pendingUserConfirmation: '待确认',
  removedAsDuplicate: '按策略移除',
}

type PreviewRowProps = {
  readonly record: NormalizedRecord
  readonly expanded: boolean
  readonly onToggle: () => void
}

/** 一行预览：默认只显示清洗值；展开后逐字段对照原值、命中规则与问题码 */
function PreviewRow({ record, expanded, onToggle }: PreviewRowProps) {
  const flags = record.derived?.dataQualityFlags ?? []

  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="py-1.5 pr-3 tabular-nums text-slate-500">{formatInteger(record.sourceRow)}</td>
        <td className="py-1.5 pr-3">
          <button className="text-slate-700 underline" onClick={onToggle} type="button">
            {record.candidateDisplayId}
          </button>
        </td>
        {PREVIEW_FIELDS.map((field) => (
          <td className="py-1.5 pr-3" key={field}>
            {cellText(record, field)}
          </td>
        ))}
        <td className="py-1.5 pr-3">
          {DEDUP_ACTION_LABELS[record.dedupDecision.action] ?? record.dedupDecision.action}
          {record.dedupDecision.duplicateKind === 'none'
            ? ''
            : `（${record.dedupDecision.duplicateGroupKey ?? ''}）`}
        </td>
        <td className="py-1.5">
          {flags.length === 0 ? (
            EMPTY_VALUE
          ) : (
            <span className="flex flex-wrap gap-1">
              {flags.map((code) => (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800" key={code}>
                  {ISSUE_TITLES[code]}
                </span>
              ))}
            </span>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-t border-slate-100 bg-slate-50">
          <td className="py-2 pl-3 text-xs text-slate-600" colSpan={PREVIEW_FIELDS.length + 4}>
            <p className="mb-2 text-slate-900">
              源文件第 {formatInteger(record.sourceRow)} 行 · 导入于 {record.importedAt} · 截止日{' '}
              {record.dataAsOf}
            </p>
            <table className="w-full min-w-[48rem] text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">字段</th>
                  <th className="py-1 pr-3 font-medium">原值</th>
                  <th className="py-1 pr-3 font-medium">清洗值</th>
                  <th className="py-1 pr-3 font-medium">命中规则</th>
                  <th className="py-1 pr-3 font-medium">来源</th>
                  <th className="py-1 font-medium">说明</th>
                </tr>
              </thead>
              <tbody>
                {record.normalizationLog.map((entry) => (
                  <tr className="border-t border-slate-200" key={`${entry.field}-${entry.rule}`}>
                    <td className="py-1 pr-3 font-medium text-slate-900">
                      {getStandardField(entry.field).header}
                    </td>
                    <td className="py-1 pr-3">{entry.rawValue ?? EMPTY_VALUE}</td>
                    <td className="py-1 pr-3">{entry.normalizedValue ?? EMPTY_VALUE}</td>
                    <td className="py-1 pr-3 text-slate-600">{entry.rule}</td>
                    <td className="py-1 pr-3 text-slate-600">{entry.source}</td>
                    <td className="py-1 text-slate-600">
                      {entry.inferred ? '推断结果，需确认；' : ''}
                      {entry.confirmed ? '已确认' : '未确认'}
                      {entry.issueCodes.length === 0
                        ? ''
                        : `；问题：${entry.issueCodes.map((code) => ISSUE_TITLES[code]).join('、')}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  )
}
