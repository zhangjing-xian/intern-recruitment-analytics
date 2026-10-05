/**
 * 请求正文的构造（AI-4，docs/PRD.md 18.4）。
 *
 * ## 这一层存在的唯一理由：**正文必须逐字节等于预览**
 *
 * PRD 18.3 要求「正文仅包括预览过的 model、messages、stream=false、max_tokens 及能力表允许的
 * temperature/thinking 等参数」，AI-1 的预览面板也把 `payloadJson` 与 messages 逐字渲染给用户看。
 * 因此真正发出去的正文只能由**同一份预览**机械地投影出来——中间任何一次「顺手补一个字段」
 * 都会让「用户批准的内容」与「实际发送的内容」不一致，而那种不一致在测试里很难被发现。
 *
 * 做法：`buildAiRequestBody(preview)` 逐字段从 `preview` 取，**不从别处取任何值**。
 * 没有 preview 就没有正文，这是类型层面的约束。
 *
 * ## 官方参数形状（2026-09-26 核实，见 `catalog.ts` 的核查记录）
 *
 * - `thinking` 是**对象** `{ type: 'enabled' | 'disabled' }`，官方默认 `enabled`。
 *   因此内部三态 `'auto'` 的语义是「**不带这个字段**」，而不是带一个默认值——
 *   带上就等于替用户做了「用服务端默认」这个决定，虽然结果相同，但正文与预览会不一致。
 * - `reasoning_effort` 取值 `none | low | high | max`，`none` 表示关闭思考模式。
 *   本模块**不会**发出 `none`：关闭思考模式由 `thinking.type = 'disabled'` 表达，
 *   两个字段同时表达同一件事容易互相矛盾（官方也没说哪个优先）。`AiReasoningEffort`
 *   因此在 AI-3 就被限定为 `low | high | max`（`catalog.ts`）。
 * - `stream` 恒为 `false`（本期非流式，流式需单独验收）。
 * - 不发送 `tools` / `response_format` / `stop` / `user_id`：本应用只发纯文本提示词，
 *   发这些字段会让「只发送预览过的内容」变得不成立。
 *
 * 本模块是纯函数层：不依赖 React / DOM / **网络** / 存储，且**不发起任何请求**。
 */

import type { AiModelParams, AiPreview } from '../privacy/aiPreview'

/** 一条消息：只有 `role` 与 `content`（不发 name / tool_call_id / 附件） */
export type AiRequestMessage = {
  readonly role: 'system' | 'user'
  readonly content: string
}

/**
 * 请求正文。
 *
 * 字段名与官方 API 的 JSON 键**完全一致**（`max_tokens` 而不是 `maxTokens`），
 * 这样序列化时不需要再做一次映射——多一层映射就多一处「预览写的是 A、发的是 B」的机会。
 * 可选字段用 `?` 而非 `| undefined`：`JSON.stringify` 会丢掉 `undefined` 的键，
 * 而「不发送」正是我们要的语义（与 D-066 同一条纪律）。
 */
export type AiRequestBody = {
  readonly model: string
  readonly messages: readonly AiRequestMessage[]
  readonly stream: false
  readonly max_tokens: number
  readonly thinking?: { readonly type: 'enabled' | 'disabled' }
  readonly reasoning_effort?: 'low' | 'high' | 'max'
  readonly temperature?: number
  readonly top_p?: number
}

/**
 * 把内部参数投影成官方请求正文。
 *
 * 三条「不发」的判定在这里**再确认一次**（不能只靠 AI-3）：
 * 参数可能来自本地加密仓里读回的偏好，而那份内容是可被外部修改的
 * （`aiSettings.ts` 的 `parseAiSettings` 会做严格校验，但校正后仍可能带上不适用的项）。
 * 也就是说：**能力表的约束在发送前必须成立**，而不是「配置时成立过一次」。
 */
export function requestBodyOf(
  params: AiModelParams,
  messages: readonly AiRequestMessage[],
): AiRequestBody {
  const thinkingOn = params.thinking === 'enabled'
  return {
    model: params.model,
    messages: messages.map((message) => ({ role: message.role, content: message.content })),
    stream: false,
    max_tokens: params.maxTokens,
    // `'auto'` = 不发送该键，由服务端按模型默认处理
    ...(params.thinking === 'auto' ? {} : { thinking: { type: params.thinking } }),
    // 推理强度只在**思考模式开启**时才有意义；关闭时它就是无效字段
    ...(thinkingOn && params.reasoningEffort !== undefined
      ? { reasoning_effort: params.reasoningEffort }
      : {}),
    // 思考模式下 temperature 不生效（官方原文：不会报错，也不会生效）→ 不发
    ...(params.temperature === undefined || thinkingOn ? {} : { temperature: params.temperature }),
    // top_p 只在思考模式下生效；`auto` 时我们不知道服务端到底开没开思考，
    // 此时**保守不发**（发了可能被忽略，那会让预览里的数字成为假象）
    ...(params.topP === undefined || params.thinking !== 'enabled' ? {} : { top_p: params.topP }),
  }
}

/**
 * 由**预览**构造请求正文（唯一入口）。
 *
 * messages 直接取 `preview.messages`：预览面板渲染的就是它们，AI-1 也保证了
 * `payloadJson` 与预览展示共用同一份序列化文本。因此这里没有任何「重新拼一遍」的空间。
 */
export function buildAiRequestBody(preview: AiPreview): AiRequestBody {
  return requestBodyOf(
    preview.params,
    preview.messages.map((message) => ({ role: message.role, content: message.content })),
  )
}

/**
 * 序列化后的正文（**发送与预览比对都用这一份**）。
 *
 * 与 `buildUserPrompt` 里那份 JSON 不同：那份是 **user message 的内容**（载荷 JSON），
 * 这份是**整个 HTTP 请求正文**。两者都必须是稳定序列化，否则「正文逐字节等于预览」无法验证。
 */
export function serializeRequestBody(body: AiRequestBody): string {
  return JSON.stringify(body)
}
