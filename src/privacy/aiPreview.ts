/**
 * AI 完整脱敏预览（AI-1，docs/PRD.md 16.2 / 17.3 / 18.4）。
 *
 * ## 预览必须「完整」到什么程度
 *
 * 用户点「确认」之前，必须能看到**将要发出去的全部内容**，一字不多一字不少：
 * 完整 JSON 载荷、system 与 messages 原文、模型与参数、目的域名与路径、脱敏级别、
 * 移除 / 合并项、内容大小。任何一项只给摘要都会让「逐次确认」变成形式主义——
 * 用户无法对看不见的内容负责。
 *
 * ## 为什么预览要带 hash
 *
 * 预览与真正发送之间必然隔着一次用户点击。若中间有任何一个输入变了
 * （筛选、隐私级别、模型参数、载荷内容），旧预览就**不再是**用户批准的那份内容；
 * 此时必须作废旧确认、要求重新生成。做法是给预览算一个稳定 `hash`，
 * 发送时比对「当前参数算出的 hash」与「被确认的 hash」是否一致——
 * 不一致就拒绝发送（AI03 / AI09）。这比「让界面记得重置状态」可靠，
 * 因为它不依赖界面有没有真的清干净。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，**不发起任何请求**。
 * 真正的网络适配器是 AI-4，且它不能接收原始记录类型。
 */

import { AI_PROMPT_VERSION, AI_SUMMARY_SCHEMA_VERSION, type SanitizedAiPayload } from './aiSummary'

/* ------------------------------------------------------------------ 模型与端点 */

/**
 * 能力表随版本打包（PRD 18.3）。
 *
 * 为什么不在这里写死「最新模型名」：模型目录会变，写死一个名字早晚会变成错的。
 * 这里只列**结构与参数约束**，具体可选模型由调用方（AI-3 的模型配置）给出；
 * 本步不接真实请求，因此也不做任何「探测可用模型」的动作（PRD 18.1 明确不探活）。
 */
/**
 * 一次请求的模型参数（AI-1 建立，AI-3 按官方能力表扩展）。
 *
 * ## 为什么 `temperature` / `topP` / `reasoningEffort` 是**可选**的
 *
 * 不是为了少写几个字段，而是为了让「**不发送**」在类型层可表达。官方文档写明：
 * 思考模式不支持 `temperature`（传了不报错也不生效）、`top_p` 只在思考模式生效。
 * 若把 `temperature` 设成必填的 `number`，那么「思考模式下不发温度」就只能靠
 * 填一个假值来表达——发出去会被忽略，但预览里会显示一个**看起来生效**的数字。
 *
 * 因此这里的语义是：**字段存在 = 会出现在请求正文里；字段缺失 = 不发送**。
 * 谁决定发不发只有一处（`src/ai/aiConfig.ts` 的 `resolveAiParams`）。
 */
export type AiModelParams = {
  readonly model: string
  /** 思考模式：`'auto'` = 不发送该参数，由服务端按模型默认处理（官方：默认打开） */
  readonly thinking: 'auto' | 'enabled' | 'disabled'
  /** 缺失 = 不发送（思考模式不支持） */
  readonly temperature?: number
  /** 缺失 = 不发送（非思考模式下恒为 1.0 且被忽略） */
  readonly topP?: number
  readonly maxTokens: number
  readonly timeoutMs: number
  /** 缺失 = 不指定，由服务端使用其默认档位 */
  readonly reasoningEffort?: 'low' | 'high' | 'max'
}

/**
 * 默认参数（AI-3 起与「当前在售模型」对齐）。
 *
 * `model` 从 AI-1 的 `deepseek-chat` 改为 `deepseek-flash`：前者已于 2026-07-24 被官方停用
 * （核实记录见 `src/ai/catalog.ts`），把它当默认等于让新用户第一次请求就打在停用模型上。
 * 这是**默认值**的更新，不是「静默替换用户的选择」——目录里的旧模型仍照原样列出并标风险。
 */
export const AI_DEFAULT_PARAMS: AiModelParams = {
  model: 'deepseek-flash',
  thinking: 'auto',
  maxTokens: 2048,
  timeoutMs: 60_000,
}

