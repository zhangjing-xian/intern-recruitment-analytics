/**
 * 薪酬与房补单测（步骤9，docs/PRD.md 6.2、8 章「薪酬房补」、12.2 薪资合成例）。
 *
 * 关键断言：混单位不合算、样本不足不出分位与直方图、直方图计数之和 = n、
 * 住宿 ≠ 无补贴、房补缺失不填 0、未确认币种 / 计薪周期时禁用比较。
 */

import { describe, expect, it } from 'vitest'

import {
  HOUSING_ACCOMMODATION,
  HOUSING_CASH,
  HOUSING_NO_SUBSIDY,
  OTHER,
  UNKNOWN,
} from '../enums'

import {
  HOUSING_NOTE,
  SALARY_COMPARISON_DISABLED_REASON,
  housingComparisonOf,
  salaryDistributionByUnit,
} from './compensation'
import { PRD_12_2_SALARY_RECORDS, SALARY_GROUP_INPUT, syntheticRecords } from './fixtures'

describe('薪资分布：按计薪单位分开', () => {
  it('PRD 12.2 薪资合成例：同单位 5 条 → P25 4000 / P50 4000 / P75 4500', () => {
    const result = salaryDistributionByUnit(PRD_12_2_SALARY_RECORDS)
    expect(result.comparable).toBe(true)
    expect(result.unitCount).toBe(1)

    const monthly = result.byUnit[0]
    expect(monthly.unit).toBe('元/月')
    expect(monthly.recordCount).toBe(5)
    expect(monthly.n).toBe(5)
    expect(monthly.sufficient).toBe(true)
    expect(monthly.quantiles.p25).toBe(4000)
    expect(monthly.quantiles.p50).toBe(4000)
    expect(monthly.quantiles.p75).toBe(4500)
    expect(monthly.mean).toBe(4200)
    expect(monthly.min).toBe(3500)
    expect(monthly.max).toBe(5000)
  })

  it('「元/月」与「元/天」分别成组，不做任何跨单位合算', () => {
    const records = syntheticRecords([
      { ...SALARY_GROUP_INPUT, offerStatus: '已入职', salaryAmount: 4000 },
      { ...SALARY_GROUP_INPUT, offerStatus: '待入职', salaryAmount: 4500 },
      {
        ...SALARY_GROUP_INPUT,
        salaryUnit: '元/天',
        offerStatus: '已入职',
        salaryAmount: 200,
      },
      { ...SALARY_GROUP_INPUT, salaryUnit: '元/天', offerStatus: '拒绝offer', salaryAmount: 300 },
    ])

    const result = salaryDistributionByUnit(records)
    expect(result.unitCount).toBe(2)
    const daily = result.byUnit.find((distribution) => distribution.unit === '元/天')
    expect(daily?.n).toBe(2)
    // 日薪样本独立计算：不足 5 条 → 不出分位，避免把月薪混进日薪分位
    expect(daily?.sufficient).toBe(false)
    expect(daily?.quantiles.p50).toBeNull()
    expect(daily?.histogram).toEqual([])
  })

  it('未知单位与「其他」单位分开显示，且不并入已知单位', () => {
    const records = syntheticRecords([
      { ...SALARY_GROUP_INPUT, offerStatus: '已入职', salaryAmount: 4000 },
      { ...SALARY_GROUP_INPUT, salaryUnit: OTHER, offerStatus: '已入职', salaryAmount: 4000 },
      { ...SALARY_GROUP_INPUT, salaryUnit: null, offerStatus: '已入职', salaryAmount: 4000 },
    ])

    const result = salaryDistributionByUnit(records)
    expect(result.byUnit.map((distribution) => distribution.label)).toEqual([
      '元/月',
      '其他单位',
      '计薪单位未知',
    ])
    expect(result.byUnit.find((distribution) => distribution.unit === null)?.n).toBe(1)
    // unitCount 只统计可识别的单位（元/月 = 1），未知 / 其他不计入
    expect(result.unitCount).toBe(1)
  })

  it('薪资缺失 / 非法的记录只计入 excludedCount，不进样本、也不当 0 元', () => {
    const records = syntheticRecords([
      { ...SALARY_GROUP_INPUT, offerStatus: '已入职', salaryAmount: null },
      { ...SALARY_GROUP_INPUT, offerStatus: '已入职', salaryAmount: -100 },
      { ...SALARY_GROUP_INPUT, offerStatus: '已入职', salaryAmount: 4000 },
    ])

    const monthly = salaryDistributionByUnit(records).byUnit[0]
    expect(monthly.recordCount).toBe(3)
    expect(monthly.n).toBe(1)
    expect(monthly.excludedCount).toBe(2)
    expect(monthly.min).toBeNull()
    expect(monthly.sufficient).toBe(false)
  })

  it('未确认币种 / 计薪周期时禁用比较：没有分位、没有直方图，只给禁用原因', () => {
    const result = salaryDistributionByUnit(PRD_12_2_SALARY_RECORDS, { comparable: false })
    expect(result.comparable).toBe(false)
    expect(result.byUnit).toEqual([])
    expect(result.disabledReason).toBe(SALARY_COMPARISON_DISABLED_REASON)
    expect(SALARY_COMPARISON_DISABLED_REASON).toContain('禁用')
  })
})

