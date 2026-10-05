/**
 * **唯一的网络适配器**（AI-4，docs/PRD.md 18.3 / 18.4）。
 *
 * ## 这个文件是全仓库唯一允许发起网络请求的地方
 *
 * 从步骤1 到 AI-3，全仓 `src` 内没有任何真实网络调用（有逐行扫描的守卫测试）。
 * AI-4 打破这条「零调用」状态，但只在**这一个文件**里打破：`features/ai/**` 仍然被守卫
 * 禁止出现任何调用形状，因此「顺手在组件里加个请求」依然会 CI 失败。
 * 需要发请求的调用方只能经 `sendSanitizedAiRequest`。
 *
 * ## 它不能接收原始记录类型（PRD 11 章、AGENTS.md）
 *
 * 函数签名只接受 `AiSendRequest`，而这个类型里只有 `payloadJson`（**已经脱敏的载荷文本**）、
 * 预览 hash、模型与参数。`NormalizedRecord[]` / `RawRow` / `SanitizedReport` 都不在这个类型里，
 * 也没有任何字段能装下它们——「把原始记录传给网络层」在**类型层面**写不出来。
 *
 * ## 六条请求纪律（PRD 18.3 逐条对应）
 *
 * 1. `POST {origin}{path}`，`Authorization: Bearer <key>`，`stream: false`；
 * 2. `credentials: 'omit'`（不带 Cookie）、`referrerPolicy: 'no-referrer'`、
 *    `redirect: 'error'`（不跟随重定向）、`cache: 'no-store'`；
 * 3. 只允许文本 messages——请求正文由 `buildAiRequestBody` 从预览投影，没有附件位；
 * 4. `AbortController` 支持取消与超时；超时与取消后**丢弃迟到结果**（不会写回任何地方）；
 * 5. **绝不自动重试、绝不切换模型或端点、绝不后台排队**：本文件没有重试逻辑，
 *    失败就返回一个 `AiRequestError` 给界面；
 * 6. Key 只进 `Authorization` 头：不进 URL、不进正文、不进错误对象、不进日志
 *    （本文件没有 `console` 调用，守卫测试会检查）。
 *
 * ## 关于「疑似 CORS」
 *
 * 浏览器对 `fetch` 的网络层失败一律抛 `TypeError`，**无法区分**断网、DNS、TLS、CORS 预检失败。
 * 因此这里只报 `kind: 'network'` 并给一句「可能是跨域，需看开发者工具」的排查建议，
 * **不写成「CORS 失败」**（PRD 18.4 明确要求，AI11 的验收点之一）。
 */

import { readAiKeyForRequest } from './keySession'
import {
  aiRequestError,
  errorKindOfCode,
  finishStatusOf,
  isAiRequestError,
  type AiChatResult,
  type AiRequestError,
} from './aiResult'
import { buildAiRequestBody, serializeRequestBody } from './aiRequest'
import { AI_DEFAULT_DESTINATION, type AiDestination, type AiPreview } from '../privacy/aiPreview'

/** 响应体大小上限（PRD 18.3：默认 ≤1MiB）；超限不解析、直接报异常 */
export const AI_RESPONSE_MAX_BYTES = 1024 * 1024

/** 错误正文里最多带回多少字符（**截断**，避免把整份 HTTP 报文搬进界面） */
export const AI_ERROR_DETAIL_MAX_CHARS = 200

/**
 * 网络层能接收的全部内容。
 *
 * 注意这里**没有** `records` / `rows` / `report` 之类的位置：脱敏载荷已经是文本。
 */
export type AiSendRequest = {
  /** 用户在预览里批准的那一份内容的 hash（结果里会带回来，便于回溯「这份结果属于哪次确认」） */
  readonly previewHash: string
  /** 请求时用的模型 ID（用户在预览里看到并批准的那个；结果里要与服务端返回的对照） */
  readonly requestedModel: string
  /** 完整的 HTTP 请求正文（由 `buildAiRequestBody` 生成，逐字段来自预览） */
  readonly body: string
  readonly destination: AiDestination
  readonly timeoutMs: number
}

