/**
 * AI 配置的本地持久化（AI-3，docs/PRD.md 18.2）。
 *
 * ## 存什么、不存什么（这是本模块唯一重要的事）
 *
 * **存**（非敏感，可明文读的偏好）：AI 开关、Key 保存方式、模型与参数偏好。
 * 这些即使泄漏也不构成数据泄漏——它们只说明「用户打算怎么调模型」。
 *
 * **不存**：API Key 本身。Key 只有两条去路——内存（`keySession.ts`）或
 * 加密仓的独立秘密槽位（`encryptedVault.saveSecret('ai-api-key', …)`）。
 * 本模块**刻意没有**接受 Key 的参数，因此「顺手把 Key 存进偏好」在类型层就写不出来。
 *
 * ## 为什么必须有仓才持久化
 *
 * 偏好走 `encryptedVault.saveObject('preference', …)`，因此**必须先解锁**。
 * 临时模式下保存会抛错，界面据此提示「临时模式只在内存，刷新即失」——
 * 这比「静默不保存」诚实：用户以为存下来了、刷新后没了，才是更糟的体验。
 *
 * 本模块不依赖 React / Dexie（门面是懒加载的），可被界面安全引用。
 */

import { encryptedVault } from '../storage/vaultFacade'
import {
  AI_DIMENSIONS_BY_LEVEL,
  normalizePositionCategoryRules,
  type AiAllowedDimension,
  type PositionCategoryRule,
} from '../privacy/aiSummary'
import type { PrivacyLevel } from '../privacy/sanitize'
import {
  AI_DEFAULT_DESTINATION,
  AI_DEFAULT_PARAMS,
  type AiDestination,
  type AiModelParams,
} from '../privacy/aiPreview'
import { aiProxyDestinationOf } from './aiProxy'
import {
  AI_ENABLED_DEFAULT,
  AI_KEY_STORAGE_DEFAULT,
  type AiEnabled,
  type AiKeyStorageMode,
} from './aiConfig'

/** 偏好在仓对象里的固定 ID（`preference` 种类下的一条记录） */
export const AI_SETTINGS_OBJECT_ID = 'ai-analysis-settings'

/** 偏好结构版本：形状变化必须递增，读回旧版本时按默认值处理而不是硬猜 */
export const AI_SETTINGS_SCHEMA_VERSION = 'ai-settings/2'

/**
 * 用户登记的自有 / 本地代理（AI-6，PRD 18.6）。
 *
 * `origin` 为 `null` = 不配置代理（默认，请求发往官方端点）。
 * 登记必须**先逐条确认**边界（代理可见 Key 与摘要），因此 `acknowledgedAt` 是必需的——
 * 只有地址、没有确认时间的记录一律按「未登记」处理（见 `proxyDestinationOf`）。
 *
 * 刻意**不存**任何凭据：代理本身的认证（如果它需要）不属于本应用的职责范围。
 */
export type AiProxySettings = {
  readonly origin: string | null
  readonly acknowledgedAt: string | null
}

export type AiSettings = {
  readonly schemaVersion: typeof AI_SETTINGS_SCHEMA_VERSION
  readonly enabled: AiEnabled
  readonly keyStorage: AiKeyStorageMode
  /** 参数偏好（**不含 Key、不含历史**）；实际发送前仍会经 `resolveAiParams` 按能力表收敛 */
  readonly params: AiModelParams
  /** 三级脱敏级别（PRD 18.5）；默认 standard */
  readonly privacyLevel: PrivacyLevel
  /** custom 级别下允许的维度（**只能在 standard 白名单内收窄**） */
  readonly customDimensions: readonly AiAllowedDimension[]
  /** 岗位类别映射（AI-6）：只在本机查表，岗位原文不进载荷 */
  readonly positionCategories: readonly PositionCategoryRule[]
  /** 本地规则的二次确认（AI-6）：确认的是哪一份规则（指纹）+ 时间 */
  readonly subjectRulesFingerprint: string | null
  readonly subjectRulesConfirmedAt: string | null
  /** 自有 / 本地代理（默认不配置） */
  readonly proxy: AiProxySettings
  readonly updatedAt: string
}

