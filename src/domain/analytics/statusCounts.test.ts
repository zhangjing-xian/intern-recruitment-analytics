/**
 * 状态计数与核心分母单测（docs/PRD.md 6.1 + 12.2）。
 * 基准：6 条记录（已入职、已入职、待入职、offer审批中、拒绝offer、拒绝口头offer）
 * → N=6、J=2、P=1、A=1、R=2、D=5；追加 1 条其他只改变 N。
 */

import { describe, expect, it } from 'vitest'

import { OFFER_STATUSES } from '../enums'

import { PRD_12_2_RECORDS, syntheticRecords } from './fixtures'
import {
  EMPTY_STATUS_COUNTS,
  approvingShareRate,
  countOfStatus,
  countStatuses,
  recordFlags,
  statusComposition,
  statusIdentityHolds,
} from './statusCounts'

describe('状态计数与恒等式', () => {
  it('PRD 12.2：N=6、J=2、P=1、A=1、R=2、D=5、接受数 3', () => {
    const counts = countStatuses(PRD_12_2_RECORDS)
    expect(counts.total).toBe(6)
    expect(counts.joined).toBe(2)
    expect(counts.pending).toBe(1)
    expect(counts.approving).toBe(1)
    expect(counts.rejectedOffer).toBe(1)
    expect(counts.rejectedVerbally).toBe(1)
    expect(counts.rejected).toBe(2)
    expect(counts.accepted).toBe(3)
    expect(counts.coreDenominator).toBe(5)
    expect(statusIdentityHolds(counts)).toBe(true)
  })

  it('追加 1 条「其他」状态：只改变 N，不动 D 与核心分子', () => {
    const counts = countStatuses([
      ...PRD_12_2_RECORDS,
      ...syntheticRecords([{ offerStatus: '其他' }]),
    ])
    expect(counts.total).toBe(7)
    expect(counts.other).toBe(1)
    expect(counts.coreDenominator).toBe(5)
    expect(counts.joined).toBe(2)
    expect(counts.rejected).toBe(2)
    expect(statusIdentityHolds(counts)).toBe(true)
  })

  it('「其他」与「未知」是两个独立状态，不合并成一个桶', () => {
    const counts = countStatuses(
      syntheticRecords([{ offerStatus: '其他' }, { offerStatus: '未知' }]),
    )
    expect(counts.other).toBe(1)
    expect(counts.unknown).toBe(1)
    expect(counts.total).toBe(2)
    expect(counts.coreDenominator).toBe(0)
  })

  it('空数据集的恒等式也成立，核心分母为 0', () => {
    expect(countStatuses([])).toEqual(EMPTY_STATUS_COUNTS)
    expect(statusIdentityHolds(EMPTY_STATUS_COUNTS)).toBe(true)
  })
})

describe('状态结构占比', () => {
  it('按 OFFER_STATUSES 固定顺序返回全部状态，计数为 0 的状态也保留', () => {
    const composition = statusComposition(countStatuses(PRD_12_2_RECORDS))
    expect(composition.map((entry) => entry.status)).toEqual([...OFFER_STATUSES])
    expect(composition.every((entry) => entry.count >= 0)).toBe(true)
    expect(composition.find((entry) => entry.status === '其他')?.count).toBe(0)
  })

  it('占比分母是 N（与核心率分母 D 不同），可读出每个状态各占多少', () => {
    const counts = countStatuses(PRD_12_2_RECORDS)
    const composition = statusComposition(counts)
    expect(composition.find((entry) => entry.status === '已入职')?.share).toBeCloseTo(2 / 6, 10)
    expect(composition.find((entry) => entry.status === 'offer审批中')?.share).toBeCloseTo(
      1 / 6,
      10,
    )
    expect(approvingShareRate(counts).value).toBeCloseTo(1 / 6, 10)
    expect(approvingShareRate(counts).note).toContain('与核心率分母 D 不同')
  })

  it('N=0 时占比为 null（显示「—」，不是 0%）', () => {
    expect(statusComposition(EMPTY_STATUS_COUNTS).every((entry) => entry.share === null)).toBe(true)
    expect(approvingShareRate(EMPTY_STATUS_COUNTS).value).toBeNull()
  })

  it('countOfStatus 可按下标取回每个状态的计数', () => {
    const counts = countStatuses(PRD_12_2_RECORDS)
    expect(countOfStatus(counts, '拒绝口头offer')).toBe(1)
    expect(countOfStatus(counts, '其他')).toBe(0)
    expect(countOfStatus(counts, '未知')).toBe(0)
  })
})

describe('单条记录的派生标记', () => {
  it('已入职：接受为 true、拒绝为 false、计入 D', () => {
    const [joined] = syntheticRecords([{ offerStatus: '已入职' }])
    expect(recordFlags(joined)).toEqual({
      statusGroup: 'joined',
      isAccepted: true,
      isRejected: false,
      countedInCoreDenominator: true,
    })
  })

  it('待入职：算接受但仍是待入职（接受 ≠ 实际入职）', () => {
    const [pending] = syntheticRecords([{ offerStatus: '待入职' }])
    expect(recordFlags(pending).isAccepted).toBe(true)
    expect(recordFlags(pending).countedInCoreDenominator).toBe(true)
  })

  it('其他 / 未知状态：接受与拒绝都是 null（不是 false）', () => {
    for (const status of ['其他', '未知'] as const) {
      const [record] = syntheticRecords([{ offerStatus: status }])
      expect(recordFlags(record).isAccepted).toBeNull()
      expect(recordFlags(record).isRejected).toBeNull()
      expect(recordFlags(record).countedInCoreDenominator).toBe(false)
    }
  })

  it('审批中：不进核心分母，也不当拒绝', () => {
    const [approving] = syntheticRecords([{ offerStatus: 'offer审批中' }])
    expect(recordFlags(approving).statusGroup).toBe('approving')
    expect(recordFlags(approving).isRejected).toBe(false)
    expect(recordFlags(approving).countedInCoreDenominator).toBe(false)
  })
})
