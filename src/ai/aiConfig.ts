/**
 * AI 配置层（AI-3，docs/PRD.md 18.2 / 18.3）。
 *
 * ## 这一层解决什么
 *
 * 设置页要管三件**互相牵连**的事：AI 开关、Key 的保存方式、模型与参数。
 * 把它们散在组件里会有三个具体后果：
 *
 * 1. **参数约束会漂移**：`temperature` 在思考模式下无效、`top_p` 只在思考模式生效、
 *    `max_tokens` 不能超过模型输出上限——这些规则必须**只有一处**，
 *    否则界面放过、请求层拒绝（或更糟：发出去被静默忽略，用户以为生效了）；
 * 2. **「改配置作废旧预览」会漏**：预览 hash 覆盖「一切会影响实际请求的输入」，
 *    因此**实际会被发送的参数**必须由一个函数算出来，不能靠组件拼；
 * 3. **兼容风险会被静默吞掉**：选了官方已停用的旧模型必须**保留选择并提示**，
 *    而不是自动换成新模型（那会改变计费与结果，属于用户不知情的变更）。
 *
 * 因此本模块提供唯一入口 `resolveAiParams(draft)`：输入界面的草稿，
 * 输出**实际会发送的参数** + 一条条调整说明（`notices`）。组件不得自己 clamp、自己判断。
 *
 * ## 一条容易写错的规则：哪些参数「不发」
 *
 * 官方原文（思考模式文档）：「思考模式不支持 `temperature`、`presence_penalty`、
 * `frequency_penalty`。请注意，为了兼容已有软件，设置参数不会报错，但也不会生效。」
 * 「`top_p` 仅在思考模式下生效……在非思考模式下，该参数恒为 1.0，传入的值会被忽略。」
 *
 * 「不报错但不生效」比报错更危险：用户会以为温度真的起了作用。所以本层的做法是
 * **在界面禁用 + 在参数对象里留空（字段不存在）**，而不是发一个被忽略的值。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，**不发起任何请求**。
 */

import type { AiModelParams } from '../privacy/aiPreview'
import {
  AI_DEFAULT_MODEL_ID,
  AI_PARAM_RANGES,
  AI_REASONING_EFFORTS,
  destinationKeyOf,
  findModelSpec,
  modelSpecOf,
  paramSupportOf,
  type AiModelSpec,
  type AiReasoningEffort,
} from './catalog'

/* ------------------------------------------------------------------ 开关与保存方式 */

/**
 * AI 是否启用。**默认关闭**（PRD 18.1）。
 *
 * 两条容易搞混的边界，写在这里以免以后被改坏：
 * - 打开这个开关**不是**永久授权：每次发送仍然要逐次预览确认（PRD 18.1 原文）；
 * - 关闭它**不删除**已保存的 Key，也**不删除** AI 历史（PRD 18.2：三者是独立操作）。
 */
export type AiEnabled = boolean

export const AI_ENABLED_DEFAULT: AiEnabled = false

/** Key 的保存方式（PRD 18.2 的「Key 保存方式」一行） */
export type AiKeyStorageMode =
  /** 默认：只在内存，刷新即失 */
  | 'memory'
  /** 用户显式勾选：加密保存在加密仓的秘密槽位里（需要先解锁） */
  | 'encrypted'

export const AI_KEY_STORAGE_DEFAULT: AiKeyStorageMode = 'memory'

/**
 * 「思考模式」的三态。
 *
 * 为什么不是 `boolean`：官方文档写明**思考模式默认打开、effort 默认 high**，
 * 因此「不指定」与「显式关闭」是两个不同的请求。用一个布尔量会把
 * 「按模型默认」压成「关」或「开」，两者都可能与用户的意图不符。
 */
export type AiThinkingSetting = 'auto' | 'enabled' | 'disabled'

/* ------------------------------------------------------------------ 草稿与结果 */

