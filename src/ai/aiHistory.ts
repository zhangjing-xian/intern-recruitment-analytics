/**
 * AI 结果的本地历史（AI-5，docs/PRD.md 16.5 / 18.2）。
 *
 * ## 四条硬规则
 *
 * 1. **只有用户显式保存才写入**：结果拿到后只存在内存里；「保存到本地历史」是一个独立动作。
 *    PRD 16.5 原文：「历史只在用户点击保存后写入加密仓」；
 * 2. **走加密仓，不落明文**：用既有的 `aiHistory` 对象种类（步骤6 建的），
 *    与业务数据同一套 AES-GCM 信封。本模块**不碰** IndexedDB，只经 `encryptedVault` 门面；
 * 3. **绝不保存 Key 或 Authorization**：`AiHistoryEntry` 的字段里**没有**任何能装凭据的位置
 *    （连 `headers` 都没有），因此「顺手把请求记下来」在类型层写不出来；
 * 4. **绝不保存 `reasoning_content`**：思维链根本不在 `AiChatResult` 的类型里
 *    （AI-4 的 `parseChatCompletion` 连读都不读），历史自然也没有它。
 *
 * ## 删除的三个动作互不代替（PRD 16.5）
 *
 * - 删单条：只删这一条；
 * - 清空 AI 历史：删全部 `aiHistory` 对象，**不动**招聘源数据、**不动** Key；
 * - 清全部本地数据（步骤12 的分层清除）：三者都删。
 *
 * 本模块只做前两个；第三个由设置页的清除范围模型负责（它已经覆盖 `aiHistory`）。
 *
 * ## 临时模式怎么办
 *
 * `loadAiHistory` 在没有仓 / 未解锁时返回空数组并说明原因；
 * `saveAiHistoryEntry` 会失败并**如实返回原因**（不假装保存成功）。
 * PRD 16.5：「临时模式关闭页面即丢失，保存历史须先建立加密仓」。
 */

import { encryptedVault } from '../storage/vaultFacade'
import type { PrivacyLevel } from '../privacy/sanitize'
import type { AiChatResult } from './aiResult'

/** 历史记录结构版本：形状变化必须递增，读回旧版本时按「不认识」处理而不是硬猜 */
export const AI_HISTORY_SCHEMA_VERSION = 'ai-history/1'

/**
 * 一条 AI 历史记录的**内容**。
 *
 * 字段刻意都是**本次请求的可回溯元数据 + 已净化结果**，没有任何凭据与原始记录的位置。
 *
 * **刻意不含 `id`**：历史的身份就是加密仓里那一行的主键（`appendObject` 生成的随机标识）。
 * 早期实现把 `id` 同时放在条目里，于是「条目说自己是 A、仓里的行键是 B」这种不一致
 * 随时可能出现，而删除是按**行键**执行的——结果就是「删了没反应」。
 * 现在身份只有一处，读回时由 `loadAiHistory` 把它作为 `id` 交给界面。
 */
export type AiHistoryPayload = {
  readonly schemaVersion: typeof AI_HISTORY_SCHEMA_VERSION
  readonly savedAt: string
  /** 发起请求的时间（与 savedAt 可以不同：用户可能过一会儿才保存） */
  readonly requestedAt: string

  /* 请求侧：这次发给模型的是什么（可复核） */
  readonly previewHash: string
  readonly requestedModel: string
  readonly responseModel: string | null
  readonly privacyLevel: PrivacyLevel
  readonly schemaVersionOfPayload: string
  readonly promptVersion: string
  readonly ruleVersionLabel: string
  readonly dataAsOf: string
  /** 生效筛选的可读描述（已脱敏） */
  readonly activeFilters: readonly string[]
  /** 本次实际发送的载荷 JSON（**已脱敏**：就是用户批准过的那一份文本） */
  readonly payloadJson: string

  /* 回复侧：拿到的是什么（已净化） */
  readonly content: string
  readonly finishReason: string | null
  /** 结果是否完整（由 `finishStatusOf` 判定，**不在这里重算**） */
  readonly finishStatus: 'complete' | 'incomplete' | 'failed'
  readonly usage: AiChatResult['usage']
  readonly responseId: string | null
  /** 本地敏感检查的结论（只存结论，不存命中原文） */
  readonly responseCheck: {
    readonly hasFindings: boolean
    readonly fieldNames: readonly string[]
    readonly sentinelHit: boolean
  }
}

/** 界面用的历史条目：仓的行键 + 内容。`id` 是**唯一**的身份来源（见 `AiHistoryPayload` 的说明） */
export type AiHistoryEntry = AiHistoryPayload & {
  /** 加密仓里那一行的主键（删除按它执行） */
  readonly id: string
}

/** 允许出现的键（读回旧数据时用它做结构校验；`id` 由仓提供，不属于载荷内容） */
const PAYLOAD_KEYS: readonly string[] = [
  'schemaVersion',
  'savedAt',
  'requestedAt',
  'previewHash',
  'requestedModel',
  'responseModel',
  'privacyLevel',
  'schemaVersionOfPayload',
  'promptVersion',
  'ruleVersionLabel',
  'dataAsOf',
  'activeFilters',
  'payloadJson',
  'content',
  'finishReason',
  'finishStatus',
  'usage',
  'responseId',
  'responseCheck',
]

