/**
 * AI 深度分析工作区（AI-1，docs/PRD.md 16.1 / 16.2 / 18.1 / 18.4 / 18.5）。
 *
 * ## 本步到底做了什么（以及刻意没做什么）
 *
 * 做：把当前筛选下的**聚合结果**交给脱敏引擎，在本机构造一份完整的候选载荷与预览，
 * 让用户逐字核对；确认按钮只**消费一次性确认令牌**，然后明确告诉用户「没有发出请求」。
 *
 * 不做（都属于后续 AI 步骤）：网络调用与 Authorization 头（AI-4）、
 * 结果展示与历史（AI-5 及以后）。**已交付**：脱敏引擎与预览（AI-1）、摘要生成器（AI-2）、
 * 模型目录与参数配置、API Key 的会话 / 加密保存（AI-3，在设置页）。
 * 本文件里**没有**也不允许出现
 * `fetch` / `XMLHttpRequest` / `sendBeacon` / `WebSocket`（有逐行扫描的 guard 测试）。
 *
 * ## 为什么状态不是一个 `confirmed: boolean`
 *
 * 「改了参数就撤销旧确认」如果靠界面记得重置一个布尔量，早晚会漏（比如新增一个参数控件）。
 * 因此这里把确认交给引擎的 `confirmPreview` / `consumeConfirmation`：
 * - 确认令牌绑定**预览 hash**（载荷 + messages + 参数 + 目的地的指纹）；
 * - 参数一变，当前输入算出的 hash 就变，`isPreviewStale` 立刻为真，
 *   被确认过的旧令牌会被 `consumeConfirmation` 以「已失效」拒绝；
 * - 令牌消费后 `consumed = true`，再点一次会被以「已被使用」拒绝（AI02 / AI03 / AI09）。
 *
 * ## 提交接缝
 *
 * `onSubmit` 是本步的**唯一**提交出口，默认实现是模拟提交（只显示「没有发出请求」）。
 * AI-4 会把它替换成唯一网络适配器，而那个适配器**不能接收原始记录类型**——
 * 它只接受 `AiPreview`，因为预览里已经只有聚合载荷了。
 */

import { useMemo, useState, type ReactNode } from 'react'

import { formatInteger } from '../../lib/format'
import {
  AI_DEFAULT_DESTINATION,
  AI_DEFAULT_PARAMS,
  EMPTY_CONFIRMATION,
  buildAiPreview,
  confirmPreview,
  consumeConfirmation,
  isPreviewStale,
  type AiConfirmationState,
  type AiDestination,
  type AiModelParams,
  type AiPreview,
} from '../../privacy/aiPreview'
import {
  AI_DEFAULT_MODEL_ID,
  AI_MODEL_CATALOG,
  AI_PARAM_RANGES,
  AI_REASONING_EFFORTS,
  AI_CORS_UNVERIFIED_NOTE,
  AI_CATALOG_VERIFIED_AT,
  paramSupportOf,
  type AiReasoningEffort,
} from '../../ai/catalog'
import {
  describeResolvedParams,
  resolveAiParams,
  type AiConfigDraft,
  type AiThinkingSetting,
} from '../../ai/aiConfig'
import {
  DEFAULT_AI_SUBMIT_CLIENT,
  type AiSubmitClient,
  type AiSubmitOutcome,
} from './aiSubmit'
import { aiSendRequestOf, type AiSendRequest } from '../../ai/client'
import type { AiHistoryPayload } from '../../ai/aiHistory'
import {
  AI_DIMENSION_LABELS,
  AI_DIMENSIONS_BY_LEVEL,
  buildSanitizedAiPayload,
  type AiAllowedDimension,
  type AiSourceCell,
  type AiSourceKpi,
  type AiSourceProfileCell,
  type PositionCategoryRule,
  type SanitizedAiPayload,
} from '../../privacy/aiSummary'
import type { PrivacyLevel } from '../../privacy/sanitize'

