import { useMemo, useState } from 'react'

import {
  ISSUE_TITLES,
  getStandardField,
  type CleaningReport,
  type DataQualityIssue,
  type DataQualitySeverity,
  type ManualCorrection,
  type NormalizedRecord,
  type StandardFieldKey,
} from '../../domain'
import { EMPTY_VALUE, formatInteger } from '../../lib/format'

import {
  FIX_AUTO_LABEL,
  FIX_CANCEL_LABEL,
  FIX_DIALOG_TITLE,
  FIX_FIELD_LABEL,
  FIX_NEW_HINT,
  FIX_NEW_LABEL,
  FIX_NO_FIELDS_NOTE,
  FIX_RAW_LABEL,
  FIX_REASON_HINT,
  FIX_REASON_LABEL,
  FIX_REASON_REQUIRED,
  FIX_SAVE_LABEL,
  WORKLIST_ALL_OPTION,
  WORKLIST_APPLIED_LABEL,
  WORKLIST_CODE_LABEL,
  WORKLIST_COLUMNS,
  WORKLIST_EMPTY_NOTE,
  WORKLIST_FIX_LABEL,
  WORKLIST_INTRO,
  WORKLIST_NO_ISSUES_NOTE,
  WORKLIST_ONLY_ISSUES_LABEL,
  WORKLIST_SEVERITY_LABEL,
  WORKLIST_TITLE,
  WORKLIST_UNDO_LABEL,
} from './manualFixText'

type IssueWorklistPanelProps = {
  readonly datasetName: string
  readonly records: readonly NormalizedRecord[]
  readonly report: CleaningReport
  /** 当前生效的人工修正（来自清洗设置，不是本组件的内部状态） */
  readonly corrections: readonly ManualCorrection[]
  /** 当前表的签名；保存修正时一并记录，换表后就不会误套用 */
  readonly sheetSignature: string
  readonly onApply: (input: {
    readonly sourceRow: number
    readonly field: StandardFieldKey
    readonly correctedValue: string
    readonly reason: string
  }) => void
  readonly onRemove: (correction: ManualCorrection) => void
}

type RowIssues = {
  readonly record: NormalizedRecord
  readonly issues: readonly DataQualityIssue[]
  readonly codes: readonly string[]
  readonly fields: readonly string[]
}

/**
 * 异常行清单（用户需求 ①，2026-09-27）。
 *
 * ## 它为什么存在
 *
 * 真实验收反馈：83 行里只能逐页翻找琥珀色徽章，而且**没有任何改值入口**。
 * 因此这里把「哪些行有问题」变成一份可筛选的清单，并在每一行给出「修改这一格」。
 *
 * ## 纪律
 *
 * - 本组件**不**改数据、**不**算指标：它只把 `report.issues` 按行聚合展示，
 *   并把用户的输入交给上层（`onApply`）；真正的重算由清洗层做（改设置 → `cleanSheet` 重跑）。
 * - 「改了什么」只认 `corrections`（来自清洗设置），不认组件内部状态——
 *   这样离开页面再回来、或改了别的设置重新清洗，修正都不会丢。
 * - 问题码与严重度直接用领域层的 `ISSUE_TITLES` / `ISSUE_SEVERITY`，组件不另立一套说法。
 */
