/**
 * AI 载荷的**历史结构**（v1）与其校验器。
 *
 * 背景：步骤11 先定义了 v1 的扁平结构（`fields` 数组，每项「值 + 指标 ID + 样本量 + 分母说明」），
 * 当时刻意**不提供**任何从 `SanitizedReport` 到它的转换函数——理由是形状不同才是安全设计：
 * `SanitizedReport` 允许含本地明细，而 AI 载荷只允许聚合；只要没有转换器，
 * 就不可能发生「顺手把整份报告塞进请求体」的事故。
 *
 * AI-1（本步）把真正在用的载荷升到 `ai-summary/1`，形状对齐 PRD 17.2 的示意
 * （`scope` + `kpi` + `dimensions` + …），结构、白名单与构造器都在 `./aiSummary.ts`。
 * 本文件因此**只剩两件事**：
 * 1. 保留 v1 的 `AI_PAYLOAD_VERSION` 与 `AiPayloadField`，供历史记录辨认旧结构；
 * 2. 提供 v1 的校验器，使「从加密仓读回一条旧历史」能被正确识别而不是当成损坏数据。
 *
 * `SanitizedAiPayload`（当前版本）**只在** `./aiSummary.ts` 定义一处，
 * 避免两个同名类型同时导出造成歧义。
 *
 * 本文件是纯函数层：不依赖 React / DOM / 网络 / 存储，也不发起任何请求。
 */

/** v1 载荷版本：结构变化必须递增，便于回溯「当时发出去的是什么形状」 */
export const AI_PAYLOAD_VERSION = 'ai-payload/1'

/** v1 的一个字段：值 + 指标 ID + 有效样本 + 分母说明 + 是否被抑制 */
export type AiPayloadField<T> = {
  readonly value: T
  readonly metricId: string
  readonly sampleSize: number
  readonly denominatorNote: string
  readonly suppressed: boolean
}

/** v1 载荷（历史结构，仅供读取旧记录时辨认） */
export type LegacyAiPayloadV1 = {
  readonly payloadVersion: string
  readonly generatedAt: string
  readonly privacyLevel: 'strict' | 'standard' | 'custom'
  readonly fields: readonly {
    readonly metricId: string
    readonly value: unknown
    readonly sampleSize: number
    readonly denominatorNote: string
  }[]
  readonly omitted: readonly { readonly metricId: string; readonly reason: string }[]
  readonly contentBytes: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLegacyPrivacyLevel(value: unknown): boolean {
  return value === 'strict' || value === 'standard' || value === 'custom'
}

/**
 * 是否为 v1 载荷。
 *
 * 用途：AI 历史从加密仓读回来时，先辨认是不是旧结构；
 * 是旧结构就按旧结构展示（或提示「该历史由更早版本写入」），**不静默丢弃**，
 * 也不假装它能被当前版本的代码理解。
 */
export function isLegacyAiPayloadV1(value: unknown): value is LegacyAiPayloadV1 {
  if (!isRecord(value)) {
    return false
  }
  const { payloadVersion, generatedAt, privacyLevel, fields, omitted, contentBytes } = value
  if (payloadVersion !== AI_PAYLOAD_VERSION) {
    return false
  }
  if (typeof generatedAt !== 'string' || !isLegacyPrivacyLevel(privacyLevel)) {
    return false
  }
  if (typeof contentBytes !== 'number' || !Number.isFinite(contentBytes) || contentBytes < 0) {
    return false
  }
  if (
    !Array.isArray(fields) ||
    !fields.every(
      (field) =>
        isRecord(field) &&
        typeof field.metricId === 'string' &&
        typeof field.sampleSize === 'number' &&
        typeof field.denominatorNote === 'string' &&
        'value' in field,
    )
  ) {
    return false
  }
  return (
    Array.isArray(omitted) &&
    omitted.every(
      (entry) => isRecord(entry) && typeof entry.metricId === 'string' && typeof entry.reason === 'string',
    )
  )
}