/** 目的地（唯一端点；预览必须显示它，让用户知道内容会去哪） */
export type AiDestination = {
  readonly origin: string
  readonly path: string
}

export const AI_DEFAULT_DESTINATION: AiDestination = {
  origin: 'https://api.deepseek.com',
  path: '/chat/completions',
}

/* ------------------------------------------------------------------ 提示词 */

/** 提示词版本随报告与历史记录保存，便于回溯「当时用的是哪版提示词」 */
export { AI_PROMPT_VERSION }

/**
 * system 提示词（PRD 17.3）。
 *
 * 每一句都对应 PRD 明写的约束，不是客套话：只能用给定指标、不得编造数字、
 * 必须区分「组内构成」与「特征内率」、样本不足只描述、不得输出个人拒 offer 概率、
 * 不得基于学校 / 学历给淘汰建议、输出固定四段 + 数据限制。
 */
export const AI_SYSTEM_PROMPT = [
  '你是招聘数据复盘助手，服务对象是招聘 HR 与招聘负责人。',
  '你只能使用用户提供的聚合指标，不得引入任何外部数据，也不得编造数字。',
  '必须区分两种视角：「组内构成」（某特征在拒 offer 组 / 入职组中的人数占比）与',
  '「特征内率」（某特征自身的拒 offer 数 ÷ 该特征的核心分母 D）。两者分母不同，不可互相替代。',
  '样本不足时只做描述，不得下结论、不得排名、不得比较优劣。',
  '不得输出个人拒 offer 概率或任何未经校准的预测；不得声称因果关系。',
  '不得基于学校、学历等背景特征给出录用或淘汰建议。',
  '输出结构固定为四段：现状判断 → 主要问题 → 可能原因 → 行动建议；',
  '末尾必须附「数据限制」一段，说明哪些结论受样本或口径限制。',
  '每个数字都要能对应到输入里的指标标识（metricId）。',
].join('\n')

/** user 提示词：附摘要 JSON 与本地口径说明，要求引用 metricId（PRD 17.3） */
export function buildUserPrompt(payload: SanitizedAiPayload, caliberNotes: readonly string[]): string {
  return [
    // 不放 Markdown 强调标记：这段文字会**逐字渲染进预览面板**，
    // 出现 `**` 就会在界面上显示成一对星号（前几步已多次踩过这个坑）。
    '以下是一次实习生招聘 offer 数据复盘的聚合脱敏摘要（JSON）。',
    '请只依据它作答，并在引用数字时标出对应的 metricId。',
    '',
    '```json',
    JSON.stringify(payload, null, 2),
    '```',
    '',
    '本地口径说明：',
    ...caliberNotes.map((note) => `- ${note}`),
    '',
    '注意：D 是核心分母（已入职 + 待入职 + 拒绝 offer），审批中不计入 D，',
    '因此「审批中占比」的分母是全部记录 N，与核心率分母不同，必须分别说明。',
  ].join('\n')
}

/* ------------------------------------------------------------------ 预览 */

/** 一次请求的 messages（预览里逐字展示，发送时逐字使用） */
export type AiPreviewMessage = {
  readonly role: 'system' | 'user'
  readonly content: string
}

export type AiDesensitizeNote = {
  readonly label: string
  readonly detail: string
}

/** 完整脱敏预览：用户看到的就是将要发送的 */
export type AiPreview = {
  /** 预览与请求共用的稳定 hash；参数或内容一变它就变，旧确认随之失效 */
  readonly hash: string
  readonly schemaVersion: string
  readonly promptVersion: string
  readonly generatedAt: string
  readonly payload: SanitizedAiPayload
  /** 与 `payload` 逐字节一致的 JSON 文本（预览直接展示这一段，避免两处序列化不一致） */
  readonly payloadJson: string
  readonly messages: readonly AiPreviewMessage[]
  readonly params: AiModelParams
  readonly destination: AiDestination
  readonly desensitizeNotes: readonly AiDesensitizeNote[]
  readonly contentBytes: number
}

/**
 * 稳定 hash（FNV-1a 变体）。
 *
 * 与 `domain/configVersion.ts` 的 `stableDigest` 是**同一个算法**：两处都需要
 * 「同样输入给同样输出」，而它们服务于不同层的契约（配置摘要 vs 预览指纹），
 * 各自独立演进比强行共用一个导出更稳。这里只需要碰撞概率低，
 * 不用于防篡改（完整性由加密仓的 AES-GCM 认证标签负责）。
 */