export function defaultAiSettings(now: string = new Date().toISOString()): AiSettings {
  return {
    schemaVersion: AI_SETTINGS_SCHEMA_VERSION,
    enabled: AI_ENABLED_DEFAULT,
    keyStorage: AI_KEY_STORAGE_DEFAULT,
    params: AI_DEFAULT_PARAMS,
    privacyLevel: 'standard',
    customDimensions: AI_DIMENSIONS_BY_LEVEL.standard,
    positionCategories: [],
    subjectRulesFingerprint: null,
    subjectRulesConfirmedAt: null,
    proxy: { origin: null, acknowledgedAt: null },
    updatedAt: now,
  }
}

/**
 * 当前生效的请求目的地（**唯一判定点**）。
 *
 * 三条规则：
 * - 没有登记代理（或登记了但没有确认记录）→ 官方端点；
 * - 登记了代理 → 该 origin + 固定路径（路径不由用户填，避免「以为改了路径」）；
 * - 空白地址一律按未登记处理：不冒险发往一个空 origin。
 *
 * 与 `keySession` 的许可按 origin 绑定的规则配合：换了地址，旧许可不覆盖新地址，
 * 因此旧 Key 不会被转发过去（`AI_KEY_PERMISSION_STALE_NOTE`）。
 */
export function aiDestinationOf(settings: AiSettings): AiDestination {
  const origin = settings.proxy.origin?.trim() ?? ''
  if (origin === '' || settings.proxy.acknowledgedAt === null) {
    return AI_DEFAULT_DESTINATION
  }
  return aiProxyDestinationOf(origin)
}

/** 读回时的隐私级别校验：不认识的值回落 standard（默认级别，不放大也不缩小） */
function parsePrivacyLevel(value: unknown): PrivacyLevel {
  return value === 'strict' || value === 'custom' ? value : 'standard'
}

/** 读回时的自定义维度：只接受 standard 白名单内的维度，其余丢弃 */
function parseCustomDimensions(value: unknown): readonly AiAllowedDimension[] {
  if (!Array.isArray(value)) {
    return AI_DIMENSIONS_BY_LEVEL.standard
  }
  const standard = AI_DIMENSIONS_BY_LEVEL.standard as readonly string[]
  const kept = value.filter(
    (item): item is AiAllowedDimension => typeof item === 'string' && standard.includes(item),
  )
  return kept.length === 0 ? AI_DIMENSIONS_BY_LEVEL.standard : kept
}

/**
 * 严格解析读回的对象。
 *
 * 为什么不用 `as AiSettings` 硬转：仓里的内容是**可能被改过**的（用户手动改 IndexedDB、
 * 或未来版本写入了不同形状）。硬转会让一个缺字段的对象一路流到请求参数里，
 * 最终表现成「模型名是 undefined」。这里逐字段校验，任何不认识的值都回落到默认。
 */
