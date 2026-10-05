import type { ReactNode } from 'react'

import { UNFILLED_REASON_LABEL, type RejectionReasonDistribution } from '../../domain'
import { formatInteger, formatPercent } from '../../lib/format'
import SectionShell from '../dimensions/SectionShell'

import {
  REASONS_DENOMINATOR_LABEL,
  REASONS_EMPTY_NOTE,
  REASONS_FILL_RATE_LABEL,
  REASONS_FILLED_LABEL,
  REASONS_HEADING,
  REASONS_MATCHED_LABEL,
  REASONS_NO_REASON_NOTE,
  REASONS_NO_UNCLASSIFIED_SAMPLE,
  REASONS_UNCLASSIFIED_LABEL,
  REASONS_UNCLASSIFIED_NOTE,
  REASONS_UNCLASSIFIED_SAMPLES_LABEL,
  SECTION_TITLES,
} from './rejectionText'

type ReasonsPanelProps = {
  /** 原因分布；分母恒为 R（含「未填写」），全部字段由引擎算好 */
  readonly reasons: RejectionReasonDistribution
}

/** 一行「标签 → 值」，用于填写率 / 未分类 / 命中字典这几个汇总数字 */
function SummaryRow({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  )
}

/**
 * 拒 offer 原因分布（docs/PRD.md 9.2）。
 *
 * 三条铁律（引擎已保证，界面负责**如实呈现**、不得修饰）：
 * 1. **分母恒为 R**（含「未填写」），不是「已填写」子集——所以「未填写」永远是表里的一行，
 *    各占比之和为 100% 而不是「已填写内部的占比」；
 * 2. 原因全缺失时必须显示填写率 **0%**，并**明说**在补齐访谈前不得推断原因
 *    （PRD 9.2 原话：本地与 AI 都不得输出「主要因为薪资」）；
 * 3. 「未分类」（有值但不在字典内）与「未填写」（根本没填）**分开**呈现：
 *    前者提示维护字典，后者提示补访谈；两者都不许猜成某个具体原因。
 *
 * 本组件不做任何分类判断（不在组件里做字符串匹配或同义词推断），
 * 类别清单与顺序、计数与占比全部来自 `rejectionReasonDistribution`。
 */
export default function ReasonsPanel({ reasons }: ReasonsPanelProps) {
  const noRejectionRecords = reasons.denominator === 0
  // 「有拒 offer 记录、但一条原因都没填」——PRD 9.2 的核心场景（当前新附件就是 7 条原因全缺失）
  const noReasonFilled = reasons.denominator > 0 && reasons.filledCount === 0
  const hasUnclassified = reasons.unclassifiedCount > 0
  // 「未填写」计数直接取引擎分布里的那一行，界面不做任何相减
  const unfilledCount =
    reasons.categories.find((entry) => entry.category === UNFILLED_REASON_LABEL)?.count ?? null

  const notes = [reasons.note]
  if (noRejectionRecords) {
    notes.push(REASONS_EMPTY_NOTE)
  }
  if (noReasonFilled) {
    notes.push(REASONS_NO_REASON_NOTE)
  }
  if (hasUnclassified) {
    notes.push(REASONS_UNCLASSIFIED_NOTE)
  }

  return (
    <SectionShell notes={notes} title={SECTION_TITLES.reasons}>
      <h4 className="text-xs font-medium text-slate-700">{REASONS_HEADING}</h4>

      <dl className="rounded border border-slate-200 px-3">
        <SummaryRow label={REASONS_DENOMINATOR_LABEL}>{formatInteger(reasons.denominator)}</SummaryRow>
        <SummaryRow label={REASONS_FILLED_LABEL}>{formatInteger(reasons.filledCount)}</SummaryRow>
        <SummaryRow label={REASONS_FILL_RATE_LABEL}>
          {/*
            R = 0 时 `fillRate` 为 null → 「—」（不是 0%）；
            R > 0 且无一条填写时为**真 0%**（分子为 0），这是 PRD 要求显示的那个 0%。
          */}
          <span className="tabular-nums" title="分子 = 已填写原因的条数，分母 = R（全部拒 offer 记录）">
            {formatPercent(reasons.fillRate, 2)}
            <span className="ml-1 text-xs text-slate-400">
              （{formatInteger(reasons.filledCount)} ÷ {formatInteger(reasons.denominator)}）
            </span>
          </span>
        </SummaryRow>
        <SummaryRow label={REASONS_MATCHED_LABEL}>{formatInteger(reasons.matchedCount)}</SummaryRow>
        <SummaryRow label={REASONS_UNCLASSIFIED_LABEL}>
          {formatInteger(reasons.unclassifiedCount)}
        </SummaryRow>
      </dl>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-sm">
          <caption className="pb-2 text-left text-xs text-slate-500">
            类别顺序与集合由引擎的受控字典给出（含计数为 0 的类别，便于核对字典是否完整）；
            占比分母恒为 R，因此各行占比之和为 100%。原因只做精确查表，不做推断。
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
              <th className="py-2 pr-3 font-medium" scope="col">
                原因类别
              </th>
              <th className="py-2 pr-3 font-medium" scope="col">
                条数
              </th>
              <th className="py-2 pr-3 font-medium" scope="col">
                占拒 offer 总数 R
              </th>
            </tr>
          </thead>
          <tbody>
            {reasons.categories.map((entry) => (
              <tr className="border-b border-slate-100" key={entry.category}>
                <th className="py-2 pr-3 text-left font-normal" scope="row">
                  {entry.category}
                </th>
                <td className="py-2 pr-3 tabular-nums">{formatInteger(entry.count)}</td>
                {/* R = 0 时 share 为 null → 「—」，绝不显示 0% */}
                <td className="py-2 pr-3 tabular-nums">{formatPercent(entry.share, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-slate-200 p-3">
        <p className="text-xs text-slate-700">{REASONS_UNCLASSIFIED_SAMPLES_LABEL}</p>
        {reasons.unclassifiedSamples.length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">{REASONS_NO_UNCLASSIFIED_SAMPLE}</p>
        ) : (
          <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-600">
            {/*
              样例是**引擎截断后的原值**（最多 5 条、每条最多 24 字），只在本机展示；
              这里用文本节点渲染，绝不拼 HTML，也不把它当作结论。
            */}
            {reasons.unclassifiedSamples.map((sample) => (
              <li key={sample}>{sample}</li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-xs leading-5 text-slate-500">
          这些值有内容但不在受控字典内，需要按业务口径维护字典（当前显示 {formatInteger(reasons.unclassifiedCount)} 条）；
          维护前它们既不算「其他」，也不参与任何原因结论。
        </p>
      </div>

      <p className="text-xs leading-5 text-slate-500">
        未填写计数：{formatInteger(unfilledCount)}
        <span className="ml-1 text-slate-400">（取自引擎分布里「未填写」那一行的计数，不由界面相减得出）</span>
        ；原因缺失时唯一正确的动作是补访谈，而不是从候选人背景反推原因。
      </p>
    </SectionShell>
  )
}
