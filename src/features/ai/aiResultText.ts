/**
 * AI 结果与历史的展示文案（AI-5，纯常量）。
 *
 * 与 `aiText.ts` 同一套纪律：这些句子会**逐字渲染**进界面，因此
 * **不允许出现 Markdown 强调标记**（`**` / `__`），并由 `AI_RESULT_UI_TEXTS` 导出供单测断言。
 *
 * 另一条纪律：**不得**把模型文本说成结论。凡是提到模型输出的地方，
 * 都要同时写出「需人工核验」与「以本地统计为准」。
 */

export const AI_RESULT_TITLE = 'AI 深度分析结果'
export const AI_RESULT_NOT_AUTHORITATIVE_NOTE = '模型生成，需人工核验；数字以本地统计为准'
export const AI_RESULT_META_TITLE = '本次调用的元数据'
export const AI_RESULT_SENT_PAYLOAD_TITLE = '本次发送的脱敏摘要（已由用户确认的那一份）'
export const AI_RESULT_CHECK_TITLE = '本地敏感检查提示（只报位置，不回显命中内容）'
export const AI_RESULT_LINKS_TITLE = '结果里出现的外部地址'
export const AI_RESULT_REFERENCE_BADGE = '已降级'
export const AI_RESULT_DOWNGRADE_TITLE = '内容降级说明'

export const AI_RESULT_COPY_LABEL = '复制净化后的 Markdown'
export const AI_RESULT_COPY_OK = '已复制净化后的 Markdown（链接与图片已降级为文本）。'
export const AI_RESULT_COPY_FAILED = '无法访问剪贴板，请手动选择结果文本后复制。'

export const AI_RESULT_EXPORT_MD_LABEL = '导出 Markdown'
export const AI_RESULT_EXPORT_PDF_LABEL = '打印 / 另存为 PDF'
export const AI_RESULT_EXPORT_BLOCKED_TITLE = '导出未完成：'

export const AI_HISTORY_SAVE_LABEL = '保存到本地历史'
export const AI_HISTORY_SAVED_NOTE =
  '已加密保存到本地历史。本应用不会自动重发历史内容，历史里也不含 API Key、请求头与模型内部推理文本。'
export const AI_HISTORY_SAVE_FAILED_TITLE = '没能保存到本地历史：'

/* ------------------------------------------------------------------ 历史页 */

export const AI_HISTORY_TITLE = 'AI 调用历史'
export const AI_HISTORY_INTRO =
  '只有你显式点击「保存到本地历史」的调用才会出现在这里；打开本页不会发起任何网络请求，也不会自动重发历史内容。'
export const AI_HISTORY_EMPTY = '还没有保存过任何 AI 调用。'
export const AI_HISTORY_LOAD_FAILED = '读取本地历史时遇到问题：'
export const AI_HISTORY_DELETE_LABEL = '删除这一条'
export const AI_HISTORY_CLEAR_LABEL = '清空全部 AI 历史'
export const AI_HISTORY_CLEAR_PHRASE = '清空 AI 历史'
export const AI_HISTORY_CLEAR_NOTE =
  '清空 AI 历史只删除历史记录本身：招聘源数据、映射模板与本地仓里的 API Key 都不受影响。'
export const AI_HISTORY_DELETE_NOTE =
  '删除后无法恢复（加密备份里也不含 AI 历史）。本地删除不能撤回已经发给 DeepSeek 的内容。'
export const AI_HISTORY_NO_KEY_NOTE =
  '历史里不含 API Key、Authorization 请求头与模型内部推理文本；这些内容从来没有被写进历史。'
export const AI_HISTORY_TEMPORARY_NOTE =
  '临时模式没有加密仓，因此无法保存历史：需要先到设置页创建并解锁本地仓。'

/** 历史条目在列表里的时间 / 模型摘要（纯格式化，界面不自己拼） */
export function historySummaryOf(entry: {
  readonly savedAt: string
  readonly requestedModel: string
  readonly responseModel: string | null
  readonly privacyLevel: string
  readonly finishStatus: string
}): string {
  const model =
    entry.responseModel === null || entry.responseModel === entry.requestedModel
      ? entry.requestedModel
      : `${entry.requestedModel} → ${entry.responseModel}`
  return `${entry.savedAt}｜${model}｜脱敏级别 ${entry.privacyLevel}｜结果状态 ${entry.finishStatus}`
}

/** 文案清单：供「无 Markdown 强调标记」断言使用（新增文案必须加进来） */
export const AI_RESULT_UI_TEXTS: readonly string[] = [
  AI_RESULT_TITLE,
  AI_RESULT_NOT_AUTHORITATIVE_NOTE,
  AI_RESULT_META_TITLE,
  AI_RESULT_SENT_PAYLOAD_TITLE,
  AI_RESULT_CHECK_TITLE,
  AI_RESULT_LINKS_TITLE,
  AI_RESULT_REFERENCE_BADGE,
  AI_RESULT_DOWNGRADE_TITLE,
  AI_RESULT_COPY_LABEL,
  AI_RESULT_COPY_OK,
  AI_RESULT_COPY_FAILED,
  AI_RESULT_EXPORT_MD_LABEL,
  AI_RESULT_EXPORT_PDF_LABEL,
  AI_RESULT_EXPORT_BLOCKED_TITLE,
  AI_HISTORY_SAVE_LABEL,
  AI_HISTORY_SAVED_NOTE,
  AI_HISTORY_SAVE_FAILED_TITLE,
  AI_HISTORY_TITLE,
  AI_HISTORY_INTRO,
  AI_HISTORY_EMPTY,
  AI_HISTORY_LOAD_FAILED,
  AI_HISTORY_DELETE_LABEL,
  AI_HISTORY_CLEAR_LABEL,
  AI_HISTORY_CLEAR_NOTE,
  AI_HISTORY_DELETE_NOTE,
  AI_HISTORY_NO_KEY_NOTE,
  AI_HISTORY_TEMPORARY_NOTE,
]
