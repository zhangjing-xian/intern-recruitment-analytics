/**
 * 通用分组聚合单测（docs/PRD.md 6.3 / 8 章）。
 * 重点：所有维度共用同一套 N/J/P/A/R/D 与率；「未知」是独立分组；
 * TopN + 其他的合并组**重新合计分子分母**，不平均各分组百分比；覆盖需求数按非空需求 ID 去重。
 */

import { describe, expect, it } from 'vitest'

import { syntheticRecords } from './fixtures'
import {
  GROUP_DIMENSIONS,
  GROUP_DIMENSION_LABELS,
  aggregateByDimension,
  bandOf,
  dimensionValueOf,
  groupRecords,
  requirementCoverageOf,
  sortGroupsByDenominator,
  summarizeRecords,
  topNWithOther,
} from './grouping'

describe('维度取值口径', () => {
  it('缺失 / 不可识别统一归「未知」，不是 null，也不被丢弃', () => {
    const [record] = syntheticRecords([{ offerStatus: '已入职' }])
    for (const dimension of GROUP_DIMENSIONS) {
      expect(typeof dimensionValueOf(record, dimension)).toBe('string')
    }
    expect(dimensionValueOf(record, 'recruiter')).toBe('未知')
    expect(dimensionValueOf(record, 'school')).toBe('未知')
    expect(dimensionValueOf(record, 'graduationYear')).toBe('未知')
    expect(dimensionValueOf(record, 'salaryBand')).toBe('未知')
  })

  it('枚举值直接取规范化结果；毕业年级按文本分组；GPT 三值分别成组', () => {
    const [record] = syntheticRecords([
      {
        offerStatus: '已入职',
        city: '上海',
        channel: 'Boss',
        referralType: '内推',
        graduationYear: 2027,
        isGptSchool: true,
        school: '合成大学',
      },
    ])
    expect(dimensionValueOf(record, 'city')).toBe('上海')
    expect(dimensionValueOf(record, 'channel')).toBe('Boss')
    expect(dimensionValueOf(record, 'referralType')).toBe('内推')
    expect(dimensionValueOf(record, 'graduationYear')).toBe('2027')
    expect(dimensionValueOf(record, 'isGptSchool')).toBe('是')
    expect(dimensionValueOf(record, 'school')).toBe('合成大学')
  })

  it('薪资区间维度需要显式边界；未配置边界时全部归「未知」', () => {
    const [record] = syntheticRecords([{ offerStatus: '已入职', salaryAmount: 4200 }])
    expect(dimensionValueOf(record, 'salaryBand')).toBe('未知')
    expect(dimensionValueOf(record, 'salaryBand', { salaryBandEdges: [3000, 4000, 5000] })).toBe(
      '4000–4999',
    )
    expect(dimensionValueOf(record, 'salaryBand', { salaryBandEdges: [] })).toBe('未知')
  })

  it('区间标签含下界、不含上界：<3000 / 3000–3999 / ≥5000', () => {
    const edges = [3000, 4000, 5000]
    expect(bandOf(2999, edges)).toBe('<3000')
    expect(bandOf(3000, edges)).toBe('3000–3999')
    expect(bandOf(3999, edges)).toBe('3000–3999')
    expect(bandOf(4000, edges)).toBe('4000–4999')
    expect(bandOf(5000, edges)).toBe('≥5000')
    expect(bandOf(null, edges)).toBeNull()
  })

  it('每个维度都有中文标签（界面与报告共用）', () => {
    expect(
      GROUP_DIMENSIONS.every((dimension) => GROUP_DIMENSION_LABELS[dimension] !== ''),
    ).toBe(true)
  })
})

describe('需求覆盖数', () => {
  it('countDistinct(非空需求ID)，缺失需求 ID 的记录单独计数', () => {
    const records = syntheticRecords([
      { requirementId: 'REQ-001' },
      { requirementId: 'REQ-001' },
      { requirementId: 'REQ-002' },
      { requirementId: null },
      { requirementId: '   ' },
    ])
    const coverage = requirementCoverageOf(records)
    expect(coverage.distinctRequirementCount).toBe(2)
    expect(coverage.missingRequirementIdCount).toBe(2)
    expect(coverage.recordCount).toBe(5)
    expect(coverage.note).toContain('跨 HR 相加可能超过全局')
  })
})

