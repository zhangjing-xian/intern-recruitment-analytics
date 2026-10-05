import { TIME_BASIS_LABELS, type AnalysisResult, type NormalizedDataset } from '../../domain'
import { formatDate, formatInteger } from '../../lib/format'

import type { DashboardFilterDraft } from './dashboardFilters'

type SnapshotBarProps = {
  readonly dataset: NormalizedDataset
  readonly analysis: AnalysisResult
  readonly draft: DashboardFilterDraft
}

function Item({ label, value, hint }: { readonly label: string; readonly value: string; readonly hint?: string }) {
  return (
    <div className="min-w-[10rem] rounded border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
      {hint !== undefined && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

/**
 * 顶部条件栏（docs/PRD.md 7 章末段：「顶部始终展示：数据集、去重策略、时间基准、截至日、
 * 规则版本和有效记录数」）。
 *
 * 全部取自数据集元数据与引擎结果，组件不推断、不改写。
 * 源文件名与工作表只在本机展示（PRD 4.2：源文件名禁止进入日志、报告与 AI 摘要）。
 */
export default function SnapshotBar({ dataset, analysis, draft }: SnapshotBarProps) {
  const { metadata } = dataset
  const time = analysis.filters.time
  const timeText =
    time === null
      ? `未启用时间区间（基准：${TIME_BASIS_LABELS[draft.timeBasis]}）`
      : `${TIME_BASIS_LABELS[time.basis]} ${time.from ?? '不限'} 至 ${time.to ?? '不限'}${
          time.includeMissingDate ? '（已纳入日期缺失记录）' : ''
        }`

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">数据与口径快照</h2>
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Item
          hint={metadata.sourceFileName === null ? '未记录源文件名' : `源文件：${metadata.sourceFileName}`}
          label="数据集"
          value={metadata.datasetName}
        />
        <Item
          hint={`导入模式：${metadata.importMode}｜导入时间：${formatDate(metadata.importedAt)}`}
          label="去重策略"
          value={metadata.dedupStrategy}
        />
        <Item hint="时间筛选基准；默认不筛选" label="时间基准" value={timeText} />
        <Item hint="数据快照声明，不由当前状态反推历史" label="截至日" value={formatDate(metadata.dataAsOf)} />
        <Item
          hint={`结构 ${analysis.ruleVersion.schemaVersion}｜字典 ${analysis.ruleVersion.dictionaryVersion}`}
          label="规则版本"
          value={analysis.ruleVersion.rulesVersion}
        />
        <Item
          hint={`保留下限 ${formatInteger(analysis.filterOutcome.retainedCount)} 条｜原始 ${formatInteger(
            analysis.filterOutcome.totalCount,
          )} 条`}
          label="有效记录数（筛选后）"
          value={`${formatInteger(analysis.filterOutcome.matchedCount)} 条（N）`}
        />
      </dl>
      <p className="mt-2 text-xs leading-5 text-slate-500">
        薪资口径：{metadata.salary.option}
        {metadata.salary.comparable
          ? '（已确认币种与计薪周期，可做同岗对比）'
          : '（未确认币种 / 计薪周期：已禁用薪资对比与低薪标签）'}
        ；名单覆盖需求数 {formatInteger(metadata.counts.distinctRequirementCount)} 个
        （countDistinct(非空需求 ID)：HR 内去重，跨 HR 相加可能超过全局，不等于公司全部在招需求）。
      </p>
    </section>
  )
}
