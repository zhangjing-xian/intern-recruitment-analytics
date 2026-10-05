/**
 * AI-4 单测：请求正文的构造（`src/ai/aiRequest.ts`）。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-4 的这几条：
 * - 「POST 官方 chat/completions、纯文本 messages、stream=false」→ 正文形状逐字段断言；
 * - 「正文与预览一致」→ 正文只由预览投影，且不含预览外的任何字段；
 * - 「不静默替换模型」→ 正文里的 model 就是预览里批准的那个；
 * - 「AI11」→ 正文里没有 Key / Authorization 的位置。
 *
 * 官方参数形状依据 2026-09-26 核实的《Chat Completions API》文档
 * （`thinking` 是对象且默认 `enabled`；`reasoning_effort` 取值 `none|low|high|max`）。
 */

import { describe, expect, it } from 'vitest'

import { buildAiPreview, type AiModelParams } from '../privacy/aiPreview'
import { buildSanitizedAiPayload } from '../privacy/aiSummary'
import {
  buildAiRequestBody,
  requestBodyOf,
  serializeRequestBody,
  type AiRequestMessage,
} from './aiRequest'

const MESSAGES: readonly AiRequestMessage[] = [
  { role: 'system', content: '你是招聘数据复盘助手。' },
  { role: 'user', content: '{"kpi":{"N":10}}' },
]

function paramsOf(overrides: Partial<AiModelParams> = {}): AiModelParams {
  return { model: 'deepseek-flash', thinking: 'auto', maxTokens: 2048, timeoutMs: 60_000, ...overrides }
}

/** 造一份真实预览（走 AI-1/AI-2 的构造器，避免手写形状） */
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
    caliberNotes: ['N = 全部保留记录（含审批中）。'],
    generatedAt: '2026-09-26T00:00:00.000Z',
  })
  return buildAiPreview({
    payload,
    caliberNotes: ['N = 全部保留记录（含审批中）。'],
    params: paramsOf(params),
    generatedAt: '2026-09-26T00:00:00.000Z',
  })
}

describe('AI-4：正文形状与官方契约一致', () => {
  it('必填字段在场，且只允许官方定义的字段出现', () => {
    const body = requestBodyOf(paramsOf(), MESSAGES)
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream'])
    expect(body.stream).toBe(false)
    expect(body.model).toBe('deepseek-flash')
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]?.role).toBe('system')
  })

  it('messages 只有 role 与 content（不发 name / tool_call_id / 附件）', () => {
    const body = requestBodyOf(paramsOf(), MESSAGES)
    for (const message of body.messages) {
      expect(Object.keys(message).sort()).toEqual(['content', 'role'])
    }
  })

  it('`thinking: auto` 时**不带** thinking 字段（不是带一个默认值）', () => {
    const body = requestBodyOf(paramsOf({ thinking: 'auto' }), MESSAGES)
    expect('thinking' in body).toBe(false)
  })

  it('`thinking: enabled` / `disabled` 转成官方要求的对象形状', () => {
    expect(requestBodyOf(paramsOf({ thinking: 'enabled' }), MESSAGES).thinking).toEqual({
      type: 'enabled',
    })
    expect(requestBodyOf(paramsOf({ thinking: 'disabled' }), MESSAGES).thinking).toEqual({
      type: 'disabled',
    })
  })

  it('思考模式关闭时**不发送** reasoning_effort（它只对思考模式有意义）', () => {
    const body = requestBodyOf(
      paramsOf({ thinking: 'disabled', reasoningEffort: 'high' }),
      MESSAGES,
    )
    expect('reasoning_effort' in body).toBe(false)
  })

  it('思考模式开启时才发送 reasoning_effort，且**绝不**发 `none`', () => {
    const body = requestBodyOf(paramsOf({ thinking: 'enabled', reasoningEffort: 'max' }), MESSAGES)
    expect(body.reasoning_effort).toBe('max')
    // 关闭思考模式由 thinking.type 表达；reasoning_effort 不发 none，避免两个字段互相矛盾
    expect(JSON.stringify(body)).not.toContain('"none"')
  })

  it('思考模式下不发送 temperature（官方：不报错也不生效）', () => {
    const body = requestBodyOf(paramsOf({ thinking: 'enabled', temperature: 0.7 }), MESSAGES)
    expect('temperature' in body).toBe(false)
  })

  it('非思考模式下 temperature 正常发送', () => {
    const body = requestBodyOf(paramsOf({ thinking: 'disabled', temperature: 0.7 }), MESSAGES)
    expect(body.temperature).toBe(0.7)
  })

  it('top_p 只在思考模式**明确开启**时发送（auto 时保守不发）', () => {
    expect('top_p' in requestBodyOf(paramsOf({ thinking: 'auto', topP: 0.95 }), MESSAGES)).toBe(false)
    expect(
      requestBodyOf(paramsOf({ thinking: 'disabled', topP: 0.95 }), MESSAGES).top_p,
    ).toBeUndefined()
    expect(requestBodyOf(paramsOf({ thinking: 'enabled', topP: 0.95 }), MESSAGES).top_p).toBe(0.95)
  })

  it('不发 tools / response_format / stop / user_id（只发预览过的内容）', () => {
    const serialized = serializeRequestBody(requestBodyOf(paramsOf(), MESSAGES))
    for (const forbidden of ['tools', 'response_format', 'stop', 'user_id', 'stream_options']) {
      expect(serialized).not.toContain(`"${forbidden}"`)
    }
  })

  it('正文里没有 Key 的任何位置（AI11）', () => {
    const serialized = serializeRequestBody(requestBodyOf(paramsOf(), MESSAGES))
    for (const forbidden of ['Authorization', 'Bearer', 'api_key', 'apiKey', 'sk-']) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})