describe('分组汇总', () => {
  const records = syntheticRecords([
    { offerStatus: '已入职', channel: '官网', requirementId: 'REQ-001', department: '技术' },
    { offerStatus: '已入职', channel: '官网', requirementId: 'REQ-001', department: '技术' },
    { offerStatus: '拒绝offer', channel: 'Boss', requirementId: 'REQ-002', department: '技术' },
    { offerStatus: '已入职', channel: 'Boss', requirementId: 'REQ-002', department: '市场' },
  ])

  it('每个分组都带 N/J/P/A/R/D、各率、有效周期与覆盖需求数', () => {
    const groups = aggregateByDimension(records, 'channel')
    const official = groups.find((group) => group.key === '官网')
    const boss = groups.find((group) => group.key === 'Boss')

    expect(official?.counts.total).toBe(2)
    expect(official?.counts.coreDenominator).toBe(2)
    expect(official?.rates.rejectionRate.value).toBe(0)
    expect(official?.coverage.distinctRequirementCount).toBe(1)
    expect(official?.cycles.actual.n).toBe(0)

    expect(boss?.counts.coreDenominator).toBe(2)
    expect(boss?.rates.rejectionRate.value).toBeCloseTo(0.5, 10)
    expect(boss?.rates.rejectionRate.denominator).toBe(2)
  })

  it('未知是独立分组：未填 HR 的记录不会被丢掉', () => {
    const groups = aggregateByDimension(records, 'recruiter')
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('未知')
    expect(groups[0].counts.total).toBe(4)
  })

  it('通用 groupBy 可用于任意键（部门 / 岗位等）', () => {
    const byDepartment = groupRecords(records, (record) => record.department ?? '未知')
    expect(byDepartment.map((group) => group.key).sort()).toEqual(['市场', '技术'])
  })

  it('单组汇总与分组汇总使用同一套率口径', () => {
    const summary = summarizeRecords('全部', records)
    expect(summary.counts.total).toBe(4)
    expect(summary.rates.joinedRate.value).toBeCloseTo(3 / 4, 10)
    expect(summary.rates.rejectionRate.denominator).toBe(summary.counts.coreDenominator)
  })

  it('排序按 D 降序 → N 降序 → 分组值升序，结果稳定', () => {
    const groups = sortGroupsByDenominator([
      summarizeRecords('B', syntheticRecords([{ offerStatus: '已入职' }])),
      summarizeRecords(
        'A',
        syntheticRecords([{ offerStatus: '已入职' }, { offerStatus: '已入职' }]),
      ),
      summarizeRecords('C', syntheticRecords([{ offerStatus: '已入职' }])),
    ])
    expect(groups.map((group) => group.key)).toEqual(['A', 'B', 'C'])
  })
})

describe('TopN + 其他', () => {
  const groups = aggregateByDimension(
    syntheticRecords([
      ...Array.from({ length: 9 }, () => ({
        offerStatus: '拒绝offer' as const,
        channel: 'Boss' as const,
      })),
      ...Array.from({ length: 6 }, () => ({
        offerStatus: '已入职' as const,
        channel: '官网' as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        offerStatus: '已入职' as const,
        channel: '内推' as const,
      })),
      ...Array.from({ length: 3 }, () => ({
        offerStatus: '拒绝offer' as const,
        channel: '实习僧' as const,
      })),
    ]),
    'channel',
  )

  it('前 N 组保留，其余合并为一组并重新汇总', () => {
    const summarized = topNWithOther(groups, 2)
    expect(summarized).toHaveLength(3)
    expect(summarized[0].key).toBe('Boss')
    expect(summarized[1].key).toBe('官网')
    expect(summarized[2].key).toBe('其他（2 个分组合并）')
    expect(summarized[2].counts.total).toBe(8)
  })

  it('合并组的率由合计分子分母重新相除，不是平均各分组百分比', () => {
    const merged = topNWithOther(groups, 2)[2]
    expect(merged.rates.rejectionRate.numerator).toBe(3)
    expect(merged.rates.rejectionRate.denominator).toBe(8)
    expect(merged.rates.rejectionRate.value).toBeCloseTo(0.375, 10)

    const tailRates = groups
      .filter((group) => group.key === '内推' || group.key === '实习僧')
      .map((group) => group.rates.rejectionRate.value ?? 0)
    expect((tailRates[0] + tailRates[1]) / 2).toBe(0.5)
  })

  it('分组数不超过 N 时原样返回（排序后）', () => {
    const summarized = topNWithOther(groups, 10)
    expect(summarized).toHaveLength(4)
    expect(summarized.map((group) => group.key)).toEqual(['Boss', '官网', '内推', '实习僧'])
  })
})
