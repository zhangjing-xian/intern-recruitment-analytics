/**
 * 筛选快照与过滤规则单测（docs/PRD.md 6.3）。
 * 规则：字段间 AND、字段内 OR、未选择不过滤；「未知」是可选独立值；
 * 时间默认不筛选、可按启动日期 / 入职日期切换、日期缺失单列；去重只排除显式移重的记录。
 */

import { describe, expect, it } from 'vitest'

import type { NormalizedRecord } from '../types'

import { syntheticRecord, syntheticRecords } from './fixtures'
import {
  EMPTY_FILTERS,
  applyFilters,
  describeActiveFilters,
  isStatusSubsetFilter,
  retainedRecords,
  unconfirmedDuplicateCount,
} from './filters'

const RECORDS = syntheticRecords([
  {
    offerStatus: '已入职',
    city: '上海',
    channel: '官网',
    recruitmentStartDate: '2026-01-05',
    joiningDate: '2026-01-15',
  },
  {
    offerStatus: '待入职',
    city: '广州',
    channel: 'Boss',
    recruitmentStartDate: '2026-02-05',
    joiningDate: '2026-03-01',
  },
  { offerStatus: '拒绝offer', city: '未知', channel: 'Boss', recruitmentStartDate: null },
  {
    offerStatus: 'offer审批中',
    city: '上海',
    channel: '内推',
    recruitmentStartDate: '2026-04-01',
    joiningDate: '2026-06-01',
  },
])

function keysOf(records: readonly NormalizedRecord[]): readonly string[] {
  return records.map((record) => record.recordId)
}

describe('维度筛选', () => {
  it('未选择等于不过滤', () => {
    const outcome = applyFilters(RECORDS, EMPTY_FILTERS)
    expect(outcome.matchedCount).toBe(4)
    expect(outcome.retainedCount).toBe(4)
    expect(outcome.statusSubset).toBe(false)
  })

  it('同字段多选是 OR，不同字段之间是 AND', () => {
    const multiCity = applyFilters(RECORDS, {
      ...EMPTY_FILTERS,
      dimensions: { city: ['上海', '广州'] },
    })
    expect(multiCity.matchedCount).toBe(3)

    const andFilter = applyFilters(RECORDS, {
      ...EMPTY_FILTERS,
      dimensions: { city: ['上海'], channel: ['内推'] },
    })
    expect(keysOf(andFilter.records)).toEqual(['SYN-0004'])
  })

  it('空数组等于该字段不过滤', () => {
    const outcome = applyFilters(RECORDS, { ...EMPTY_FILTERS, dimensions: { city: [] } })
    expect(outcome.matchedCount).toBe(4)
  })

  it('「未知」是可选的独立值，不是被自动排除的脏数据', () => {
    const outcome = applyFilters(RECORDS, { ...EMPTY_FILTERS, dimensions: { city: ['未知'] } })
    expect(keysOf(outcome.records)).toEqual(['SYN-0003'])
  })
})

describe('状态筛选', () => {
  it('单组状态筛选会提示「当前子集率」，并给出被排除记录数', () => {
    const filters = { ...EMPTY_FILTERS, statuses: ['已入职'] as const }
    const outcome = applyFilters(RECORDS, filters)
    expect(outcome.matchedCount).toBe(1)
    expect(outcome.excludedByStatus).toBe(3)
    expect(outcome.statusSubset).toBe(true)
    expect(isStatusSubsetFilter(filters)).toBe(true)
  })

  it('多状态筛选是 OR', () => {
    const outcome = applyFilters(RECORDS, {
      ...EMPTY_FILTERS,
      statuses: ['已入职', '待入职'],
    })
    expect(outcome.matchedCount).toBe(2)
  })
})

