/**
 * DeepSeek 模型目录与能力表（AI-3，docs/PRD.md 18.1 / 18.3）。
 *
 * ## 为什么这份表是**打包在版本里**的常量
 *
 * PRD 18.1 明确：模型目录本地随应用打包、记录核查日期与能力矩阵，**不开页面自动拉取
 * `/models`**。理由是硬的——本项目对外的网络承诺是「只有用户逐次确认后才发一次请求」，
 * 而「打开设置页就去查模型列表」会破坏这条承诺（AI01/AI17：开关、保存 Key、看历史都不得
 * 产生任何请求）。因此这份表**只能**由人工在实施时按官方文档核实后写进来，并带上核查日期。
 *
 * 同理，这里**不做** Key 探活、余额查询、模型可用性探测。
 *
 * ## 官方核查记录（2026-09-26）
 *
 * - [模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：
 *   当前在售两个模型 `deepseek-flash`（DeepSeek-V4.1-Flash）与 `deepseek-v4-pro`
 *   （DeepSeek-V4-Pro-0813）；上下文 1M；输出最大 384K。
 *   旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` **仍可调用但对应模型已下线**，
 *   由 DeepSeek-V4.1-Flash 提供服务 —— 这正是「不静默替换、要标兼容风险」的实例。
 *   更新日志公告 `deepseek-chat` / `deepseek-reasoner` 于 2026-07-24 停用。
 * - [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)：
 *   思考模式**默认打开**，`effort` 默认 `high`；
 *   开关是 `{"thinking": {"type": "enabled/disabled"}}`，强度是 `reasoning_effort`；
 *   思考模式**不支持** `temperature` / `presence_penalty` / `frequency_penalty`
 *   （传了不报错也不生效，所以界面必须**禁用**而不是发出去再说）；
 *   `top_p` 只在思考模式生效（有效范围 0.95–1.0）。
 * - [获取模型列表](https://api-docs.deepseek.com/zh-cn/api/list-models)：
 *   `GET /models` 的响应含 `context_window` / `max_output_tokens` / `effort.supported_levels`。
 *   本表按该**形状**记录能力，但不联网获取。
 *
 * ## 三条纪律
 *
 * 1. **不静默替换**：目录里的 `legacy` 模型照原样列出并标兼容风险，绝不自动换成另一个
 *    （换了会改计费与结果，属于用户不知情的变更）；
 * 2. **不支持的参数在界面禁用**（PRD 18.3 原文），而不是发送后报错——由 `resolveAiParams`
 *    统一收敛，界面不得自己判断；
 * 3. **费用按最高价估算并写明这是假设**（PRD 18.3「费用与等待时间在进行前提示」）。
 *    用高峰价 + 缓存未命中价，宁可高估；核对日期与价格口径都随预览一起展示。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，**不发起任何请求**。
 */

import type { AiDestination } from '../privacy/aiPreview'

/**
 * 端点类型在这里重新导出一次，让 `src/ai` 内部模块（如 `keySession`）不必各自
 * 指向 `privacy/`——Destination 属于「请求目的地」这个概念，AI 层是它的使用者。
 */
export type { AiDestination }

/* ------------------------------------------------------------------ 可达性 */

/**
 * 端点可达性与 CORS 的**已知边界**。
 *
 * 这两条必须随预览展示（PRD 10.1、18.5）：
 * - 浏览器直连需要服务端允许本站 Origin 与 `Authorization` / `Content-Type` 预检；
 *   官方文档**没有**对任意静态站点 Origin 长期开放 CORS 的保证；
 * - 本期**没有**用真实 Key 做过付费请求，因此「能不能通」是**未验证**状态，
 *   不能在界面上写成「可以直连」。
 */
export const AI_CORS_UNVERIFIED_NOTE =
  '浏览器直连是否可用取决于 DeepSeek 是否允许本站 Origin 的预检请求（CORS）。官方文档没有对任意静态站点长期开放 CORS 的保证，本版本也没有用真实 Key 做过付费验证，因此这一项属于「未验证」，不能提前承诺可用。'

/* ------------------------------------------------------------------ 能力表 */

