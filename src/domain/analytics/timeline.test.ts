/**
 * 分月趋势聚合单测（docs/PRD.md 6.3）。
 *
 * 断言三件事：
 * 1. **只按合法日期分月**：缺失 / 非法日期不进任何月份，单列计数，总数不丢；
 * 2. 每个月份批次的口径与 KPI 一致（复用 `summarizeRecords`，不是各写一套率）；
 * 3. 口径提示明确「启动批次 ≠ 发 offer 趋势」「入职日期 ≠ 发 offer 批次表现」。
 */

import { describe, expect, it } from 'vitest'

import { aggregateByMonth, periodKeyOf, timelineCoversAllRecords, timelineNote } from './timeline'
import { PRD_12_2_RECORDS, syntheticRecords } from './fixtures'

describe('periodKeyOf', () => {
  it('合法日期取到月份', () => {
    expect(periodKeyOf('2026-03-08')).toBe('2026-03')
    expect(periodKeyOf('2026-12-31')).toBe('2026-12')
  })

  it('缺失日期返回 null（不当成某个默认月份）', () => {
    expect(periodKeyOf(null)).toBeNull()
  })

  it('非法日历日返回 null，不取前 7 位凑月份', () => {
    expect(periodKeyOf('2026-02-30')).toBeNull()
    expect(periodKeyOf('2026-13-05')).toBeNull()
  })

  it('非 YYYY-MM-DD 写法返回 null', () => {
    expect(periodKeyOf('2026-3-5')).toBeNull()
    expect(periodKeyOf('2026/03/05')).toBeNull()
  })
})

describe('aggregateByMonth', () => {
  it('PRD 12.2 验收集按启动招聘日期分月：1 / 1 / 4，无缺失', () => {
    const result = aggregateByMonth(PRD_12_2_RECORDS, 'recruitmentStartDate')

    expect(result.buckets.map((bucket) => bucket.periodKey)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(result.buckets.map((bucket) => bucket.summary.counts.total)).toEqual([1, 1, 4])
    expect(result.missingDateCount).toBe(0)
    expect(timelineCoversAllRecords(result, PRD_12_2_RECORDS.length)).toBe(true)
  })

  it('每个月份批次的率与 KPI 同口径（2026-03：D=3、拒 offer 率 2/3）', () => {
    const result = aggregateByMonth(PRD_12_2_RECORDS, 'recruitmentStartDate')
    const march = result.buckets.find((bucket) => bucket.periodKey === '2026-03')

    expect(march).toBeDefined()
    expect(march?.summary.counts).toMatchObject({
      total: 4,
      pending: 1,
      approving: 1,
      rejectedOffer: 1,
      rejectedVerbally: 1,
      rejected: 2,
      coreDenominator: 3,
    })
    expect(march?.summary.rates.rejectionRate.numerator).toBe(2)
    expect(march?.summary.rates.rejectionRate.denominator).toBe(3)
    expect(march?.summary.rates.rejectionRate.value).toBeCloseTo(2 / 3, 10)
  })

  it('按入职日期分月：3 个批次 + 3 条日期缺失单列', () => {
    const result = aggregateByMonth(PRD_12_2_RECORDS, 'joiningDate')

    expect(result.buckets.map((bucket) => bucket.periodKey)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(result.buckets.map((bucket) => bucket.summary.counts.total)).toEqual([1, 1, 1])
    expect(result.missingDateCount).toBe(3)
    expect(timelineCoversAllRecords(result, PRD_12_2_RECORDS.length)).toBe(true)
    // 无入职日期的审批中 / 拒 offer 记录不得落进只有待入职的那一个月
    expect(result.buckets[2].summary.counts.approving).toBe(0)
  })

  it('月份按时间升序，不按记录顺序', () => {
    const records = syntheticRecords([
      { offerStatus: '已入职', recruitmentStartDate: '2026-09-01', joiningDate: '2026-09-10' },
      { offerStatus: '已入职', recruitmentStartDate: '2026-01-01', joiningDate: '2026-01-10' },
      { offerStatus: '已入职', recruitmentStartDate: '2026-05-01', joiningDate: '2026-05-10' },
    ])
    const result = aggregateByMonth(records, 'recruitmentStartDate')

    expect(result.buckets.map((bucket) => bucket.periodKey)).toEqual(['2026-01', '2026-05', '2026-09'])
  })

  it('非法日期既不进趋势，也不算进任何一个月份', () => {
    const records = syntheticRecords([
      { offerStatus: '已入职', recruitmentStartDate: '2026-04-01', joiningDate: '2026-04-11' },
      { offerStatus: '已入职', recruitmentStartDate: '2026-02-30', joiningDate: null },
      { offerStatus: '未知', recruitmentStartDate: null, joiningDate: null },
    ])
    const result = aggregateByMonth(records, 'recruitmentStartDate')

    expect(result.buckets.map((bucket) => bucket.periodKey)).toEqual(['2026-04'])
    expect(result.buckets[0].summary.counts.total).toBe(1)
    expect(result.missingDateCount).toBe(2)
    expect(timelineCoversAllRecords(result, records.length)).toBe(true)
  })

  it('空记录集返回空趋势而不是 0 值图表', () => {
    const result = aggregateByMonth([], 'recruitmentStartDate')

    expect(result.buckets).toEqual([])
    expect(result.missingDateCount).toBe(0)
    expect(timelineCoversAllRecords(result, 0)).toBe(true)
  })

  it('默认基准为启动招聘日期', () => {
    const result = aggregateByMonth(PRD_12_2_RECORDS)

    expect(result.basis).toBe('recruitmentStartDate')
  })

  it('总记录数与趋势覆盖不一致时能被检出（防止漏算被吞掉）', () => {
    const result = aggregateByMonth(PRD_12_2_RECORDS, 'recruitmentStartDate')

    expect(timelineCoversAllRecords(result, PRD_12_2_RECORDS.length + 1)).toBe(false)
  })
})

describe('timelineNote', () => {
  it('启动招聘日期不称「发 offer 趋势」', () => {
    const note = timelineNote('recruitmentStartDate')

    expect(note).toContain('启动招聘日期')
    expect(note).toContain('发 offer 趋势')
  })

  it('入职日期不称「发 offer 批次表现」', () => {
    expect(timelineNote('joiningDate')).toContain('发 offer 批次表现')
  })

  it('聚合结果把基准名称写进口径提示', () => {
    expect(aggregateByMonth([], 'joiningDate').note).toContain('入职日期')
  })
})