describe('薪资直方图分箱', () => {
  /*
   * 2026-09-27 起分两种方式（用户真实数据反馈）：
   * - 取值种类 ≤ `VALUE_BIN_MAX_DISTINCT`（12）→ **按实际取值逐值出箱**（每根柱子就是一个真实值）；
   * - 取值种类更多 → 维持等宽分箱（逐值出箱会让分布形状消失）。
   * 两条分支都要钉住，且图注（`histogramNote`）必须与分支一致。
   */
  it('取值种类不多时逐值出箱：每根柱子就是一个真实取值，标签不是区间', () => {
    const records = syntheticRecords(
      [3500, 3500, 4000, 4500, 4500, 4500, 5500].map((salaryAmount) => ({
        ...SALARY_GROUP_INPUT,
        offerStatus: '已入职' as const,
        salaryAmount,
      })),
    )
    const monthly = salaryDistributionByUnit(records).byUnit[0]

    expect(monthly.histogram.map((bin) => bin.label)).toEqual(['3500', '4000', '4500', '5500'])
    expect(monthly.histogram.map((bin) => bin.count)).toEqual([2, 1, 3, 1])
    // 单值箱没有右边界（与「样本全相同」那一支同一约定）
    expect(monthly.histogram.every((bin) => bin.to === null)).toBe(true)
    expect(monthly.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(monthly.n)
    expect(monthly.histogramNote).toContain('逐个出箱')
    expect(monthly.histogramNote).toContain('不是区间')
  })

  it('取值种类多时维持等宽分箱，最后一个箱包含最大值，图注说明用的是等宽', () => {
    // 构造 13 个不同取值（刚好超过阈值），bins 指定 4 档
    const amounts = Array.from({ length: 13 }, (_item, index) => 3000 + index * 500)
    const records = syntheticRecords(
      amounts.map((salaryAmount) => ({
        ...SALARY_GROUP_INPUT,
        offerStatus: '已入职' as const,
        salaryAmount,
      })),
    )
    const monthly = salaryDistributionByUnit(records, { bins: 4 }).byUnit[0]

    expect(monthly.histogram).toHaveLength(4)
    expect(monthly.histogram.reduce((sum, bin) => sum + bin.count, 0)).toBe(13)
    expect(monthly.histogram.at(-1)?.to).toBe(9000)
    expect(monthly.histogram[0].from).toBe(3000)
    expect(monthly.histogramNote).toContain('等宽 4 档')
    expect(monthly.histogramNote).toContain('超过 12 个')
  })

  it('阈值边界：12 个取值逐值出箱、13 个走等宽（阈值不是拍脑袋的模糊地带）', () => {
    const build = (count: number) =>
      syntheticRecords(
        Array.from({ length: count }, (_item, index) => ({
          ...SALARY_GROUP_INPUT,
          offerStatus: '已入职' as const,
          salaryAmount: 3000 + index * 500,
        })),
      )
    expect(salaryDistributionByUnit(build(12)).byUnit[0].histogram).toHaveLength(12)
    expect(salaryDistributionByUnit(build(13)).byUnit[0].histogram).toHaveLength(8)
  })

  it('样本全相同时退化为单个箱，不编造区间', () => {
    const records = syntheticRecords(
      [4000, 4000, 4000, 4000, 4000].map((salaryAmount) => ({
        ...SALARY_GROUP_INPUT,
        offerStatus: '已入职' as const,
        salaryAmount,
      })),
    )
    const monthly = salaryDistributionByUnit(records).byUnit[0]
    expect(monthly.histogram).toHaveLength(1)
    expect(monthly.histogram[0].to).toBeNull()
    expect(monthly.histogram[0].count).toBe(5)
    expect(monthly.histogramNote).toContain('全部相同')
  })
})

describe('房补类型对比', () => {
  it('住宿、无补贴、未知房补是三个不同的计数（住宿不折现、未知不当 0）', () => {
    const records = syntheticRecords([
      { housingType: HOUSING_ACCOMMODATION, offerStatus: '已入职' },
      { housingType: HOUSING_ACCOMMODATION, offerStatus: '待入职' },
      { housingType: HOUSING_NO_SUBSIDY, offerStatus: '已入职' },
      { housingType: UNKNOWN, offerStatus: '已入职' },
      { housingType: OTHER, offerStatus: '已入职' },
    ])

    const result = housingComparisonOf(records)
    expect(result.accommodationCount).toBe(2)
    expect(result.noSubsidyCount).toBe(1)
    expect(result.unknownOrOtherCount).toBe(2)
    expect(result.note).toBe(HOUSING_NOTE)

    // 房补类型分组保留「未知」「其他」，不会被丢弃
    const keys = result.groups.map((group) => group.key)
    expect(keys).toContain(UNKNOWN)
    expect(keys).toContain(OTHER)
    expect(keys).toContain(HOUSING_ACCOMMODATION)
  })

  it('现金房补金额按房补周期分列，缺失金额只计数不填 0', () => {
    const records = syntheticRecords([
      { housingType: HOUSING_CASH, housingPeriod: '月', housingAmount: 500, offerStatus: '已入职' },
      { housingType: HOUSING_CASH, housingPeriod: '月', housingAmount: 800, offerStatus: '已入职' },
      { housingType: HOUSING_CASH, housingPeriod: '月', housingAmount: null, offerStatus: '已入职' },
      { housingType: HOUSING_CASH, housingPeriod: '天', housingAmount: 20, offerStatus: '已入职' },
      { housingType: HOUSING_CASH, housingPeriod: null, housingAmount: 100, offerStatus: '已入职' },
    ])

    const result = housingComparisonOf(records)
    expect(result.cashAmountMissingCount).toBe(1)
    expect(result.cashByPeriod.map((stats) => stats.label)).toEqual(['月', '天', '房补周期未知'])

    const monthly = result.cashByPeriod[0]
    expect(monthly.n).toBe(2)
    expect(monthly.excludedCount).toBe(1)
    // 月房补只有 2 条有效样本：不足门槛，不出分位（也不打「待遇低」标签）
    expect(monthly.sufficient).toBe(false)
    expect(monthly.quantiles.p50).toBeNull()
  })

  it('现金房补样本充足（n ≥ 5）时给出分位', () => {
    const records = syntheticRecords(
      [100, 200, 300, 400, 500].map((housingAmount) => ({
        housingType: HOUSING_CASH,
        housingPeriod: '月' as const,
        housingAmount,
        offerStatus: '已入职' as const,
      })),
    )

    const stats = housingComparisonOf(records).cashByPeriod[0]
    expect(stats.n).toBe(5)
    expect(stats.sufficient).toBe(true)
    expect(stats.quantiles.p50).toBe(300)
  })
})
