/**
 * AI 请求的结果与错误契约（AI-4，docs/PRD.md 18.4）。
 *
 * ## 为什么错误要分成这么多类，而不是一个 `Error`
 *
 * PRD 18.4 的表格逐行规定了不同情形的**用户动作**，而这些动作彼此不同：
 * `401` 要「建议替换 Key」、`402` 要「用户自行处理余额」、`429` 要「稍后手动重试」、
 * 网络失败要「给排查方法但**不硬判**为 CORS」。把它们压成一个字符串会丢掉这些差别，
 * 而「显示什么、能点什么按钮」正是由 `kind` 决定的。
 *
 * ## 两条必须写进类型的边界
 *
 * 1. **绝不自动重试**：本模块没有重试次数字段、没有退避策略，也不导出任何「重试」函数。
 *    用户要重试只能**重新预览并确认**（PRD 18.4「不自动重试、不自动切换」）。
 *    这是**结构上**的保证，不是一句注释。
 * 2. **绝不带 Key 或敏感正文**：`AiRequestError` 的字段里没有 `key` / `authorization` /
 *    `requestBody`；服务端返回的错误正文只提取 `error.code` 与一段**截断**的说明。
 *    整份 HTTP 报文绝不进错误对象（PRD 18.4「不显示整份 HTTP 报文」）。
 */

/** 官方错误码（docs：错误码页）。未列出的码走 `http` 兜底，不猜含义 */
export const AI_ERROR_CODES = [
  'invalid_request_error',
  'authentication_error',
  'insufficient_balance',
  'rate_limit_exceeded',
  'model_not_found',
  'server_error',
] as const
export type AiErrorCode = (typeof AI_ERROR_CODES)[number]

/**
 * 从服务端错误码 / 类型 / HTTP 状态映射到内部种类。
 *
 * ## 判定顺序（2026-09-27 晚修正，来自一次真实用户的失败）
 *
 * 1. **先看三个「状态与语义一一对应」的 HTTP 状态**：`401` → `auth`、`402` → `balance`、
 *    `429` → `rate-limit`。它们不存在歧义；
 * 2. 再看 `error.type`（官方字段，粒度更粗但更贴近语义）；
 * 3. 再看 `error.code`；
 * 4. 最后用其余 HTTP 状态兜底（`400` / `422` → 参数、`404` → 模型、`5xx` → 服务端）。
 *
 * ## 为什么把 `401` 提到 `code` 之前（这是一个真的误诊）
 *
 * DeepSeek 在「Key 无效」时返回的是 **HTTP 401 + `code: "invalid_request_error"`**
 * （`type: "authentication_error"`）。旧顺序是「`code` 优先、状态兜底」，
 * 于是 `invalid_request_error` 先命中，界面告诉用户
 * 「请求参数被服务端拒绝（可能是模型不支持某个参数…）」——**把认证失败说成了参数问题**，
 * 用户会去反复调模型与参数，而真正的原因（Key 无效）藏在同一段文字的服务端说明里。
 * 现在的顺序下，同一个响应会被判成 `auth`，提示与事实一致。
 *
 * 注意这**不是**「状态永远优先」：`422 + insufficient_balance` 这类情形仍按 `type` / `code`
 * 走，只有上述三个状态被提前。
 */
export function errorKindOfCode(
  code: string | null,
  status: number,
  type: string | null = null,
): AiRequestErrorKind {
  if (status === 401) {
    return 'auth'
  }
  if (status === 402) {
    return 'balance'
  }
  if (status === 429) {
    return 'rate-limit'
  }
  // `type` 与 `code` 用同一张映射表，按顺序取第一个认得的（`type` 更贴近语义，`code` 更细）
  for (const signal of [type, code]) {
    switch (signal) {
      case 'authentication_error':
        return 'auth'
      case 'insufficient_balance':
        return 'balance'
      case 'rate_limit_exceeded':
        return 'rate-limit'
      case 'model_not_found':
        return 'model-unavailable'
      case 'invalid_request_error':
        return 'invalid-params'
      case 'server_error':
        return 'server'
      default:
        break
    }
  }
  if (status === 400 || status === 422) {
    return 'invalid-params'
  }
  if (status === 404) {
    return 'model-unavailable'
  }
  if (status >= 500) {
    return 'server'
  }
  return 'http'
}