/** 参数名（与请求正文里的字段同名，便于一一对应） */
export const AI_PARAM_NAMES = [
  'temperature',
  'topP',
  'maxTokens',
  'thinking',
  'reasoningEffort',
] as const
export type AiParamName = (typeof AI_PARAM_NAMES)[number]

/** 推理强度档位（官方文档示例与 `/models` 的 `effort.supported_levels` 形状） */
export const AI_REASONING_EFFORTS = ['low', 'high', 'max'] as const
export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number]

/** 一个参数在当前模型 + 思考模式下的可用性；禁用必须给出**原因**，不能只是灰掉 */
export type AiParamSupport = {
  readonly supported: boolean
  /** 禁用原因：直接显示给用户，因此必须是可读中文，不能是内部代码 */
  readonly reason: string | null
}

/** 定价：按「每百万 tokens」的人民币价（官方定价页的计价单位） */
export type AiModelPricing = {
  readonly inputCacheHitPerMillion: { readonly peak: number; readonly offPeak: number }
  readonly inputCacheMissPerMillion: { readonly peak: number; readonly offPeak: number }
  readonly outputPerMillion: { readonly peak: number; readonly offPeak: number }
  /** 高峰时段说明（官方原文口径） */
  readonly peakHoursNote: string
}

export type AiModelSpec = {
  readonly id: string
  readonly displayName: string
  /** 官方模型版本标识（如 `DeepSeek-V4-Pro-0813`） */
  readonly modelVersion: string
  /**
   * `current`：当前在售；`legacy`：官方已停用或已下线（**仍列出**，标风险，不静默替换）；
   * `userProvided`：用户手填的官方模型 ID（不在目录里，按当前能力表保守处理）。
   */
  readonly status: 'current' | 'legacy' | 'userProvided'
  /** 兼容风险提示；`current` 为 null */
  readonly compatibilityRisk: string | null
  readonly contextWindowTokens: number
  readonly maxOutputTokens: number
  readonly supportsThinking: boolean
  /** 思考模式是服务端默认行为（官方：默认打开、effort 默认 high） */
  readonly thinkingDefaultEnabled: boolean
  readonly supportedReasoningEfforts: readonly AiReasoningEffort[]
  readonly pricing: AiModelPricing
}

/** 全目录共用的高峰时段说明（官方定价页口径，避免每个模型抄一遍） */
const PEAK_HOURS_NOTE =
  '北京时间周一至周五 9:00–12:00、14:00–18:00 为高峰时段（不含法定节假日），其余时段为低峰，低峰价为高峰价的一半。'

const FLASH_PRICING: AiModelPricing = {
  inputCacheHitPerMillion: { peak: 0.04, offPeak: 0.02 },
  inputCacheMissPerMillion: { peak: 2, offPeak: 1 },
  outputPerMillion: { peak: 8, offPeak: 4 },
  peakHoursNote: PEAK_HOURS_NOTE,
}

const PRO_PRICING: AiModelPricing = {
  inputCacheHitPerMillion: { peak: 0.3, offPeak: 0.15 },
  inputCacheMissPerMillion: { peak: 9, offPeak: 4.5 },
  outputPerMillion: { peak: 27, offPeak: 13.5 },
  peakHoursNote: PEAK_HOURS_NOTE,
}

/**
 * 模型目录（**人工核实后写死**，不联网获取）。
 *
 * 顺序即界面下拉顺序：当前在售的排前面。
 */
