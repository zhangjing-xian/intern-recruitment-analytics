/**
 * 同岗薪酬基准单测（docs/PRD.md 6.2 + 12.2）。
 * 基准：同岗 3500 / 4000 / 4000 / 4500 / 5000 → P25=4000、P50=4000、P75=4500、n=5 出基准；
 * 仅 3500 低于中位数；同组 n=4 时基准不足、**不打低薪标签**；住宿不折现、缺失不当 0。
 */

import { describe, expect, it } from 'vitest'

import { PRD_12_2_SALARY_RECORDS, SALARY_GROUP_INPUT, syntheticRecords } from './fixtures'
import {
  DEFAULT_BENCHMARK_MIN_SAMPLE,
  benchmarkGroupKey,
  benchmarkGroupLabel,
  benchmarkScopeNote,
  buildSalaryBenchmarks,
  collectBenchmarkSamples,
  indexBenchmarks,
  isBelowBenchmarkMedian,
  salaryAmountOf,
  salaryPercentileRankOf,
  totalCashCompensation,
} from './salary'

const SAMPLES = new Map(
  collectBenchmarkSamples(PRD_12_2_SALARY_RECORDS).map((sample) => [sample.groupKey, sample]),
)

describe('严格同组键', () => {
  it('城市 + 序列 + 岗位 + 币种 + 计薪周期相同才算同组', () => {
    const [first] = PRD_12_2_SALARY_RECORDS
    expect(benchmarkGroupKey(first)).toBe(benchmarkGroupKey(PRD_12_2_SALARY_RECORDS[3]))
    expect(benchmarkGroupLabel(benchmarkGroupKey(first) ?? '')).toBe(
      '上海 / 技术 / 前端开发 / CNY / 元/月',
    )
  })

  it('岗位 / 序列 / 币种 / 计薪周期任一缺失或为「未知 / 其他」→ 不出基准', () => {
    const [missingPosition, noCurrency, unknownCity, otherUnit] = syntheticRecords([
      { ...SALARY_GROUP_INPUT, position: null },
      { ...SALARY_GROUP_INPUT, currency: null },
      { ...SALARY_GROUP_INPUT, city: '未知' },
      { ...SALARY_GROUP_INPUT, salaryUnit: '其他' },
    ])
    expect(benchmarkGroupKey(missingPosition)).toBeNull()
    expect(benchmarkGroupKey(noCurrency)).toBeNull()
    expect(benchmarkGroupKey(unknownCity)).toBeNull()
    expect(benchmarkGroupKey(otherUnit)).toBeNull()
  })

  it('不同岗位 / 城市不会落到同一组', () => {
    const [otherCity, otherPosition] = syntheticRecords([
      { ...SALARY_GROUP_INPUT, city: '广州' },
      { ...SALARY_GROUP_INPUT, position: '后端开发' },
    ])
    const base = benchmarkGroupKey(PRD_12_2_SALARY_RECORDS[0])
    expect(benchmarkGroupKey(otherCity)).not.toBe(base)
    expect(benchmarkGroupKey(otherPosition)).not.toBe(base)
  })
})

describe('基准范围与门槛', () => {
  it('PRD 12.2：n=5 时 P25=4000、P50=4000、P75=4500，基准可用', () => {
    const benchmarks = buildSalaryBenchmarks(PRD_12_2_SALARY_RECORDS)
    expect(benchmarks).toHaveLength(1)
    const [benchmark] = benchmarks
    expect(benchmark.n).toBe(5)
    expect(benchmark.p25).toBe(4000)
    expect(benchmark.p50).toBe(4000)
    expect(benchmark.p75).toBe(4500)
    expect(benchmark.sufficient).toBe(true)
    expect(benchmark.scope).toBe('dataset')
    expect(DEFAULT_BENCHMARK_MIN_SAMPLE).toBe(5)
  })

  it('同组 n=4 时基准不足：sufficient=false 且分位为 null（不打低薪标签）', () => {
    const records = PRD_12_2_SALARY_RECORDS.slice(0, 4)
    const [benchmark] = buildSalaryBenchmarks(records)
    expect(benchmark.n).toBe(4)
    expect(benchmark.sufficient).toBe(false)
    expect(benchmark.p25).toBeNull()
    expect(benchmark.p50).toBeNull()
    expect(benchmark.p75).toBeNull()
    expect(isBelowBenchmarkMedian(records[0], indexBenchmarks([benchmark]))).toBeNull()
  })

  it('基准不受 offer 状态影响：拒 offer 记录也在参照集合里', () => {
    expect(buildSalaryBenchmarks(PRD_12_2_SALARY_RECORDS)[0].n).toBe(5)
    const rejectedRecords = PRD_12_2_SALARY_RECORDS.filter(
      (record) => record.offerStatus === '拒绝offer',
    )
    expect(rejectedRecords).toHaveLength(1)
    expect(salaryAmountOf(rejectedRecords[0])).toBe(4000)
  })

  it('币种 / 计薪周期未确认时不出任何基准', () => {
    expect(buildSalaryBenchmarks(PRD_12_2_SALARY_RECORDS, { comparable: false })).toEqual([])
  })

  it('无效薪资（缺失 / 负数）不进样本', () => {
    const [missing, negative] = syntheticRecords([
      { ...SALARY_GROUP_INPUT, salaryAmount: null },
      { ...SALARY_GROUP_INPUT, salaryAmount: -1000 },
    ])
    expect(salaryAmountOf(missing)).toBeNull()
    expect(salaryAmountOf(negative)).toBeNull()
  })

  it('参照集合描述写明门槛与范围（基准不悄悄变化）', () => {
    const note = benchmarkScopeNote()
    expect(note).toContain('n ≥ 5')
    expect(note).toContain('dataset')
    expect(note).toContain('不受渠道 / HR / offer 状态 / 薪资筛选影响')
  })
})

