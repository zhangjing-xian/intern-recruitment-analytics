import type { ReactNode } from 'react'

import { REJECTION_CONDITION_LABELS } from '../../domain'
import type {
  ConditionEvaluation,
  RejectionRuleEvaluation,
  RejectionThresholds,
} from '../../domain'
import { formatDecimal, formatInteger, formatPercent } from '../../lib/format'
import SectionShell from '../dimensions/SectionShell'

import {
  ATTENTION_EMPTY_SCOPE_NOTE,
  ATTENTION_HEADING,
  ATTENTION_NO_RULES_NOTE,
  ATTENTION_SCOPE_NOTE,
  COLUMN_LABELS,
  DISCLAIMER_LABEL,
  LEVEL_LABELS,
  LEVEL_NOTES,
  SECTION_TITLES,
  THRESHOLDS_HEADING,
  WAITING_THRESHOLD_LABEL,
} from './rejectionText'

type AttentionTagsPanelProps = {
  readonly evaluations: readonly RejectionRuleEvaluation[]
  /** 结论层免责声明（原样渲染，界面不改写） */
  readonly disclaimer: string
  /** 门槛配置（运营配置，随报告记录；界面只展示数值，不判断） */
  readonly thresholds: RejectionThresholds
  readonly waitingThresholdDays: number
  /** 当前筛选下的记录数，用于区分「规则为空」与「比较人群为空」 */
  readonly recordCount: number
}

/** 一行「标签 → 值」 */
function Row({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-1.5 last:border-b-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  )
}

/**
 * 条件清单（命中 / 未知 / 不满足）。
 *
 * **未知条件必须可见**（PRD 9.3「未知条件保持 unknown，不当 false 或零补贴」）：
 * 只展示命中条件会让读者以为「没列出来的就是没命中」，而实际可能是**根本判不了**——
 * 所以这里逐条给出条件名与引擎的 `detail`（判定依据，如实际天数、基准说明）。
 */