export function parseAiSettings(value: unknown): AiSettings {
  if (typeof value !== 'object' || value === null) {
    return defaultAiSettings()
  }
  const record = value as Record<string, unknown>
  if (record.schemaVersion !== AI_SETTINGS_SCHEMA_VERSION) {
    return defaultAiSettings()
  }
  const enabled = record.enabled === true
  const keyStorage: AiKeyStorageMode =
    record.keyStorage === 'encrypted' ? 'encrypted' : 'memory'
  const paramsRecord =
    typeof record.params === 'object' && record.params !== null
      ? (record.params as Record<string, unknown>)
      : {}

  const model =
    typeof paramsRecord.model === 'string' && paramsRecord.model.trim() !== ''
      ? paramsRecord.model
      : AI_DEFAULT_PARAMS.model
  const thinking =
    paramsRecord.thinking === 'enabled' || paramsRecord.thinking === 'disabled'
      ? paramsRecord.thinking
      : 'auto'
  const maxTokens =
    typeof paramsRecord.maxTokens === 'number' && Number.isFinite(paramsRecord.maxTokens)
      ? paramsRecord.maxTokens
      : AI_DEFAULT_PARAMS.maxTokens
  const timeoutMs =
    typeof paramsRecord.timeoutMs === 'number' && Number.isFinite(paramsRecord.timeoutMs)
      ? paramsRecord.timeoutMs
      : AI_DEFAULT_PARAMS.timeoutMs

  const temperature =
    typeof paramsRecord.temperature === 'number' && Number.isFinite(paramsRecord.temperature)
      ? paramsRecord.temperature
      : undefined
  const topP =
    typeof paramsRecord.topP === 'number' && Number.isFinite(paramsRecord.topP)
      ? paramsRecord.topP
      : undefined
  const reasoningEffort =
    paramsRecord.reasoningEffort === 'low' ||
    paramsRecord.reasoningEffort === 'high' ||
    paramsRecord.reasoningEffort === 'max'
      ? paramsRecord.reasoningEffort
      : undefined

  const positionCategories = Array.isArray(record.positionCategories)
    ? normalizePositionCategoryRules(
        record.positionCategories.flatMap((item): PositionCategoryRule[] => {
          if (typeof item !== 'object' || item === null) {
            return []
          }
          const rule = item as Record<string, unknown>
          return typeof rule.keyword === 'string' && typeof rule.category === 'string'
            ? [{ keyword: rule.keyword, category: rule.category }]
            : []
        }),
      )
    : []

  const proxyRecord =
    typeof record.proxy === 'object' && record.proxy !== null
      ? (record.proxy as Record<string, unknown>)
      : {}
  /**
   * 代理登记的回读：**地址与确认时间必须同时成立**，否则按「未登记」处理。
   * 只存了地址而没存确认时间（旧版本、被手改的仓）不能让应用悄悄发往一个
   * 用户从未确认过的地址——那正是「提示代理可见 Key 与摘要」要防的事。
   */
  const proxyOrigin =
    typeof proxyRecord.origin === 'string' && proxyRecord.origin.trim() !== ''
      ? proxyRecord.origin.trim()
      : null
  const proxy =
    proxyOrigin === null || typeof proxyRecord.acknowledgedAt !== 'string'
      ? { origin: null, acknowledgedAt: null }
      : { origin: proxyOrigin, acknowledgedAt: proxyRecord.acknowledgedAt }

  return {
    schemaVersion: AI_SETTINGS_SCHEMA_VERSION,
    enabled,
    keyStorage,
    params: {
      model,
      thinking,
      maxTokens,
      timeoutMs,
      ...(temperature === undefined ? {} : { temperature }),
      ...(topP === undefined ? {} : { topP }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    },
    privacyLevel: parsePrivacyLevel(record.privacyLevel),
    customDimensions: parseCustomDimensions(record.customDimensions),
    positionCategories,
    subjectRulesFingerprint:
      typeof record.subjectRulesFingerprint === 'string'
        ? record.subjectRulesFingerprint
        : null,
    subjectRulesConfirmedAt:
      typeof record.subjectRulesConfirmedAt === 'string'
        ? record.subjectRulesConfirmedAt
        : null,
    proxy,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date().toISOString(),
  }
}

/**
 * **本会话的临时偏好**（只在一个页面会话内有效，不落盘）。
 *
 * ## 为什么必须有这一份（2026-09-27 晚修的真实 bug）
 *
 * 用户在**设置页**打开了 AI 开关（当时还没建本地仓，写不进仓，界面提示
 * 「配置已在本次会话生效，但没能写入本地仓」），然后切到**分析看板**——
 * 看板仍显示「AI 深度分析当前是关闭状态」，预览按钮点不动。
 *
 * 原因：`loadAiSettings` 每次都去仓里读，**读不到就回落默认值**；
 * 而临时模式下用户的选择从来没进过仓，于是「本次会话生效」只对设置页自己成立。
 * 一句话：**提示语说「本次会话生效」，代码却只做到了「本页面生效」。**
 *
 * 有这一份之后：写仓失败时记住用户的选择，`loadAiSettings` 优先返回它；
 * 一旦写仓成功（或有仓可读）就清掉它，仓重新成为唯一事实来源。
 * 它是**模块级内存**，刷新页面即失——与「临时模式只在内存」的既有口径一致，不新增任何落盘。
 */
let sessionOverride: AiSettings | null = null

/** 仅供测试与「清空 AI 配置」路径重置会话态（不导出给界面用） */
export function clearAiSettingsSessionOverride(): void {
  sessionOverride = null
}

/**
 * 读偏好。**没有仓 / 未解锁 / 内容损坏一律回落到默认值**，且不抛错。
 *
 * 为什么静默回落而不是报错：AI 偏好缺失不该拦住用户使用本地功能（PRD AI17：
 * 「关闭 AI 后全部本地功能正常」）。真正的错误（比如写入失败）由保存路径抛出并展示。
 *
 * 顺序：**本会话未落盘的选择 → 仓里的记录 → 默认值**（见 `sessionOverride` 的说明）。
 */
export async function loadAiSettings(): Promise<AiSettings> {
  if (sessionOverride !== null) {
    return sessionOverride
  }
  try {
    const stored = await encryptedVault.loadObject<unknown>('preference', AI_SETTINGS_OBJECT_ID)
    return stored === null ? defaultAiSettings() : parseAiSettings(stored)
  } catch {
    // 未建仓 / 未解锁 / Dexie 不可用：都当作「还没有偏好」
    return defaultAiSettings()
  }
}

export type SaveAiSettingsResult =
  | { readonly ok: true; readonly settings: AiSettings }
  | { readonly ok: false; readonly reason: string }

/**
 * 保存偏好。**需要已解锁的加密仓**。
 *
 * 失败时返回原因而不是抛错：界面要么提示「临时模式无法持久化」，要么提示
 * 「请先解锁本地仓」，两条都是用户可操作的信息，不该变成一个红屏。
 */
export async function saveAiSettings(settings: AiSettings): Promise<SaveAiSettingsResult> {
  const next: AiSettings = { ...settings, updatedAt: new Date().toISOString() }
  try {
    await encryptedVault.saveObject('preference', next, { id: AI_SETTINGS_OBJECT_ID })
    // 写进仓了：仓成为唯一事实来源，会话态不再需要
    sessionOverride = null
    return { ok: true, settings: next }
  } catch (error) {
    /*
     * 写不进仓（临时模式 / 未解锁）：**仍然记住这次选择**，否则用户切到看板就会看到
     * 「AI 是关闭的」——那正是 2026-09-27 晚用户遇到的 bug（提示语说「本次会话生效」，
     * 实际只在本页面生效）。返回值里的 `ok: false` 不变，界面照旧如实提示「没能写入本地仓」。
     */
    sessionOverride = next
    return {
      ok: false,
      reason:
        error instanceof Error && error.message.trim() !== ''
          ? error.message
          : '无法写入本地仓（可能是未解锁，或当前为临时模式）。',
    }
  }
}

/** 供「清空业务数据」后同步界面用：删掉偏好记录（**不动 Key 与 AI 历史**） */
export async function removeAiSettings(): Promise<number> {
  // 会话态一并清掉：否则「清空」之后界面还会拿那份内存副本继续当配置用
  sessionOverride = null
  try {
    return await encryptedVault.deleteObject('preference', AI_SETTINGS_OBJECT_ID)
  } catch {
    return 0
  }
}
