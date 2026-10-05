/**
 * AI-4 单测：唯一网络适配器与在途请求管理（`client.ts` / `aiClient.ts`）。
 *
 * ## 这里为什么必须 mock `fetch`，以及 mock 到了什么程度
 *
 * IMPLEMENTATION_PLAN 的注意事项写得很清楚：「默认 mock 测试」「**不**默认用付费 Key」
 * 「真实付费验证仅用户明确操作后用合成摘要，未测标注」。因此本文件用 `vi.stubGlobal`
 * 把 `fetch` 换成一个**记录调用并返回合成响应**的假实现：
 *
 * - 断言的是**发给谁、发了几次、正文是什么、头里有什么**——这些正是 AI01–AI04 / AI11 的验收点；
 * - **没有**任何真实网络请求，也没有任何真实 Key（用的是形状像 Key 的合成串）；
 * - 「真实部署来源能否直连」属于 AI16，**未验证**，本文件不假装验证过。
 *
 * 覆盖的验收点：
 * - AI01：未点击确认时**零请求**；确认后恰好 1 次，且正文与预览一致；
 * - AI02：双击不产生第二次付费请求；
 * - AI03：失败**不自动重试**；修改绑定项后旧确认失效（由 `privacy/aiPreview` 保证，这里验前一层）；
 * - AI11：Key 只在 `Authorization` 头；不进正文、不进错误对象；
 * - 顺带覆盖 PRD 18.4 的取消 / 超时 / 迟到响应 / 错误分类。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildAiPreview, type AiModelParams } from '../privacy/aiPreview'
import { buildSanitizedAiPayload } from '../privacy/aiSummary'
import { resetAiKeySessionForTests, setAiKeySession } from './keySession'
import {
  abortInFlightAiRequest,
  currentAiRequestGeneration,
  hasInFlightAiRequest,
  resetAiRequestStateForTests,
  sendAiRequestOnce,
} from './aiClient'
import {
  AI_RESPONSE_MAX_BYTES,
  aiSendRequestOf,
  sendSanitizedAiRequest,
  type AiSendRequest,
} from './client'
import type { AiRequestError } from './aiResult'

/** 合成的 Key（形状像 Key，但绝不是真实凭据） */
const SYNTHETIC_KEY = 'sk-synthetic-not-a-real-credential-0001'
const SAVED_AT = '2026-09-26T00:00:00.000Z'

const DEFAULT_PARAMS: AiModelParams = {
  model: 'deepseek-flash',
  thinking: 'auto',
  maxTokens: 2048,
  timeoutMs: 60_000,
}

function previewOf(params: Partial<AiModelParams> = {}) {
  const payload = buildSanitizedAiPayload({
    privacyLevel: 'standard',
    scope: {
      rowCount: 12,
      dedupPolicy: '确认后每组保留首条',
      filters: [],
      ruleVersion: '1.0.0',
      dataAsOf: '2026-08-31',
    },
    kpi: {
      total: 12,
      joined: 6,
      pending: 2,
      approving: 2,
      rejectedOffer: 2,
      rejectedVerbally: 0,
      coreDenominator: 10,
    },
    cells: [{ dimension: 'city', key: '上海', total: 12, coreDenominator: 10, rejected: 2 }],
    reasons: [],
    quality: { unknownStatus: 0, missingSalary: 0, unknownSchool: 0 },
    caliberNotes: [],
    generatedAt: '2026-09-26T00:00:00.000Z',
  })
  return buildAiPreview({
    payload,
    caliberNotes: [],
    params: { ...DEFAULT_PARAMS, ...params },
    generatedAt: '2026-09-26T00:00:00.000Z',
  })
}

/** 官方响应形状的合成样例（字段名与文档一致） */
function successBody(): string {
  return JSON.stringify({
    id: 'chatcmpl-synthetic-1',
    object: 'chat.completion',
    created: 1_760_000_000,
    model: 'deepseek-flash',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: '## 核心结论\n合成结果。',
          // 真实响应在思考模式下还会带 reasoning_content；这里刻意带上，
          // 用来证明我们**不会**把它读进结果对象
          reasoning_content: '这是不该被保存的思维链。',
        },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 },
    },
  })
}