import AiPreviewPanel, { type AiCopyState } from './AiPreviewPanel'
import {
  AI_COPY_DONE,
  AI_COPY_FAILED,
  AI_CUSTOM_DIMENSIONS_HINT,
  AI_CUSTOM_DIMENSIONS_LABEL,
  AI_CUSTOM_EMPTY_NOTE,
  AI_DISABLED_NOTE,
  AI_ENTRY_NOTE,
  AI_GENERATE_LABEL,
  AI_NOT_IMPLEMENTED_NOTE,
  AI_NO_PREVIEW_NOTE,
  AI_PARAM_INVALID_NOTE,
  AI_PARAM_MAX_TOKENS_LABEL,
  AI_PARAM_MODEL_LABEL,
  AI_PARAM_TEMPERATURE_LABEL,
  AI_PARAM_THINKING_LABEL,
  AI_PARAM_TIMEOUT_LABEL,
  AI_PARAMS_HINT,
  AI_PARAMS_TITLE,
  AI_PRIVACY_LEVEL_HINT,
  AI_PRIVACY_LEVEL_LABEL,
  AI_PRIVACY_LEVEL_OPTIONS,
  AI_REGENERATE_LABEL,
  AI_SCOPE_TITLE,
  AI_SUBJECT_RULES_BLOCK_NOTE,
  AI_SUBJECT_RULES_BLOCK_REASON,
  AI_SUBJECT_RULES_BLOCK_TITLE,
  AI_SUBJECT_RULES_FINGERPRINT_LABEL,
  AI_WORKSPACE_INTRO,
  AI_WORKSPACE_NO_DATA_DESCRIPTION,
  AI_WORKSPACE_NO_DATA_ITEMS,
  AI_WORKSPACE_NO_DATA_TITLE,
  AI_WORKSPACE_TITLE,
} from './aiText'

/* ------------------------------------------------------------------ 输入契约 */

/**
 * 工作区需要的**全部**输入。刻意是「一个数据对象 + 回调」而不是十几个散参数：
 * 数据来源只有一个（看板的唯一装配点），界面不得自己去读会话或另算指标。
 */
export type AiWorkspaceData = {
  /** 候选单元格（由 `buildAiSourceCells` 从已算好的分组得到） */
  readonly cells: readonly AiSourceCell[]
  readonly kpi: AiSourceKpi
  readonly scope: {
    readonly rowCount: number
    readonly dedupPolicy: string
    /** 生效筛选的可读描述（必须已脱敏：不得含文件名 / 学校全名 / HR 真名） */
    readonly filters: readonly string[]
    readonly ruleVersion: string
    readonly dataAsOf: string
  }
  /** 拒 offer 原因分布：只允许**受控类别 + 计数**，自由文本原文不进载荷 */
  readonly reasons: readonly { readonly category: string; readonly count: number }[]
  readonly quality: {
    readonly unknownStatus: number
    readonly missingSalary: number
    readonly unknownSchool: number
  }
  /** 本地口径说明（会随 user message 展示，必须是可外发文本） */
  readonly caliberNotes: readonly string[]
  /**
   * 拒 offer **组内构成**候选格（AI-2，可选）。
   *
   * 不提供时载荷里不会出现组间比较块——**不是**发一个空块或补 0 的版本。
   */
  readonly rejectionProfile?: readonly AiSourceProfileCell[]
  /** 组间比较的两个人群分母（缺省时载荷里不讲「少了多少人」，那会让读者把两个分母当成同一个） */
  readonly rejectionTotals?: {
    readonly rejectedTotal: number
    readonly joinedTotal: number
    readonly excludedFromComparison: number
  }
}

