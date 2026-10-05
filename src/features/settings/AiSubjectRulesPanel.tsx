/**
 * AI 摘要使用的本地规则 + 岗位类别映射 + 二次确认（AI-6）。
 *
 * ## 这一个面板回答两个问题
 *
 * 1. **「我的哪些本地口径会影响发出去的内容」**：岗位类别映射、学校层次名单、
 *    拒 offer 原因主题三样，逐条列出「会发出什么、永远不会发出什么、来自哪里」；
 * 2. **「我说过可以了吗」**：确认绑定的是一份**指纹**（`subjectRulesFingerprint`），
 *    不是一个布尔开关。规则一改指纹就变，界面立刻回到「未确认」，
 *    看板也会拒绝发送（`features/ai/AiAnalysisWorkspace.tsx` 里同一个判据）。
 *
 * ## 为什么映射编辑器在这里，而不是新建一个页面
 *
 * 它只服务于 AI 摘要（清洗链路不消费它），放在 AI 设置里，口径与「会发出去什么」
 * 挨着显示；把编辑入口挪到别处，用户就要在两个页面之间自己拼因果。
 *
 * ## 边界
 *
 * 本组件不做白名单判断、不算指标、不读加密仓：规则视图由 `src/ai/subjectRules.ts` 给出，
 * 保存由上层（`AiSettingsPanel`）负责。界面只负责摆放与回显。
 */

import { useMemo, useState } from 'react'

import type { PositionCategoryRule } from '../../privacy/aiSummary'
import { POSITION_CATEGORY_MAX_RULES } from '../../privacy/aiSummary'
import type { AiSubjectRuleView } from '../../ai/subjectRules'

import {
  AI_POSITION_MAP_EMPTY,
  AI_POSITION_MAP_HINT,
  AI_POSITION_MAP_INVALID_NOTE,
  AI_POSITION_MAP_MAX_NOTE,
  AI_POSITION_MAP_PLACEHOLDER,
  AI_POSITION_MAP_TITLE,
  AI_SUBJECT_CONFIRM_LABEL,
  AI_SUBJECT_CONFIRMED_NOTE,
  AI_SUBJECT_FINGERPRINT_LABEL,
  AI_SUBJECT_INTRO,
  AI_SUBJECT_STALE_NOTE,
  AI_SUBJECT_TITLE,
  AI_SUBJECT_UNCONFIRMED_NOTE,
  formatPositionCategoryLines,
  parsePositionCategoryLines,
} from './aiSettingsText'

type AiSubjectRulesPanelProps = {
  readonly rules: readonly AiSubjectRuleView[]
  readonly positionCategories: readonly PositionCategoryRule[]
  readonly fingerprint: string
  readonly confirmed: boolean
  /** 曾经确认过、但指纹已经变了（提示要说清是「规则变了」而不是「从没确认」） */
  readonly staleConfirmation: boolean
  readonly confirmedAt: string | null
  readonly busy: boolean
  readonly onChangePositionCategories: (rules: readonly PositionCategoryRule[]) => void
  readonly onConfirm: () => void
}

export default function AiSubjectRulesPanel({
  rules,
  positionCategories,
  fingerprint,
  confirmed,
  staleConfirmation,
  confirmedAt,
  busy,
  onChangePositionCategories,
  onConfirm,
}: AiSubjectRulesPanelProps) {
  const [draft, setDraft] = useState(() => formatPositionCategoryLines(positionCategories))
  const parsed = useMemo(() => parsePositionCategoryLines(draft), [draft])
  /**
   * 只在草稿真的解析出**不同**的规则时才保存：否则用户每敲一个字都会写一次加密仓，
   * 而「半输入状态」（例如只敲了 `前端开发=`）会在仓里留下一份被截断的映射。
   */
  const pending =
    formatPositionCategoryLines(parsed.rules) !== formatPositionCategoryLines(positionCategories)

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{AI_SUBJECT_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{AI_SUBJECT_INTRO}</p>
      </div>

      <ul className="space-y-2">
        {rules.map((rule) => (
          <li className="rounded border border-slate-200 bg-slate-50 p-2" key={rule.id}>
            <p className="text-xs font-medium text-slate-900">{rule.label}</p>
            <div className="mt-1 space-y-1 text-xs leading-5">
              <p className="text-slate-700">
                <span className="font-medium">会发出：</span>
                {rule.sends.length === 0 ? '（当前没有可发出的取值）' : rule.sends.join('、')}
              </p>
              <p className="text-slate-700">
                <span className="font-medium">永远不会发出：</span>
                {rule.neverSends.join('；')}
              </p>
              <ul className="list-disc space-y-0.5 pl-5 text-slate-600">
                {rule.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="text-slate-500">来源：{rule.source}</p>
            </div>
          </li>
        ))}
      </ul>

      {/* ------------------------------------------------- 岗位类别映射编辑 */}
      <div className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-800">{AI_POSITION_MAP_TITLE}</p>
        <p className="text-xs leading-5 text-slate-600">{AI_POSITION_MAP_HINT}</p>
        <textarea
          className="h-24 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
          disabled={busy}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={AI_POSITION_MAP_PLACEHOLDER}
          spellCheck={false}
          value={draft}
        />
        {parsed.rules.length === 0 ? (
          <p className="text-xs leading-5 text-slate-500">{AI_POSITION_MAP_EMPTY}</p>
        ) : null}
        {parsed.invalidLines.length > 0 ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2">
            <p className="text-xs leading-5 text-amber-900">{AI_POSITION_MAP_INVALID_NOTE}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5 text-amber-900">
              {parsed.invalidLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={busy || !pending || parsed.rules.length > POSITION_CATEGORY_MAX_RULES}
            onClick={() => onChangePositionCategories(parsed.rules)}
            type="button"
          >
            保存映射（{parsed.rules.length} 条）
          </button>
          <p className="text-xs leading-5 text-slate-500">{AI_POSITION_MAP_MAX_NOTE}</p>
        </div>
      </div>

      {/* ------------------------------------------------- 二次确认 */}
      <div className="space-y-2 rounded border border-indigo-200 bg-indigo-50/40 p-3">
        <p className="text-xs text-slate-500">
          {AI_SUBJECT_FINGERPRINT_LABEL}：
          <span className="font-mono text-indigo-900">{fingerprint}</span>
        </p>
        <p
          className={
            confirmed
              ? 'text-xs leading-5 text-emerald-900'
              : 'text-xs leading-5 text-amber-900'
          }
        >
          {confirmed
            ? `${AI_SUBJECT_CONFIRMED_NOTE}${confirmedAt === null ? '' : `确认时间：${confirmedAt}`}`
            : staleConfirmation
              ? AI_SUBJECT_STALE_NOTE
              : AI_SUBJECT_UNCONFIRMED_NOTE}
        </p>
        <button
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={busy}
          onClick={onConfirm}
          type="button"
        >
          {AI_SUBJECT_CONFIRM_LABEL}
        </button>
      </div>
    </section>
  )
}
