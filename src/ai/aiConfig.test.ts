/**
 * AI-3 单测：参数与开关的解析（`src/ai/aiConfig.ts`）。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-3 的这几条：
 * - 「模型 / 思考模式 / 温度 / max_tokens / 超时 / 隐私设置」→ 每一项都能被解析成实发参数；
 * - 「不支持参数禁用」→ 不支持的参数**在参数对象里根本不存在**（不是给个会被忽略的值）；
 * - 「旧 chat/reasoner 标兼容风险，不静默替换」→ 选了旧模型仍是旧模型，只附提示；
 * - 「AI10 通过」→ 参数对象里没有 Key 的位置。
 */

import { describe, expect, it } from 'vitest'

import { AI_DEFAULT_MODEL_ID, AI_PARAM_RANGES } from './catalog'
import { AI_ENABLED_DEFAULT, defaultAiConfigDraft, describeResolvedParams, resolveAiParams } from './aiConfig'

describe('AI-3：AI 默认关闭', () => {
  it('开关的默认值是关闭（PRD 18.1）', () => {
    expect(AI_ENABLED_DEFAULT).toBe(false)
  })
})

describe('AI-3：实发参数由唯一入口算出，不支持的项「不存在」', () => {
  it('默认草稿解析出当前在售模型，且不带任何会被忽略的参数', () => {
    const config = resolveAiParams(defaultAiConfigDraft())
    expect(config.params.model).toBe(AI_DEFAULT_MODEL_ID)
    // 默认 `thinking: 'auto'` 表示「不指定」，由服务端按模型默认处理
    expect(config.params.thinking).toBe('auto')
    // 官方默认思考模式为打开 → temperature 不发送（字段不存在，不是 0）
    expect(config.params.temperature).toBeUndefined()
    expect(config.thinkingActive).toBe(true)
    // 明确告诉用户为什么没发
    expect(config.notices.some((item) => item.code === 'temperature-ignored')).toBe(true)
  })

  it('显式关闭思考模式后 temperature 变回可发，且被正常收敛', () => {
    const config = resolveAiParams(
      defaultAiConfigDraft({ thinking: 'disabled', temperature: '0.3' }),
    )
    expect(config.thinkingActive).toBe(false)
    expect(config.params.temperature).toBe(0.3)
    expect(config.params.thinking).toBe('disabled')
    // 非思考模式下 top_p 不生效，因此也不发送
    expect(config.params.topP).toBeUndefined()
    expect(config.notices.some((item) => item.code === 'topP-ignored')).toBe(true)
  })

  it('思考模式下 top_p 可发，且范围收敛到 0.95–1', () => {
    const tooLow = resolveAiParams(defaultAiConfigDraft({ thinking: 'enabled', topP: '0.5' }))
    expect(tooLow.params.topP).toBe(AI_PARAM_RANGES.topP.min)
    expect(tooLow.notices.some((item) => item.code === 'value-clamped')).toBe(true)

    const ok = resolveAiParams(defaultAiConfigDraft({ thinking: 'enabled', topP: '0.99' }))
    expect(ok.params.topP).toBe(0.99)
  })

  it('推理强度只在思考模式下发，且必须是模型支持的档位', () => {
    const on = resolveAiParams(
      defaultAiConfigDraft({ thinking: 'enabled', reasoningEffort: 'high' }),
    )
    expect(on.params.reasoningEffort).toBe('high')

    const off = resolveAiParams(
      defaultAiConfigDraft({ thinking: 'disabled', reasoningEffort: 'high' }),
    )
    expect(off.params.reasoningEffort).toBeUndefined()
    expect(off.notices.some((item) => item.code === 'reasoning-effort-ignored')).toBe(true)

    /*
     * `deepseek-chat` 只支持思考模式……实际上它根本不支持思考模式，
     * 所以任何推理强度都会被忽略。这里断言的是「不支持就不发」，
     * 而不是某个具体档位的取舍——档位取舍由当前在售模型覆盖（见下一个断言）。
     */
    const unsupportedModel = resolveAiParams(
      defaultAiConfigDraft({ model: 'deepseek-chat', thinking: 'enabled', reasoningEffort: 'max' }),
    )
    expect(unsupportedModel.params.reasoningEffort).toBeUndefined()

    // 当前在售模型支持思考模式，但档位必须落在它声明的集合里
    const flash = resolveAiParams(
      defaultAiConfigDraft({ model: 'deepseek-flash', thinking: 'enabled', reasoningEffort: 'max' }),
    )
    expect(flash.params.reasoningEffort).toBe('max')
  })

  it('空字符串表示「不指定」，不会变成一个 0 或 NaN 塞进请求', () => {
    const config = resolveAiParams(
      defaultAiConfigDraft({ thinking: 'enabled', reasoningEffort: '', topP: '', temperature: '' }),
    )
    expect(config.params.reasoningEffort).toBeUndefined()
    // 空 top_p 在思考模式下回落默认 0.95（可发参数必须有值）
    expect(config.params.topP).toBe(0.95)
    // 空 temperature 在思考模式下本来就不发
    expect(config.params.temperature).toBeUndefined()
  })
})