export const AI_MODEL_CATALOG: readonly AiModelSpec[] = [
  {
    id: 'deepseek-flash',
    displayName: 'deepseek-flash（DeepSeek-V4.1-Flash，推荐）',
    modelVersion: 'DeepSeek-V4.1-Flash',
    status: 'current',
    compatibilityRisk: null,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    supportsThinking: true,
    thinkingDefaultEnabled: true,
    supportedReasoningEfforts: AI_REASONING_EFFORTS,
    pricing: FLASH_PRICING,
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'deepseek-v4-pro（DeepSeek-V4-Pro-0813）',
    modelVersion: 'DeepSeek-V4-Pro-0813',
    status: 'current',
    compatibilityRisk: null,
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    supportsThinking: true,
    thinkingDefaultEnabled: true,
    supportedReasoningEfforts: AI_REASONING_EFFORTS,
    pricing: PRO_PRICING,
  },
  {
    id: 'deepseek-v4-flash',
    displayName: 'deepseek-v4-flash（旧名，官方已下线该模型）',
    modelVersion: '已下线（请求由 DeepSeek-V4.1-Flash 提供服务）',
    status: 'legacy',
    compatibilityRisk:
      '官方标注：该模型已下线，使用这个旧名调用时由 DeepSeek-V4.1-Flash 提供服务并按 Flash 价格计费。名称与实际模型不一致，结果与计费都无法从名称判断，建议改用 deepseek-flash。',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    supportsThinking: true,
    thinkingDefaultEnabled: true,
    supportedReasoningEfforts: AI_REASONING_EFFORTS,
    pricing: FLASH_PRICING,
  },
  {
    id: 'deepseek-v4-flash-vision-exp',
    displayName: 'deepseek-v4-flash-vision-exp（旧名，实验模型已下线）',
    modelVersion: '已下线（请求由 DeepSeek-V4.1-Flash 提供服务）',
    status: 'legacy',
    compatibilityRisk:
      '官方标注：该实验模型已下线，使用这个旧名调用时由 DeepSeek-V4.1-Flash 提供服务并按 Flash 价格计费。本应用只发送纯文本，不使用图像能力。建议改用 deepseek-flash。',
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 384_000,
    supportsThinking: true,
    thinkingDefaultEnabled: true,
    supportedReasoningEfforts: AI_REASONING_EFFORTS,
    pricing: FLASH_PRICING,
  },
  {
    id: 'deepseek-chat',
    displayName: 'deepseek-chat（旧配置，官方已停用）',
    modelVersion: '已停用（官方公告 2026-07-24 停用）',
    status: 'legacy',
    compatibilityRisk:
      '官方更新日志公告：deepseek-chat 与 deepseek-reasoner 已于 2026-07-24 停用。本应用不静默替换模型，选择它会在请求时由服务端决定结果或直接失败，建议改用 deepseek-flash。',
    contextWindowTokens: 64_000,
    maxOutputTokens: 8_192,
    supportsThinking: false,
    thinkingDefaultEnabled: false,
    supportedReasoningEfforts: [],
    pricing: FLASH_PRICING,
  },
  {
    id: 'deepseek-reasoner',
    displayName: 'deepseek-reasoner（旧配置，官方已停用）',
    modelVersion: '已停用（官方公告 2026-07-24 停用）',
    status: 'legacy',
    compatibilityRisk:
      '官方更新日志公告：deepseek-chat 与 deepseek-reasoner 已于 2026-07-24 停用。本应用不静默替换模型，选择它会在请求时由服务端决定结果或直接失败，建议改用 deepseek-flash。',
    contextWindowTokens: 64_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    thinkingDefaultEnabled: false,
    supportedReasoningEfforts: ['low', 'high'],
    pricing: FLASH_PRICING,
  },
] as const

/** 默认模型：当前在售的第一个（不是旧的 `deepseek-chat`） */
export const AI_DEFAULT_MODEL_ID = 'deepseek-flash'

export function findModelSpec(modelId: string): AiModelSpec | undefined {
  return AI_MODEL_CATALOG.find((spec) => spec.id === modelId)
}

/**
 * 取模型能力：目录里没有的 ID（用户手填）按**当前模型的最保守能力**处理，
 * 但明确标记为 `userProvided`，让界面能提示「这个 ID 不在本版本核实的目录里」。
 * 绝不因为「不认识」就假装它支持某个参数。
 */
