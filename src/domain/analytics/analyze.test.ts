/**
 * 指标引擎组合入口单测（docs/PRD.md 12.2 开发回归基准 + 4.2 派生字段契约）。
 * 基准：N=6、D=5、拒 offer 率 40%、入职率 40%、待入职占比 20%、审批中占比 16.67%、平均周期 15 天；
 * 追加 1 条其他状态只改变 N；薪资例 P50=4000 且相等不算低；n<5 不出低薪标签；零分母显示 null。
 */

import { describe, expect, it } from 'vitest'

// 页面与数据层只从领域层统一出口导入：这里顺带验证桶文件已导出指标引擎
import { EMPTY_FILTERS, analyzeRecords, decorateRecords } from '../index'
import { CURRENT_RULE_VERSION } from '../version'

import { PRD_12_2_RECORDS, PRD_12_2_SALARY_RECORDS, syntheticRecords } from './fixtures'

const BASE_OPTIONS = {
  dataAsOf: '2026-09-26',
  dedupStrategy: '保留全部',
  salaryComparable: true,
} as const

describe('一次分析的全部共享指标', () => {
  const result = analyzeRecords(PRD_12_2_RECORDS, BASE_OPTIONS)

  it('PRD 12.2：N=6、J=2、P=1、A=1、R=2、D=5', () => {
    expect(result.statusCounts.total).toBe(6)
    expect(result.statusCounts.joined).toBe(2)
    expect(result.statusCounts.pending).toBe(1)
    expect(result.statusCounts.approving).toBe(1)
    expect(result.statusCounts.rejected).toBe(2)
    expect(result.statusCounts.coreDenominator).toBe(5)
  })

  it('PRD 12.2：接受率 60%、拒 offer 率 40%、入职率 40%、待入职占比 20%、审批中占比 16.67%', () => {
    expect(result.rates.acceptanceRate.value).toBeCloseTo(0.6, 10)
    expect(result.rates.rejectionRate.value).toBeCloseTo(0.4, 10)
    expect(result.rates.joinedRate.value).toBeCloseTo(0.4, 10)
    expect(result.rates.pendingShareRate.value).toBeCloseTo(0.2, 10)
    expect(result.rates.approvingShareRate.value).toBeCloseTo(1 / 6, 10)
  })

  it('PRD 12.2：平均实际招聘周期 15 天，待入职计划周期单独统计', () => {
    expect(result.cycles.actual.n).toBe(2)
    expect(result.cycles.actual.meanDays).toBe(15)
    expect(result.cycles.planned.n).toBe(1)
    expect(result.cycles.planned.meanDays).toBe(20)
  })

  it('覆盖需求数、原因填写率与去重提示随结果一起给出', () => {
    expect(result.coverage.distinctRequirementCount).toBe(6)
    expect(result.rejectionReasonFillRate.value).toBeCloseTo(0.5, 10)
    expect(result.unconfirmedDuplicateCount).toBe(0)
  })

  it('口径快照齐全：截至日、去重策略、规则版本、基准范围说明', () => {
    expect(result.dataAsOf).toBe('2026-09-26')
    expect(result.dedupStrategy).toBe('保留全部')
    expect(result.ruleVersion).toEqual(CURRENT_RULE_VERSION)
    expect(result.benchmarkScope).toBe('dataset')
    expect(result.benchmarkNote).toContain('n ≥ 5')
    expect(result.subsetRateNote).toBeNull()
  })

  it('追加 1 条「其他」状态：N=7、D 仍为 5、核心率不变', () => {
    const extended = analyzeRecords(
      [...PRD_12_2_RECORDS, ...syntheticRecords([{ offerStatus: '其他' }])],
      BASE_OPTIONS,
    )
    expect(extended.statusCounts.total).toBe(7)
    expect(extended.statusCounts.coreDenominator).toBe(5)
    expect(extended.rates.rejectionRate.value).toBeCloseTo(0.4, 10)
    expect(extended.rates.joinedRate.value).toBeCloseTo(0.4, 10)
    // 审批中占比的分母是 N：N 变成 7 后占比随之变为 1/7，核心率不受影响
    expect(extended.rates.approvingShareRate.value).toBeCloseTo(1 / 7, 10)
  })

  it('空数据集：计数为 0、率为 null（不是 0%）', () => {
    const empty = analyzeRecords([], BASE_OPTIONS)
    expect(empty.statusCounts.total).toBe(0)
    expect(empty.rates.acceptanceRate.value).toBeNull()
    expect(empty.rates.approvingShareRate.value).toBeNull()
    expect(empty.cycles.actual.meanDays).toBeNull()
    expect(empty.coverage.distinctRequirementCount).toBe(0)
  })

  it('状态筛选生效时给出「当前子集率」提示，且率按子集重算', () => {
    const subset = analyzeRecords(PRD_12_2_RECORDS, {
      ...BASE_OPTIONS,
      filters: { ...EMPTY_FILTERS, statuses: ['已入职'] },
    })
    expect(subset.filterOutcome.statusSubset).toBe(true)
    expect(subset.subsetRateNote).toContain('当前子集率')
    expect(subset.statusCounts.coreDenominator).toBe(2)
    expect(subset.rates.joinedRate.value).toBe(1)
  })

  it('币种 / 计薪周期未确认时不产出基准（禁用待遇对比）', () => {
    const result = analyzeRecords(PRD_12_2_SALARY_RECORDS, {
      ...BASE_OPTIONS,
      salaryComparable: false,
    })
    expect(result.benchmarks).toEqual([])
  })

  it('基准参照集合默认不受业务筛选影响（换渠道筛选不改变基准样本）', () => {
    const byChannel = analyzeRecords(PRD_12_2_SALARY_RECORDS, {
      ...BASE_OPTIONS,
      filters: { ...EMPTY_FILTERS, dimensions: { channel: ['未知'] } },
    })
    expect(byChannel.filterOutcome.matchedCount).toBe(5)
    expect(byChannel.benchmarks[0].n).toBe(5)
    expect(byChannel.benchmarks[0].p50).toBe(4000)
  })
})

