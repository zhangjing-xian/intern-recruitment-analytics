/**
 * 分维度分析规则单测（步骤9，docs/PRD.md 8 章）。
 *
 * 关键断言：仅 1 位 HR 时不做排名、未知 HR 不参与排名、门槛只数 D ≥ 10、
 * 学校别名来源可追溯（别名归一条数可见）、未拆分需求类型单独计数。
 */

import { describe, expect, it } from 'vitest'

import { UNKNOWN, UNSPLIT_REQUIREMENT_TYPE } from '../enums'

import {
  HR_SINGLE_NOTE,
  POSITION_RANK_NOTE,
  PROFILE_NOTE,
  REQUIREMENT_TYPE_NOTE,
  gptSourceCounts,
  recruiterRankingAvailability,
  schoolSourceCounts,
  unsplitRequirementTypeCount,
} from './dimensionNotes'
import { aggregateByDimension } from './grouping'
import { syntheticRecords } from './fixtures'

/** 构造 n 条同一 HR / 同一状态的记录 */
function joinedRecords(count: number, recruiter: string | null) {
  return Array.from({ length: count }, () => ({ offerStatus: '已入职' as const, recruiter }))
}

describe('HR 排名可用性', () => {
  it('只有 1 位 HR：不做排名（未知不参与，避免凭空多出一名）', () => {
    const records = syntheticRecords([
      ...joinedRecords(12, 'HR-A'),
      { offerStatus: '已入职', recruiter: null },
      { offerStatus: '已入职', recruiter: null },
    ])
    const availability = recruiterRankingAvailability(aggregateByDimension(records, 'recruiter'))

    expect(availability.recruiterCount).toBe(1)
    expect(availability.canRank).toBe(false)
    expect(availability.rankableCount).toBe(1)
    expect(availability.note).toBe(HR_SINGLE_NOTE)
  })

  it('HR 全部缺失：给出「先补齐招聘 HR 列」的说明，而不是排名', () => {
    const records = syntheticRecords(joinedRecords(4, null))
    const availability = recruiterRankingAvailability(aggregateByDimension(records, 'recruiter'))

    expect(availability.recruiterCount).toBe(0)
    expect(availability.canRank).toBe(false)
    expect(availability.note).toContain('不排名')
  })

  it('多 HR 时可排名，但门槛只数 D ≥ 10 的那几位', () => {
    const records = syntheticRecords([
      ...joinedRecords(10, 'HR-A'),
      ...joinedRecords(3, 'HR-B'),
      { offerStatus: '拒绝offer', recruiter: 'HR-C' },
    ])
    const availability = recruiterRankingAvailability(aggregateByDimension(records, 'recruiter'))

    expect(availability.recruiterCount).toBe(3)
    expect(availability.canRank).toBe(true)
    expect(availability.rankableCount).toBe(1)
    expect(availability.note).toContain('D ≥ 10')
  })
})

describe('需求类型与画像口径', () => {
  it('未拆分需求类型单独计数（不能把「替补替换未拆分」当成替补或替换）', () => {
    const records = syntheticRecords([
      { requirementType: UNSPLIT_REQUIREMENT_TYPE },
      { requirementType: UNSPLIT_REQUIREMENT_TYPE },
      { requirementType: '新增招聘' },
      { requirementType: UNKNOWN },
    ])

    expect(unsplitRequirementTypeCount(records)).toBe(2)
    expect(REQUIREMENT_TYPE_NOTE).toContain('未拆分')
    expect(REQUIREMENT_TYPE_NOTE).toContain('不能宣称替补优于替换')
  })

  it('学校结论来源可追溯：别名归一的条数单独可见', () => {
    const records = syntheticRecords([
      { school: '上海交通大学' },
      { school: '上海交通大学' },
      { school: null },
    ])

    const counts = schoolSourceCounts(records)
    expect(counts.raw).toBe(2)
    expect(counts.unknown).toBe(1)
    expect(counts.aliasTable).toBe(0)
  })

  it('GPT 判定来源同样按来源计数（夹具未模拟名单补全 → 全部未知）', () => {
    const counts = gptSourceCounts(syntheticRecords([{ isGptSchool: true }, { isGptSchool: null }]))
    expect(counts.unknown).toBe(2)
    expect(counts.localList).toBe(0)
  })

  it('画像与排行的红线文案由引擎给出（组件不得自己改写）', () => {
    expect(PROFILE_NOTE).toContain('不推断个人能力')
    expect(PROFILE_NOTE).toContain('不输出个人拒 offer 概率')
    expect(POSITION_RANK_NOTE).toContain('D ≥ 10')
    expect(POSITION_RANK_NOTE).toContain('不代表统计显著')
  })
})