export function previewHashOf(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).toUpperCase().padStart(8, '0')
}

/**
 * hash 的输入：**所有会改变实际请求的字段**。
 *
 * 少算任何一项都会造出「内容变了但 hash 没变」的漏洞——那等于让旧确认对新内容生效。
 * 因此这里显式列出：schema 版本、提示词版本、隐私级别、载荷全文、messages 全文、
 * 模型与全部参数、端点。`generatedAt` **不参与**：它只是展示时间，
 * 若算进去，同一份内容每次生成都会得到不同 hash，反而无法判断「内容是否真的变了」。
 */
function hashInputOf(parts: {
  readonly schemaVersion: string
  readonly promptVersion: string
  readonly payloadJson: string
  readonly messages: readonly AiPreviewMessage[]
  readonly params: AiModelParams
  readonly destination: AiDestination
}): string {
  return JSON.stringify({
    schemaVersion: parts.schemaVersion,
    promptVersion: parts.promptVersion,
    payloadJson: parts.payloadJson,
    messages: parts.messages.map((message) => [message.role, message.content]),
    /*
     * 参数**逐个列出**而不是展开对象：`JSON.stringify` 会把 `undefined` 的键整个丢掉，
     * 于是「温度从 0.7 变成不发送」和「温度从 0.7 变成 0.7」会产生同一个 hash。
     * 两者是不同的请求，绝不能共用一个确认（AI03 / AI09）。
     */
    params: {
      model: parts.params.model,
      thinking: parts.params.thinking,
      temperature: parts.params.temperature ?? null,
      topP: parts.params.topP ?? null,
      maxTokens: parts.params.maxTokens,
      timeoutMs: parts.params.timeoutMs,
      reasoningEffort: parts.params.reasoningEffort ?? null,
    },
    destination: { origin: parts.destination.origin, path: parts.destination.path },
  })
}

/** 脱敏说明：把「做了什么、没做什么」逐条写清，供用户在确认前核对 */
export function buildDesensitizeNotes(
  payload: SanitizedAiPayload,
  options: {
    readonly suppressedCellCount: number
    readonly removedDimensions: readonly string[]
  },
): readonly AiDesensitizeNote[] {
  return [
    {
      label: '白名单重建',
      detail:
        '载荷只由允许的字段构造，不是「复制一份再删敏感键」。因此聚合结果里新增的字段默认不会进入载荷。',
    },
    {
      label: '隐私级别',
      detail: `当前为 ${payload.privacyLevel}：只发送该级别允许的维度，未列出的维度整维省略并在「被省略项」里列出原因。`,
    },
    {
      label: '人事身份',
      detail:
        '姓名、候选人 ID、需求 ID、HR 真实姓名、学校全名、文件名、自由文本原因、准确薪资、完整日期都不会出现在载荷里——这些字段在载荷结构中没有位置。',
    },
    {
      label: 'HR、学校与岗位',
      detail:
        'HR 只以代号出现；学校只以层次（是否 GPT 院校）出现，未知一律标「未标注」而不猜测；岗位只以「岗位类别映射」给出的类别出现（没配映射时是「有岗位记录」），岗位全名本身不进载荷。',
    },
    {
      label: '薪资与周期',
      detail: '只发送分桶后的区间（如 <3000、3000-4000、10-19天），不发送任何准确金额或精确天数。',
    },
    {
      label: '小样本抑制',
      detail: `有效分母小于 5 的单元格整格省略（不是填 0）：本次共省略 ${String(options.suppressedCellCount)} 格。填 0 会被读成「这一格没有拒绝」，所以宁可不发。`,
    },
    {
      label: '被省略的维度',
      detail:
        options.removedDimensions.length === 0
          ? '没有被整维省略的维度。'
          : `整维省略：${options.removedDimensions.join('、')}。`,
    },
    {
      label: '不会发送的内容',
      detail: '不发送原始行、整份报告、文件名、历史记录、原始错误行，也不发送候选人级别的任何明细。',
    },
  ]
}

