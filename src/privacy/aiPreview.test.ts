/**
 * AI 完整预览与一次性确认测试（AI-1，docs/PRD.md 16.2 / 17.3 / 18.4）。
 *
 * 这一组钉的是「用户到底批准了什么」这件事：
 * - 预览必须**完整**（JSON / system / messages / 参数 / 目的地 / 脱敏说明都要在），
 *   否则「逐次确认」没有意义；
 * - 预览与发送必须**共用同一份序列化文本**，否则「预览看到的」与「实际发出去的」可能不同；
 * - 参数或内容一变，旧确认**立即失效**且必须重新预览（对应 AI03 / AI09）；
 * - 确认令牌**只能消费一次**（对应 AI02：双击不产生第二次付费请求）。
 *
 * 本文件不涉及任何网络：AI-1 明确「不接真实网络」，确认只走到令牌消费为止。
 */

import { describe, expect, it } from 'vitest'

import {
  AI_DEFAULT_DESTINATION,
  AI_DEFAULT_PARAMS,
  AI_PROMPT_VERSION,
  AI_SYSTEM_PROMPT,
  EMPTY_CONFIRMATION,
  buildAiPreview,
  buildUserPrompt,
  confirmPreview,
  consumeConfirmation,
  isPreviewStale,
  previewHashOf,
  type AiPreviewInput,
} from './aiPreview'
import { AI_SUMMARY_SCHEMA_VERSION, buildSanitizedAiPayload, type AiSourceCell } from './aiSummary'