export function modelSpecOf(modelId: string): AiModelSpec {
  const known = findModelSpec(modelId)
  if (known !== undefined) {
    return known
  }
  return {
    id: modelId,
    displayName: `${modelId}（不在本版本核实的目录里）`,
    modelVersion: '未知',
    status: 'userProvided',
    compatibilityRisk:
      '这个模型 ID 不在本版本核实的目录里（核实日期见目录说明）。参数可用性按目录中最保守的当前模型处理，可能与实际能力不一致；费用按目录最高价估算。',
    contextWindowTokens: 64_000,
    maxOutputTokens: 8_192,
    supportsThinking: true,
    thinkingDefaultEnabled: true,
    supportedReasoningEfforts: AI_REASONING_EFFORTS,
    pricing: PRO_PRICING,
  }
}

/** 目录核实日期（随预览与设置展示，便于回溯「当时按哪天的资料判断」） */
export const AI_CATALOG_VERIFIED_AT = '2026-09-26'

export const AI_CATALOG_SOURCES: readonly string[] = [
  'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  'https://api-docs.deepseek.com/zh-cn/guides/thinking_mode',
  'https://api-docs.deepseek.com/zh-cn/api/list-models',
  'https://api-docs.deepseek.com/updates/',
]

/* ------------------------------------------------------------------ 参数可用性 */

/**
 * 某个参数在「该模型 + 是否思考模式」下的可用性（PRD 18.3「不支持的参数在 UI 禁用」）。
 *
 * 官方原文依据（思考模式文档）：
 * - 思考模式**不支持** `temperature` / `presence_penalty` / `frequency_penalty`，
 *   「为了兼容已有软件，设置参数不会报错，但也不会生效」——**这正是必须禁用的理由**：
 *   发出去不会报错，只会让用户以为温度生效了；
 * - `top_p` **只在思考模式生效**（有效范围 0.95–1.0），非思考模式下恒为 1.0、传入被忽略。
 */
export function paramSupportOf(
  spec: AiModelSpec,
  param: AiParamName,
  thinking: boolean,
): AiParamSupport {
  switch (param) {
    case 'thinking':
      return spec.supportsThinking
        ? { supported: true, reason: null }
        : {
            supported: false,
            reason: `模型 ${spec.id} 不支持思考模式参数，该开关已禁用（不会发送此参数）。`,
          }
    case 'reasoningEffort':
      if (!spec.supportsThinking) {
        return {
          supported: false,
          reason: `模型 ${spec.id} 不支持思考模式，因此也没有推理强度可设置。`,
        }
      }
      return thinking
        ? { supported: true, reason: null }
        : {
            supported: false,
            reason: '推理强度只在思考模式下生效，当前为思考模式关闭，因此不发送该参数。',
          }
    case 'temperature':
      return thinking
        ? {
            supported: false,
            reason:
              '思考模式不支持 temperature：官方说明传入不会报错但也不会生效。为避免让你以为它起了作用，这里直接禁用且不发送。',
          }
        : { supported: true, reason: null }
    case 'topP':
      return thinking
        ? { supported: true, reason: null }
        : {
            supported: false,
            reason: 'top_p 只在思考模式下生效，非思考模式下恒为 1.0 且传入会被忽略，因此不发送。',
          }
    case 'maxTokens':
      return { supported: true, reason: null }
    default:
      return { supported: false, reason: '未知参数，已禁用。' }
  }
}

/** 参数取值范围（界面据此收敛输入，不把非法值发出去） */
export const AI_PARAM_RANGES = {
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0.95, max: 1, step: 0.01 },
  maxTokens: { min: 1, max: 384_000, step: 1 },
  timeoutMs: { min: 1_000, max: 600_000, step: 1_000 },
} as const

/* ------------------------------------------------------------------ 费用估算 */

/**
 * 粗估一次请求的费用（**上限价 + 明确假设**）。
 *
 * 为什么是「上限价」：输入按**缓存未命中**计、时段按**高峰**计——
 * 两条都取最贵的分支，宁可高估。理由是不是所有输入都会命中缓存，而低峰价只在特定时段生效；
 * 低估会让用户以为不花钱。估算值必须与「这是上限估算」的说明一起展示，不能单独出现。
 */
export type AiCostEstimate = {
  /** 输入 token 上限估算（按字符数粗估，见 `estimateInputTokens`） */
  readonly inputTokens: number
  /** 输出 token 上限 = `max_tokens` */
  readonly outputTokens: number
  readonly maxCostYuan: number
  readonly assumptions: readonly string[]
}

