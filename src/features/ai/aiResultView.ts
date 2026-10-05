/**
 * AI 结果视图与历史条目的相互转换（AI-5）。
 *
 * ## 为什么这些函数不在 `AiResultPanel.tsx` 里
 *
 * 两条具体理由：
 * 1. **Fast refresh 的约束**：组件文件只应导出组件。混着导出常量与纯函数会让 HMR 在工作时
 *    整文件重挂载（oxlint 的 `react(only-export-components)` 正是报这个）；
 * 2. **纯逻辑该与界面分开**：「结果 → 历史条目」「历史条目 → 结果视图」是**不需要 React**
 *    的映射，放在 `.ts` 里就能被单测直接调用，不必渲染组件。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储。
 */

import { parseAiMarkdown, sanitizeMarkdownText } from '../../ai/aiMarkdown'
import { checkAiResponseText } from '../../ai/aiResponseCheck'
import { finishStatusOf, type AiChatResult } from '../../ai/aiResult'
import {
  AI_HISTORY_SCHEMA_VERSION,
  type AiHistoryEntry,
  type AiHistoryPayload,
} from '../../ai/aiHistory'
import type { PrivacyLevel } from '../../privacy/sanitize'

/** 结果页需要的全部输入（**没有** Key / 请求头 / 思维链的位置） */
export type AiResultView = {
  readonly requestedAt: string
  readonly requestedModel: string
  readonly responseModel: string | null
  readonly privacyLevel: PrivacyLevel
  readonly ruleVersionLabel: string
  readonly promptVersion: string
  readonly schemaVersionOfPayload: string
  readonly dataAsOf: string
  readonly activeFilters: readonly string[]
  /** 本次实际发送的载荷 JSON（用户批准过的那一份文本） */
  readonly payloadJson: string
  readonly previewHash: string
  readonly result: AiChatResult
  /** 结果是否仍属当前世代；`false` = 迟到响应，界面**不得**把它当有效结果展示 */
  readonly current: boolean
  /** 本次数据集里的本地哨兵（用于回复侧检查；不传则只做字段名检查） */
  readonly sentinels?: readonly string[]
}

/**
 * 由结果构造一条历史**载荷**（不落盘、不含 id）。
 *
 * 响应侧检查也在这里算好并存进载荷：历史里要保留「当时检查过、结论是什么」，
 * 否则以后重看历史时无法判断当时是否提示过。
 */
export function historyPayloadOf(view: AiResultView, savedAt: string): AiHistoryPayload {
  const document = parseAiMarkdown(view.result.content)
  const check = checkAiResponseText(sanitizeMarkdownText(document), view.sentinels ?? [])
  return {
    schemaVersion: AI_HISTORY_SCHEMA_VERSION,
    savedAt,
    requestedAt: view.requestedAt,
    previewHash: view.previewHash,
    requestedModel: view.requestedModel,
    responseModel: view.responseModel,
    privacyLevel: view.privacyLevel,
    schemaVersionOfPayload: view.schemaVersionOfPayload,
    promptVersion: view.promptVersion,
    ruleVersionLabel: view.ruleVersionLabel,
    dataAsOf: view.dataAsOf,
    activeFilters: view.activeFilters,
    payloadJson: view.payloadJson,
    content: view.result.content,
    finishReason: view.result.finishReason,
    // 完整性判定只此一处（`finishStatusOf`），界面不得自己比字符串
    finishStatus: finishStatusOf(view.result.finishReason),
    usage: view.result.usage,
    responseId: view.result.responseId,
    responseCheck: {
      hasFindings: check.hasFindings,
      fieldNames: check.fieldNames,
      sentinelHit: check.sentinelHit,
    },
  }
}

/**
 * 由**预览 + 结果**构造视图（工作区用；这两样是它在那一刻手上真正有的东西）。
 */
export function resultViewOf(input: {
  readonly preview: {
    readonly hash: string
    readonly promptVersion: string
    readonly schemaVersion: string
    readonly generatedAt: string
    readonly payloadJson: string
    readonly payload: {
      readonly privacyLevel: PrivacyLevel
      readonly dataAsOf: string
      readonly scope: { readonly ruleVersion: string; readonly filters: readonly string[] }
    }
  }
  readonly result: AiChatResult
  readonly current: boolean
  readonly sentinels?: readonly string[]
}): AiResultView {
  return {
    requestedAt: input.preview.generatedAt,
    requestedModel: input.result.requestedModel,
    responseModel: input.result.responseModel,
    privacyLevel: input.preview.payload.privacyLevel,
    ruleVersionLabel: input.preview.payload.scope.ruleVersion,
    promptVersion: input.preview.promptVersion,
    schemaVersionOfPayload: input.preview.schemaVersion,
    dataAsOf: input.preview.payload.dataAsOf,
    activeFilters: input.preview.payload.scope.filters,
    payloadJson: input.preview.payloadJson,
    previewHash: input.preview.hash,
    result: input.result,
    current: input.current,
    ...(input.sentinels === undefined ? {} : { sentinels: input.sentinels }),
  }
}

/**
 * 由历史条目构造结果视图（历史页用）。
 *
 * `current: true` 是刻意的：世代号管的是「在途请求的响应还算不算数」，
 * 而历史是**已经保存下来的快照**，与当前世代无关——把它判成迟到会让历史永远打不开。
 */
export function resultViewOfHistoryEntry(entry: AiHistoryEntry): AiResultView {
  return {
    requestedAt: entry.requestedAt,
    requestedModel: entry.requestedModel,
    responseModel: entry.responseModel,
    privacyLevel: entry.privacyLevel,
    ruleVersionLabel: entry.ruleVersionLabel,
    promptVersion: entry.promptVersion,
    schemaVersionOfPayload: entry.schemaVersionOfPayload,
    dataAsOf: entry.dataAsOf,
    activeFilters: entry.activeFilters,
    payloadJson: entry.payloadJson,
    previewHash: entry.previewHash,
    result: {
      requestHash: entry.previewHash,
      requestedModel: entry.requestedModel,
      responseModel: entry.responseModel,
      content: entry.content,
      finishReason: entry.finishReason,
      usage: entry.usage,
      responseId: entry.responseId,
    },
    current: true,
  }
}