/** 界面上的配置草稿（**字符串形式**，因为输入框给的就是字符串） */
export type AiConfigDraft = {
  readonly model: string
  readonly thinking: AiThinkingSetting
  readonly reasoningEffort: AiReasoningEffort | ''
  readonly temperature: string
  readonly topP: string
  readonly maxTokens: string
  readonly timeoutMs: string
}

/**
 * 一条「本地调整」说明：**必须展示给用户**。
 *
 * 为什么调整要说明而不是静默 clamp：用户填了 5 秒超时、被悄悄改成 1 秒，
 * 之后请求超时他会以为网络有问题。宁可多说一句。
 */
export type AiConfigNotice = {
  /** 稳定的机器可读标识，便于测试断言（文案可以改，这个不要改） */
  readonly code:
    | 'temperature-ignored'
    | 'topP-ignored'
    | 'reasoning-effort-ignored'
    | 'thinking-unsupported'
    | 'model-legacy'
    | 'model-unverified'
    | 'value-clamped'
    | 'value-invalid'
  readonly detail: string
}

export type AiResolvedConfig = {
  readonly spec: AiModelSpec
  /** **实际会发送的参数**（不支持项在这里根本不存在，而不是填个默认值） */
  readonly params: AiModelParams
  readonly notices: readonly AiConfigNotice[]
  /** 思考模式是否生效（`auto` 时取模型默认） */
  readonly thinkingActive: boolean
}

/* ------------------------------------------------------------------ 取值收敛 */

function clampNumber(
  raw: string,
  fallback: number,
  min: number,
  max: number,
): { readonly value: number; readonly clamped: boolean; readonly invalid: boolean } {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { value: fallback, clamped: false, invalid: false }
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    return { value: fallback, clamped: false, invalid: true }
  }
  if (parsed < min || parsed > max) {
    return { value: Math.min(max, Math.max(min, parsed)), clamped: true, invalid: false }
  }
  return { value: parsed, clamped: false, invalid: false }
}

/**
 * `max_tokens` 的两条上界取**更严**的那一条：
 * 模型能力（`maxOutputTokens`）与产品预算（`AI_PARAM_RANGES.maxTokens.max`）。
 *
 * 为什么两者都要：模型能力是硬上限（超了会被服务端拒绝），
 * 产品预算是「不让用户一次花掉太多」的运营选择。任一条都不该被另一条放宽。
 */
function maxTokensCeilingOf(spec: AiModelSpec): number {
  return Math.min(spec.maxOutputTokens, AI_PARAM_RANGES.maxTokens.max)
}

/* ------------------------------------------------------------------ 唯一入口 */

/**
 * 把草稿解析成**实际会发送的配置**（唯一入口）。
 *
 * 处理顺序（顺序本身有意义）：
 * 1. 认模型 → 不在目录里就按最保守能力处理并提示「未核实」；
 * 2. 定思考模式（`auto` 取模型默认）→ 模型不支持思考时忽略开关并提示；
 * 3. 逐个参数按其**可用性**决定发不发（不支持的记 notice，不塞默认值）；
 * 4. 可发的参数再做范围收敛（超界 clamp 并提示，非法值回落默认并提示）；
 * 5. 旧模型 / 未核实模型附兼容风险提示——**保留用户的选择，不替换**。
 */