describe('派生字段填充（4.2 契约：组件不得自行计算）', () => {
  it('基准 / 分位排名 / 低于中位数由引擎写入 derived', () => {
    const decorated = decorateRecords(PRD_12_2_SALARY_RECORDS, { salaryComparable: true })
    expect(decorated[0].derived.salaryBenchmark?.n).toBe(5)
    expect(decorated[0].derived.salaryBenchmark?.p50).toBe(4000)
    expect(decorated[0].derived.salaryPercentileRank).toBeCloseTo(0.1, 10)
    expect(decorated[0].derived.isBelowMedian).toBe(true)
    expect(decorated[1].derived.isBelowMedian).toBe(false)
  })

  it('接受 / 拒绝标记与核心分母标记按统一口径填充（其他 / 未知为 null）', () => {
    const decorated = decorateRecords(
      syntheticRecords([
        { offerStatus: '已入职' },
        { offerStatus: 'offer审批中' },
        { offerStatus: '其他' },
      ]),
      { salaryComparable: false },
    )
    expect(decorated.map((record) => record.derived.isAccepted)).toEqual([true, false, null])
    expect(decorated.map((record) => record.derived.countedInCoreDenominator)).toEqual([
      true,
      false,
      false,
    ])
  })

  it('同组 n<5 时不打低薪标签：isBelowMedian 为 null', () => {
    const decorated = decorateRecords(PRD_12_2_SALARY_RECORDS.slice(0, 4), {
      salaryComparable: true,
    })
    expect(decorated.every((record) => record.derived.salaryBenchmark?.sufficient === false)).toBe(
      true,
    )
    expect(decorated.every((record) => record.derived.isBelowMedian === null)).toBe(true)
  })

  it('清洗层已有的质量标记原样保留，不被引擎改写', () => {
    const [record] = decorateRecords(syntheticRecords([{ offerStatus: '已入职' }]), {
      salaryComparable: false,
    })
    expect(record.derived.dataQualityFlags).toEqual([])
    expect(record.derived.actualCycleEligible).toBe(false)
  })

  it('参照集合可显式指定并把范围标为 userDefined', () => {
    const [record] = decorateRecords(PRD_12_2_SALARY_RECORDS.slice(0, 1), {
      salaryComparable: true,
      benchmarkScope: 'userDefined',
      referenceRecords: PRD_12_2_SALARY_RECORDS,
    })
    expect(record.derived.salaryBenchmark?.scope).toBe('userDefined')
    expect(record.derived.salaryBenchmark?.sufficient).toBe(true)
  })
})
