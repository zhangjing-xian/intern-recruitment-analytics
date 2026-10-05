import type { ReactNode } from 'react'

import type { GroupSummary } from '../../domain'
import { formatInteger, formatPercent } from '../../lib/format'
import { SAMPLE_TAG_LABELS } from '../dimensions/analysisText'

import {
  COMPARISON_HEADING,
  COUNT_LABELS,
  REJECTION_RATE_LABEL,
  SAMPLE_LABEL,
  SECTION_TITLES,
} from './rejectionText'

type AnalysisGroupCardsProps = {
  /** 全部口径汇总（含待入职与审批中）；核心拒 offer 率 R ÷ D 的分母 D 就是它的 D */
  readonly overall: GroupSummary
  /** 两组比较人群 R ∪ J（待入职与审批中不在其中） */
  readonly comparison: GroupSummary
  /** 引擎给的对比口径说明（原样渲染，界面不改写） */
  readonly comparisonNote: string
}

/**
 * 率单元格：数值 + 「分子 ÷ 分母」。
 *
 * 全部三个数都取自引擎的 `RateMetric`；`value === null`（分母 0）时 `formatPercent`
 * 返回「—」，**绝不**显示 0%。这里只有「比率 → 百分数」的展示转换，没有任何业务除法。
 */
function RateValue({
  numerator,
  denominator,
  value,
}: {
  readonly numerator: number
  readonly denominator: number
  readonly value: number | null
}) {
  return (
    <span className="tabular-nums" title={`分子 ${numerator} ÷ 分母 ${denominator}`}>
      {formatPercent(value, 2)}
      <span className="ml-1 text-xs text-slate-400">
        （{formatInteger(numerator)} ÷ {formatInteger(denominator)}）
      </span>
    </span>
  )
}

/** 一行「标签 → 值」；值缺失时由调用方传入占位文案 */
function MetricRow({
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

/** 一组口径的卡片；`hint` 说明这张卡的分母是谁、哪些记录不进这张卡 */
function CohortCard({
  title,
  hint,
  summary,
  countsNote,
}: {
  readonly title: string
  readonly hint: string
  readonly summary: GroupSummary
  /** 该卡片特有的口径补充（例如「本卡 P / A 恒为 0」） */
  readonly countsNote: string
}) {
  const { counts, rates } = summary

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs leading-5 text-slate-600">{hint}</p>
      <dl className="mt-1">
        <MetricRow label={COUNT_LABELS.total}>{formatInteger(counts.total)}</MetricRow>
        <MetricRow label={COUNT_LABELS.joined}>{formatInteger(counts.joined)}</MetricRow>
        <MetricRow label={COUNT_LABELS.pending}>{formatInteger(counts.pending)}</MetricRow>
        <MetricRow label={COUNT_LABELS.approving}>{formatInteger(counts.approving)}</MetricRow>
        <MetricRow label={COUNT_LABELS.rejected}>{formatInteger(counts.rejected)}</MetricRow>
        <MetricRow label={COUNT_LABELS.coreDenominator}>
          {formatInteger(counts.coreDenominator)}
        </MetricRow>
        <MetricRow label={REJECTION_RATE_LABEL}>
          {/*
            分子 / 分母 / 值三件套全部来自引擎的 `rates.rejectionRate`：
            D = 0 时 value 为 null → 「—」，不是 0%。
          */}
          <RateValue
            denominator={rates.rejectionRate.denominator}
            numerator={rates.rejectionRate.numerator}
            value={rates.rejectionRate.value}
          />
        </MetricRow>
        <MetricRow label={SAMPLE_LABEL}>
          {/* 判定来自引擎的 `sampleSufficiencyOf`（`rates.sufficiency`），组件不自己比 10 */}
          <span className="text-xs text-slate-600">{SAMPLE_TAG_LABELS[rates.sufficiency.tag]}</span>
        </MetricRow>
      </dl>
      <p className="text-xs leading-5 text-slate-500">{countsNote}</p>
      <p className="text-xs leading-5 text-slate-500">{rates.sufficiency.note}</p>
    </section>
  )
}

/**
 * 两组口径卡片（docs/PRD.md 9.1）。
 *
 * 为什么必须两张卡而不是一张：PRD 9.1 明确要求页面说清「**组间比较人群**」与「**核心率人群**」
 * 不同——核心拒 offer 率 R ÷ D 里的 D 含待入职，而两组比较（拒 offer 组 vs 入职组）
 * 不含待入职与审批中。合成一张表会让读者以为两个分母是同一个。
 *
 * 数字全部来自 `insight.overall` 与 `insight.comparison`（引擎的 `summarizeRecords` 产出），
 * 本组件不加不减、不重算任何率。
 */
export default function AnalysisGroupCards({
  overall,
  comparison,
  comparisonNote,
}: AnalysisGroupCardsProps) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{SECTION_TITLES.groups}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">{COMPARISON_HEADING}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <CohortCard
          countsNote="本卡是核心率人群：分母 D 含待入职 P（PRD 9.1：待入职仍在拒 offer 率分母 D 中），排除审批中 A、其他与未知。"
          hint="当前筛选下的全部记录（含待入职与审批中）。核心拒 offer 率 R ÷ D 用的就是这张卡的 D。"
          summary={overall}
          title="全部记录（核心率口径）"
        />
        <CohortCard
          countsNote="本卡是组间比较人群：只有拒 offer 组与入职组，因此 P 与 A 恒为 0 属于口径结果，不是数据缺失。"
          hint="只有拒 offer 组（拒绝 offer + 拒绝口头 offer）与入职组（已入职）；待入职与审批中不参与组间比较。"
          summary={comparison}
          title="两组比较人群（拒 offer 组 + 入职组）"
        />
      </div>

      {/* 口径说明原样来自引擎：它已包含 D 的构成、两组人数与「待入职与审批中不参与组间比较」 */}
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        {comparisonNote}
      </p>

      <p className="text-xs leading-5 text-slate-500">
        两张卡的分母不同，因此数字不可互相替代：左卡回答「当前筛选下拒 offer 占核心分母多少」，
        右卡回答「拒 offer 的人与入职的人在特征上如何分布」。
      </p>
    </section>
  )
}