export function resolveAiParams(draft: AiConfigDraft): AiResolvedConfig {
  const notices: AiConfigNotice[] = []

  const known = findModelSpec(draft.model)
  const spec = modelSpecOf(draft.model)
  if (known === undefined) {
    notices.push({
      code: 'model-unverified',
      detail: `模型 ${spec.id} 不在本版本核实的目录里，参数可用性按最保守的当前模型处理，可能与实际能力不一致。`,
    })
  } else if (spec.status === 'legacy' && spec.compatibilityRisk !== null) {
    notices.push({ code: 'model-legacy', detail: spec.compatibilityRisk })
  }

  // 思考模式：模型不支持时忽略用户的开关（否则会发出一个必然被拒的参数）
  const thinkingSupport = paramSupportOf(spec, 'thinking', false)
  let thinkingActive: boolean
  if (!thinkingSupport.supported) {
    thinkingActive = false
    if (draft.thinking !== 'disabled') {
      notices.push({ code: 'thinking-unsupported', detail: thinkingSupport.reason ?? '该模型不支持思考模式。' })
    }
  } else {
    thinkingActive =
      draft.thinking === 'auto' ? spec.thinkingDefaultEnabled : draft.thinking === 'enabled'
  }

  // temperature：仅在非思考模式可用；思考模式下**字段不存在**
  let temperature: number | undefined
  const temperatureSupport = paramSupportOf(spec, 'temperature', thinkingActive)
  if (temperatureSupport.supported) {
    const result = clampNumber(
      draft.temperature,
      1,
      AI_PARAM_RANGES.temperature.min,
      AI_PARAM_RANGES.temperature.max,
    )
    temperature = result.value
    if (result.invalid) {
      notices.push({
        code: 'value-invalid',
        detail: `temperature 不是有效数字，已回落为默认值 ${String(result.value)}。`,
      })
    } else if (result.clamped) {
      notices.push({
        code: 'value-clamped',
        detail: `temperature 超出 ${String(AI_PARAM_RANGES.temperature.min)}–${String(AI_PARAM_RANGES.temperature.max)}，已收敛为 ${String(result.value)}。`,
      })
    }
  } else if (temperatureSupport.reason !== null) {
    notices.push({ code: 'temperature-ignored', detail: temperatureSupport.reason })
  }

  // top_p：只在思考模式生效
  let topP: number | undefined
  const topPSupport = paramSupportOf(spec, 'topP', thinkingActive)
  if (topPSupport.supported) {
    const result = clampNumber(
      draft.topP,
      0.95,
      AI_PARAM_RANGES.topP.min,
      AI_PARAM_RANGES.topP.max,
    )
    topP = result.value
    if (result.invalid) {
      notices.push({
        code: 'value-invalid',
        detail: `top_p 不是有效数字，已回落为默认值 ${String(result.value)}。`,
      })
    } else if (result.clamped) {
      notices.push({
        code: 'value-clamped',
        detail: `top_p 超出 ${String(AI_PARAM_RANGES.topP.min)}–${String(AI_PARAM_RANGES.topP.max)}，已收敛为 ${String(result.value)}。`,
      })
    }
  } else if (topPSupport.reason !== null) {
    notices.push({ code: 'topP-ignored', detail: topPSupport.reason })
  }

  // reasoning_effort：只在思考模式生效，且必须在模型支持的档位里
  let reasoningEffort: AiReasoningEffort | undefined
  const effortSupport = paramSupportOf(spec, 'reasoningEffort', thinkingActive)
  if (effortSupport.supported) {
    const requested = draft.reasoningEffort
    if (requested === '') {
      // 不指定 = 由服务端用它为该模型定义的默认档位（官方：effort 默认 high）
      reasoningEffort = undefined
    } else if (AI_REASONING_EFFORTS.includes(requested) && spec.supportedReasoningEfforts.includes(requested)) {
      reasoningEffort = requested
    } else {
      notices.push({
        code: 'value-invalid',
        detail: `模型 ${spec.id} 不支持推理强度「${requested}」，已改为由服务端使用默认档位。`,
      })
    }
  } else if (effortSupport.reason !== null) {
    notices.push({ code: 'reasoning-effort-ignored', detail: effortSupport.reason })
  }

  // max_tokens：上界取模型能力与产品预算中更严的一条
  const ceiling = maxTokensCeilingOf(spec)
  const maxTokensRaw = clampNumber(draft.maxTokens, 2048, AI_PARAM_RANGES.maxTokens.min, ceiling)
  const maxTokens = Math.round(maxTokensRaw.value)
  if (maxTokensRaw.invalid) {
    notices.push({
      code: 'value-invalid',
      detail: `max_tokens 不是有效数字，已回落为默认值 ${String(maxTokens)}。`,
    })
  } else if (maxTokensRaw.clamped) {
    notices.push({
      code: 'value-clamped',
      detail: `max_tokens 超出可用范围（模型 ${spec.id} 输出上限 ${String(spec.maxOutputTokens)}，产品预算上限 ${String(AI_PARAM_RANGES.maxTokens.max)}），已收敛为 ${String(maxTokens)}。`,
    })
  }

  // timeout：纯本地参数，只受产品范围约束
  const timeoutRaw = clampNumber(
    draft.timeoutMs,
    60_000,
    AI_PARAM_RANGES.timeoutMs.min,
    AI_PARAM_RANGES.timeoutMs.max,
  )
  const timeoutMs = Math.round(timeoutRaw.value)
  if (timeoutRaw.invalid) {
    notices.push({
      code: 'value-invalid',
      detail: `超时不是有效数字，已回落为默认值 ${String(timeoutMs)} 毫秒。`,
    })
  } else if (timeoutRaw.clamped) {
    notices.push({
      code: 'value-clamped',
      detail: `超时超出 ${String(AI_PARAM_RANGES.timeoutMs.min)}–${String(AI_PARAM_RANGES.timeoutMs.max)} 毫秒，已收敛为 ${String(timeoutMs)} 毫秒。`,
    })
  }

  return {
    spec,
    thinkingActive,
    notices,
    params: {
      model: spec.id,
      maxTokens,
      timeoutMs,
      // 不支持的两个字段**根本不出现**，而不是给一个会被服务端忽略的值
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      // `thinking` 用三态表达「不指定」：`auto` 时完全不带该参数
      thinking: draft.thinking === 'auto' ? 'auto' : thinkingActive ? 'enabled' : 'disabled',
    },
  }
}

