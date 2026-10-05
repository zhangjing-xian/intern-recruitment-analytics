/**
 * 记录身份与脱敏代号（docs/PRD.md 4.2「内部字段」、13.2「脱敏」）。
 *
 * 铁律：
 * - 唯一键只能是本地随机生成的 `recordId`；姓名、需求 ID、推荐人**都不得**作为唯一键；
 * - 展示与导出使用 `candidateDisplayId`：同一记录内稳定，**不**承诺跨数据集代表同一人；
 * - 疑似重复只用于提示，必须由用户确认后才合并或删除（见 ./valueMappings 与步骤5 去重）。
 */

import { normalizeCellText } from './valueMappings'
import type { StandardFieldKey } from './fields'
import type { RawCellValue } from './types'

/** 记录代号前缀（展示 / 导出用，不代表跨批次身份） */
export const DISPLAY_ID_PREFIX = 'C-'

/** 代号长度（十六进制位数） */
export const DISPLAY_ID_LENGTH = 6

/** 明确禁止作为身份键的字段（评审与测试可直接引用该清单） */
export const IDENTITY_RULES = {
  uniqueKey: 'recordId',
  displayIdField: 'candidateDisplayId',
  forbiddenIdentityFields: ['candidateName', 'requirementId', 'referrer'],
} as const satisfies {
  readonly uniqueKey: string
  readonly displayIdField: string
  readonly forbiddenIdentityFields: readonly StandardFieldKey[]
}

/** 疑似重复的匹配键字段组合：仅用于提示，不自动合并 */
export const SUSPECTED_DUPLICATE_KEY_FIELDS = [
  'requirementId',
  'candidateName',
  'recruitmentStartDate',
] as const satisfies readonly StandardFieldKey[]

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuidV4(value: string): boolean {
  return UUID_V4_PATTERN.test(value)
}

function toHex(byte: number): string {
  return byte.toString(16).padStart(2, '0')
}

/** 由 16 字节随机数生成标准 v4 UUID（补齐 version / variant 位） */
function uuidFromBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, toHex).join('')
  const variantByte = (Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80
  const uuidHex = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${toHex(variantByte)}${hex.slice(18, 32)}`
  return [
    uuidHex.slice(0, 8),
    uuidHex.slice(8, 12),
    uuidHex.slice(12, 16),
    uuidHex.slice(16, 20),
    uuidHex.slice(20, 32),
  ].join('-')
}

/**
 * 生成记录唯一键。优先使用 `crypto.randomUUID`，其次 `crypto.getRandomValues`，
 * 最后退化为时间戳 + 随机数（仅用于极端环境，**不**因随机性不足而假造身份）。
 */
export function newRecordId(): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  if (typeof cryptoApi?.getRandomValues === 'function') {
    return uuidFromBytes(cryptoApi.getRandomValues(new Uint8Array(16)))
  }
  return `fallback-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

/**
 * 由 `recordId` 派生的展示代号：稳定、无需查表、不含任何可识别信息。
 * 相同 `recordId` 永远得到相同代号；代号重复只影响展示，不作为身份判定依据。
 */
export function buildDisplayId(recordId: string): string {
  let hash = 0
  for (const char of recordId) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) % 0x1000000
  }
  return `${DISPLAY_ID_PREFIX}${hash.toString(16).toUpperCase().padStart(DISPLAY_ID_LENGTH, '0')}`
}

export type SuspectedDuplicateKeyParts = {
  readonly requirementId: string | null
  readonly candidateName: string | null
  readonly recruitmentStartDate: string | null
}

/**
 * 构造疑似重复的可读键（`需求ID + 姓名 + 启动日期`）。
 * 三个部分都为空时返回 null（无信息可比，不制造假重复）；只做提示，必须用户确认。
 */
export function buildSuspectedDuplicateKey(parts: SuspectedDuplicateKeyParts): string | null {
  const values = [parts.requirementId, parts.candidateName, parts.recruitmentStartDate].map(
    (value) => normalizeCellText(value ?? '').toLowerCase(),
  )
  if (values.every((value) => value === '')) {
    return null
  }
  return values.join('|')
}

/**
 * 整行内容签名（用于识别「完全重复」）：按单元格文本逐格拼接，用不可见分隔符防止串位。
 * 只比较文本，不做任何语义归一：内容有任一差异就不是「完全重复」。
 */
export function buildExactDuplicateKey(cells: readonly RawCellValue[]): string {
  return cells.map((cell) => normalizeCellText(cell)).join('\u001f')
}