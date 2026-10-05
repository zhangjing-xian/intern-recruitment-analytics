/**
 * 率与比例单测（docs/PRD.md 6.1 + 12.2）。
 * 基准：接受率 60%、拒 offer 率 40%、入职率 40%、待入职占比 20%、审批中占比 16.67%。
 * 另外两条硬规则：分母为 0 → null（不是 0%）；汇总率必须合计分子分母再相除。
 */

import { describe, expect, it } from 'vitest'

import { PRD_12_2_RECORDS, syntheticRecords } from './fixtures'
import {
  AUTO_CONCLUSION_MIN_DENOMINATOR,
  buildCoreRates,
  isReasonFilled,
  rateOf,
  rejectionReasonFillRate,
  sampleSufficiencyOf,
} from './rates'
import { countStatuses } from './statusCounts'

describe('核心率', () => {
  const rates = buildCoreRates(countStatuses(PRD_12_2_RECORDS))

  it('PRD 12.2：接受率 60%、拒 offer 率 40%、入职率 40%、待入职占比 20%', () => {
    expect(rates.acceptanceRate.value).toBeCloseTo(0.6, 10)
    expect(rates.rejectionRate.value).toBeCloseTo(0.4, 10)
    expect(rates.joinedRate.value).toBeCloseTo(0.4, 10)
    expect(rates.pendingShareRate.value).toBeCloseTo(0.2, 10)
  })

  it('审批中占比 16.67% 使用分母 N，与核心率分母不同且已标注', () => {
    expect(rates.approvingShareRate.value).toBeCloseTo(1 / 6, 10)
    expect(rates.approvingShareRate.denominator).toBe(6)
    expect(rates.approvingShareRate.note).toContain('与核心率分母 D 不同')
    expect(rates.pendingShareOfAllRate.denominator).toBe(6)
    expect(rates.pendingShareOfAllRate.value).toBeCloseTo(1 / 6, 10)
  })

  it('入职率不使用 J/N 冒充：J/N 是 33.33%，J/D 才是 40%', () => {
    expect(rates.joinedRate.numerator).toBe(2)
    expect(rates.joinedRate.denominator).toBe(5)
    expect(rates.joinedRate.note).toContain('不是')
    expect(2 / 6).toBeCloseTo(0.3333, 3)
  })

  it('每项都带分子 / 分母 / 排除数：D 之外的审批中记录被计入排除数', () => {
    expect(rates.rejectionRate.numerator).toBe(2)
    expect(rates.rejectionRate.denominator).toBe(5)
    expect(rates.rejectionRate.excludedCount).toBe(1)
    expect(rates.acceptanceRate.note).toContain('D = 已入职 + 待入职 + 拒绝 offer')
  })

  it('空数据集：分母为 0 时值为 null（显示「—/无有效样本」，不是 0%）', () => {
    const empty = buildCoreRates(countStatuses([]))
    expect(empty.rejectionRate.value).toBeNull()
    expect(empty.joinedRate.value).toBeNull()
    expect(empty.approvingShareRate.value).toBeNull()
    expect(empty.acceptanceRate.denominator).toBe(0)
  })

  it('分母为 0 的 rateOf 直接给 null，不返回 0', () => {
    expect(rateOf(0, 0).value).toBeNull()
    expect(rateOf(0, 3).value).toBe(0)
  })
})

describe('汇总率不是平均分组率', () => {
  const groupA = syntheticRecords([{ offerStatus: '已入职', channel: '官网' }])
  const groupB = syntheticRecords(
    Array.from({ length: 9 }, () => ({ offerStatus: '拒绝offer' as const, channel: 'Boss' })),
  )

  it('合计分子分母后相除得到 90%，而不是两个分组百分比的 50%', () => {
    const rateA = buildCoreRates(countStatuses(groupA)).rejectionRate.value ?? 0
    const rateB = buildCoreRates(countStatuses(groupB)).rejectionRate.value ?? 0
    expect(rateA).toBe(0)
    expect(rateB).toBe(1)
    expect((rateA + rateB) / 2).toBe(0.5)

    const overall = buildCoreRates(countStatuses([...groupA, ...groupB])).rejectionRate
    expect(overall.numerator).toBe(9)
    expect(overall.denominator).toBe(10)
    expect(overall.value).toBeCloseTo(0.9, 10)
  })
})

describe('原因填写率', () => {
  it('PRD 12.2：2 条拒 offer 中 1 条填写 → 50%，非拒 offer 不进分母', () => {
    const rate = rejectionReasonFillRate(PRD_12_2_RECORDS)
    expect(rate.numerator).toBe(1)
    expect(rate.denominator).toBe(2)
    expect(rate.value).toBeCloseTo(0.5, 10)
    expect(rate.excludedCount).toBe(4)
  })

  it('原因全缺失时是 0%（不是 null）：未填写仍计入分母', () => {
    const records = syntheticRecords([
      { offerStatus: '拒绝offer', rejectionReason: null },
      { offerStatus: '拒绝口头offer', rejectionReason: '   ' },
    ])
    expect(rejectionReasonFillRate(records).value).toBe(0)
    expect(rejectionReasonFillRate(records).note).toContain('未填写')
  })

  it('没有拒 offer 记录时分母为 0 → null', () => {
    const records = syntheticRecords([{ offerStatus: '已入职' }])
    expect(rejectionReasonFillRate(records).value).toBeNull()
  })

  it('空白字符串不算已填写', () => {
    expect(isReasonFilled('  ')).toBe(false)
    expect(isReasonFilled(null)).toBe(false)
    expect(isReasonFilled('薪酬')).toBe(true)
  })
})

describe('样本门槛（自动结论）', () => {
  it('D=0 无有效样本、0<D<10 小样本、D≥10 可参与自动结论', () => {
    expect(AUTO_CONCLUSION_MIN_DENOMINATOR).toBe(10)
    expect(sampleSufficiencyOf(0).tag).toBe('none')
    expect(sampleSufficiencyOf(9).tag).toBe('small')
    expect(sampleSufficiencyOf(9).note).toContain('不参与自动排名')
    expect(sampleSufficiencyOf(10).tag).toBe('sufficient')
    expect(sampleSufficiencyOf(10).note).toContain('不代表')
  })

  it('门槛可配置，但默认值只有一处定义', () => {
    expect(sampleSufficiencyOf(5, 5).tag).toBe('sufficient')
  })
})
