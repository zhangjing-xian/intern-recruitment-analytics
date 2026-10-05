/**
 * 交叉表单测（步骤9，docs/PRD.md 8 章「渠道与推荐人」「HR 效能」）。
 *
 * 关键断言：Σ 各格 N = 记录总数（一张表只统计一次）、行 / 列合计与全表合计各自重新汇总、
 * 「未知」固定在最后且保留、空格是 N = 0 的正常分组（分母 0 → 率为 null，不显示 0%）。
 */

import { describe, expect, it } from 'vitest'

import { UNKNOWN } from '../enums'

import { CHANNEL_REFERRAL_NOTE, crossTabCellOf, crossTabulate } from './crossTab'
import { syntheticRecords } from './fixtures'

const RECORDS = syntheticRecords([
  {
    city: '上海',
    channel: 'Boss',
    referralType: '内推',
    offerStatus: '已入职',
    recruiter: 'HR-A',
  },
  {
    city: '上海',
    channel: 'Boss',
    referralType: '内推',
    offerStatus: '拒绝offer',
    recruiter: 'HR-A',
  },
  {
    city: '上海',
    channel: '官网',
    referralType: 'HR推',
    offerStatus: '已入职',
    recruiter: 'HR-B',
  },
  { city: '广州', channel: '官网', referralType: UNKNOWN, offerStatus: UNKNOWN },
  { city: UNKNOWN, channel: UNKNOWN, referralType: UNKNOWN, offerStatus: '待入职' },
])

describe('交叉表基础口径', () => {
  const result = crossTabulate(RECORDS, 'channel', 'referralType')

  it('Σ 各格 N = 记录总数：一条记录只落进一格，不是两套统计拼起来', () => {
    const cellTotal = result.cells.reduce((sum, cell) => sum + cell.summary.counts.total, 0)
    const rowTotal = result.rowTotals.reduce((sum, group) => sum + group.counts.total, 0)
    const columnTotal = result.columnTotals.reduce((sum, group) => sum + group.counts.total, 0)

    expect(result.cells).toHaveLength(result.rowKeys.length * result.columnKeys.length)
    expect(cellTotal).toBe(RECORDS.length)
    expect(rowTotal).toBe(RECORDS.length)
    expect(columnTotal).toBe(RECORDS.length)
    expect(result.total.counts.total).toBe(RECORDS.length)
  })

  it('行 / 列合计与全表合计同口径（分子分母可对齐）', () => {
    expect(result.total.counts.coreDenominator).toBe(4)
    expect(result.rowTotals.map((group) => group.key)).toEqual(['Boss', '官网', UNKNOWN])
    expect(result.columnTotals.map((group) => group.key)).toEqual(['内推', 'HR推', UNKNOWN])
  })

  it('「未知」固定排在最后，且作为正常取值参与计数', () => {
    const unknownRow = result.rowTotals.find((group) => group.key === UNKNOWN)
    expect(unknownRow?.counts.total).toBe(1)
    expect(result.rowKeys.at(-1)).toBe(UNKNOWN)
    expect(result.columnKeys.at(-1)).toBe(UNKNOWN)
  })

  it('「渠道」与「推荐类型」是两个维度：同一渠道下不同推荐类型分属不同格', () => {
    const boss = result.rowTotals.find((group) => group.key === 'Boss')
    const official = result.rowTotals.find((group) => group.key === '官网')
    expect(boss?.counts.total).toBe(2)
    expect(official?.counts.total).toBe(2)
    expect(crossTabCellOf(result, 'Boss', '内推')?.counts.total).toBe(2)
    expect(crossTabCellOf(result, '官网', 'HR推')?.counts.total).toBe(1)
  })

  it('空格是 N = 0 的正常分组：分母 0 时率为 null（不是 0%）', () => {
    const empty = crossTabCellOf(result, 'Boss', 'HR推')
    expect(empty?.counts.total).toBe(0)
    expect(empty?.rates.joinedRate.value).toBeNull()
    expect(empty?.cycles.actual.n).toBe(0)
  })

  it('模块自己给出「渠道 ≠ 推荐类型、渠道质量 ≠ ROI」的口径提示', () => {
    expect(result.note).toContain('重新汇总')
    expect(CHANNEL_REFERRAL_NOTE).toContain('不能称为渠道 ROI')
    expect(CHANNEL_REFERRAL_NOTE).toContain('是两个维度')
  })
})

describe('交叉表不平均分组百分比', () => {
  const records = syntheticRecords([
    { city: '上海', channel: 'Boss', referralType: '内推', offerStatus: '已入职' },
    { city: '上海', channel: 'Boss', referralType: '内推', offerStatus: '拒绝offer' },
    { city: '上海', channel: '官网', referralType: '内推', offerStatus: '已入职' },
  ])
  const result = crossTabulate(records, 'city', 'channel')

  it('行合计的率由合计分子分母相除，而不是各格百分比的平均', () => {
    const row = result.rowTotals.find((group) => group.key === '上海')
    // 两格分别是 1/2 = 50% 与 0/1 = 0%，平均是 25%；正确口径是 1/3 ≈ 33.33%
    expect(row?.rates.rejectionRate.numerator).toBe(1)
    expect(row?.rates.rejectionRate.denominator).toBe(3)
    expect(row?.rates.rejectionRate.value).toBeCloseTo(1 / 3)
    expect(row?.rates.rejectionRate.value).not.toBeCloseTo(0.25)
  })
})

describe('交叉表透传分组选项', () => {
  it('薪资分档边界对两个维度同时生效（同一份取值口径）', () => {
    const records = syntheticRecords([
      { city: '上海', channel: 'Boss', salaryAmount: 3000, offerStatus: '已入职' },
      { city: '上海', channel: '官网', salaryAmount: 4500, offerStatus: '已入职' },
      { city: '广州', channel: 'Boss', salaryAmount: 6000, offerStatus: '拒绝offer' },
    ])
    const result = crossTabulate(records, 'salaryBand', 'salaryBand', {
      salaryBandEdges: [4000, 5000],
    })

    // 排序仍由 `sortGroupsByDenominator` 决定（D → N → 取值），所以只断言取值集合与对角线
    expect(result.rowKeys).toHaveLength(3)
    expect(result.rowKeys).toContain('<4000')
    expect(result.rowKeys).toContain('4000–4999')
    expect(result.rowKeys).toContain('≥5000')
    expect(result.columnKeys).toEqual(result.rowKeys)
    // 对角线格子就是「该区间自身的全部记录」
    expect(crossTabCellOf(result, '≥5000', '≥5000')?.counts.total).toBe(1)
  })
})