describe('时间筛选', () => {
  it('按启动招聘日期筛选，日期缺失的记录单列计数且默认不纳入', () => {
    const outcome = applyFilters(RECORDS, {
      ...EMPTY_FILTERS,
      time: {
        basis: 'recruitmentStartDate',
        from: '2026-02-01',
        to: '2026-03-01',
        includeMissingDate: false,
      },
    })
    expect(keysOf(outcome.records)).toEqual(['SYN-0002'])
    expect(outcome.missingDateCount).toBe(1)
  })

  it('显式勾选后可纳入日期缺失记录，但仍单独计数', () => {
    const outcome = applyFilters(RECORDS, {
      ...EMPTY_FILTERS,
      time: {
        basis: 'recruitmentStartDate',
        from: '2026-02-01',
        to: '2026-03-01',
        includeMissingDate: true,
      },
    })
    expect(outcome.matchedCount).toBe(2)
    expect(outcome.missingDateCount).toBe(1)
  })

  it('时间基准可切换为入职日期，不能拿启动日期冒充', () => {
    const outcome = applyFilters(RECORDS, {
      ...EMPTY_FILTERS,
      time: {
        basis: 'joiningDate',
        from: '2026-06-01',
        to: '2026-06-30',
        includeMissingDate: false,
      },
    })
    expect(keysOf(outcome.records)).toEqual(['SYN-0004'])
    expect(outcome.missingDateCount).toBe(1)
  })

  it('两端都可以只给一端；未设置时间筛选时不做日期裁剪', () => {
    const outcome = applyFilters(RECORDS, {
      ...EMPTY_FILTERS,
      time: { basis: 'recruitmentStartDate', from: null, to: null, includeMissingDate: false },
    })
    expect(outcome.matchedCount).toBe(4)
    expect(outcome.missingDateCount).toBe(0)
  })
})

describe('去重策略的保留规则', () => {
  const withDuplicates: readonly NormalizedRecord[] = [
    ...RECORDS,
    {
      ...syntheticRecord({ recordId: 'SYN-0005' }),
      dedupDecision: {
        duplicateKind: 'exact',
        duplicateGroupKey: 'exact#1',
        suspectedKey: null,
        action: 'removedAsDuplicate',
        decidedBy: 'user',
      },
    },
    {
      ...syntheticRecord({ recordId: 'SYN-0006' }),
      dedupDecision: {
        duplicateKind: 'suspected',
        duplicateGroupKey: null,
        suspectedKey: 'REQ-001 + 合成 + 2026-01-05',
        action: 'pendingUserConfirmation',
        decidedBy: 'none',
      },
    },
  ]

  it('显式移重的记录不进分析集，并计入 droppedDuplicateCount', () => {
    const outcome = applyFilters(withDuplicates)
    expect(keysOf(outcome.records)).not.toContain('SYN-0005')
    expect(outcome.records).toHaveLength(5)
    expect(outcome.droppedDuplicateCount).toBe(1)
    expect(outcome.totalCount).toBe(6)
  })

  it('尚未确认的重复行保留在分析集里，但单独计数', () => {
    expect(unconfirmedDuplicateCount(withDuplicates)).toBe(1)
    expect(retainedRecords(withDuplicates)).toHaveLength(5)
  })
})

describe('筛选描述', () => {
  it('输出可直接展示的中文描述（含子集率与时间基准提示）', () => {
    const descriptions = describeActiveFilters({
      dimensions: { city: ['上海', '广州'], channel: ['Boss'] },
      statuses: ['已入职'],
      time: {
        basis: 'joiningDate',
        from: '2026-01-01',
        to: '2026-06-30',
        includeMissingDate: false,
      },
    })
    expect(descriptions).toContain('城市：上海、广州')
    expect(descriptions).toContain('渠道：Boss')
    expect(descriptions).toContain('offer 状态：已入职（当前为子集率）')
    expect(descriptions.join(' ')).toContain('时间基准：入职日期 2026-01-01 至 2026-06-30')
    expect(descriptions.join(' ')).toContain('日期缺失记录不纳入')
  })

  it('没有筛选时描述为空', () => {
    expect(describeActiveFilters(EMPTY_FILTERS)).toEqual([])
  })
})