/** 由预览直接构造发送请求（调用方不需要自己拼正文） */
export function aiSendRequestOf(preview: AiPreview, destination?: AiDestination): AiSendRequest {
  const target = destination ?? AI_DEFAULT_DESTINATION
  return {
    previewHash: preview.hash,
    requestedModel: preview.params.model,
    body: serializeRequestBody(buildAiRequestBody(preview)),
    destination: target,
    timeoutMs: preview.params.timeoutMs,
  }
}

/** 一次在途请求的取消句柄；调用方只拿到 `cancel`，拿不到 `AbortController` 本身 */
export type AiInFlightRequest = {
  /** 取消本次请求（本地停止等待；**不承诺**服务端未处理、也不承诺免收费） */
  readonly cancel: () => void
}

/**
 * 发送一次请求。
 *
 * 返回 `AiChatResult` 或抛出 `AiRequestError`。**没有其他失败形态**：
 * 网络异常、超时、取消、响应不合规都被收敛成 `AiRequestError`，
 * 调用方不必再区分 `TypeError` / `DOMException` / JSON 解析错误。
 */
export async function sendSanitizedAiRequest(
  request: AiSendRequest,
  inFlight: { readonly register: (handle: AiInFlightRequest) => void },
): Promise<AiChatResult> {
  const key = readAiKeyForRequest()
  if (key === null) {
    // 没有 Key 就**不发请求**（这不是「失败」，而是不该发生的一次调用）
    throw aiRequestError({
      kind: 'no-key',
      message: '当前没有可用的 API Key，未发出任何请求。',
      advice: '到设置页填写 Key（默认只放在内存），然后重新预览并确认。',
    })
  }

  const controller = new AbortController()
  inFlight.register({ cancel: () => { controller.abort() } })

  /*
   * 超时用一个定时器表达：它只做一件事——`abort()`，并记下「这次中断是超时引起的」。
   * 为什么不能靠两个定时器（一个 abort、一个标记）：两个定时器会引入竞态，
   * 标记可能晚于 catch 分支执行，于是超时被误报成「用户取消」。
   * 状态标志在**同一个回调**里先置位再 abort，顺序是确定的。
   */
  let timedOut = false
  const timeoutHandle = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, request.timeoutMs)

  try {
    const response = await doFetch(request, key, controller.signal)
    return await readResponse(response, request)
  } catch (cause) {
    throw await normalizeFailure(cause, controller.signal, timedOut)
  } finally {
    clearTimeout(timeoutHandle)
  }
}

/**
 * 唯一一次 `fetch`。
 *
 * 刻意写成独立函数：守卫测试与人工审查都只需要看这一个地方，
 * 而「有没有别的地方在发请求」可以靠全仓检索回答。
 */
async function doFetch(
  request: AiSendRequest,
  key: string,
  signal: AbortSignal,
): Promise<Response> {
  const url = `${request.destination.origin}${request.destination.path}`
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Key 只在这里出现：不是查询参数、不是正文、不是 `VITE_*`
      Authorization: `Bearer ${key}`,
    },
    body: request.body,
    // 四条浏览器侧的边界（PRD 18.3 逐条要求）
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    redirect: 'error',
    cache: 'no-store',
    signal,
  })
}