export type AiRequestErrorKind =
  /** 没有可用 Key（或仓已锁定导致 Key 被清）——**不发请求** */
  | 'no-key'
  /** 还没确认，或确认令牌已失效 / 已被消费——**不发请求** */
  | 'not-confirmed'
  /** 同时已有一次请求在途——**不发第二次** */
  | 'in-flight'
  /** 参数非法（400 / 422 / invalid_request_error） */
  | 'invalid-params'
  /** Key 无效或认证失败（401） */
  | 'auth'
  /** 余额不足（402） */
  | 'balance'
  /** 模型不存在或不可用（model_not_found / 404） */
  | 'model-unavailable'
  /** 请求受限（429） */
  | 'rate-limit'
  /** 服务端错误（5xx） */
  | 'server'
  /** 其他 HTTP 状态 */
  | 'http'
  /** 网络 / 跨域 / TLS / DNS：浏览器通常无法区分根因，因此**只说「可能」** */
  | 'network'
  /** 超时（本地已停止等待；**可能已产生费用**） */
  | 'timeout'
  /** 用户取消（本地已停止等待；**不承诺免收费**） */
  | 'cancelled'
  /** 响应不是 JSON / 结构不符 / 空 content */
  | 'malformed-response'
  /** 响应体超过本地上限 */
  | 'response-too-large'

export type AiRequestError = {
  readonly kind: AiRequestErrorKind
  /** 面向用户的一句话说明（中文，可直接渲染） */
  readonly message: string
  /** HTTP 状态；非 HTTP 失败为 null（**不用 0 冒充**） */
  readonly status: number | null
  /** 官方错误码；取不到为 null */
  readonly code: string | null
  /** 建议的下一步（可能为 null：有些情形没有可靠建议） */
  readonly advice: string | null
}

export function aiRequestError(input: {
  readonly kind: AiRequestErrorKind
  readonly status?: number | null
  readonly code?: string | null
  readonly message: string
  readonly advice?: string | null
}): AiRequestError {
  return {
    kind: input.kind,
    status: input.status ?? null,
    code: input.code ?? null,
    message: input.message,
    advice: input.advice ?? null,
  }
}

/**
 * 结构判定：这个值是不是已经分类好的 `AiRequestError`。
 *
 * 为什么需要一个共用的判定函数：调用链上有**两层** try/catch（适配器内部一层、互斥层一层），
 * 而 HTTP 非 2xx 是在**内层**抛出的、已经分类好的错误（`kind: 'auth'` 等，还带着状态码与错误码）。
 * 内层的兜底若不先认它，就会把 `401` 重新包成「网络失败」，把最有用的分类信息丢掉——
 * 这个 bug 在 AI-4 的测试里被逐条抓出来（`auth` / `balance` / `rate-limit` 全被压成 `network`）。
 */
export function isAiRequestError(value: unknown): value is AiRequestError {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as { kind?: unknown; message?: unknown }
  return typeof record.kind === 'string' && typeof record.message === 'string'
}

/** 成功响应（只保留必要字段；`reasoning_content` 刻意不在其中） */
export type AiChatResult = {
  /** 本次请求对应的预览 hash（用于确认「这一份结果属于哪一次确认」） */
  readonly requestHash: string
  /** 请求时用的模型 ID（用户在预览里看到并批准的那个） */
  readonly requestedModel: string
  /** 服务端返回的模型名（可能是别名解析结果，**与请求的未必相同**） */
  readonly responseModel: string | null
  /** 最终回答正文；空 / 缺失由调用方按「不可用」处理 */
  readonly content: string
  readonly finishReason: string | null
  /** 用量统计（服务端可能不返回，因此可为 null；**不用 0 冒充**） */
  readonly usage: {
    readonly promptTokens: number
    readonly completionTokens: number
    readonly totalTokens: number
    /** 命中上下文缓存的输入 token 数（用于对照费用估算里「按未命中计」的上限假设） */
    readonly promptCacheHitTokens: number | null
  } | null
  /** 服务端返回的请求 id（排障用；不含任何业务内容） */
  readonly responseId: string | null
}

/**
 * `finish_reason` 的分类（PRD 16.5、AI16）。
 *
 * 为什么单独一个函数：`length` / `content_filter` / `insufficient_system_resource` / `aborted`
 * 都意味着**结果不完整或不可用**，而 AI-5 要据此标注「不完整」并**不自动续写**。
 * 判定只此一处，界面不得自己 `=== 'length'`。
 */
export type AiFinishStatus = 'complete' | 'incomplete' | 'failed'

export function finishStatusOf(finishReason: string | null): AiFinishStatus {
  switch (finishReason) {
    case 'stop':
      return 'complete'
    case 'length':
    case 'content_filter':
    case 'insufficient_system_resource':
    case 'aborted':
      return 'incomplete'
    case null:
      // 没给 finish_reason 时不能当成「完整」——那等于替服务端补了一个我们不知道的结论
      return 'incomplete'
    default:
      return 'incomplete'
  }
}

/** `finish_reason` 的中文说明（界面不得再抄一份） */
export const AI_FINISH_REASON_NOTES: Readonly<Record<AiFinishStatus, string>> = {
  complete: '模型自然结束输出。',
  incomplete: '结果不完整：可能是输出达到长度上限、被内容过滤、服务端资源不足或被中断。本应用不会自动续写。',
  failed: '本次没有拿到可用结果。',
}