export type AiAnalysisWorkspaceProps = {
  readonly data: AiWorkspaceData
  /** 初始参数（来自设置页保存的 AI 配置）；缺省用引擎默认值 */
  readonly initialParams?: AiModelParams
  /**
   * AI 是否已启用（PRD 18.1：默认关闭，开关在设置页）。
   *
   * 关闭时**只禁用「生成预览」而不隐藏工作区**：用户需要知道「AI 功能存在但没打开」，
   * 而不是面对一个消失的入口。开关打开也不代表已授权——每次发送仍要逐次确认。
   */
  readonly enabled?: boolean
  /** 复制实现；默认用 `navigator.clipboard`，取不到时降级为「请手动选择」 */
  readonly onCopy?: (text: string) => Promise<boolean>
  /**
   * 发送接缝（AI-4）。默认是**真实适配器**（`src/ai/aiClient.ts` 的 `sendAiRequestOnce`）。
   *
   * 为什么做成可注入的接口而不是直接 import 真实适配器：
   * 1. 组件测试必须能在**不发任何请求**的前提下验证「未确认 0 请求 / 确认恰好 1 次」——
   *    注入假客户端后，测试可以精确数出调用次数与传进去的正文；
   * 2. 真实适配器里写着 `fetch`，而 `features/ai/**` 有逐行扫描的守卫禁止出现调用形状；
   *    经由 `src/ai/aiClient.ts` 这一个文件调用，守卫才会保持有意义。
   *
   * 注意：本组件**不**校验确认令牌之外的东西——令牌的消费由
   * `privacy/aiPreview.ts` 的 `consumeConfirmation` 负责，且必须在调用客户端**之前**成功。
   * 因此「没确认就发请求」在这条路径上不可能发生。
   */
  readonly client?: AiSubmitClient
  /**
   * 保存结果到本地历史（AI-5）。缺省时不显示保存按钮——**不假装能保存**。
   * 由看板传入 `saveAiHistoryEntry`；只有用户点击才会写盘（PRD 16.5）。
   */
  readonly onSaveHistory?: (
    payload: AiHistoryPayload,
  ) => Promise<{ readonly ok: boolean; readonly reason?: string }>
  /** 初始脱敏级别（AI-6，来自设置页保存的默认级别）；缺省 standard */
  readonly initialPrivacyLevel?: PrivacyLevel
  /** 初始自定义维度（AI-6，跟随设置页的默认级别） */
  readonly initialCustomDimensions?: readonly AiAllowedDimension[]
  /** 初始目的地（AI-6，来自设置页的代理登记）；缺省官方端点 */
  readonly initialDestination?: AiDestination
  /** 岗位类别映射（AI-6）：只在本机查表，岗位原文不进载荷 */
  readonly positionCategories?: readonly PositionCategoryRule[]
  /**
   * 本机规则是否已确认（AI-6，来自设置页的二次确认）。
   *
   * 缺省 `true` = 不启用这道闸门（例如 AI-1 时代的调用方与组件测试）：
   * 闸门是**加法**，缺省不改变既有行为。看板会显式传入真实结论，
   * 未确认时「生成预览」仍然可用（看预览不发任何东西），但不会发请求。
   */
  readonly subjectRulesConfirmed?: boolean
  /** 当前规则指纹（仅用于展示，让用户对得上设置页显示的那一串） */
  readonly subjectRulesFingerprint?: string
  /**
   * 「AI 设置」内联槽位（用户反馈，2026-09-27 晚）。
   *
   * 用户的原话是「把设置里 AI 相关的信息放到分析看板中来，交互应该是
   * 分析看板 → AI 深度分析 → 填写 API → 确认分析」。看板把**同一个** `AiSettingsPanel`
   * 作为槽位传进来，因此开关 / Key / 本地规则确认可以在原地完成，而不必跳去设置页再跳回来。
   *
   * 为什么用槽位而不是在这里 import 面板：设置面板属于 `features/settings`，
   * 让 `features/ai` 反向依赖它会把两个功能区的边界搅在一起；槽位只要求「一块内容」。
   * 槽位缺省时不渲染这一块（保持既有调用方与组件测试的行为）。
   */
  readonly settingsSlot?: ReactNode
  /** 打开工作区时「AI 设置」是否默认展开；缺省在 AI 未启用时展开（那正是用户需要它的时刻） */
  readonly settingsSlotDefaultOpen?: boolean
}

/* ------------------------------------------------------------------ 参数草稿 */

/**
 * 参数草稿与「实际发出的参数」都**不在这里定义**（AI-3 起）。
 *
 * 口径集中在两处，组件不复制任何一条：
 * - 草稿结构与默认值：`src/ai/aiConfig.ts` 的 `AiConfigDraft` / `defaultAiConfigDraft()`；
 * - 可用性、范围收敛、旧模型兼容提示：同一个文件的 `resolveAiParams()`。
 *
 * 为什么必须收走：`temperature` 在思考模式下无效、`top_p` 只在思考模式生效、
 * `max_tokens` 受模型能力与产品预算双重上限约束——这些规则若在组件里再写一遍，
 * 早晚会与请求层不一致，而「发出去被静默忽略」比报错更难发现。
 */
function configDraftOf(params: AiModelParams): AiConfigDraft {
  return {
    model: params.model,
    thinking: params.thinking,
    reasoningEffort: params.reasoningEffort ?? '',
    temperature: params.temperature === undefined ? '' : String(params.temperature),
    topP: params.topP === undefined ? '' : String(params.topP),
    maxTokens: String(params.maxTokens),
    timeoutMs: String(params.timeoutMs),
  }
}

/** 默认复制实现：优先异步剪贴板 API；不可用时如实告诉用户「请手动选择」 */
async function defaultCopy(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return false
  }
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    // 剪贴板在非安全上下文 / 无用户手势 / 权限被拒时都会抛错，属于预期分支
    return false
  }
}

/**
 * 「被确认的内容是否已不再是当前内容」。
 *
 * 正常情况下预览与当前输入同源，所以它恒为 false；保留这条通路是为了让
 * 「过期」只有一个判据：拿被确认的预览与**当前输入重新算出的**预览比 hash。
 * 界面永远不自己记「有没有改过参数」——那种记法迟早会漏。
 */
function staleAgainst(
  preview: AiPreview,
  payload: SanitizedAiPayload,
  caliberNotes: readonly string[],
  params: AiModelParams,
  destination: AiDestination,
): boolean {
  const recomputed = buildAiPreview({
    payload,
    caliberNotes,
    params,
    destination,
    generatedAt: preview.generatedAt,
  })
  return isPreviewStale(preview, recomputed.hash)
}