/** 把浏览器侧的失败收敛成可分类的错误（**不硬判 CORS**） */
async function normalizeFailure(
  cause: unknown,
  signal: AbortSignal,
  timedOut: boolean,
): Promise<AiRequestError> {
  /*
   * 先认「已经分类好的错误」：HTTP 非 2xx 是在内层抛出的、带状态码与官方错误码的
   * `AiRequestError`（`auth` / `balance` / `rate-limit` / …）。若不先认它，
   * 下面的兜底会把 `401` 重新包成「网络失败」——那会丢掉**最有用的分类信息**，
   * 界面也就无法给出「请替换 Key」这类正确建议。这个 bug 在 AI-4 的测试里被抓出来。
   */
  if (isAiRequestError(cause)) {
    return cause
  }
  if (signal.aborted) {
    return timedOut
      ? aiRequestError({
          kind: 'timeout',
          message: '本地已停止等待（超时）。请求可能仍在服务端处理，因此可能已产生费用。',
          advice: '需要重试请重新预览并确认（本应用不会自动重试）。',
        })
      : aiRequestError({
          kind: 'cancelled',
          message: '本次请求已取消。本地不再等待结果，但不承诺服务端未处理、也不承诺免收费。',
          advice: '需要重试请重新预览并确认。',
        })
  }
  if (cause instanceof TypeError) {
    /*
     * `TypeError` 是 fetch 的网络层失败的统称：断网、DNS、TLS、跨域预检失败**都会**抛它，
     * 浏览器不告诉我们是哪一种。因此这里只说「可能」，并把排查方法写清楚。
     */
    return aiRequestError({
      kind: 'network',
      message: '请求没有到达可用的响应（可能是网络中断、DNS / TLS 问题，也可能是跨域预检被拒绝）。',
      advice:
        '请打开浏览器开发者工具的「网络」面板查看该请求的真实状态：若显示 CORS 相关错误，则说明 DeepSeek 未允许本站 Origin，需要自行处理跨域（本应用不使用公共代理，也不由网站运营方托管代理）。',
    })
  }
  return aiRequestError({
    kind: 'network',
    message: '请求失败，且失败原因无法从浏览器侧判定。',
    advice: '请查看开发者工具的「网络」面板确认根因。',
  })
}

/** 读取并校验响应（状态码 → 错误；正文 → 结果） */
async function readResponse(response: Response, request: AiSendRequest): Promise<AiChatResult> {
  if (!response.ok) {
    throw await httpErrorOf(response)
  }

  const text = await readBoundedText(response)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw aiRequestError({
      kind: 'malformed-response',
      status: response.status,
      message: '服务端返回的不是可解析的 JSON，因此没有可用结果（错误 HTML 不会被当成报告渲染）。',
      advice: '稍后重新预览并确认；若持续出现，请检查端点地址是否正确。',
    })
  }

  return parseChatCompletion(parsed, request)
}

/**
 * 带大小上限的读取。
 *
 * 为什么不用 `response.json()`：它会把整份正文读进内存再解析，而服务端理论上可以返回
 * 任意大的内容（PRD 18.3 要求「内容大小（默认 ≤1MiB）」）。这里在**流式读取**时就计数，
 * 超限立刻停止并报异常——不让一个超大响应把页面拖垮。
 */
async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > AI_RESPONSE_MAX_BYTES) {
    throw aiRequestError({
      kind: 'response-too-large',
      status: response.status,
      message: `响应体声明的大小超过本地上限（${String(AI_RESPONSE_MAX_BYTES)} 字节），已拒绝解析。`,
      advice: '请缩小分析范围后重新预览并确认。',
    })
  }

  const body = response.body
  if (body === null) {
    return await response.text()
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    if (value === undefined) {
      continue
    }
    total += value.byteLength
    if (total > AI_RESPONSE_MAX_BYTES) {
      await reader.cancel()
      throw aiRequestError({
        kind: 'response-too-large',
        status: response.status,
        message: `响应体超过本地上限（${String(AI_RESPONSE_MAX_BYTES)} 字节），已停止读取。`,
        advice: '请缩小分析范围后重新预览并确认。',
      })
    }
    chunks.push(value)
  }

  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

/** HTTP 非 2xx：提取**安全**的错误码与截断说明，绝不带整份报文 */
async function httpErrorOf(response: Response): Promise<AiRequestError> {
  const status = response.status
  let code: string | null = null
  let type: string | null = null
  let detail: string | null = null
  try {
    const text = await response.text()
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null) {
      const error = (parsed as { error?: unknown }).error
      if (typeof error === 'object' && error !== null) {
        const record = error as { code?: unknown; message?: unknown; type?: unknown }
        if (typeof record.code === 'string') {
          code = record.code
        }
        /*
         * 官方的 `type` 也要读：DeepSeek 在「Key 无效」时给的是
         * `type: "authentication_error"` + `code: "invalid_request_error"` + HTTP 401，
         * 只有 `code` 会把认证失败误诊成参数问题（2026-09-27 真实发生，见 `errorKindOfCode`）。
         */
        if (typeof record.type === 'string') {
          type = record.type
        }
        if (typeof record.message === 'string') {
          detail = record.message.slice(0, AI_ERROR_DETAIL_MAX_CHARS)
        }
      }
    }
  } catch {
    // 错误正文不是 JSON（例如网关返回 HTML）：不带回来，避免把整份 HTTP 报文搬进界面
  }

  const kind = errorKindOfCode(code, status, type)
  const suffix = detail === null ? '' : `（服务端说明：${detail}）`
  return aiRequestError({
    kind,
    status,
    code,
    message: `${httpMessageOf(kind)}${suffix}`,
    advice: httpAdviceOf(kind),
  })
}