type FetchCall = {
  readonly url: string
  readonly init: RequestInit
}

/**
 * 一个「手动结算」的 Promise 控制器。
 *
 * 为什么不用 `let resolve: ((v: Response) => void) | null = null` 再在回调里赋值：
 * TypeScript 的控制流分析会把闭包里的那个变量判成 `never`，于是 `resolve?.(...)`
 * 在**运行时**抛 `TypeError: resolve is not a function`——而适配器会把 `TypeError`
 * 正确地归类成「网络失败」，测试就会得到一个看起来完全无关的失败（分类断言全挂）。
 * 用一个对象持有回调，类型不会塌缩，语义也更清楚。
 */
function deferredResponse() {
  const box: { resolve?: (value: Response) => void; reject?: (reason: unknown) => void } = {}
  const promise = new Promise<Response>((resolve, reject) => {
    box.resolve = resolve
    box.reject = reject
  })
  return { box, promise }
}

/** 装一个记录调用的假 fetch；返回调用记录数组与恢复函数 */
function stubFetch(handler: (call: FetchCall) => Promise<Response> | Response) {
  const calls: FetchCall[] = []
  const fake = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const call: FetchCall = { url: String(input), init: init ?? {} }
    calls.push(call)
    return Promise.resolve(handler(call))
  }
  vi.stubGlobal('fetch', fake)
  return calls
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** 把请求交给适配器（不经过互斥层），用于直接测 adapter 本身 */
function inFlightSink() {
  let handle: { cancel: () => void } | null = null
  return {
    register: (value: { cancel: () => void }) => {
      handle = value
    },
    cancel: () => handle?.cancel(),
  }
}