function ConditionList({
  title,
  conditions,
  emptyNote,
}: {
  readonly title: string
  readonly conditions: readonly ConditionEvaluation[]
  readonly emptyNote: string
}) {
  return (
    <div>
      <p className="text-xs font-medium text-slate-700">{title}</p>
      {conditions.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">{emptyNote}</p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
          {conditions.map((condition) => (
            <li key={condition.condition}>
              <span className="font-medium text-slate-800">{condition.label}</span>
              <span className="ml-1">：{condition.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** 单条规则评估卡片：规则可回溯 + 证据 + 未知条件 + 建议核查 */
function RuleCard({ evaluation }: { readonly evaluation: RejectionRuleEvaluation }) {
  const { rule } = evaluation
  const levelNote = LEVEL_NOTES[evaluation.level]

  return (
    <article className="space-y-2 rounded border border-slate-200 p-3">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{rule.label}</h4>
          {/* 规则 ID 与版本必须可见：结论要能回溯到「哪条规则、哪一版」 */}
          <p className="mt-0.5 text-xs text-slate-500">
            {COLUMN_LABELS.ruleVersion}：{rule.id}（{rule.version}）
          </p>
        </div>
        <span className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
          {LEVEL_LABELS[evaluation.level]}
        </span>
      </header>

      <p className="text-xs leading-5 text-slate-500">{levelNote}</p>

      {/* 引擎生成的结论文案原样渲染：界面不改写、不四舍五入、不追加形容词 */}
      <p className="rounded bg-slate-50 p-2 text-xs leading-5 text-slate-800">{evaluation.conclusion}</p>

      <dl>
        <Row label={COLUMN_LABELS.hitCount}>
          <span className="tabular-nums">{formatInteger(evaluation.hitCount)} 条</span>
          <span className="ml-2 text-xs text-slate-500">
            （其中拒 offer 组 {formatInteger(evaluation.hitRejected)} 条、入职组{' '}
            {formatInteger(evaluation.hitJoined)} 条）
          </span>
        </Row>
        <Row label={`有效 D / R（${COLUMN_LABELS.ruleRate}）`}>
          {/*
            D = J + P + R，与右侧「整体拒 offer 率 R ÷ D」**同一个分母口径**。
            命中记录全部落在两组比较人群内，但其中「按核心分母口径应计入 D」的待入职仍然进 D，
            否则率差会拿两种口径相减、把「仅供描述」误升成「观察到关联」。
            因此这里同时说出「D 含待入职」：光看 D 与命中拆分（拒 offer + 入职）会差出待入职那部分。
          */}
          <span
            className="tabular-nums"
            title={`分子 ${evaluation.rejected} ÷ 分母 ${evaluation.coreDenominator}`}
          >
            D {formatInteger(evaluation.coreDenominator)} / R {formatInteger(evaluation.rejected)}
          </span>
          <span className="ml-2 text-xs text-slate-500">
            = {formatPercent(evaluation.rejectionRate, 2)}（{formatInteger(evaluation.rejected)} ÷{' '}
            {formatInteger(evaluation.coreDenominator)}）
          </span>
          <span className="ml-1 block text-xs text-slate-500">
            分子分母均由引擎给出：D 与整体率同口径（含按核心分母口径计入的待入职），命中拆分里的拒 offer 组与入职组
            只是比较人群内的部分。
          </span>
        </Row>
        <Row label={COLUMN_LABELS.baseline}>
          {/*
            基准是当前筛选下的整体拒 offer 率（引擎用整体 R 与整体 D 算出）；
            任一侧分母为 0 时引擎给 null，这里显示「—」，绝不显示 0%。
          */}
          {formatPercent(evaluation.baselineRate, 2)}
          <span className="ml-1 text-xs text-slate-500">
            （当前筛选下的整体拒 offer 率 R ÷ D）
          </span>
        </Row>
        <Row label={COLUMN_LABELS.rateGap}>
          {formatDecimal(evaluation.rateGapPoints, 2)}
          <span className="ml-1 text-xs text-slate-500">个百分点（组内率 − 整体率）</span>
        </Row>
        <Row label={COLUMN_LABELS.suggestedCheck}>{evaluation.suggestedCheck}</Row>
        <Row label={COLUMN_LABELS.scope}>{evaluation.scopeNote}</Row>
      </dl>

      <div className="space-y-2">
        <ConditionList
          conditions={evaluation.metConditions}
          emptyNote="没有已满足的条件（规则要求全部条件同时满足，缺一即不命中）。"
          title={COLUMN_LABELS.metConditions}
        />
        {/* 未知条件是本页必须展示的证据之一，不能折叠、不能省略 */}
        <ConditionList
          conditions={evaluation.unknownConditions}
          emptyNote="本规则没有未知条件：所有条件的判定依据都齐全。"
          title={COLUMN_LABELS.unknownConditions}
        />
        <ConditionList
          conditions={evaluation.unmetConditions}
          emptyNote="没有出现「明确不满足」的条件。"
          title={COLUMN_LABELS.unmetConditions}
        />
      </div>

      <p className="text-xs leading-5 text-slate-500">
        规则条件（须全部满足）：{rule.conditions.map((condition) => REJECTION_CONDITION_LABELS[condition]).join(' 且 ')}；
        命中数只统计「所有条件都已满足」的记录，未知条件的记录既不算命中、也不算不满足。
      </p>
    </article>
  )
}

/**
 * 拒 offer 运营关注标签（docs/PRD.md 9.3）。
 *
 * 名称与定位：这是**规则筛查**，不是个人概率模型，也不用于自动淘汰或歧视候选人。
 * 每条规则必须能回溯（规则 ID / 版本 / 命中条件 / 未知条件 / 有效 D、R / 比较基准 / 率差 /
 * 适用范围 / 建议核查事项）；**禁止**输出「此人拒 offer 概率 80%」这类未经校准的说法——
 * 所以本组件只渲染引擎给出的确定性格文案，任何地方都不出现「概率」以外的预测表达。
 *
 * 结论分级由引擎按门槛判定（D ≥ 10 且 R ≥ 3 且率差 ≥ 10 个百分点才是 `observed`），
 * 界面只把级别映射成固定徽标，不自己比较任何阈值。
 */
export default function AttentionTagsPanel({
  evaluations,
  disclaimer,
  thresholds,
  waitingThresholdDays,
  recordCount,
}: AttentionTagsPanelProps) {
  const finalNotes = [ATTENTION_SCOPE_NOTE]
  if (evaluations.length === 0) {
    finalNotes.push(ATTENTION_NO_RULES_NOTE)
  } else if (evaluations.every((evaluation) => evaluation.hitCount === 0)) {
    finalNotes.push(recordCount === 0 ? '当前筛选下没有任何记录。' : ATTENTION_EMPTY_SCOPE_NOTE)
  }

  return (
    <SectionShell notes={finalNotes} title={SECTION_TITLES.attention}>
      <h4 className="text-xs font-medium text-slate-700">{ATTENTION_HEADING}</h4>

      {/* 免责声明放在规则列表**之前**：读者先看到边界，再看数字 */}
      <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <span className="font-medium">{DISCLAIMER_LABEL}：</span>
        {disclaimer}
      </p>

      <div className="rounded border border-slate-200 p-3">
        <p className="text-xs font-medium text-slate-700">{THRESHOLDS_HEADING}</p>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          组内有效分母 D ≥ {formatInteger(thresholds.minDenominator)}、组内拒 offer 数 R ≥{' '}
          {formatInteger(thresholds.minRejected)}、与整体率差 ≥{' '}
          {formatDecimal(thresholds.minRateGapPoints, 0)} 个百分点，
          <span className="font-medium">三条同时满足</span>才会输出「观察到关联」；否则只显示「仅供描述」或
          「样本不足」。{WAITING_THRESHOLD_LABEL}：{formatInteger(waitingThresholdDays)} 天
          （拒 offer 记录没有拒绝日期，其历史等待时长恒为「未知」，不当成「未超时」）。
        </p>
      </div>

      {evaluations.length === 0 ? null : (
        <div className="space-y-3">
          {evaluations.map((evaluation) => (
            <RuleCard evaluation={evaluation} key={evaluation.rule.id} />
          ))}
        </div>
      )}
    </SectionShell>
  )
}