/* ------------------------------------------------------------------ 默认草稿 */

export function defaultAiConfigDraft(overrides: Partial<AiConfigDraft> = {}): AiConfigDraft {
  return {
    model: AI_DEFAULT_MODEL_ID,
    thinking: 'auto',
    reasoningEffort: '',
    temperature: '1',
    topP: '0.95',
    maxTokens: '2048',
    timeoutMs: '60000',
    ...overrides,
  }
}

/**
 * 「这份配置里哪些参数会被发送」——给设置页与预览做**同一份**展示来源。
 *
 * 为什么不各自列一份：一旦两处不一致，用户会看到「设置里说温度生效、预览里没有温度」，
 * 那是比不显示更糟的状态。
 */
export function describeResolvedParams(config: AiResolvedConfig): readonly { readonly label: string; readonly value: string }[] {
  const { params } = config
  const rows: { readonly label: string; readonly value: string }[] = [
    { label: '模型', value: params.model },
    {
      label: '思考模式',
      value:
        params.thinking === 'auto'
          ? '不指定（由服务端按模型默认处理）'
          : params.thinking === 'enabled'
            ? '开启'
            : '关闭',
    },
    { label: '最长输出 max_tokens', value: String(params.maxTokens) },
    { label: '超时', value: `${String(params.timeoutMs)} 毫秒` },
  ]
  rows.push({
    label: '温度 temperature',
    value: params.temperature === undefined ? '不发送（见下方调整说明）' : String(params.temperature),
  })
  rows.push({
    label: 'top_p',
    value: params.topP === undefined ? '不发送（见下方调整说明）' : String(params.topP),
  })
  rows.push({
    label: '推理强度 reasoning_effort',
    value:
      params.reasoningEffort === undefined
        ? '不指定（由服务端使用默认档位）'
        : params.reasoningEffort,
  })
  return rows
}

/** 端点标签：许可与预览都用它，避免两处各写一遍拼接规则 */
export function destinationLabelOf(origin: string, path: string): string {
  return `${origin}${path}`
}

export { destinationKeyOf }
