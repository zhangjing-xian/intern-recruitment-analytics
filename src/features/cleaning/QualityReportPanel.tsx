import {
  ISSUE_SEVERITY,
  ISSUE_TITLES,
  type CleaningReport,
  type DataQualityIssueCode,
  type DataQualitySeverity,
} from '../../domain'
import { formatInteger } from '../../lib/format'

const SEVERITY_STYLES: Readonly<Record<DataQualitySeverity, string>> = {
  阻断: 'bg-rose-100 text-rose-800',
  字段错误: 'bg-orange-100 text-orange-800',
  警告: 'bg-amber-100 text-amber-800',
}

type QualityReportPanelProps = {
  readonly report: CleaningReport
}

/**
 * 质量报告（docs/PRD.md 5.5）。
 *
 * 只展示**计数与可用性**：问题条数、按问题码 / 严重度汇总、各模块有效样本与禁用原因、
 * 关键决策日志。**不**在这里计算率、分位或基准（那些属于步骤7 的统一指标引擎）。
 * 分母为 0 或没有有效样本时显示「—」而不是 0。
 */
export default function QualityReportPanel({ report }: QualityReportPanelProps) {
  const { counts } = report
  const issuesBySeverity: readonly DataQualitySeverity[] = ['阻断', '字段错误', '警告']
  const issueEntries = Object.entries(report.issueCountsByCode)
    .filter((entry): entry is [DataQualityIssueCode, number] => entry[1] !== undefined)
    .sort((left, right) => right[1] - left[1])

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">质量报告</h2>
        <span className="text-xs text-slate-500">
          只做计数与可用性说明；率、分位与基准在分析看板统一计算。
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="原始行" value={formatInteger(counts.rawRowCount)} />
        <Stat label="空行跳过" value={formatInteger(counts.emptyRowCount)} />
        <Stat label="保留行" value={formatInteger(counts.keptRowCount)} />
        <Stat label="去重移除" value={formatInteger(counts.removedDuplicateCount)} />
        <Stat label="有问题行" value={formatInteger(counts.issueRowCount)} />
        <Stat label="覆盖需求数" value={formatInteger(counts.distinctRequirementCount)} />
      </dl>

      <div className="flex flex-wrap gap-2 text-xs">
        {issuesBySeverity.map((severity) => (
          <span
            className={`rounded-full px-3 py-1 font-medium ${SEVERITY_STYLES[severity]}`}
            key={severity}
          >
            {severity} {formatInteger(report.issueCountsBySeverity[severity])}
          </span>
        ))}
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
          重复分组 {formatInteger(report.exactDuplicateGroups.length)} 组完全重复 /{' '}
          {formatInteger(report.suspectedDuplicateGroups.length)} 组疑似重复
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
          歧义日期 {formatInteger(report.ambiguousDateCount)} · 长周期{' '}
          {formatInteger(report.cycleTooLongCount)} · 负周期 {formatInteger(report.negativeCycleCount)}
        </span>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-700">
          表头回声行 {formatInteger(report.headerEchoRowCount)} · 已剔除{' '}
          {formatInteger(report.droppedRowCount)} · 隐藏行排除{' '}
          {formatInteger(report.hiddenRowExcludedCount)}
        </span>
      </div>

      {report.ambiguousDateSamples.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          日月歧义样例（未确认顺序前不转换）：{report.ambiguousDateSamples.join('、')}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-900">问题汇总（按问题码）</h3>
          <IssueCountList entries={issueEntries} />
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-slate-900">关键决策日志（改设置即重算，可撤销）</h3>
          <ul className="space-y-1 text-xs text-slate-700">
            {report.decisionLog.map((decision) => (
              <li className="rounded-md bg-slate-50 px-3 py-1.5" key={decision.id}>
                <span className="font-medium text-slate-900">{decision.label}</span>
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                    decision.confirmed
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {decision.confirmed ? '已确认' : '待确认'}
                </span>
                <p className="mt-1 text-slate-600">{decision.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-slate-900">各模块可用性与有效样本</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-medium">模块</th>
                <th className="py-1 pr-3 font-medium">可用</th>
                <th className="py-1 pr-3 font-medium">有效样本</th>
                <th className="py-1 font-medium">口径 / 禁用原因</th>
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {report.metricAvailability.map((availability) => (
                <tr className="border-t border-slate-100" key={availability.module}>
                  <td className="py-1.5 pr-3 font-medium text-slate-900">{availability.module}</td>
                  <td className="py-1.5 pr-3">
                    {availability.available ? (
                      <span className="text-emerald-700">可用</span>
                    ) : (
                      <span className="text-rose-700">已禁用</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {availability.validSampleCount === null
                      ? '—'
                      : formatInteger(availability.validSampleCount)}
                  </td>
                  <td className="py-1.5 text-slate-600">{availability.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold text-slate-900">口径备注</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
          {report.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </section>
  )
}

type IssueListProps = {
  readonly entries: readonly (readonly [DataQualityIssueCode, number])[]
}

/** 按问题码汇总（条数降序）：只展示计数，明细留在记录级「质量标记」里 */
function IssueCountList({ entries }: IssueListProps) {
  if (entries.length === 0) {
    return (
      <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
        未发现任何质量问题；未识别的值也不会被静默猜测，会以问题码形式出现。
      </p>
    )
  }
  return (
    <ul className="space-y-1 text-xs text-slate-700">
      {entries.map(([code, count]) => (
        <li
          className="flex items-center gap-3 rounded-md bg-slate-50 px-3 py-1.5"
          key={code}
        >
          <span className="font-medium text-slate-900">{ISSUE_TITLES[code]}</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_STYLES[ISSUE_SEVERITY[code]]}`}
          >
            {ISSUE_SEVERITY[code]}
          </span>
          <span className="ml-auto tabular-nums text-slate-900">{formatInteger(count)}</span>
        </li>
      ))}
    </ul>
  )
}

type StatProps = { readonly label: string; readonly value: string }

function Stat({ label, value }: StatProps) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold text-slate-900">{value}</dd>
    </div>
  )
}
