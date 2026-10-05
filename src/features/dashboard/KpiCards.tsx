import type { AnalysisResult, RateMetric } from '../../domain'
import { EMPTY_VALUE, formatInteger, formatPercent } from '../../lib/format'

type KpiCardsProps = {
  readonly analysis: AnalysisResult
}

const SUFFICIENCY_STYLES: Readonly<Record<'none' | 'small' | 'sufficient', string>> = {
  none: 'bg-slate-100 text-slate-700',
  small: 'bg-amber-100 text-amber-800',
  sufficient: 'bg-emerald-100 text-emerald-800',
}

const SUFFICIENCY_LABELS: Readonly<Record<'none' | 'small' | 'sufficient', string>> = {
  none: '无有效样本',
  small: '小样本',
  sufficient: '样本达标',
}

function CountCard({
  label,
  value,
  hint,
}: {
  readonly label: string
  readonly value: number
  readonly hint: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-medium text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {formatInteger(value)}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p>
    </div>
  )
}

function RateRow({ label, rate }: { readonly label: string; readonly rate: RateMetric }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <span className="text-lg font-semibold tabular-nums text-slate-900">
          {formatPercent(rate.value, 2)}
        </span>
      </div>
      <p className="mt-1 text-xs tabular-nums text-slate-500">
        分子 {formatInteger(rate.numerator)} ÷ 分母 {formatInteger(rate.denominator)}
        {rate.denominator === 0 ? `（${EMPTY_VALUE}，无有效样本）` : ''}
      </p>
      {rate.excludedCount > 0 && (
        <p className="mt-1 text-xs text-slate-500">未进本率分母 {formatInteger(rate.excludedCount)} 条</p>
      )}
      {rate.note !== null && <p className="mt-1 text-xs leading-5 text-slate-500">{rate.note}</p>}
    </div>
  )
}

/**
 * 核心指标卡片（docs/PRD.md 6.1 / AGENTS.md §7）。
 *
 * 三条展示铁律：
 * 1. 总卡片名称固定为「**总 offer 记录数（含审批中）**」，并说明它不等于正式发放 offer 数；
 * 2. 每个率都显示**分子 ÷ 分母**，分母为 0 时显示「—/无有效样本」，绝不显示 0%；
 * 3. 「其他」与「未知」**分开**显示；「审批中占比」明确标注分母是 N（与核心分母 D 不同）。
 *
 * 本组件不计算任何指标：所有数字都来自 `analyzeRecords` 的结果。
 */
export default function KpiCards({ analysis }: KpiCardsProps) {
  const counts = analysis.statusCounts
  const { rates } = analysis

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">核心指标</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${SUFFICIENCY_STYLES[rates.sufficiency.tag]}`}
        >
          {SUFFICIENCY_LABELS[rates.sufficiency.tag]}：{rates.sufficiency.note}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <CountCard
          hint="N = 所有保留记录，含审批中；不等于正式发放 offer 数"
          label="总 offer 记录数（含审批中）"
          value={counts.total}
        />
        <CountCard hint="J：已入职" label="已入职" value={counts.joined} />
        <CountCard hint="P：待入职（已接受未到岗）" label="待入职" value={counts.pending} />
        <CountCard
          hint="A：offer 审批中，不计入核心分母 D"
          label="offer 审批中"
          value={counts.approving}
        />
        <CountCard
          hint="D = J + P + R，核心率的分母"
          label="核心分母 D"
          value={counts.coreDenominator}
        />
        <CountCard hint="R1：拒绝 offer" label="拒绝 offer" value={counts.rejectedOffer} />
        <CountCard hint="R2：拒绝口头 offer" label="拒绝口头 offer" value={counts.rejectedVerbally} />
        <CountCard hint="R = R1 + R2" label="拒绝合计 R" value={counts.rejected} />
        <CountCard
          hint="已识别但不进核心口径，与「未知」分开显示"
          label="其他"
          value={counts.other}
        />
        <CountCard hint="缺失或无法识别，作为独立可选值保留" label="未知" value={counts.unknown} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <RateRow label="接受率 (J+P)/D（接受 ≠ 实际入职）" rate={rates.acceptanceRate} />
        <RateRow label="入职率 J/D（不是 J/N）" rate={rates.joinedRate} />
        <RateRow label="拒 offer 率 R/D" rate={rates.rejectionRate} />
        <RateRow label="待入职占比 P/D" rate={rates.pendingShareRate} />
        <RateRow label="待入职占全部记录 P/N（分母不同，明示）" rate={rates.pendingShareOfAllRate} />
        <RateRow label="审批中占比 A/N（分母不是 D）" rate={rates.approvingShareRate} />
      </div>

      <p className="text-xs leading-5 text-slate-500">
        恒等式：N = J + P + A + R1 + R2 + U。汇总率一律「合计分子分母后再相除」，
        不平均各分组百分比；分母为 0 时显示「—」，不用 0% 掩盖。
      </p>
    </section>
  )
}