/**
 * 结构校验：从加密仓读回的内容**可能被改过**（用户手动改 IndexedDB、或未来版本写入不同形状）。
 *
 * 为什么不让它硬转：一个缺字段的对象会一路流到界面，最终表现成 `undefined` 被渲染出来。
 * 这里逐字段检查，不认识就**整条丢弃**——丢一条历史比展示一条形状不明的记录安全。
 */
export function isAiHistoryPayload(value: unknown): value is AiHistoryPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!PAYLOAD_KEYS.includes(key)) {
      return false
    }
  }
  if (record.schemaVersion !== AI_HISTORY_SCHEMA_VERSION) {
    return false
  }
  for (const key of ['savedAt', 'requestedAt', 'previewHash', 'requestedModel', 'content']) {
    if (typeof record[key] !== 'string') {
      return false
    }
  }
  if (typeof record.payloadJson !== 'string') {
    return false
  }
  if (!Array.isArray(record.activeFilters)) {
    return false
  }
  if (typeof record.responseCheck !== 'object' || record.responseCheck === null) {
    return false
  }
  return true
}

/** 附上仓的行键（界面用） */
function withId(payload: AiHistoryPayload, id: string): AiHistoryEntry {
  return { ...payload, id }
}

export type SaveHistoryResult =
  | { readonly ok: true; readonly entry: AiHistoryEntry }
  | { readonly ok: false; readonly reason: string }

/**
 * 保存一条历史（**唯一写入点**）。
 *
 * 入参是**载荷**（不含 id）：身份由仓在追加时生成，因此不存在「界面算错 id 导致覆盖」的可能。
 * 返回带 `id` 的条目，界面据此后续删除。
 *
 * 临时模式 / 未解锁时返回 `ok: false` 与可读原因，界面据此提示「需要先建立并解锁加密仓」，
 * 而**不是**静默失败——用户以为存下来了、刷新后没了，是更糟的体验。
 */
export async function saveAiHistoryEntry(
  payload: AiHistoryPayload,
): Promise<SaveHistoryResult> {
  try {
    /*
     * 用 `appendObject` 而不是 `saveObject`：历史是「只增不改」的列表，
     * 追加由仓保证新 id，不可能因为界面层算错 id 而**覆盖**掉一条已有历史。
     * （`saveObject` 传同一个 id 是覆盖语义，把「id 唯一」的责任推给调用方是错的。）
     */
    const saved = await encryptedVault.appendObject('aiHistory', payload)
    return { ok: true, entry: withId(payload, saved.id) }
  } catch (error) {
    return {
      ok: false,
      reason:
        error instanceof Error && error.message.trim() !== ''
          ? `没能写入本地历史：${error.message}`
          : '没能写入本地历史：当前可能是临时模式或本地仓未解锁。临时模式只在内存，刷新即失。',
    }
  }
}

export type LoadHistoryResult = {
  readonly entries: readonly AiHistoryEntry[]
  /** 读取失败或仓不可用时的原因；成功时为 null */
  readonly reason: string | null
}

/**
 * 读取全部历史（按保存时间**倒序**：最近的在最上面）。
 *
 * 顺序在这里定而不是在界面里排：界面各自排序会出现「同一个列表两种顺序」。
 * 每条都用**仓的行键**当 `id`——删除按同一个键执行，因此「删了没反应」不可能发生。
 */
export async function loadAiHistory(): Promise<LoadHistoryResult> {
  try {
    const records = await encryptedVault.listObjects<unknown>('aiHistory')
    const entries = records
      .filter((record) => isAiHistoryPayload(record.payload))
      .map((record) => withId(record.payload as AiHistoryPayload, record.id))
      // 时间戳是 ISO 字符串，字典序即时间序
      .sort((left, right) => (left.savedAt < right.savedAt ? 1 : left.savedAt > right.savedAt ? -1 : 0))
    return { entries, reason: null }
  } catch (error) {
    return {
      entries: [],
      reason:
        error instanceof Error && error.message.trim() !== ''
          ? `没能读取本地历史：${error.message}`
          : '没能读取本地历史：当前可能是临时模式或本地仓未解锁。',
    }
  }
}

/** 删除单条；返回删除条数（0 表示本来就不存在） */
export async function deleteAiHistoryEntry(id: string): Promise<number> {
  try {
    return await encryptedVault.deleteObject('aiHistory', id)
  } catch {
    return 0
  }
}

/**
 * 清空全部 AI 历史。
 *
 * **只删 `aiHistory` 这一种类**：招聘源数据（`dataset`）、偏好（`preference`）、
 * 映射模板、分析缓存与 AI Key 的秘密槽位都不受影响（PRD 16.5 明确要求这三者互不代替）。
 */
export async function clearAiHistory(): Promise<number> {
  try {
    return await encryptedVault.clearObjects('aiHistory')
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------------ 构造 */

/** 生成一条历史的 id：本地随机，不含任何业务含义（与 `crypto` 的 randomId 同源思路） */
export function newHistoryId(random: () => number = Math.random): string {
  const chunk = (): string =>
    Math.floor(random() * 0x10000)
      .toString(16)
      .padStart(4, '0')
  return `ai-${chunk()}${chunk()}-${chunk()}`
}