function httpMessageOf(kind: ReturnType<typeof errorKindOfCode>): string {
  switch (kind) {
    case 'invalid-params':
      return '请求参数被服务端拒绝（可能是模型不支持某个参数、或摘要长度超出模型上下文）。'
    case 'auth':
      return 'API Key 无效或认证失败。'
    case 'balance':
      return '账户余额不足。'
    case 'model-unavailable':
      return '所选模型不存在或当前不可用。'
    case 'rate-limit':
      return '请求受限（触发限速）。'
    case 'server':
      return '服务端暂时不可用。'
    default:
      return '服务端返回了未预期的错误状态。'
  }
}

function httpAdviceOf(kind: ReturnType<typeof errorKindOfCode>): string | null {
  switch (kind) {
    case 'invalid-params':
      return '请检查模型与参数（例如思考模式下的 temperature 会被禁用），或缩小分析范围后重新预览。'
    case 'auth':
      return '请检查这把 Key：是不是复制少了字符 / 多带了空格换行、是不是在 DeepSeek 平台上被删除或重置、账户是否可用；换一把有效 Key 后重新预览并确认。本应用不会打印或回显 Key，也不会自动重试。'
    case 'balance':
      return '余额问题需要你自行处理；本应用不查询余额、也不会自动重试。'
    case 'model-unavailable':
      return '请改用目录里的当前在售模型——本应用不会静默替你切换模型。'
    case 'rate-limit':
      return '请稍后手动重试（需要重新预览并确认）；本应用不会后台排队。'
    case 'server':
      return '请稍后手动重试（需要重新预览并确认）。'
    default:
      return '请查看开发者工具的网络面板确认细节。'
  }
}

/* ------------------------------------------------------------------ 响应结构 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 严格解析 `chat completion`。
 *
 * 只取 PRD 18.3 允许的字段，**不取 `reasoning_content`**：
 * PRD 16.5 明确「不把 reasoning_content 当最终报告，不默认保存或导出内部推理文本」。
 * 这里连读都不读，从源头避免它被顺手存进历史（AI-5 会再确认一次）。
 */
/**
 * 「HTTP 成功但正文为空」的**分情况诊断**（2026-09-27 深夜，用户第二次真实调用之后加）。
 *
 * ## 为什么不能只说「content 为空」
 *
 * 用户当时的原文提示是「稍后重新预览并确认；若持续为空，请检查模型与参数」——等于没说。
 * 实际上这种响应几乎总能定位到两种原因之一，而且**修法完全不同**：
 *
 * 1. **输出额度被用尽**（`finish_reason === 'length'`）：开了思考模式的模型会先产出一大段推理，
 *    推理内容**同样计入** `max_tokens`。额度花完时 `content` 就是空的。
 *    修法是「关掉思考模式」或「把最长输出调大」，**不是**去调温度、换措辞。
 * 2. **只产出了推理内容**（响应里有 `reasoning_content` / `reasoning_tokens > 0`）：
 *    本应用按要求**不读** `reasoning_content`，因此没有可用结果。
 *    修法是换用不支持思考的模型，或把思考模式设为关闭。
 *
 * 两者都读不到时，才退回原来那句泛泛的提示。
 *
 * ## 关于「不读 reasoning_content」
 *
 * 这里只检查这个字段**在不在**、以及推理 token 的**计数**——不读、不存、不显示它的正文。
 * 计数与字段存在性是元数据，用来帮用户定位问题；正文一旦读了就有被展示或外发的风险。
 */