beforeEach(() => {
  resetAiKeySessionForTests()
  resetAiRequestStateForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------ AI01 */

describe('AI-4 / AI01：未确认时零请求', () => {
  it('没有 Key 时**一次请求都不发**', async () => {
    const calls = stubFetch(() => jsonResponse(successBody()))
    const request = aiSendRequestOf(previewOf())

    await expect(sendSanitizedAiRequest(request, inFlightSink())).rejects.toMatchObject({
      kind: 'no-key',
    })
    expect(calls).toHaveLength(0)
  })

  it('没有 Key 时不构造 URL、不读正文——连 fetch 都不进', async () => {
    const calls = stubFetch(() => jsonResponse(successBody()))
    await sendSanitizedAiRequest(aiSendRequestOf(previewOf()), inFlightSink()).catch(() => undefined)
    expect(calls).toEqual([])
  })
})

/* ------------------------------------------------------------------ 请求形状 */

describe('AI-4：请求按 PRD 18.3 的六条纪律发出', () => {
  it('POST 到预览里的端点，带 Bearer 认证与四项浏览器侧约束', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const calls = stubFetch(() => jsonResponse(successBody()))
    const preview = previewOf()
    const request = aiSendRequestOf(preview)

    const result = await sendSanitizedAiRequest(request, inFlightSink())

    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://api.deepseek.com/chat/completions')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.credentials).toBe('omit')
    expect(call?.init.referrerPolicy).toBe('no-referrer')
    expect(call?.init.redirect).toBe('error')
    expect(call?.init.cache).toBe('no-store')

    const headers = call?.init.headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${SYNTHETIC_KEY}`)
    expect(headers['Content-Type']).toBe('application/json')

    // 正文逐字节等于「预览投影出来的正文」
    expect(call?.init.body).toBe(request.body)
    expect(result.requestHash).toBe(preview.hash)
    expect(result.requestedModel).toBe('deepseek-flash')
  })

  it('Key 只出现在 Authorization 头：不在 URL、不在正文、不在其他头', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const calls = stubFetch(() => jsonResponse(successBody()))
    await sendSanitizedAiRequest(aiSendRequestOf(previewOf()), inFlightSink())

    const call = calls[0]
    expect(call?.url).not.toContain(SYNTHETIC_KEY)
    expect(String(call?.init.body)).not.toContain(SYNTHETIC_KEY)

    const headers = call?.init.headers as Record<string, string>
    // 只有 Authorization 头里那一处；其余头（Content-Type 等）里没有 Key
    for (const [name, value] of Object.entries(headers)) {
      if (name === 'Authorization') {
        expect(value).toBe(`Bearer ${SYNTHETIC_KEY}`)
      } else {
        expect(value).not.toContain(SYNTHETIC_KEY)
      }
    }
    expect(Object.keys(headers).sort()).toEqual(['Authorization', 'Content-Type'])
  })

  it('成功时只取必要字段，**不读 reasoning_content**（PRD 16.5）', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() => jsonResponse(successBody()))

    const result = await sendSanitizedAiRequest(aiSendRequestOf(previewOf()), inFlightSink())

    expect(result.content).toContain('核心结论')
    expect(result.responseModel).toBe('deepseek-flash')
    expect(result.finishReason).toBe('stop')
    expect(result.usage).toMatchObject({ promptTokens: 100, totalTokens: 120 })
    expect(result.responseId).toBe('chatcmpl-synthetic-1')
    // 思维链绝不进结果对象
    expect(JSON.stringify(result)).not.toContain('思维链')
  })
})

/* ------------------------------------------------------------------ 令牌与互斥 */

describe('AI-4 / AI02：确认恰好一次，双击不双付费', () => {
  it('互斥生效：第二次调用被拒且**不发第二次请求**', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const gate = deferredResponse()
    const calls = stubFetch(() => gate.promise)

    const request = aiSendRequestOf(previewOf())
    const first = sendAiRequestOnce(request)
    // 第一次在途时立刻发第二次
    const second = await sendAiRequestOnce(request)

    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.error.kind).toBe('in-flight')
      expect(second.error.advice ?? '').toContain('不会后台排队')
    }
    expect(calls).toHaveLength(1)

    gate.box.resolve?.(jsonResponse(successBody()))
    const settled = await first
    expect(settled.ok).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it('请求结束后互斥释放（可以再发一次新的确认）', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const calls = stubFetch(() => jsonResponse(successBody()))

    await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(hasInFlightAiRequest()).toBe(false)
    await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(calls).toHaveLength(2)
  })
})

/* ------------------------------------------------------------------ 失败不重试 */

describe('AI-4 / AI03：失败绝不自动重试', () => {
  it('401 只发一次，返回分类后的错误，不重试', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const calls = stubFetch(() =>
      jsonResponse(JSON.stringify({ error: { code: 'authentication_error', message: 'invalid key' } }), 401),
    )

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))

    expect(calls).toHaveLength(1)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('auth')
      expect(outcome.error.status).toBe(401)
      expect(outcome.error.code).toBe('authentication_error')
      expect(outcome.error.advice ?? '').toContain('Key')
      expect(outcome.error.advice ?? '').toContain('不会自动重试')
    }
  })

  /*
   * 真实发生过的误诊（2026-09-27 晚，用户拿一把无效 Key 试了一次）：
   * DeepSeek 对「Key 无效」返回的是 **HTTP 401 + `code: "invalid_request_error"`**
   * （`type: "authentication_error"`）。旧实现「`code` 优先」，于是把它判成
   * 「请求参数被服务端拒绝（可能是模型不支持某个参数…）」——**认证失败被说成参数问题**。
   * 这条用例用服务端真实返回的**形状**（Key 掩码用合成值）钉住正确分类。
   */
  it('401 + code=invalid_request_error + type=authentication_error：必须报认证失败，不是参数问题', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const calls = stubFetch(() =>
      jsonResponse(
        JSON.stringify({
          error: {
            message: 'Authentication Fails, Your api key: ****0000 is invalid',
            type: 'authentication_error',
            param: null,
            code: 'invalid_request_error',
          },
        }),
        401,
      ),
    )

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))

    expect(calls).toHaveLength(1)
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('auth')
      expect(outcome.error.message).toContain('认证失败')
      // 不许再出现「参数」这种会让用户去乱调模型的诊断
      expect(outcome.error.message).not.toContain('参数被服务端拒绝')
      expect(outcome.error.advice ?? '').not.toContain('检查模型与参数')
      // 服务端说明照旧带回来（用户正是靠它看懂原因的），但必须被截断
      expect(outcome.error.message).toContain('is invalid')
    }
  })

  it('5xx 也只发一次（不自动重试、不换端点）', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const calls = stubFetch(() => jsonResponse(JSON.stringify({ error: { code: 'server_error' } }), 500))

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))

    expect(calls).toHaveLength(1)
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('server')
      expect(outcome.error.advice ?? '').toContain('手动重试')
    }
  })

  it('错误对象里没有 Key、没有请求正文、没有整份 HTTP 报文', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() =>
      jsonResponse(
        JSON.stringify({
          error: {
            code: 'invalid_request_error',
            // 服务端可能回一段很长的说明：必须被截断后带回，且不含我们的 Key
            message: `bad params ${'x'.repeat(500)}`,
          },
        }),
        400,
      ),
    )

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      const serialized = JSON.stringify(outcome.error)
      expect(serialized).not.toContain(SYNTHETIC_KEY)
      expect(serialized).not.toContain('Bearer')
      // 说明被截断（不把整份报文搬进界面）
      expect((outcome.error.message ?? '').length).toBeLessThan(400)
    }
  })
})

/* ------------------------------------------------------------------ 错误分类 */

describe('AI-4：错误分类逐条对应 PRD 18.4', () => {
  const cases: readonly { readonly status: number; readonly code: string | null; readonly kind: string }[] = [
    { status: 400, code: 'invalid_request_error', kind: 'invalid-params' },
    { status: 401, code: 'authentication_error', kind: 'auth' },
    { status: 402, code: 'insufficient_balance', kind: 'balance' },
    { status: 404, code: 'model_not_found', kind: 'model-unavailable' },
    { status: 429, code: 'rate_limit_exceeded', kind: 'rate-limit' },
    { status: 500, code: 'server_error', kind: 'server' },
    { status: 503, code: null, kind: 'server' },
    { status: 418, code: null, kind: 'http' },
  ]

  for (const item of cases) {
    it(`${String(item.status)} / ${item.code ?? '（无码）'} → ${item.kind}`, async () => {
      setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
      stubFetch(() =>
        jsonResponse(
          JSON.stringify(item.code === null ? { error: {} } : { error: { code: item.code } }),
          item.status,
        ),
      )

      const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.error.kind).toBe(item.kind)
      }
    })
  }

  it('`TypeError` 只报「网络可能失败」，**不硬判 CORS**', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() => {
      throw new TypeError('Failed to fetch')
    })

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('network')
      // 只说「可能」，且把三种根因并列举出，不把跨域写成唯一结论
      expect(outcome.error.message).toContain('可能')
      expect(outcome.error.message).toContain('跨域')
      // 不允许出现断言式的根因判定
      for (const hardClaim of ['CORS 失败', '是跨域问题', '跨域导致', '确认是跨域']) {
        expect(outcome.error.message).not.toContain(hardClaim)
      }
      expect(outcome.error.advice ?? '').toContain('开发者工具')
    }
  })

  it('非 JSON 响应报 malformed-response，不会把错误 HTML 当报告', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() => new Response('<html>502 Bad Gateway</html>', { status: 200 }))

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('malformed-response')
      expect(outcome.error.message).not.toContain('<html>')
    }
  })

  it('choices 为空 / content 为空都按异常处理，不标成成功', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() => jsonResponse(JSON.stringify({ choices: [] })))
    const empty = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(empty.ok).toBe(false)

    stubFetch(() =>
      jsonResponse(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '   ' } }] })),
    )
    const blank = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(blank.ok).toBe(false)
    if (!blank.ok) {
      expect(blank.error.kind).toBe('malformed-response')
    }
  })

  it('响应体超过本地上限时拒绝解析并明确报出', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const huge = 'x'.repeat(AI_RESPONSE_MAX_BYTES + 100)
    stubFetch(() => new Response(huge, { status: 200, headers: { 'Content-Length': String(huge.length) } }))

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('response-too-large')
    }
  })

  /*
   * 「HTTP 成功但正文为空」的分情况诊断（2026-09-27 深夜，用户第二次真实调用之后加）。
   * 用户当时拿的是「思考模式默认为开启」的模型 + max_tokens 2048：推理把额度吃光，
   * 正文为空，而提示只说「请检查模型与参数」——等于没告诉他该改哪里。
   */
  it('正文为空且 finish_reason=length：指出输出额度被用尽，并给出「关思考模式 / 调大上限」', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() =>
      jsonResponse(
        JSON.stringify({
          choices: [{ finish_reason: 'length', message: { content: '' } }],
          usage: {
            prompt_tokens: 900,
            completion_tokens: 2048,
            total_tokens: 2948,
            completion_tokens_details: { reasoning_tokens: 2010 },
          },
        }),
      ),
    )

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.kind).toBe('malformed-response')
      expect(outcome.error.message).toContain('额度用完了')
      // 把事实带出来：finish_reason 与 token 计数（只有计数，没有推理正文）
      expect(outcome.error.message).toContain('finish_reason=length')
      expect(outcome.error.message).toContain('2048')
      expect(outcome.error.advice ?? '').toContain('思考模式')
      expect(outcome.error.advice ?? '').toContain('max_tokens')
    }
  })

  it('正文为空但有推理内容：说明「本应用不读推理内容」，并建议关闭思考模式', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() =>
      jsonResponse(
        JSON.stringify({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: '', reasoning_content: '（推理正文不应被读取或展示）' },
            },
          ],
        }),
      ),
    )

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error.message).toContain('推理')
      expect(outcome.error.message).toContain('不读取推理内容')
      // 推理正文绝不能出现在错误对象里（只报字段存在与否）
      expect(JSON.stringify(outcome.error)).not.toContain('不应被读取')
      expect(outcome.error.advice ?? '').toContain('思考模式')
    }
  })
})

/* ------------------------------------------------------------------ 取消与超时 */

describe('AI-4：取消与超时都丢弃迟到结果', () => {
  it('取消后报 cancelled，且明说「不承诺服务端未处理、也不承诺免收费」', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const gate = deferredResponse()
    stubFetch(() => gate.promise)

    const sink = inFlightSink()
    const pending = sendSanitizedAiRequest(aiSendRequestOf(previewOf()), sink)
    // 让 fetch 真正开始
    await Promise.resolve()
    sink.cancel()
    gate.box.reject?.(new DOMException('aborted', 'AbortError'))

    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' })
    await pending.catch((error: AiRequestError) => {
      expect(error.message).toContain('不承诺')
    })
  })

  it('超时报 timeout，并提示「可能已产生费用」', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    vi.useFakeTimers()
    try {
      const gate = deferredResponse()
      stubFetch(() => gate.promise)

      const request: AiSendRequest = { ...aiSendRequestOf(previewOf()), timeoutMs: 1_000 }
      const pending = sendSanitizedAiRequest(request, inFlightSink())
      // 让定时器有机会挂上
      await Promise.resolve()
      vi.advanceTimersByTime(1_001)
      gate.box.reject?.(new DOMException('aborted', 'AbortError'))

      await expect(pending).rejects.toMatchObject({ kind: 'timeout' })
      await pending.catch((error: AiRequestError) => {
        expect(error.message).toContain('可能已产生费用')
      })
    } finally {
      vi.useRealTimers()
    }
  })
})

/* ------------------------------------------------------------------ 迟到响应 */

describe('AI-4：锁定 / 清空后迟到响应作废', () => {
  it('世代号推进后，回写的响应被判为「不属当前世代」', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const gate = deferredResponse()
    stubFetch(() => gate.promise)

    const pending = sendAiRequestOnce(aiSendRequestOf(previewOf()))
    await Promise.resolve()

    // 期间本地仓被锁定：中止在途请求并推进世代号
    const generation = abortInFlightAiRequest()
    expect(generation).toBeGreaterThan(0)
    expect(hasInFlightAiRequest()).toBe(false)

    gate.box.resolve?.(jsonResponse(successBody()))
    const outcome = await pending

    // 请求可能已经拿到响应（abort 是异步的），但 `current === false` 让调用方必须丢弃
    expect(outcome.current).toBe(false)
    expect(generation).toBe(currentAiRequestGeneration())
  })

  it('没有发生任何中止时，结果是「当前世代」（不会把所有结果都判成迟到）', async () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    stubFetch(() => jsonResponse(successBody()))

    const outcome = await sendAiRequestOnce(aiSendRequestOf(previewOf()))
    expect(outcome.ok).toBe(true)
    expect(outcome.current).toBe(true)
  })
})