export default function IssueWorklistPanel({
  datasetName,
  records,
  report,
  corrections,
  sheetSignature,
  onApply,
  onRemove,
}: IssueWorklistPanelProps) {
  const [onlyIssues, setOnlyIssues] = useState(true)
  const [severity, setSeverity] = useState<DataQualitySeverity | typeof WORKLIST_ALL_OPTION>(
    WORKLIST_ALL_OPTION,
  )
  const [code, setCode] = useState<string>(WORKLIST_ALL_OPTION)
  const [editing, setEditing] = useState<{ record: NormalizedRecord; field: StandardFieldKey } | null>(
    null,
  )

  /** 问题按源行号归组：一条问题带 `sourceRow`，据此挂到记录上 */
  const rowsWithIssues = useMemo<readonly RowIssues[]>(() => {
    const issuesByRow = new Map<number, DataQualityIssue[]>()
    for (const issue of report.issues) {
      if (issue.sourceRow === null) {
        continue
      }
      const existing = issuesByRow.get(issue.sourceRow)
      if (existing === undefined) {
        issuesByRow.set(issue.sourceRow, [issue])
      } else {
        existing.push(issue)
      }
    }
    const result: RowIssues[] = []
    for (const record of records) {
      const issues = issuesByRow.get(record.sourceRow) ?? []
      if (issues.length === 0) {
        continue
      }
      result.push({
        record,
        issues,
        codes: [...new Set(issues.map((issue) => issue.code))],
        fields: [
          ...new Set(
            issues
              .map((issue) => issue.field)
              .filter((field): field is string => field !== null && field !== ''),
          ),
        ],
      })
    }
    return result
  }, [records, report.issues])

  const availableCodes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of rowsWithIssues) {
      for (const rowCode of row.codes) {
        counts.set(rowCode, (counts.get(rowCode) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])
  }, [rowsWithIssues])

  const filtered = rowsWithIssues.filter((row) => {
    if (severity !== WORKLIST_ALL_OPTION) {
      const hasSeverity = row.issues.some((issue) => issue.severity === severity)
      if (!hasSeverity) {
        return false
      }
    }
    if (code !== WORKLIST_ALL_OPTION && !row.codes.includes(code)) {
      return false
    }
    return true
  })

  /** 该行已生效的修正（与清洗层同一判据：源表行号 + 字段） */
  const correctionsOfRow = (record: NormalizedRecord): readonly ManualCorrection[] =>
    corrections.filter((item) => item.sourceRow === record.sourceRow)

  /** 某个字段是否已有修正（用于弹窗回填） */
  const correctionFor = (sourceRow: number, field: StandardFieldKey): ManualCorrection | undefined =>
    corrections.find((item) => item.sourceRow === sourceRow && item.field === field)

  if (rowsWithIssues.length === 0) {
    return (
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">{WORKLIST_TITLE}</h2>
        <p className="text-xs leading-5 text-slate-600">{WORKLIST_NO_ISSUES_NOTE}</p>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-900">{WORKLIST_TITLE}</h2>
        <p className="text-xs leading-5 text-slate-600">{WORKLIST_INTRO}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
        <label className="flex items-center gap-1">
          <input
            checked={onlyIssues}
            onChange={(event) => {
              setOnlyIssues(event.target.checked)
            }}
            type="checkbox"
          />
          {WORKLIST_ONLY_ISSUES_LABEL}
        </label>
        <label className="flex items-center gap-2">
          {WORKLIST_SEVERITY_LABEL}
          <select
            className="rounded border border-slate-300 px-2 py-1"
            onChange={(event) => {
              setSeverity(event.target.value as DataQualitySeverity | typeof WORKLIST_ALL_OPTION)
            }}
            value={severity}
          >
            <option value={WORKLIST_ALL_OPTION}>{WORKLIST_ALL_OPTION}</option>
            {(['阻断', '字段错误', '警告'] as const).map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          {WORKLIST_CODE_LABEL}
          <select
            className="rounded border border-slate-300 px-2 py-1"
            onChange={(event) => {
              setCode(event.target.value)
            }}
            value={code}
          >
            <option value={WORKLIST_ALL_OPTION}>{WORKLIST_ALL_OPTION}</option>
            {availableCodes.map(([item, count]) => (
              <option key={item} value={item}>
                {ISSUE_TITLES[item as keyof typeof ISSUE_TITLES]}（{formatInteger(count)} 行）
              </option>
            ))}
          </select>
        </label>
        <span className="text-slate-500">
          共 {formatInteger(rowsWithIssues.length)} 行有问题（当前显示 {formatInteger(filtered.length)} 行）
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] border-collapse text-sm">
          <caption className="pb-2 text-left text-xs text-slate-500">{datasetName}</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium">{WORKLIST_COLUMNS.row}</th>
              <th className="py-2 pr-3 font-medium">{WORKLIST_COLUMNS.displayId}</th>
              <th className="py-2 pr-3 font-medium">{WORKLIST_COLUMNS.codes}</th>
              <th className="py-2 pr-3 font-medium">{WORKLIST_COLUMNS.fields}</th>
              <th className="py-2 font-medium">{WORKLIST_COLUMNS.fix}</th>
            </tr>
          </thead>
          <tbody>
            {(onlyIssues ? filtered : filtered.slice(0, 50)).map((row) => {
              const applied = correctionsOfRow(row.record)
              /** 可修改的字段：这一行日志里出现过的字段（= 已映射的字段） */
              const fixableFields = [
                ...new Set((row.record.normalizationLog ?? []).map((entry) => entry.field)),
              ]
              /*
               * 默认改哪一个字段：**按问题出现的顺序**取第一个能对上字段的问题，
               * 而不是按日志顺序——用户点的是「这一行有问题」，应该先落到那个出问题的字段上。
               * 对不上时退回该行第一个已映射字段（用户仍可在弹窗里自己换）。
               */
              const defaultField =
                row.issues
                  .map((issue) =>
                    fixableFields.find(
                      (field) => issue.field !== null && getStandardField(field).header === issue.field,
                    ),
                  )
                  .find((field): field is StandardFieldKey => field !== undefined) ??
                fixableFields[0]
              return (
                <tr className="border-b border-slate-100 align-top" key={row.record.recordId}>
                  <td className="py-2 pr-3 tabular-nums text-slate-500">
                    {formatInteger(row.record.sourceRow)}
                  </td>
                  <td className="py-2 pr-3">{row.record.candidateDisplayId}</td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap gap-1">
                      {row.codes.map((item) => (
                        <span
                          className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800"
                          key={item}
                        >
                          {ISSUE_TITLES[item as keyof typeof ISSUE_TITLES]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-slate-600">
                    {row.fields.length === 0 ? EMPTY_VALUE : row.fields.join('、')}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      {applied.map((item) => (
                        <span className="flex items-center gap-2 text-xs text-slate-700" key={item.field}>
                          <span className="rounded bg-slate-100 px-2 py-0.5">
                            {WORKLIST_APPLIED_LABEL}：{getStandardField(item.field).header}
                          </span>
                          <button
                            className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-100"
                            onClick={() => {
                              onRemove(item)
                            }}
                            type="button"
                          >
                            {WORKLIST_UNDO_LABEL}
                          </button>
                        </span>
                      ))}
                      {defaultField === undefined ? (
                        <span className="text-xs text-slate-400">{FIX_NO_FIELDS_NOTE}</span>
                      ) : (
                        <button
                          className="w-fit rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100"
                          onClick={() => {
                            setEditing({ record: row.record, field: defaultField })
                          }}
                          type="button"
                        >
                          {WORKLIST_FIX_LABEL}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && <p className="text-xs text-slate-600">{WORKLIST_EMPTY_NOTE}</p>}

      {editing === null ? null : (
        <ManualFixDialog
          correction={correctionFor(editing.record.sourceRow, editing.field)}
          onCancel={() => {
            setEditing(null)
          }}
          onSubmit={(input) => {
            onApply({ sourceRow: editing.record.sourceRow, ...input })
            setEditing(null)
          }}
          record={editing.record}
          initialField={editing.field}
        />
      )}

      {/* 表签名只用于「保存时一并记录」；界面上说明它，避免用户以为换表后修正还会生效 */}
      <p className="text-xs text-slate-500">
        修正记录会绑定当前这份表的签名（{sheetSignature}）：换一份表后不会自动套用。
      </p>
    </section>
  )
}

type ManualFixDialogProps = {
  readonly record: NormalizedRecord
  readonly initialField: StandardFieldKey
  readonly correction: ManualCorrection | undefined
  readonly onCancel: () => void
  readonly onSubmit: (input: {
    readonly field: StandardFieldKey
    readonly correctedValue: string
    readonly reason: string
  }) => void
}

/**
 * 改一格的小窗口（用户需求 ①）。
 *
 * 四个要点：
 * 1. **原值 / 自动清洗值都摆出来**：用户改的是「规则算错的那一格」，不是凭空填一个数（D-091 的五栏）；
 * 2. **原因必填**：不填就不让保存，并说明为什么（过一段时间没人知道为什么改）；
 * 3. **留空 = 改成缺失**：明确写出来，避免用户以为「留空就是 0」；
 * 4. 只提交字段 + 新值 + 原因，**不在这里改任何数据**——重算由上层交给清洗层。
 */
function ManualFixDialog({
  record,
  initialField,
  correction,
  onCancel,
  onSubmit,
}: ManualFixDialogProps) {
  const fields = useMemo(
    () => [...new Set((record.normalizationLog ?? []).map((entry) => entry.field))],
    [record.normalizationLog],
  )
  const [field, setField] = useState<StandardFieldKey>(initialField)
  const [value, setValue] = useState(correction?.correctedValue ?? '')
  const [reason, setReason] = useState(correction?.reason ?? '')
  const [error, setError] = useState<string | null>(null)

  const entries = (record.normalizationLog ?? []).filter((entry) => entry.field === field)
  const ruleEntry = entries.find((entry) => entry.rule !== 'manual-correction')
  const manualEntry = entries.find((entry) => entry.rule === 'manual-correction')

  return (
    <div
      aria-label={FIX_DIALOG_TITLE}
      className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-4"
      role="dialog"
    >
      <h3 className="text-sm font-semibold text-slate-900">
        {FIX_DIALOG_TITLE}（第 {formatInteger(record.sourceRow)} 行 · {record.candidateDisplayId}）
      </h3>

      <label className="block space-y-1 text-xs text-slate-700">
        <span className="font-medium">{FIX_FIELD_LABEL}</span>
        <select
          className="w-full rounded border border-slate-300 px-2 py-1"
          onChange={(event) => {
            setField(event.target.value as StandardFieldKey)
            setValue('')
            setError(null)
          }}
          value={field}
        >
          {fields.map((item) => (
            <option key={item} value={item}>
              {getStandardField(item).header}
            </option>
          ))}
        </select>
      </label>

      <dl className="grid gap-2 text-xs sm:grid-cols-2">
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-slate-500">{FIX_RAW_LABEL}</dt>
          <dd className="mt-0.5 text-slate-900">{ruleEntry?.rawValue ?? EMPTY_VALUE}</dd>
        </div>
        <div className="rounded border border-slate-200 bg-white p-2">
          <dt className="text-slate-500">{FIX_AUTO_LABEL}</dt>
          <dd className="mt-0.5 text-slate-900">{ruleEntry?.normalizedValue ?? EMPTY_VALUE}</dd>
        </div>
      </dl>

      {manualEntry === undefined ? null : (
        <p className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
          当前已有一处修改：{manualEntry.normalizedValue ?? EMPTY_VALUE}（原因：{manualEntry.reason ?? ''}·
          {manualEntry.ruleVersion}）
        </p>
      )}

      <label className="block space-y-1 text-xs text-slate-700">
        <span className="font-medium">{FIX_NEW_LABEL}</span>
        {/* aria-label 只写字段名：标签里的说明文字不该混进无障碍名称（读屏时会变成一长串） */}
        <input
          aria-label={FIX_NEW_LABEL}
          className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
          onChange={(event) => {
            setValue(event.target.value)
          }}
          value={value}
        />
        <span className="block text-slate-500">{FIX_NEW_HINT}</span>
      </label>

      <label className="block space-y-1 text-xs text-slate-700">
        <span className="font-medium">{FIX_REASON_LABEL}</span>
        <textarea
          aria-label={FIX_REASON_LABEL}
          className="h-16 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
          onChange={(event) => {
            setReason(event.target.value)
            setError(null)
          }}
          value={reason}
        />
        <span className="block text-slate-500">{FIX_REASON_HINT}</span>
      </label>

      {error === null ? null : <p className="text-xs text-rose-700">{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          onClick={() => {
            if (reason.trim() === '') {
              setError(FIX_REASON_REQUIRED)
              return
            }
            onSubmit({ field, correctedValue: value.trim(), reason: reason.trim() })
          }}
          type="button"
        >
          {FIX_SAVE_LABEL}
        </button>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-white"
          onClick={onCancel}
          type="button"
        >
          {FIX_CANCEL_LABEL}
        </button>
      </div>
    </div>
  )
}