describe('AI-4：正文只由预览投影出来', () => {
  it('模型就是预览里批准的那个（不静默替换）', () => {
    const preview = previewOf({ model: 'deepseek-v4-pro' })
    const body = buildAiRequestBody(preview)
    expect(body.model).toBe('deepseek-v4-pro')
    expect(body.model).toBe(preview.params.model)
  })

  it('messages 与预览逐字一致（预览展示的就是要发的）', () => {
    const preview = previewOf()
    const body = buildAiRequestBody(preview)
    expect(body.messages).toEqual(
      preview.messages.map((message) => ({ role: message.role, content: message.content })),
    )
  })

  it('用户消息里带着载荷 JSON（与预览面板逐字渲染的是同一份文本）', () => {
    const preview = previewOf()
    const body = buildAiRequestBody(preview)
    const userMessage = body.messages.find((message) => message.role === 'user')
    expect(userMessage?.content).toContain(preview.payloadJson.trim().split('\n')[0] ?? '')
    expect(userMessage?.content).toContain('```json')
  })

  it('同一份预览两次构造得到逐字节相同的正文（同输入同产物）', () => {
    const preview = previewOf({ thinking: 'enabled', reasoningEffort: 'high' })
    expect(serializeRequestBody(buildAiRequestBody(preview))).toBe(
      serializeRequestBody(buildAiRequestBody(preview)),
    )
  })

  it('参数变化会改变正文（这是「正文与预览绑定」的前提）', () => {
    const base = serializeRequestBody(buildAiRequestBody(previewOf({ maxTokens: 2048 })))
    const changed = serializeRequestBody(buildAiRequestBody(previewOf({ maxTokens: 4096 })))
    expect(changed).not.toBe(base)
  })

  it('`max_tokens` 用官方字段名（不是 maxTokens）', () => {
    const preview = previewOf({ maxTokens: 3072 })
    const body = buildAiRequestBody(preview)
    expect(body.max_tokens).toBe(3072)
    expect(JSON.stringify(body)).not.toContain('"maxTokens"')
  })
})