/* ------------------------------------------------------------------ 组件 */

export default function AiAnalysisWorkspace({
  data,
  initialParams,
  initialPrivacyLevel = 'standard',
  initialCustomDimensions,
  initialDestination,
  positionCategories = [],
  subjectRulesConfirmed = true,
  subjectRulesFingerprint,
  enabled = true,
  settingsSlot,
  settingsSlotDefaultOpen,
  onCopy,
  client = DEFAULT_AI_SUBMIT_CLIENT,
  onSaveHistory,
}: AiAnalysisWorkspaceProps) {
  const [privacyLevel, setPrivacyLevel] = useState<PrivacyLevel>(initialPrivacyLevel)
  const [customDimensions, setCustomDimensions] = useState<readonly AiAllowedDimension[]>(
    initialCustomDimensions === undefined || initialCustomDimensions.length === 0
      ? AI_DIMENSIONS_BY_LEVEL.standard
      : initialCustomDimensions,
  )
  const [paramsDraft, setParamsDraft] = useState<AiConfigDraft>(() =>
    configDraftOf(initialParams ?? AI_DEFAULT_PARAMS),
  )
  /**
   * 预览的生成时间：`null` 表示还没有点过「生成脱敏预览」。
   * 它同时是「有没有预览」和「预览是哪一刻的快照」的来源；
   * 它**不参与 hash**（引擎明确说明：算进去会让同一份内容每次生成都换 hash）。
   */
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<AiConfirmationState>(EMPTY_CONFIRMATION)
  const [submitOutcome, setSubmitOutcome] = useState<AiSubmitOutcome>({ kind: 'idle' })
  const [copyState, setCopyState] = useState<AiCopyState>({ kind: 'idle' })

  /**
   * 实际会发送的配置（**唯一口径**，`src/ai/aiConfig.ts` 的 `resolveAiParams`）。
   *
   * 组件不自己 clamp、不自己判断「这个参数能不能发」：那些规则的唯一实现点在引擎层，
   * 而 `config.notices` 会把每一次本地调整如实带回界面展示。
   */
  const config = useMemo(() => resolveAiParams(paramsDraft), [paramsDraft])
  const params = config.params
  /** 请求目的地：由设置页算出后传入（代理登记的唯一判定点是 `aiDestinationOf`） */
  const destination: AiDestination = initialDestination ?? AI_DEFAULT_DESTINATION

  /** 载荷：**纯本地构造**，没有任何 I/O；输入变化时它就是新的候选载荷 */
  const payload = useMemo(
    () =>
      buildSanitizedAiPayload({
        privacyLevel,
        scope: {
          rowCount: data.scope.rowCount,
          dedupPolicy: data.scope.dedupPolicy,
          filters: data.scope.filters,
          ruleVersion: data.scope.ruleVersion,
          dataAsOf: data.scope.dataAsOf,
        },
        kpi: data.kpi,
        cells: data.cells,
        reasons: data.reasons.map((item) => ({ category: item.category, count: item.count })),
        quality: data.quality,
        caliberNotes: data.caliberNotes,
        // `generatedAt` 原本会进载荷的展示字段；hash 不含它，因此重新生成不会无谓地作废旧确认
        generatedAt: generatedAt ?? '',
        // custom 级别下实际允许的维度：引擎只允许在 standard 白名单内**收窄**
        allowedDimensions: privacyLevel === 'custom' ? customDimensions : undefined,
        // 岗位类别映射（AI-6）：引擎会在载荷构造时再规范化一次，不合格的规则被丢掉
        positionCategories,
        rejectionProfile: data.rejectionProfile,
        rejectionTotals: data.rejectionTotals,
      }),
    [
      privacyLevel,
      customDimensions,
      positionCategories,
      data.cells,
      data.kpi,
      data.reasons,
      data.quality,
      data.caliberNotes,
      data.rejectionProfile,
      data.rejectionTotals,
      data.scope.rowCount,
      data.scope.dedupPolicy,
      data.scope.filters,
      data.scope.ruleVersion,
      data.scope.dataAsOf,
      generatedAt,
    ],
  )

  /** 当前输入对应的预览（也是 user message 与 payloadJson 的唯一来源） */
  const preview = useMemo(
    () =>
      buildAiPreview({
        payload,
        caliberNotes: data.caliberNotes,
        params,
        destination,
        generatedAt: generatedAt ?? '',
      }),
    [payload, data.caliberNotes, params, destination, generatedAt],
  )

  const stale = staleAgainst(preview, payload, data.caliberNotes, params, destination)
  const confirmed = confirmation.token !== null && !confirmation.consumed
  /**
   * 已消费的令牌不能再点（AI02），**本机规则未确认时也不能点**（AI-6）。
   *
   * 第二道闸门与确认令牌是两件事：令牌回答「你批准了哪一份内容」，
   * 规则确认回答「你知不知道摘要里的岗位类别 / 学校层次 / 原因主题是从哪来的」。
   * 两者都为真才允许发请求——生成预览不受影响（看预览不发送任何东西）。
   */
  const canConfirm = !stale && !confirmation.consumed && subjectRulesConfirmed

  /** 任何会改变「将要发送的内容」的改动都必须作废旧确认（靠 hash，不靠界面记得清布尔量） */
  const invalidate = (): void => {
    setConfirmation(EMPTY_CONFIRMATION)
    setSubmitOutcome({ kind: 'idle' })
    setCopyState({ kind: 'idle' })
  }

  const handlePrivacyLevel = (level: PrivacyLevel): void => {
    setPrivacyLevel(level)
    if (level === 'custom') {
      // 首次切到 custom 时给一份显式初值（standard 白名单），避免用户对着空清单猜
      setCustomDimensions((current) =>
        current.length === 0 ? AI_DIMENSIONS_BY_LEVEL.standard : current,
      )
    }
    invalidate()
  }

  const toggleCustomDimension = (dimension: AiAllowedDimension): void => {
    setCustomDimensions((current) =>
      current.includes(dimension)
        ? current.filter((item) => item !== dimension)
        : [...current, dimension],
    )
    invalidate()
  }

  const handleParamChange = (next: AiConfigDraft): void => {
    setParamsDraft(next)
    invalidate()
  }

  const handleGenerate = (): void => {
    invalidate()
    setGeneratedAt(new Date().toISOString())
  }

  const handleCancel = (): void => {
    setGeneratedAt(null)
    invalidate()
  }

  /**
   * 「确认」：把**当前这一份预览**的 hash 记成已确认（还**没有**消费）。
   *
   * 为什么确认与提交要分开两步：确认回答的是「用户批准的是哪一份内容」，
   * 提交回答的是「这一次请求能不能发」。合成一步会让「防双击重复计费」无处落脚
   * （AI02 要求第二次点击不产生第二次付费请求）。
   */
  const handleConfirm = (): void => {
    if (generatedAt === null) {
      // 没有预览就没有「被批准的内容」，连令牌都不该存在
      return
    }
    setConfirmation(confirmPreview(preview.hash, new Date().toISOString()))
    setSubmitOutcome({ kind: 'idle' })
  }

  /**
   * 提交：**先消费一次性确认令牌，再发请求**（顺序不可颠倒）。
   *
   * 三种令牌层面的拒绝（未确认 / 已被使用 / 已失效）都照抄引擎原文，界面不改写成更
   * 「友好」的说法——那会掩盖真正的状态。只有 `ok === true` 才允许进入发送路径，
   * 因此「没确认就发请求」在这条路径上不可能发生（AI01 的第一条）。
   *
   * 发送期间的三种结局都如实分开显示：
   * - 网络 / HTTP 失败 → `failed`（带分类后的错误，**没有重试按钮**）；
   * - 成功但**迟到**（期间锁定 / 清空 / 切换过）→ `current: false`，界面必须丢弃结果；
   * - 成功且有效 → `sent`。
   */
  const handleSubmit = (): void => {
    /*
     * 规则未确认时**先于令牌消费**拒绝：这不是「令牌无效」，而是「这批规则你还没确认」。
     * 放在前面还有一个好处：令牌不会被这条路径吃掉，用户确认规则后仍可用同一份预览。
     */
    if (!subjectRulesConfirmed) {
      setSubmitOutcome({ kind: 'rejected', reason: AI_SUBJECT_RULES_BLOCK_REASON })
      return
    }
    const result = consumeConfirmation(confirmation, preview.hash)
    setConfirmation(result.state)
    if (!result.ok) {
      setSubmitOutcome({ kind: 'rejected', reason: result.reason })
      return
    }

    const request: AiSendRequest = aiSendRequestOf(preview, destination)
    setSubmitOutcome({ kind: 'cancelling' })
    void client.sendOnce(request).then(
      (outcome) => {
        if (outcome.ok) {
          setSubmitOutcome({ kind: 'sent', result: outcome.result, current: outcome.current })
        } else {
          setSubmitOutcome({ kind: 'failed', error: outcome.error, current: outcome.current })
        }
      },
      (cause: unknown) => {
        // 客户端实现自己抛错（不该发生）：收敛成一个可展示的错误，绝不冒泡成白屏
        setSubmitOutcome({
          kind: 'failed',
          current: true,
          error: {
            kind: 'network',
            message: '发送时出现未预期的错误。',
            status: null,
            code: null,
            advice:
              cause instanceof Error && cause.message.trim() !== ''
                ? `底层信息：${cause.message}`
                : null,
          },
        })
      },
    )
  }

  /** 取消：本地停止等待；**不承诺**服务端未处理、也不承诺免收费 */
  const handleCancelRequest = (): void => {
    client.cancel()
    setSubmitOutcome({ kind: 'cancelling' })
  }

  /**
   * 按钮文案与引擎语义的分工：「确认并调用 DeepSeek」第一次点击 = 建立令牌（用户批准了
   * 这一份预览）；紧接着的第二次点击 = 消费令牌（本步的模拟提交）。
   * 这样「确认」与「提交」在引擎里是两步，界面却只有一个符合 PRD 文案的按钮。
   */
  const handleConfirmOrSubmit = (): void => {
    if (!confirmed) {
      handleConfirm()
      return
    }
    handleSubmit()
  }

  const handleCopy = (): void => {
    const write = onCopy ?? defaultCopy
    void write(preview.payloadJson).then(
      (ok) =>
        setCopyState({
          kind: ok ? 'copied' : 'failed',
          message: ok ? AI_COPY_DONE : AI_COPY_FAILED,
        }),
      () =>
        setCopyState({
          kind: 'failed',
          message: AI_COPY_FAILED,
        }),
    )
  }

  if (data.scope.rowCount === 0) {
    return (
      <section className="space-y-2 rounded-lg border border-dashed border-slate-300 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{AI_WORKSPACE_NO_DATA_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{AI_WORKSPACE_NO_DATA_DESCRIPTION}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
          {AI_WORKSPACE_NO_DATA_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    )
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">{AI_WORKSPACE_TITLE}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">{AI_WORKSPACE_INTRO}</p>
      </div>

      {/*
        用户反馈（2026-09-27 晚）：「把设置里 AI 相关的信息放到分析看板中来」——
        开关、API Key、本地规则确认都能在**原地**完成，不必再跳到设置页。
        这里只负责摆一个可折叠的容器：里面的面板由看板原样传入（同一个组件、同一套口径），
        因此不会出现「看板里一套设置、设置页里另一套」。
        默认展开条件：AI 还没启用时（那正是用户最需要看到开关与 Key 输入框的时刻）。
      */}
      {settingsSlot === undefined ? null : (
        <details
          className="rounded border border-slate-200 bg-slate-50 p-3"
          open={settingsSlotDefaultOpen ?? !enabled}
        >
          <summary className="cursor-pointer text-xs font-medium text-slate-800">
            AI 设置（开关 / API Key / 本地规则确认）——就在这里改，不用跳到设置页
          </summary>
          <div className="mt-2">{settingsSlot}</div>
        </details>
      )}

      {/* 摘要范围摊开写：用户要能看出「这份摘要对应哪一次筛选、哪份数据」 */}
      <section className="space-y-1 rounded border border-slate-200 bg-slate-50 p-3">
        <h4 className="text-xs font-semibold text-slate-800">{AI_SCOPE_TITLE}</h4>
        <p className="text-xs leading-5 text-slate-600">
          参与聚合的记录：{formatInteger(data.scope.rowCount)} 条；截至 {data.scope.dataAsOf}；
          去重策略：{data.scope.dedupPolicy}；规则版本：{data.scope.ruleVersion}。
        </p>
        {data.scope.filters.length === 0 ? (
          <p className="text-xs leading-5 text-slate-600">当前没有生效筛选：摘要覆盖全部记录。</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-600">
            {data.scope.filters.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
      </section>

      {subjectRulesConfirmed ? null : (
        <section className="space-y-1 rounded border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">{AI_SUBJECT_RULES_BLOCK_TITLE}</p>
          <p className="text-xs leading-5 text-amber-900">{AI_SUBJECT_RULES_BLOCK_NOTE}</p>
          {subjectRulesFingerprint === undefined ? null : (
            <p className="text-xs leading-5 text-amber-900">
              {AI_SUBJECT_RULES_FINGERPRINT_LABEL}：
              <span className="font-mono">{subjectRulesFingerprint}</span>
            </p>
          )}
        </section>
      )}

      <section className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
        <h4 className="text-xs font-semibold text-slate-800">{AI_PRIVACY_LEVEL_LABEL}</h4>
        <p className="text-xs leading-5 text-slate-600">{AI_PRIVACY_LEVEL_HINT}</p>
        <div className="space-y-1">
          {(Object.keys(AI_PRIVACY_LEVEL_OPTIONS) as readonly PrivacyLevel[]).map((level) => (
            <label className="flex items-start gap-2 text-xs leading-5 text-slate-700" key={level}>
              <input
                checked={privacyLevel === level}
                className="mt-0.5"
                name="ai-privacy-level"
                onChange={() => handlePrivacyLevel(level)}
                type="radio"
                value={level}
              />
              <span>
                <span className="font-medium text-slate-900">
                  {AI_PRIVACY_LEVEL_OPTIONS[level].label}
                </span>
                ：{AI_PRIVACY_LEVEL_OPTIONS[level].description}
              </span>
            </label>
          ))}
        </div>

        {privacyLevel === 'custom' ? (
          <div className="space-y-1 rounded border border-slate-200 bg-white p-3">
            <p className="text-xs font-medium text-slate-800">{AI_CUSTOM_DIMENSIONS_LABEL}</p>
            <p className="text-xs leading-5 text-slate-600">{AI_CUSTOM_DIMENSIONS_HINT}</p>
            <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
              {AI_DIMENSIONS_BY_LEVEL.standard.map((dimension) => (
                <label
                  className="flex items-center gap-2 text-xs leading-5 text-slate-700"
                  key={dimension}
                >
                  <input
                    checked={customDimensions.includes(dimension)}
                    onChange={() => toggleCustomDimension(dimension)}
                    type="checkbox"
                  />
                  <span>{AI_DIMENSION_LABELS[dimension]}</span>
                </label>
              ))}
            </div>
            {customDimensions.length === 0 ? (
              <p className="text-xs leading-5 text-amber-800">{AI_CUSTOM_EMPTY_NOTE}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-2 rounded border border-slate-200 bg-slate-50 p-3">
        <h4 className="text-xs font-semibold text-slate-800">{AI_PARAMS_TITLE}</h4>
        <p className="text-xs leading-5 text-slate-600">{AI_PARAMS_HINT}</p>

        {/*
          模型改成**目录驱动的下拉**（AI-3）：AI-1 是自由文本，无法表达
          「这个模型已停用」「这个模型不支持思考」。仍然允许手填官方 ID，
          但会明确标注「不在本版本核实的目录里」——目录见 src/ai/catalog.ts。
        */}
        <label className="block text-xs text-slate-700">
          {AI_PARAM_MODEL_LABEL}
          <select
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
            onChange={(event) => handleParamChange({ ...paramsDraft, model: event.target.value })}
            value={AI_MODEL_CATALOG.some((spec) => spec.id === paramsDraft.model) ? paramsDraft.model : ''}
          >
            <option value="">（自定义模型 ID：见下方输入框）</option>
            {AI_MODEL_CATALOG.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-700">
          自定义模型 ID（留空表示使用上面的选择）
          <input
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            onChange={(event) => handleParamChange({ ...paramsDraft, model: event.target.value })}
            placeholder={AI_DEFAULT_MODEL_ID}
            type="text"
            value={paramsDraft.model}
          />
        </label>
        <p className="text-xs leading-5 text-slate-500">
          当前生效模型：{config.spec.id}｜官方模型版本：{config.spec.modelVersion}｜上下文{' '}
          {formatInteger(config.spec.contextWindowTokens)} tokens｜输出上限{' '}
          {formatInteger(config.spec.maxOutputTokens)} tokens｜目录核实日期 {AI_CATALOG_VERIFIED_AT}
        </p>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {/* 思考模式：三态（不指定 / 开启 / 关闭），因为官方默认是**打开** */}
          <label className="text-xs text-slate-700">
            {AI_PARAM_THINKING_LABEL}
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              disabled={!paramSupportOf(config.spec, 'thinking', false).supported}
              onChange={(event) =>
                handleParamChange({
                  ...paramsDraft,
                  thinking: event.target.value as AiThinkingSetting,
                })
              }
              value={paramsDraft.thinking}
            >
              <option value="auto">不指定（由服务端按模型默认处理）</option>
              <option value="enabled">开启</option>
              <option value="disabled">关闭</option>
            </select>
          </label>

          <label className="text-xs text-slate-700">
            推理强度 reasoning_effort
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              disabled={!paramSupportOf(config.spec, 'reasoningEffort', config.thinkingActive).supported}
              onChange={(event) =>
                handleParamChange({
                  ...paramsDraft,
                  reasoningEffort: event.target.value as AiReasoningEffort | '',
                })
              }
              value={paramsDraft.reasoningEffort}
            >
              <option value="">不指定（由服务端使用默认档位）</option>
              {AI_REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs text-slate-700">
            {AI_PARAM_TEMPERATURE_LABEL}            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
              disabled={!paramSupportOf(config.spec, 'temperature', config.thinkingActive).supported}
              max={AI_PARAM_RANGES.temperature.max}
              min={AI_PARAM_RANGES.temperature.min}
              onChange={(event) =>
                handleParamChange({ ...paramsDraft, temperature: event.target.value })
              }
              step={AI_PARAM_RANGES.temperature.step}
              type="number"
              value={paramsDraft.temperature}
            />
          </label>

          <label className="text-xs text-slate-700">
            top_p（只在思考模式生效）
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
              disabled={!paramSupportOf(config.spec, 'topP', config.thinkingActive).supported}
              max={AI_PARAM_RANGES.topP.max}
              min={AI_PARAM_RANGES.topP.min}
              onChange={(event) => handleParamChange({ ...paramsDraft, topP: event.target.value })}
              step={AI_PARAM_RANGES.topP.step}
              type="number"
              value={paramsDraft.topP}
            />
          </label>

          <label className="text-xs text-slate-700">
            {AI_PARAM_MAX_TOKENS_LABEL}
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              max={Math.min(config.spec.maxOutputTokens, AI_PARAM_RANGES.maxTokens.max)}
              min={AI_PARAM_RANGES.maxTokens.min}
              onChange={(event) =>
                handleParamChange({ ...paramsDraft, maxTokens: event.target.value })
              }
              step="1"
              type="number"
              value={paramsDraft.maxTokens}
            />
          </label>

          <label className="text-xs text-slate-700">
            {AI_PARAM_TIMEOUT_LABEL}
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              max={AI_PARAM_RANGES.timeoutMs.max}
              min={AI_PARAM_RANGES.timeoutMs.min}
              onChange={(event) =>
                handleParamChange({ ...paramsDraft, timeoutMs: event.target.value })
              }
              step={AI_PARAM_RANGES.timeoutMs.step}
              type="number"
              value={paramsDraft.timeoutMs}
            />
          </label>
        </div>

        {/*
          用户第二次真实调用踩到的坑（2026-09-27 深夜）：他用的模型「思考模式默认为开启」，
          而推理内容**同样计入 max_tokens**；2048 的额度被推理吃光后正文就是空的，
          而当时的提示只写「content 为空，请检查模型与参数」，等于没告诉他该改哪里。
          这里在「思考模式 = 不指定」且**该模型默认开启**时把这件事直接说出来
          （事实取自模型目录 `thinkingDefaultEnabled`，界面不自己判断）。
        */}
        {paramsDraft.thinking === 'auto' && config.spec.thinkingDefaultEnabled ? (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
            这个模型（{config.spec.id}）的思考模式默认为开启，而推理内容与正文共用「最长输出
            max_tokens」这一个额度：额度被推理用尽时，正文会是空的。若你遇到「正文为空」，
            请把思考模式设为「关闭」，或把最长输出调大（例如 8192）。
          </p>
        ) : null}

        {/* 本步实际会发送什么参数：与设置页共用同一份取值来源 */}
        <div className="rounded border border-slate-200 bg-white p-2">
          <p className="text-xs font-medium text-slate-800">本次实际会发送的参数</p>
          <ul className="mt-1 space-y-0.5 text-xs leading-5 text-slate-600">
            {describeResolvedParams(config).map((row) => (
              <li key={row.label}>
                {row.label}：{row.value}
              </li>
            ))}
          </ul>
        </div>

        {config.notices.length > 0 ? (
          <div className="rounded border border-amber-300 bg-amber-50 p-2">
            <p className="text-xs font-medium text-amber-900">
              本机自动调整了 {config.notices.length} 项（不是错误，但必须让你知道）
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5 text-amber-900">
              {config.notices.map((notice) => (
                <li key={`${notice.code}-${notice.detail}`}>{notice.detail}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs leading-5 text-slate-500">{AI_PARAM_INVALID_NOTE}</p>
        <p className="text-xs leading-5 text-slate-500">{AI_CORS_UNVERIFIED_NOTE}</p>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!enabled}
          onClick={handleGenerate}
          type="button"
        >
          {generatedAt === null ? AI_GENERATE_LABEL : AI_REGENERATE_LABEL}
        </button>
        <p className="text-xs leading-5 text-slate-600">
          {enabled ? AI_ENTRY_NOTE : AI_DISABLED_NOTE}
        </p>
      </div>

      {generatedAt === null ? (
        <p className="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          {AI_NO_PREVIEW_NOTE}
        </p>
      ) : (
        <AiPreviewPanel
          canConfirm={canConfirm}
          confirmed={confirmed}
          copyState={copyState}
          onCancel={handleCancel}
          onCancelRequest={handleCancelRequest}
          onConfirm={handleConfirmOrSubmit}
          onCopy={handleCopy}
          {...(onSaveHistory === undefined ? {} : { onSaveHistory })}
          preview={preview}
          stale={stale}
          submitOutcome={submitOutcome}
        />
      )}

      <p className="text-xs leading-5 text-slate-500">{AI_NOT_IMPLEMENTED_NOTE}</p>
    </section>
  )
}
