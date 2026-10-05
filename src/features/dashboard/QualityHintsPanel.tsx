import {
  type AnalysisResult,
  type DataQualitySeverity,
  type NormalizedDataset,
} from '../../domain'
import { EMPTY_VALUE, formatInteger, formatPercent } from '../../lib/format'

import { BENCHMARK_INSUFFICIENT_NOTE } from './dashboardText'

type QualityHintsPanelProps = {
  readonly dataset: NormalizedDataset
  readonly analysis: AnalysisResult
  /** 实际周期超过阈值的记录数（由引擎的 `cycleTooLongCount` 算好，组件不自己数） */
  readonly cycleTooLongCount: number
  readonly cycleTooLongDays: number
}

const SEVERITY_STYLES: Readonly<Record<DataQualitySeverity, string>> = {
  阻断: 'bg-rose-100 text-rose-800',
  字段错误: 'bg-orange-100 text-orange-800',
  警告: 'bg-amber-100 text-amber-800',
}

/**
 * 质量与口径提示（步骤8，docs/PRD.md 5.5 / 7 章「通用状态」）。
 *
 * 目的：把「这批数字有多少保留、多少没进分母、哪些模块本就不可用」摊开讲，
 * 避免用户把「样本不足」「口径未确认」误读成「业务变差了」。
 *
 * 只展示计数与已有口径：不在这里算率（率的分子分母都来自 `analyzeRecords`），
 * 也不把「未确认」写成「已确认」。
 */
export default function QualityHintsPanel({
  dataset,
  analysis,
  cycleTooLongCount,
  cycleTooLongDays,
}: QualityHintsPanelProps) {
  const { report, metadata } = dataset
  const severities: readonly DataQualitySeverity[] = ['阻断', '字段错误', '警告']
  const insufficientBenchmarks = analysis.benchmarks.filter((benchmark) => !benchmark.sufficient)
  const usableBenchmarks = analysis.benchmarks.length - insufficientBenchmarks.length
  const unavailableModules = report.metricAvailability.filter((item) => !item.available)

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">质量与口径提示</h2>
        <div className="flex flex-wrap gap-2 text-xs">
          {severities.map((severity) => (
            <span
              className={`rounded-full px-3 py-1 font-medium ${SEVERITY_STYLES[severity]}`}
              key={severity}
            >
              {severity} {formatInteger(report.issueCountsBySeverity[severity])}
            </span>
          ))}
        </div>
      </div>

      <ul className="list-disc space-y-1 pl-5 text-xs leading-6 text-slate-700">
        <li>
          尚未确认去重的重复行：
          {analysis.unconfirmedDuplicateCount === 0
            ? '无'
            : `${formatInteger(analysis.unconfirmedDuplicateCount)} 条`}
          ——这些行仍保留在分析集中，没有被当成「已确认去重」。
        </li>
        <li>
          歧义日期的日月顺序：
          {report.ambiguousDateCount === 0
            ? '无需确认'
            : `未确认 ${formatInteger(report.ambiguousDateCount)} 条`}
          ；未确认时这些单元格不转换（保留原值），趋势图自然也不会包含它们。
        </li>
        <li>
          当前筛选下按基准日期判定为缺失 / 非法的记录：
          {analysis.filterOutcome.missingDateCount === 0
            ? '无'
            : `${formatInteger(analysis.filterOutcome.missingDateCount)} 条`}
          （只在启用时间区间时单列计数，默认不纳入区间）。
        </li>
        <li>
          实际招聘周期超过 {formatInteger(cycleTooLongDays)} 天的已入职记录：
          {cycleTooLongCount === 0 ? '无' : `${formatInteger(cycleTooLongCount)} 条`}
          （只提示核实，不截尾、不删除，也不影响率）。
        </li>
        <li>
          拒 offer 原因填写率：
          {formatPercent(analysis.rejectionReasonFillRate.value, 2)}（分子{' '}
          {formatInteger(analysis.rejectionReasonFillRate.numerator)} ÷ 分母{' '}
          {formatInteger(analysis.rejectionReasonFillRate.denominator)}）；原因「未填写」仍在分母里。
        </li>
        <li>
          同岗薪酬基准：可用分组 {formatInteger(usableBenchmarks)} 个、样本不足{' '}
          {formatInteger(insufficientBenchmarks.length)} 个。{BENCHMARK_INSUFFICIENT_NOTE}
          <span className="text-slate-500">（{analysis.benchmarkNote}）</span>
        </li>
        <li>
          因口径或数据问题被禁用的模块：
          {unavailableModules.length === 0
            ? `无（当前数据集声明：${metadata.disabledModules.length === 0 ? '全部分析可用' : metadata.disabledModules.join('、')}）`
            : unavailableModules.map((item) => `${item.module}（${item.reason ?? '口径未确认'}）`).join('；')}
        </li>
      </ul>

      <details className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          各分析模块的有效样本数（清洗阶段口径）
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-3 font-medium">模块</th>
                <th className="py-1 pr-3 font-medium">可用</th>
                <th className="py-1 pr-3 font-medium">有效样本</th>
                <th className="py-1 font-medium">说明</th>
              </tr>
            </thead>
            <tbody>
              {report.metricAvailability.map((item) => (
                <tr className="border-b border-slate-100" key={item.module}>
                  <th className="py-1 pr-3 text-left font-normal" scope="row">
                    {item.module}
                  </th>
                  <td className="py-1 pr-3">{item.available ? '可用' : '已禁用'}</td>
                  <td className="py-1 pr-3 tabular-nums">
                    {item.validSampleCount === null ? EMPTY_VALUE : formatInteger(item.validSampleCount)}
                  </td>
                  <td className="py-1 text-slate-600">{item.reason ?? EMPTY_VALUE}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}
