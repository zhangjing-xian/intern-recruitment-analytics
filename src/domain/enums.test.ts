import { describe, expect, it } from 'vitest'

import {
  ACCEPTED_STATUSES,
  AWAITING_APPROVAL_STATUS,
  BOSS_CHANNEL,
  CORE_DENOMINATOR_STATUSES,
  OFFER_STATUS_GROUP_OF,
  OFFER_STATUSES,
  OTHER,
  REJECTED_STATUSES,
  UNKNOWN,
  UNSPLIT_REQUIREMENT_TYPE,
  countsTowardCoreDenominator,
  isAcceptedStatus,
  isOfferStatus,
  isRejectedStatus,
} from './enums'

describe('offer 状态口径', () => {
  it('核心分母 D 恰好是 J + P + R，排除审批中 / 其他 / 未知', () => {
    expect(CORE_DENOMINATOR_STATUSES).toHaveLength(4)
    expect(CORE_DENOMINATOR_STATUSES).not.toContain(AWAITING_APPROVAL_STATUS)
    expect(CORE_DENOMINATOR_STATUSES).not.toContain(OTHER)
    expect(CORE_DENOMINATOR_STATUSES).not.toContain(UNKNOWN)
    for (const status of [...ACCEPTED_STATUSES, ...REJECTED_STATUSES]) {
      expect(countsTowardCoreDenominator(status)).toBe(true)
    }
  })

  it('「已送审批」映射目标 offer审批中不计入分母，也不属于接受 / 拒绝', () => {
    expect(countsTowardCoreDenominator(AWAITING_APPROVAL_STATUS)).toBe(false)
    expect(isAcceptedStatus(AWAITING_APPROVAL_STATUS)).toBe(false)
    expect(isRejectedStatus(AWAITING_APPROVAL_STATUS)).toBe(false)
  })

  it('接受 = 已入职 + 待入职；拒绝 = 两种拒 offer 状态', () => {
    expect(isAcceptedStatus('已入职')).toBe(true)
    expect(isAcceptedStatus('待入职')).toBe(true)
    expect(isAcceptedStatus('拒绝offer')).toBe(false)
    expect(isRejectedStatus('拒绝offer')).toBe(true)
    expect(isRejectedStatus('拒绝口头offer')).toBe(true)
    expect(isRejectedStatus('待入职')).toBe(false)
  })

  it('其他 / 未知是「既不是也不是」（null），不得当作否', () => {
    expect(isAcceptedStatus(OTHER)).toBeNull()
    expect(isAcceptedStatus(UNKNOWN)).toBeNull()
    expect(isRejectedStatus(OTHER)).toBeNull()
    expect(isRejectedStatus(UNKNOWN)).toBeNull()
    expect(countsTowardCoreDenominator(OTHER)).toBe(false)
    expect(countsTowardCoreDenominator(UNKNOWN)).toBe(false)
  })

  it('分组覆盖全部状态，用于恒等式 N = J + P + A + R1 + R2 + U', () => {
    for (const status of OFFER_STATUSES) {
      expect(OFFER_STATUS_GROUP_OF[status].length).toBeGreaterThan(0)
    }
    expect(new Set(OFFER_STATUSES).size).toBe(OFFER_STATUSES.length)
  })

  it('运行时校验只接受字典值（原值「已送审批」不是标准值）', () => {
    expect(isOfferStatus('offer审批中')).toBe(true)
    expect(isOfferStatus('已送审批')).toBe(false)
    expect(isOfferStatus('')).toBe(false)
  })
})

describe('其它枚举字典', () => {
  it('Boss 使用统一大小写写法', () => {
    expect(BOSS_CHANNEL).toBe('Boss')
  })

  it('「替补/替换」的统一落点是未拆分枚举', () => {
    expect(UNSPLIT_REQUIREMENT_TYPE).toBe('替补替换未拆分')
  })

  it('每个枚举都包含未知；可识别但不进核心口径的归其他', () => {
    expect(UNKNOWN).toBe('未知')
    expect(OTHER).toBe('其他')
    expect(OFFER_STATUSES).toContain(UNKNOWN)
    expect(OFFER_STATUSES).toContain(OTHER)
  })
})
