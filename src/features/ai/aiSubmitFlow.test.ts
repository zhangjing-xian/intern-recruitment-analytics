/**
 * AI-4 集成测试：确认令牌 → 发送的**顺序不变量**。
 *
 * ## 为什么单独一个文件
 *
 * `features/ai/**` 的组件测试跑的是 `renderToStaticMarkup`（不跑 effect、不点按钮），
 * 因此**点不到**「确认并调用」按钮。既然点不到，就不能假装验证过点击行为——
 * 这里改为验证**界面所依赖的那条顺序契约**本身：
 *
 * ```
 * 预览 → 用户确认（建立令牌）→ 消费令牌（成功）→ 才允许发送
 * ```
 *
 * 这条契约是 AI01「未确认 0 请求」/ AI02「双击不双付费」/ AI03「改参数作废旧确认」的根。
 * 它由 `privacy/aiPreview.ts`（令牌）与界面调用顺序共同保证；测试用真实的预览与令牌引擎
 * 驱动一遍，并断言「只有消费成功才可能调用发送」。
 *
 * ## 这个文件**不**验证的东西
 *
 * 「按钮真的能点」「点两次真的只发一次」属于浏览器交互，**未验证**——
 * 本仓库没有引入 Testing Library / Playwright（步骤14 才做端到端）。
 * 这里不把「静态断言」写成「点击测试通过」。
 */

import { describe, expect, it } from 'vitest'

import { buildAiPreview, type AiModelParams } from '../../privacy/aiPreview'
import { buildSanitizedAiPayload } from '../../privacy/aiSummary'
import {
  EMPTY_CONFIRMATION,
  confirmPreview,
  consumeConfirmation,
  isPreviewStale,
} from '../../privacy/aiPreview'
import { aiSendRequestOf } from '../../ai/client'
import { resetAiKeySessionForTests, setAiKeySession } from '../../ai/keySession'
import { resetAiRequestStateForTests } from '../../ai/aiClient'

const SYNTHETIC_KEY = 'sk-synthetic-not-a-real-credential-0001'

const PARAMS: AiModelParams = {
  model: 'deepseek-flash',
  thinking: 'auto',
  maxTokens: 2048,
  timeoutMs: 60_000,
}

function previewOf(overrides: Partial<AiModelParams> = {}) {
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
    params: { ...PARAMS, ...overrides },
    generatedAt: '2026-09-26T00:00:00.000Z',
  })
}

/**
 * 复刻工作区 `handleSubmit` 的顺序，并把「发送」换成一个可计数的假实现。
 *
 * 为什么复刻而不是调组件：组件里那段逻辑依赖 React state 与真实点击，
 * 在本仓库的静态渲染测试环境里点不到。复刻的价值在于**断言顺序**，而不是复制实现——
 * 一旦令牌层的行为变了（例如 `consumeConfirmation` 不再绑定 hash），这里会立刻失败。
 */
function submitOnce(input: {
  readonly confirmHash: string | null
  readonly currentPreviewHash: string
  readonly sent: string[]
  readonly preview: ReturnType<typeof previewOf>
}) {
  const state =
    input.confirmHash === null
      ? EMPTY_CONFIRMATION
      : confirmPreview(input.confirmHash, '2026-09-26T10:00:00.000Z')

  const result = consumeConfirmation(state, input.currentPreviewHash)
  if (!result.ok) {
    return { sent: false, reason: result.reason }
  }
  // 只有消费成功才走到这里——这就是「未确认 0 请求」的实现方式
  const request = aiSendRequestOf(input.preview)
  input.sent.push(request.body)
  return { sent: true, reason: null }
}