export type AiPreviewInput = {
  readonly payload: SanitizedAiPayload
  readonly caliberNotes: readonly string[]
  readonly params?: AiModelParams
  readonly destination?: AiDestination
  readonly generatedAt: string
}

/**
 * 构造完整预览（唯一入口）。
 *
 * `payloadJson` 用固定的 2 空格缩进序列化一次，预览展示与发送都**共用这一份字符串**
 * （而不是各自 `JSON.stringify` 一次）——两处分别序列化是「预览与实际发送不一致」的经典来源。
 */
export function buildAiPreview(input: AiPreviewInput): AiPreview {
  const params = input.params ?? AI_DEFAULT_PARAMS
  const destination = input.destination ?? AI_DEFAULT_DESTINATION
  const payloadJson = JSON.stringify(input.payload, null, 2)
  const messages: readonly AiPreviewMessage[] = [
    { role: 'system', content: AI_SYSTEM_PROMPT },
    { role: 'user', content: buildUserPrompt(input.payload, input.caliberNotes) },
  ]
  const schemaVersion = AI_SUMMARY_SCHEMA_VERSION
  const hash = previewHashOf(
    hashInputOf({ schemaVersion, promptVersion: AI_PROMPT_VERSION, payloadJson, messages, params, destination }),
  )

  const removedDimensions = input.payload.omitted.map((item) => item.metricId)

  return {
    hash,
    schemaVersion,
    promptVersion: AI_PROMPT_VERSION,
    generatedAt: input.generatedAt,
    payload: input.payload,
    payloadJson,
    messages,
    params,
    destination,
    desensitizeNotes: buildDesensitizeNotes(input.payload, {
      suppressedCellCount: input.payload.suppressedCellCount,
      removedDimensions,
    }),
    contentBytes: new TextEncoder().encode(payloadJson).length,
  }
}

/**
 * 确认令牌：**只能消费一次**。
 *
 * 为什么不是一个 `boolean confirmed`：布尔量无法表达「确认的是哪一份内容」。
 * 令牌绑定预览 hash，消费后立即失效，因此
 * 「改了参数 → 旧令牌 hash 与当前不一致 → 拒绝发送」是结构上成立的，
 * 不依赖界面有没有记得重置状态（AI03 / AI09 / AI10 的基础）。
 */
export type AiConfirmationToken = {
  readonly hash: string
  readonly confirmedAt: string
}

export type AiConfirmationState = {
  readonly token: AiConfirmationToken | null
  readonly consumed: boolean
}

export const EMPTY_CONFIRMATION: AiConfirmationState = { token: null, consumed: false }

/** 用户点击「确认」：把当前预览的 hash 记为已确认（未消费） */
export function confirmPreview(hash: string, confirmedAt: string): AiConfirmationState {
  return { token: { hash, confirmedAt }, consumed: false }
}

export type AiConsumeResult =
  | { readonly ok: true; readonly state: AiConfirmationState }
  | { readonly ok: false; readonly state: AiConfirmationState; readonly reason: string }

/**
 * 消费确认令牌。三道检查，任一不过就拒绝：
 * 1. 没有令牌 → 未确认；
 * 2. 令牌已被消费 → 防双击重复计费（AI02）；
 * 3. 令牌 hash 与**当前**预览 hash 不一致 → 参数已变，旧确认失效（AI03 / AI09）。
 */
export function consumeConfirmation(
  state: AiConfirmationState,
  currentHash: string,
): AiConsumeResult {
  if (state.token === null) {
    return { ok: false, state, reason: '尚未确认：请先查看完整预览并点击确认。' }
  }
  if (state.consumed) {
    return { ok: false, state, reason: '本次确认已被使用：需要重新预览并再次确认。' }
  }
  if (state.token.hash !== currentHash) {
    return {
      ok: false,
      state,
      reason: '预览内容或参数已变化：旧确认已失效，请重新查看预览并确认。',
    }
  }
  return { ok: true, state: { token: state.token, consumed: true } }
}

/** 预览是否仍然对当前参数有效（界面据此决定要不要提示「需重新生成」） */
export function isPreviewStale(preview: AiPreview, currentHash: string): boolean {
  return preview.hash !== currentHash
}
