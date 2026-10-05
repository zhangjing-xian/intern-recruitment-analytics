/**
 * 状态计数与核心分母（docs/PRD.md 6.1，AGENTS.md §7 术语速查）。
 *
 * 恒等式与分母是**全局唯一口径**，组件不得再自行判断：
 * ```
 * N = 所有保留记录（含审批中）
 * J = 已入职   P = 待入职   A = offer 审批中
 * R1 = 拒绝 offer   R2 = 拒绝口头 offer   R = R1 + R2
 * U = 其他 / 未知
 * D = J + P + R      ← 核心分母，排除审批中、其他、未知
 * 恒等式：N = J + P + A + R1 + R2 + U
 * ```
 * 「其他」与「未知」是**两个**独立状态，必须分开显示，不合并成一个桶。
 */

import {
  OFFER_STATUS_GROUP_OF,
  OFFER_STATUSES,
  countsTowardCoreDenominator,
  isAcceptedStatus,
  isRejectedStatus,
  type OfferStatus,
  type OfferStatusGroup,
} from '../enums'
import type { NormalizedRecord } from '../types'

import { rateOf, type RateMetric } from './rates'

/** 一次统计下的全部状态计数；命名与 PRD 符号一一对应，避免页面各自起名 */
export type StatusCounts = {
  /** N：所有保留记录数（含审批中） */
  readonly total: number
  /** J：已入职 */
  readonly joined: number
  /** P：待入职 */
  readonly pending: number
  /** A：offer 审批中 */
  readonly approving: number
  /** R1：拒绝 offer */
  readonly rejectedOffer: number
  /** R2：拒绝口头 offer */
  readonly rejectedVerbally: number
  /** R = R1 + R2 */
  readonly rejected: number
  /** U 之一：其他（已识别但不进核心口径） */
  readonly other: number
  /** U 之一：未知（缺失或无法识别） */
  readonly unknown: number
  /** 接受数（J + P）：接受**不等于**实际入职 */
  readonly accepted: number
  /** D：核心分母（J + P + R） */
  readonly coreDenominator: number
}

export const EMPTY_STATUS_COUNTS: StatusCounts = {
  total: 0,
  joined: 0,
  pending: 0,
  approving: 0,
  rejectedOffer: 0,
  rejectedVerbally: 0,
  rejected: 0,
  other: 0,
  unknown: 0,
  accepted: 0,
  coreDenominator: 0,
}

type MutableStatusCounts = { -readonly [Key in keyof StatusCounts]: number }

/** 状态 → 计数对象的字段名（分组口径与 `OFFER_STATUS_GROUP_OF` 严格一致） */
const COUNT_FIELD_OF_GROUP: Readonly<Record<OfferStatusGroup, keyof StatusCounts>> = {
  joined: 'joined',
  pending: 'pending',
  approving: 'approving',
  rejectedOffer: 'rejectedOffer',
  rejectedVerbally: 'rejectedVerbally',
  other: 'other',
  unknown: 'unknown',
}

/** 统计一组记录的状态计数、R、接受数与核心分母 D */
export function countStatuses(records: readonly NormalizedRecord[]): StatusCounts {
  const counts: MutableStatusCounts = { ...EMPTY_STATUS_COUNTS }
  for (const record of records) {
    counts.total += 1
    const field = COUNT_FIELD_OF_GROUP[OFFER_STATUS_GROUP_OF[record.offerStatus]]
    counts[field] += 1
  }

  counts.rejected = counts.rejectedOffer + counts.rejectedVerbally
  counts.accepted = counts.joined + counts.pending
  counts.coreDenominator = counts.joined + counts.pending + counts.rejected
  return counts
}

/** 恒等式 `N = J + P + A + R1 + R2 + U` 是否成立（不成立说明状态口径被破坏，必须暴露） */
export function statusIdentityHolds(counts: StatusCounts): boolean {
  return (
    counts.total ===
    counts.joined +
      counts.pending +
      counts.approving +
      counts.rejectedOffer +
      counts.rejectedVerbally +
      counts.other +
      counts.unknown
  )
}

/** 单个状态的计数（含其他 / 未知，用于状态结构图） */
export function countOfStatus(counts: StatusCounts, status: OfferStatus): number {
  const field: keyof StatusCounts = COUNT_FIELD_OF_GROUP[OFFER_STATUS_GROUP_OF[status]]
  return counts[field]
}

/** 状态结构占比的一项：`各状态数 / N`（分母固定为 N，与核心率分母不同） */
export type StatusShare = {
  readonly status: OfferStatus
  readonly count: number
  /** count / N；N = 0 时为 null（显示「—」，不显示 0%） */
  readonly share: number | null
}

/** 状态结构：按 OFFER_STATUSES 固定顺序返回**全部**状态（计数 0 的状态也保留） */
export function statusComposition(counts: StatusCounts): readonly StatusShare[] {
  return OFFER_STATUSES.map((status) => {
    const count = countOfStatus(counts, status)
    return {
      status,
      count,
      share: counts.total === 0 ? null : count / counts.total,
    }
  })
}

/** 单条记录的派生标记；未知 / 其他状态一律 null，**不**当 false */
export type RecordFlags = {
  readonly statusGroup: OfferStatusGroup
  readonly isAccepted: boolean | null
  readonly isRejected: boolean | null
  readonly countedInCoreDenominator: boolean
}

export function recordFlags(record: NormalizedRecord): RecordFlags {
  const status = record.offerStatus
  return {
    statusGroup: OFFER_STATUS_GROUP_OF[status],
    isAccepted: isAcceptedStatus(status),
    isRejected: isRejectedStatus(status),
    countedInCoreDenominator: countsTowardCoreDenominator(status),
  }
}

/**
 * 「审批中占比」= A / N：分母与核心率**不同**，必须单独构造并明示分母来源
 * （docs/PRD.md 6.1：审批中占比 A/N，明确提示分母不同）。
 */
export function approvingShareRate(counts: StatusCounts): RateMetric {
  return rateOf(counts.approving, counts.total, {
    note: '分母为 N（全部保留记录），与核心率分母 D 不同，必须明示',
  })
}
