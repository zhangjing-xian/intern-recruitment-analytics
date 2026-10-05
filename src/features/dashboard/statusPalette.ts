/**
 * 状态配色（唯一来源）：图表、图例、状态表共用，避免同一状态在两处不同颜色。
 * 七个状态全部给色，包括「其他」与「未知」——它们必须可见，不是被过滤掉的脏数据。
 */

import {
  AWAITING_APPROVAL_STATUS,
  JOINED_STATUS,
  OTHER,
  PENDING_JOINING_STATUS,
  REJECTED_OFFER_STATUS,
  REJECTED_VERBALLY_STATUS,
  UNKNOWN,
  type OfferStatus,
} from '../../domain'

export const STATUS_COLORS: Readonly<Record<OfferStatus, string>> = {
  [JOINED_STATUS]: '#0f766e',
  [PENDING_JOINING_STATUS]: '#0284c7',
  [AWAITING_APPROVAL_STATUS]: '#b45309',
  [REJECTED_OFFER_STATUS]: '#be123c',
  [REJECTED_VERBALLY_STATUS]: '#fb7185',
  [OTHER]: '#64748b',
  [UNKNOWN]: '#cbd5e1',
}

/** 趋势图里按月堆叠的状态顺序：先核心口径（J/P/R），再审批中，最后其他 / 未知 */
export const TREND_STATUS_ORDER: readonly OfferStatus[] = [
  JOINED_STATUS,
  PENDING_JOINING_STATUS,
  REJECTED_OFFER_STATUS,
  REJECTED_VERBALLY_STATUS,
  AWAITING_APPROVAL_STATUS,
  OTHER,
  UNKNOWN,
]