/**
 * 输入 token 粗估：`ceil(字符数 / 1.5)`。
 *
 * 为什么是粗估而不是精确：本项目**不引入 tokenizer 依赖**（会把包体撑大，而且分词规则
 * 随模型变化）。中文大致 1 字 1 token、英文约 4 字 1 token，取 1.5 作为折中并明确标注为估算。
 * token 数与费用都只是**告知**，不参与任何校验或阻断。
 */
export function estimateInputTokens(charCount: number): number {
  if (!Number.isFinite(charCount) || charCount <= 0) {
    return 0
  }
  return Math.ceil(charCount / 1.5)
}

export function estimateCost(input: {
  readonly spec: AiModelSpec
  readonly inputCharCount: number
  readonly maxOutputTokens: number
}): AiCostEstimate {
  const inputTokens = estimateInputTokens(input.inputCharCount)
  const outputTokens = Math.max(0, Math.round(input.maxOutputTokens))
  const inputCost =
    (inputTokens / 1_000_000) * input.spec.pricing.inputCacheMissPerMillion.peak
  const outputCost = (outputTokens / 1_000_000) * input.spec.pricing.outputPerMillion.peak
  return {
    inputTokens,
    outputTokens,
    maxCostYuan: inputCost + outputCost,
    assumptions: [
      '输入 token 按字符数 ÷ 1.5 粗估（中文约 1 字 1 token、英文约 4 字 1 token），不是精确分词结果。',
      '输入按「缓存未命中」价计、时段按「高峰」价计，两条都取最贵分支，因此这是本次费用的上限估算。',
      '实际费用由 DeepSeek 按其计费规则结算；本应用不查询余额、也无法在发送前得知确切费用。',
      `价格取自 ${AI_CATALOG_VERIFIED_AT} 核实的官方定价页，可能已变动。`,
    ],
  }
}

/**
 * 费用文案：**没有任何一条路径**会显示「预计精确费用」。
 * 金额保留 4 位小数——单位是元，小到 0.0001 元，2 位小数会把小额显示成 0.00（那是假精度）。
 */
export function formatCostEstimate(estimate: AiCostEstimate): string {
  const cost =
    estimate.maxCostYuan < 0.0001
      ? '< 0.0001 元'
      : `${estimate.maxCostYuan.toFixed(4)} 元`
  return `本次请求的费用上限估算约 ${cost}（输入约 ${String(estimate.inputTokens)} tokens、输出上限 ${String(estimate.outputTokens)} tokens）。`
}

/* ------------------------------------------------------------------ Key 许可 */

/**
 * Key 许可：**按端点绑定**（PRD 18.2「Key 许可按端点绑定，避免改端点后旧 Key 被转发」）。
 *
 * 为什么单独一个类型：用户同意「把 Key 发给 api.deepseek.com」**不等于**同意把它发给
 * 另一个地址。换了端点就必须重新授权，而不是沿用旧许可。
 */
export type AiKeyPermission = {
  readonly origin: string
  readonly grantedAt: string
}

export function destinationKeyOf(destination: AiDestination): string {
  return `${destination.origin}${destination.path}`
}

/**
 * 当前许可是否覆盖这个端点。
 *
 * 只比 **origin**（协议 + 主机 + 端口）：端点是路径级常量（`/chat/completions`），
 * 把路径算进比较会让「换了路径但同一服务方」也失效——那不是用户能感知的边界，
 * 而 origin 才是「Key 发给谁」这件事的真正边界。
 */
export function keyPermissionCovers(
  permission: AiKeyPermission | null,
  destination: AiDestination,
): boolean {
  return permission !== null && permission.origin === destination.origin
}

/** 许可失效时的说明（改地址后必须显示，不能静默沿用旧 Key） */
export const AI_KEY_PERMISSION_STALE_NOTE =
  '目的地已变更，之前对旧地址的 Key 许可已失效。请重新确认后才会把 Key 发给新地址——本应用不会把旧地址的 Key 自动转发过去。'