describe('分位排名与低于中位数', () => {
  it('3500 / 4000 的百分位排名分别为 10% / 40%', () => {
    expect(salaryPercentileRankOf(PRD_12_2_SALARY_RECORDS[0], SAMPLES)).toBeCloseTo(0.1, 10)
    expect(salaryPercentileRankOf(PRD_12_2_SALARY_RECORDS[1], SAMPLES)).toBeCloseTo(0.4, 10)
  })

  it('仅 3500 低于中位数，4000 相等不标低', () => {
    const index = indexBenchmarks(buildSalaryBenchmarks(PRD_12_2_SALARY_RECORDS))
    const belowFlags = PRD_12_2_SALARY_RECORDS.map((record) =>
      isBelowBenchmarkMedian(record, index),
    )
    expect(belowFlags).toEqual([true, false, false, false, false])
  })

  it('基准不足或薪资缺失时不再返回布尔值', () => {
    const insufficientIndex = indexBenchmarks(
      buildSalaryBenchmarks(PRD_12_2_SALARY_RECORDS.slice(0, 4)),
    )
    expect(isBelowBenchmarkMedian(PRD_12_2_SALARY_RECORDS[0], insufficientIndex)).toBeNull()

    const [noSalary] = syntheticRecords([{ ...SALARY_GROUP_INPUT, salaryAmount: null }])
    expect(salaryPercentileRankOf(noSalary, SAMPLES)).toBeNull()
    expect(
      isBelowBenchmarkMedian(noSalary, indexBenchmarks(buildSalaryBenchmarks(PRD_12_2_SALARY_RECORDS))),
    ).toBeNull()
  })
})

describe('现金待遇合计', () => {
  it('现金房补与计薪周期对齐时可加总', () => {
    const [record] = syntheticRecords([
      {
        ...SALARY_GROUP_INPUT,
        salaryAmount: 4000,
        housingType: '现金房补',
        housingAmount: 500,
        housingPeriod: '月',
      },
    ])
    const total = totalCashCompensation(record)
    expect(total.total).toBe(4500)
    expect(total.alignable).toBe(true)
  })

  it('房补周期无法对齐时不做合计（不拿薪资冒充总额）', () => {
    const [record] = syntheticRecords([
      {
        ...SALARY_GROUP_INPUT,
        salaryAmount: 4000,
        housingType: '现金房补',
        housingAmount: 500,
        housingPeriod: '次',
      },
    ])
    const total = totalCashCompensation(record)
    expect(total.total).toBeNull()
    expect(total.housingCashAmount).toBe(500)
    expect(total.alignable).toBe(false)
  })

  it('无补贴按 0 计入；提供住宿不折现；未知房补不当 0', () => {
    const [noSubsidy, accommodation, unknownHousing, cashWithoutAmount] = syntheticRecords([
      { ...SALARY_GROUP_INPUT, salaryAmount: 4000, housingType: '无补贴', housingAmount: 0 },
      { ...SALARY_GROUP_INPUT, salaryAmount: 4000, housingType: '提供住宿' },
      { ...SALARY_GROUP_INPUT, salaryAmount: 4000, housingType: '未知' },
      {
        ...SALARY_GROUP_INPUT,
        salaryAmount: 4000,
        housingType: '现金房补',
        housingAmount: null,
      },
    ])
    expect(totalCashCompensation(noSubsidy).total).toBe(4000)
    expect(totalCashCompensation(accommodation).total).toBeNull()
    expect(totalCashCompensation(accommodation).note).toContain('不折算成现金')
    expect(totalCashCompensation(unknownHousing).housingCashAmount).toBeNull()
    expect(totalCashCompensation(cashWithoutAmount).total).toBeNull()
  })
})