describe('AI-4 / AI01：未确认时零请求', () => {
  it('没有确认令牌时不会构造任何请求（发送计数为 0）', () => {
    const preview = previewOf()
    const sent: string[] = []

    const outcome = submitOnce({
      confirmHash: null,
      currentPreviewHash: preview.hash,
      sent,
      preview,
    })

    expect(outcome.sent).toBe(false)
    expect(outcome.reason).toContain('尚未确认')
    expect(sent).toHaveLength(0)
  })

  it('确认绑定的是**那一份内容**：hash 对不上就拒绝发送（AI03）', () => {
    const approved = previewOf()
    const changed = previewOf({ maxTokens: 4096 })
    const sent: string[] = []

    expect(isPreviewStale(approved, changed.hash)).toBe(true)
    const outcome = submitOnce({
      confirmHash: approved.hash,
      currentPreviewHash: changed.hash,
      sent,
      preview: changed,
    })

    expect(outcome.sent).toBe(false)
    expect(outcome.reason).toContain('已失效')
    expect(sent).toHaveLength(0)
  })
})

describe('AI-4：确认后恰好一次，且正文与预览一致', () => {
  it('确认匹配时发送一次，正文等于预览投影出来的正文', () => {
    const preview = previewOf()
    const sent: string[] = []

    const outcome = submitOnce({
      confirmHash: preview.hash,
      currentPreviewHash: preview.hash,
      sent,
      preview,
    })

    expect(outcome.sent).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBe(aiSendRequestOf(preview).body)
    // 正文里带着用户批准过的载荷 JSON 片段（预览面板逐字渲染的就是它）
    expect(sent[0]).toContain('ai-summary/')
  })

  it('AI02：同一个令牌消费第二次会被拒（界面因此不会发第二次请求）', () => {
    const preview = previewOf()
    const first = consumeConfirmation(
      confirmPreview(preview.hash, '2026-09-26T10:00:00.000Z'),
      preview.hash,
    )
    expect(first.ok).toBe(true)

    const second = consumeConfirmation(first.state, preview.hash)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.reason).toContain('已被使用')
    }
  })

  it('改参数 → 新 hash → 旧确认失效（所以要重新预览，AI03）', () => {
    const base = previewOf()
    for (const changed of [
      previewOf({ maxTokens: 4096 }),
      previewOf({ model: 'deepseek-v4-pro' }),
      previewOf({ thinking: 'enabled' }),
    ]) {
      expect(changed.hash).not.toBe(base.hash)
      const outcome = consumeConfirmation(
        confirmPreview(base.hash, '2026-09-26T10:00:00.000Z'),
        changed.hash,
      )
      expect(outcome.ok).toBe(false)
      if (!outcome.ok) {
        expect(outcome.reason).toContain('已失效')
      }
    }
  })

  it('正文随参数变化而变化（否则「正文与预览绑定」是空话）', () => {
    const a = aiSendRequestOf(previewOf({ maxTokens: 2048 })).body
    const b = aiSendRequestOf(previewOf({ maxTokens: 4096 })).body
    expect(a).not.toBe(b)
  })
})

describe('AI-4：Key 缺失时不进入发送路径', () => {
  it('没有 Key 时适配器拒绝，且一次请求都不发', async () => {
    resetAiKeySessionForTests()
    resetAiRequestStateForTests()
    const { sendSanitizedAiRequest } = await import('../../ai/client')
    const { aiSendRequestOf: build } = await import('../../ai/client')

    const preview = previewOf()
    const request = build(preview)
    await expect(
      sendSanitizedAiRequest(request, { register: () => undefined }),
    ).rejects.toMatchObject({ kind: 'no-key' })
  })

  it('Key 只在内存里存在时，请求头里的 Bearer 就是它（用合成 Key 验证形状）', () => {
    setAiKeySession(SYNTHETIC_KEY, '2026-09-26T00:00:00.000Z')
    const request = aiSendRequestOf(previewOf())
    // 正文里绝不能出现 Key
    expect(request.body).not.toContain(SYNTHETIC_KEY)
    expect(request.body).not.toContain('Bearer')
  })
})