const CELLS: readonly AiSourceCell[] = [
  { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
  { dimension: 'channel', key: 'Boss', total: 40, coreDenominator: 18, rejected: 6 },
  { dimension: 'recruiter', key: '合成HR-乙', recruiterCode: 'HR-1', total: 40, coreDenominator: 18, rejected: 6 },
]

function payloadFor(privacyLevel: 'strict' | 'standard' | 'custom' = 'standard') {
  return buildSanitizedAiPayload({
    privacyLevel,
    scope: {
      rowCount: 128,
      dedupPolicy: '确认后每组保留首条',
      filters: ['城市：上海'],
      ruleVersion: '1.0.0+3F2A19C4',
      dataAsOf: '2026-08-31',
    },
    kpi: { total: 128, joined: 41, pending: 9, approving: 6, rejectedOffer: 5, rejectedVerbally: 2, coreDenominator: 57 },
    cells: CELLS,
    reasons: [{ category: '薪酬', count: 5 }],
    quality: { unknownStatus: 0, missingSalary: 21, unknownSchool: 3 },
    caliberNotes: ['D = 已入职 + 待入职 + 拒绝 offer'],
    generatedAt: '2026-09-26T10:00:00.000Z',
  })
}

function previewInput(overrides: Partial<AiPreviewInput> = {}): AiPreviewInput {
  return {
    payload: payloadFor(),
    caliberNotes: ['D = 已入职 + 待入职 + 拒绝 offer'],
    generatedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  }
}

describe('预览必须完整', () => {
  it('包含完整 JSON、system 与 messages、模型参数、目的地、脱敏说明与体积', () => {
    const preview = buildAiPreview(previewInput())

    // 完整 JSON：与 payload 逐字对应
    expect(preview.payloadJson).toBe(JSON.stringify(preview.payload, null, 2))
    expect(JSON.parse(preview.payloadJson)).toEqual(JSON.parse(JSON.stringify(preview.payload)))
    expect(preview.schemaVersion).toBe(AI_SUMMARY_SCHEMA_VERSION)
    expect(preview.promptVersion).toBe(AI_PROMPT_VERSION)

    // system 与 user 原文都在
    expect(preview.messages.map((message) => message.role)).toEqual(['system', 'user'])
    expect(preview.messages[0].content).toBe(AI_SYSTEM_PROMPT)
    expect(preview.messages[1].content).toContain('```json')
    expect(preview.messages[1].content).toContain('metricId')

    // 模型参数与目的地
    expect(preview.params).toEqual(AI_DEFAULT_PARAMS)
    expect(preview.destination).toEqual(AI_DEFAULT_DESTINATION)

    // 脱敏说明逐条在，且包含两条关键约束
    expect(preview.desensitizeNotes.length).toBeGreaterThanOrEqual(6)
    const joined = preview.desensitizeNotes.map((note) => `${note.label}|${note.detail}`).join('\n')
    expect(joined).toContain('白名单重建')
    expect(joined).toContain('小样本抑制')
    expect(joined).toContain('不发送原始行')

    // 体积与 JSON 字节数一致
    expect(preview.contentBytes).toBe(new TextEncoder().encode(preview.payloadJson).length)
  })

  it('预览与发送共用同一份序列化文本（不是各自 stringify 一次）', () => {
    const preview = buildAiPreview(previewInput())
    // user message 里嵌的就是 payloadJson 本身，逐字相同
    expect(preview.messages[1].content).toContain(preview.payloadJson)
  })

  it('预览里不出现任何认证头或 Key 字段（Key 是 AI-3 的事，且永不进预览）', () => {
    const preview = buildAiPreview(previewInput())
    const serialized = JSON.stringify(preview)
    for (const forbidden of ['Authorization', 'Bearer', 'apiKey', 'api_key', 'sk-']) {
      expect(serialized.includes(forbidden), `预览里出现了 ${forbidden}`).toBe(false)
    }
  })

  it('目的地只有唯一端点（没有代理、没有第二个域名）', () => {
    const preview = buildAiPreview(previewInput())
    expect(preview.destination.origin).toBe('https://api.deepseek.com')
    expect(preview.destination.path).toBe('/chat/completions')
  })
})

describe('提示词内容符合 PRD 17.3 的约束', () => {
  it('system 与 user 提示词里没有 Markdown 强调标记（会逐字渲染进预览）', () => {
    /*
     * 这条是本项目反复踩过的坑：提示词与界面文案是**纯文本渲染**，
     * 写成 `**重点**` 只会在预览面板里显示成一对星号。
     * 提示词与界面文案在这一点上要求一致，因此在引擎侧也钉一条。
     */
    const preview = buildAiPreview(previewInput())
    for (const message of preview.messages) {
      expect(message.content.includes('**'), `${message.role} 提示词含 **`).toBe(false)
      expect(message.content.includes('__'), `${message.role} 提示词含 __`).toBe(false)
    }
  })

  it('user 提示词说「聚合脱敏摘要」用的是无标记写法', () => {
    const prompt = buildUserPrompt(payloadFor(), ['口径'])
    expect(prompt).toContain('聚合脱敏摘要')
  })
  it('system 提示词写明六条硬约束', () => {
    for (const requirement of [
      '只能使用用户提供的聚合指标',
      '不得编造数字',
      '组内构成',
      '特征内率',
      '样本不足时只做描述',
      '不得输出个人拒 offer 概率',
      '不得基于学校、学历',
      '数据限制',
    ]) {
      expect(AI_SYSTEM_PROMPT.includes(requirement), `system 缺约束：${requirement}`).toBe(true)
    }
  })

  it('user 提示词附上本地口径说明，并提醒 D 与 N 的分母不同', () => {
    const prompt = buildUserPrompt(payloadFor(), ['D = 已入职 + 待入职 + 拒绝 offer'])
    expect(prompt).toContain('D = 已入职 + 待入职 + 拒绝 offer')
    expect(prompt).toContain('审批中')
    expect(prompt).toContain('分母')
  })
})

describe('hash 与旧确认失效（AI03 / AI09）', () => {
  it('同一份输入重复构造得到相同 hash 与相同 JSON', () => {
    const first = buildAiPreview(previewInput())
    const second = buildAiPreview(previewInput())
    expect(first.hash).toBe(second.hash)
    expect(first.payloadJson).toBe(second.payloadJson)
  })

  it('generatedAt 不参与 hash（只是展示时间，不该让「内容没变」被判成变了）', () => {
    const early = buildAiPreview(previewInput({ generatedAt: '2026-09-26T10:00:00.000Z' }))
    const late = buildAiPreview(previewInput({ generatedAt: '2026-09-27T18:30:00.000Z' }))
    expect(late.hash).toBe(early.hash)
  })

  it('隐私级别变化 → hash 变化 → 旧预览被判定为过期', () => {
    const standard = buildAiPreview(previewInput())
    const strict = buildAiPreview(previewInput({ payload: payloadFor('strict') }))
    expect(strict.hash).not.toBe(standard.hash)
    expect(isPreviewStale(standard, strict.hash)).toBe(true)
    expect(isPreviewStale(standard, standard.hash)).toBe(false)
  })

  it('模型参数变化 → hash 变化（参数也是「用户批准的内容」的一部分）', () => {
    const base = buildAiPreview(previewInput())
    const warmer = buildAiPreview(
      previewInput({ params: { ...AI_DEFAULT_PARAMS, temperature: 0.7 } }),
    )
    const longer = buildAiPreview(
      previewInput({ params: { ...AI_DEFAULT_PARAMS, maxTokens: 4096 } }),
    )
    const otherModel = buildAiPreview(
      previewInput({ params: { ...AI_DEFAULT_PARAMS, model: 'deepseek-reasoner' } }),
    )
    for (const changed of [warmer, longer, otherModel]) {
      expect(changed.hash).not.toBe(base.hash)
    }
  })

  it('目的地变化 → hash 变化（避免「确认了 A 端点却发往 B」）', () => {
    const base = buildAiPreview(previewInput())
    const other = buildAiPreview(
      previewInput({ destination: { origin: 'https://example.invalid', path: '/v1/chat' } }),
    )
    expect(other.hash).not.toBe(base.hash)
  })

  it('载荷内容变化 → hash 变化', () => {
    const base = buildAiPreview(previewInput())
    const changedPayload = buildSanitizedAiPayload({
      privacyLevel: 'standard',
      scope: {
        rowCount: 999,
        dedupPolicy: '确认后每组保留首条',
        filters: ['城市：上海'],
        ruleVersion: '1.0.0+3F2A19C4',
        dataAsOf: '2026-08-31',
      },
      kpi: {
        total: 999,
        joined: 41,
        pending: 9,
        approving: 6,
        rejectedOffer: 5,
        rejectedVerbally: 2,
        coreDenominator: 57,
      },
      cells: CELLS,
      reasons: [],
      quality: { unknownStatus: 0, missingSalary: 21, unknownSchool: 3 },
      caliberNotes: [],
      generatedAt: '2026-09-26T10:00:00.000Z',
    })
    expect(buildAiPreview(previewInput({ payload: changedPayload })).hash).not.toBe(base.hash)
  })

  it('previewHashOf 是稳定且区分度足够的 8 位大写十六进制', () => {
    expect(previewHashOf('abc')).toBe(previewHashOf('abc'))
    expect(previewHashOf('abc')).not.toBe(previewHashOf('abd'))
    expect(previewHashOf('')).toMatch(/^[0-9A-F]{8}$/)
  })
})

describe('一次性确认令牌（AI02 / AI03）', () => {
  it('未确认时不能消费', () => {
    const preview = buildAiPreview(previewInput())
    const result = consumeConfirmation(EMPTY_CONFIRMATION, preview.hash)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('尚未确认')
    }
  })

  it('确认后恰好消费一次；第二次消费被拒绝（防双击重复计费）', () => {
    const preview = buildAiPreview(previewInput())
    const confirmed = confirmPreview(preview.hash, '2026-09-26T10:01:00.000Z')

    const first = consumeConfirmation(confirmed, preview.hash)
    expect(first.ok).toBe(true)

    const second = consumeConfirmation(first.ok ? first.state : confirmed, preview.hash)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.reason).toContain('已被使用')
    }
  })

  it('参数变化后，旧确认与新 hash 不匹配 → 拒绝发送', () => {
    const oldPreview = buildAiPreview(previewInput())
    const confirmed = confirmPreview(oldPreview.hash, '2026-09-26T10:01:00.000Z')
    // 用户随后改了温度：重新生成预览，hash 变了
    const newPreview = buildAiPreview(
      previewInput({ params: { ...AI_DEFAULT_PARAMS, temperature: 0.9 } }),
    )

    const result = consumeConfirmation(confirmed, newPreview.hash)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('已失效')
    }
  })

  it('消费成功只返回新状态，不产生任何副作用（本层不发请求）', () => {
    const preview = buildAiPreview(previewInput())
    const confirmed = confirmPreview(preview.hash, '2026-09-26T10:01:00.000Z')
    const result = consumeConfirmation(confirmed, preview.hash)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.state.consumed).toBe(true)
      expect(result.state.token?.hash).toBe(preview.hash)
    }
  })
})