function emptyContentError(input: {
  readonly finishReason: string | null
  readonly reasoningTokens: number | null
  readonly hasReasoningField: boolean
  readonly completionTokens: number | null
}): AiRequestError {
  const facts: string[] = []
  if (input.finishReason !== null) {
    facts.push(`finish_reason=${input.finishReason}`)
  }
  if (input.completionTokens !== null) {
    facts.push(`本次产出 ${String(input.completionTokens)} tokens`)
  }
  if (input.reasoningTokens !== null) {
    facts.push(`其中推理内容 ${String(input.reasoningTokens)} tokens`)
  }
  const suffix = facts.length === 0 ? '' : `（${facts.join('；')}）`

  if (input.finishReason === 'length') {
    return aiRequestError({
      kind: 'malformed-response',
      message: `模型把输出额度用完了，正文没有产出${suffix}。开了思考模式的模型会先把额度花在推理上，而推理内容与正文共用同一个上限。`,
      advice:
        '把「思考模式」设为关闭、或把「最长输出 max_tokens」调大（例如 8192）后，重新生成预览并确认。',
    })
  }
  if (input.hasReasoningField || (input.reasoningTokens ?? 0) > 0) {
    return aiRequestError({
      kind: 'malformed-response',
      message: `服务端这次只产出了推理（思考）内容，正文为空${suffix}。本应用按要求不读取推理内容，因此没有把推理当结果。`,
      advice:
        '在参数区把「思考模式」设为关闭（或改用不支持思考的模型）后，重新生成预览并确认。',
    })
  }
  return aiRequestError({
    kind: 'malformed-response',
    message: `响应里的 content 为空或缺失，本次没有可用结果（不会把空结果标成成功）${suffix}。`,
    advice:
      '先确认所选模型是否支持思考模式（支持的话建议先设为关闭），必要时把「最长输出 max_tokens」调大；持续为空请换一个模型后重新生成预览并确认。',
  })
}

function parseChatCompletion(parsed: unknown, request: AiSendRequest): AiChatResult {  const root = asRecord(parsed)
  const choices = root?.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    throw aiRequestError({
      kind: 'malformed-response',
      message: '响应里没有 choices，无法得到可用结果。',
      advice: '稍后重新预览并确认。',
    })
  }
  const first = asRecord(choices[0])
  const message = asRecord(first?.message)
  const content = message?.content
  const finishReason = typeof first?.finish_reason === 'string' ? first.finish_reason : null
  const usageRecord = asRecord(root?.usage)
  const details = asRecord(usageRecord?.prompt_tokens_details)
  const completionDetails = asRecord(usageRecord?.completion_tokens_details)
  const promptTokens = numberOrNull(usageRecord?.prompt_tokens)
  const completionTokens = numberOrNull(usageRecord?.completion_tokens)
  const totalTokens = numberOrNull(usageRecord?.total_tokens)
  if (typeof content !== 'string' || content.trim() === '') {
    throw emptyContentError({
      finishReason,
      // 只取**计数**，绝不读 `reasoning_content` 的正文（PRD 18.3：本应用不读推理内容）
      reasoningTokens: numberOrNull(completionDetails?.reasoning_tokens),
      hasReasoningField: message !== null && Object.hasOwn(message, 'reasoning_content'),
      completionTokens,
    })
  }

  const usage =
    promptTokens === null || completionTokens === null || totalTokens === null
      ? null
      : {
          promptTokens,
          completionTokens,
          totalTokens,
          promptCacheHitTokens: numberOrNull(details?.prompt_cache_hit_tokens),
        }

  // 用一次 `finishStatusOf` 确认它是已知取值；未知取值按「不完整」处理而不是当成功
  void finishStatusOf(finishReason)

  return {
    requestHash: request.previewHash,
    requestedModel: request.requestedModel,
    responseModel: typeof root?.model === 'string' ? root.model : null,
    content,
    finishReason,
    usage,
    responseId: typeof root?.id === 'string' ? root.id : null,
  }
}