describe('AI-3：max_tokens 的上界取模型能力与产品预算中更严的一条', () => {
  it('超过模型输出上限时收敛到该上限并提示', () => {
    // deepseek-chat 的输出上限是 8192
    const config = resolveAiParams(defaultAiConfigDraft({ model: 'deepseek-chat', maxTokens: '999999' }))
    expect(config.params.maxTokens).toBeLessThanOrEqual(8192)
    expect(config.notices.some((item) => item.code === 'value-clamped')).toBe(true)
  })

  it('当前模型的输出上限很大时，产品预算仍然生效', () => {
    const config = resolveAiParams(
      defaultAiConfigDraft({ model: 'deepseek-flash', maxTokens: '99999999' }),
    )
    expect(config.params.maxTokens).toBeLessThanOrEqual(AI_PARAM_RANGES.maxTokens.max)
  })

  it('非法输入回落默认值并提示，绝不产生 NaN', () => {
    const config = resolveAiParams(
      defaultAiConfigDraft({ maxTokens: 'abc', timeoutMs: 'xyz' }),
    )
    expect(Number.isFinite(config.params.maxTokens)).toBe(true)
    expect(Number.isFinite(config.params.timeoutMs)).toBe(true)
    expect(config.notices.filter((item) => item.code === 'value-invalid').length).toBeGreaterThanOrEqual(2)
  })

  it('超时只受产品范围约束（它不发给服务端）', () => {
    const config = resolveAiParams(defaultAiConfigDraft({ timeoutMs: '10' }))
    expect(config.params.timeoutMs).toBe(AI_PARAM_RANGES.timeoutMs.min)
    expect(config.params.timeoutMs).toBeGreaterThanOrEqual(1000)
  })
})

describe('AI-3：旧模型保留选择 + 兼容风险提示，不静默替换', () => {
  it('选了 deepseek-chat 之后模型仍是 deepseek-chat', () => {
    const config = resolveAiParams(defaultAiConfigDraft({ model: 'deepseek-chat' }))
    expect(config.params.model).toBe('deepseek-chat')
    expect(config.spec.status).toBe('legacy')
    expect(config.notices.some((item) => item.code === 'model-legacy')).toBe(true)
  })

  it('未登记的模型 ID 附「未核实」提示，参数按最保守能力处理', () => {
    const config = resolveAiParams(defaultAiConfigDraft({ model: 'my-custom-model' }))
    expect(config.params.model).toBe('my-custom-model')
    expect(config.notices.some((item) => item.code === 'model-unverified')).toBe(true)
  })

  it('不支持思考模式的模型：即使请求开启思考，也按不支持处理并说明', () => {
    const config = resolveAiParams(
      defaultAiConfigDraft({ model: 'deepseek-chat', thinking: 'enabled' }),
    )
    expect(config.thinkingActive).toBe(false)
    expect(config.notices.some((item) => item.code === 'thinking-unsupported')).toBe(true)
  })
})

describe('AI-3：参数展示与实际会发送的参数同源', () => {
  it('describeResolvedParams 逐项对应当前参数，不发送的项写明「不发送」', () => {
    /*
     * 用**关闭思考模式**的草稿来断言「不发送」：那种状态下 temperature 可发、
     * top_p 因「只在思考模式生效」而不发。默认草稿（thinking = auto → 思考生效）
     * 正好相反：temperature 不发、top_p 发 0.95。
     * 两种方向都要有断言，否则「不发送」这条显示规则可能只在一个方向上是错的。
     */
    const config = resolveAiParams(defaultAiConfigDraft({ thinking: 'disabled' }))
    const rows = describeResolvedParams(config)
    const byLabel = new Map(rows.map((row) => [row.label, row.value]))

    expect(byLabel.get('模型')).toBe(config.params.model)
    expect(byLabel.get('最长输出 max_tokens')).toBe(String(config.params.maxTokens))
    expect(byLabel.get('思考模式')).toBe('关闭')
    // 非思考模式下 top_p 不生效 → 显示「不发送」而不是 0.95
    expect(byLabel.get('top_p')).toContain('不发送')
    // temperature 此时可发，应显示具体数值而不是「不发送」
    expect(byLabel.get('温度 temperature')).toBe(String(config.params.temperature))
    expect(byLabel.get('推理强度 reasoning_effort')).toContain('不指定')

    // 反方向：思考生效时 temperature 不发送
    const thinkingOn = resolveAiParams(defaultAiConfigDraft({ thinking: 'enabled' }))
    const onRows = new Map(describeResolvedParams(thinkingOn).map((row) => [row.label, row.value]))
    expect(onRows.get('温度 temperature')).toContain('不发送')
    expect(onRows.get('top_p')).toBe(String(thinkingOn.params.topP))
  })

  it('参数对象里没有能装 Key 的位置（AI10 的结构性前提）', () => {
    const config = resolveAiParams(defaultAiConfigDraft())
    const keys = Object.keys(config.params)
    for (const forbidden of ['apiKey', 'key', 'authorization', 'token']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('同一份草稿解析两次得到逐字节相同的结果（同输入同产物）', () => {
    const draft = defaultAiConfigDraft({ thinking: 'enabled', temperature: '0.7', topP: '0.97' })
    expect(JSON.stringify(resolveAiParams(draft))).toBe(JSON.stringify(resolveAiParams(draft)))
  })
})
