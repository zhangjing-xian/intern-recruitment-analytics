/**
 * 重复判定与去重（docs/PRD.md 5.4）单测。
 * 铁律：完全重复只按原始单元格比较、疑似重复只作提示（不做模糊匹配）；
 * 未确认前**不减少样本**，默认建议每组保留首条但必须用户确认后才生效。
 */

import { describe, expect, it } from 'vitest'

import type { DedupDecision, NormalizedRecord, RawCellValue } from '../domain'
import {
  analyzeDuplicates,
  applyDedupStrategy,
  initialDedupDecision,
  suggestedKeepRecordIds,
  type DuplicateCandidate,
} from './duplicates'

function candidate(input: {
  readonly recordId: string
  readonly sourceRow: number
  readonly cells?: readonly RawCellValue[]
  readonly requirementId?: string | null
  readonly candidateName?: string | null
  readonly recruitmentStartDate?: string | null
  readonly offerId?: string | null
}): DuplicateCandidate {
  return {
    recordId: input.recordId,
    sourceRow: input.sourceRow,
    cells: input.cells ?? [`需求-${input.recordId}`],
    requirementId: input.requirementId === undefined ? 'REQ-001' : input.requirementId,
    candidateName: input.candidateName === undefined ? '候选人甲' : input.candidateName,
    recruitmentStartDate:
      input.recruitmentStartDate === undefined ? '2026-05-08' : input.recruitmentStartDate,
    offerId: input.offerId ?? null,
  }
}

/** 去重只读 `recordId` 与 `dedupDecision`：用桩对象避免复制整条记录的 30 个字段 */
function recordStub(recordId: string, dedupDecision: DedupDecision): NormalizedRecord {
  return { recordId, dedupDecision } as unknown as NormalizedRecord
}

function noneDecision(): DedupDecision {
  return initialDedupDecision({ duplicateKind: 'none', duplicateGroupKey: null, suspectedKey: null })
}

function duplicateDecision(duplicateGroupKey: string): DedupDecision {
  return initialDedupDecision({ duplicateKind: 'exact', duplicateGroupKey, suspectedKey: null })
}

describe('完全重复（整行原始文本一致）', () => {
  it('一致的非空行归为一组：按源行号排序，建议保留首条、其余建议移除', () => {
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r3', sourceRow: 12, cells: ['REQ-1', '候选人甲', '已入职'] }),
      candidate({ recordId: 'r1', sourceRow: 3, cells: ['REQ-1', '候选人甲', '已入职'] }),
      candidate({ recordId: 'r2', sourceRow: 5, cells: ['REQ-1', '候选人乙', '待入职'] }),
    ])

    expect(analysis.exactGroups).toHaveLength(1)
    const [group] = analysis.exactGroups
    expect(group.kind).toBe('exact')
    expect(group.groupKey).toBe('exact#1')
    expect(group.recordIds).toEqual(['r1', 'r3'])
    expect(group.sourceRows).toEqual([3, 12])
    expect(group.suggestedKeepRecordId).toBe('r1')
    expect(group.suggestedRemoveRecordIds).toEqual(['r3'])
    expect(analysis.exactRowCount).toBe(2)
    expect(analysis.exactGroupKeyByRecordId.get('r3')).toBe('exact#1')
    expect(analysis.suspectedGroups).toEqual([])
  })

  it('完全一致的空行 / 占位符行不算重复（否则空行会被当成重复数据）', () => {
    const blank: readonly RawCellValue[] = [null, '  ', '-']
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r1', sourceRow: 2, cells: blank }),
      candidate({ recordId: 'r2', sourceRow: 3, cells: blank }),
    ])
    expect(analysis.exactGroups).toEqual([])
    expect(analysis.exactRowCount).toBe(0)
    expect(analysis.exactGroupKeyByRecordId.size).toBe(0)
  })

  it('多组重复时分组标识为稳定序号，不把行内容写进标识', () => {
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r1', sourceRow: 2, cells: ['a'] }),
      candidate({ recordId: 'r2', sourceRow: 3, cells: ['a'] }),
      candidate({ recordId: 'r3', sourceRow: 4, cells: ['b'] }),
      candidate({ recordId: 'r4', sourceRow: 5, cells: ['b'] }),
    ])
    expect(analysis.exactGroups.map((group) => group.groupKey)).toEqual(['exact#1', 'exact#2'])
    expect(analysis.exactRowCount).toBe(4)
  })
})

describe('疑似重复（只提示，绝不自动合并）', () => {
  it('需求ID + 姓名 + 启动日期三者完全一致时提示，并记录可读键', () => {
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r1', sourceRow: 3, cells: ['a'] }),
      candidate({ recordId: 'r2', sourceRow: 8, cells: ['b'] }),
    ])

    expect(analysis.suspectedGroups).toHaveLength(1)
    expect(analysis.suspectedGroups[0].groupKey).toBe('suspected#1')
    expect(analysis.suspectedGroups[0].recordIds).toEqual(['r1', 'r2'])
    expect(analysis.suspectedGroups[0].suggestedKeepRecordId).toBe('r1')
    expect(analysis.suspectedRowCount).toBe(2)
    expect(analysis.suspectedKeyByRecordId.get('r1')).toBe(
      analysis.suspectedKeyByRecordId.get('r2'),
    )
    expect(analysis.suspectedGroupKeyByRecordId.get('r2')).toBe('suspected#1')
  })

  it('缺姓名 / 缺需求 ID / 启动日期不一致一律不提示（三者不全一致就不猜）', () => {
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r1', sourceRow: 3, requirementId: null }),
      candidate({ recordId: 'r2', sourceRow: 4, requirementId: null }),
      candidate({ recordId: 'r3', sourceRow: 5, candidateName: null }),
      candidate({ recordId: 'r4', sourceRow: 6, candidateName: null }),
      candidate({ recordId: 'r5', sourceRow: 7, candidateName: '候选人乙' }),
      candidate({ recordId: 'r6', sourceRow: 8, recruitmentStartDate: '2026-05-09' }),
    ])
    expect(analysis.suspectedGroups).toEqual([])
    expect(analysis.suspectedRowCount).toBe(0)
  })

  it('有稳定 offer 唯一 ID 时以 ID 为准：ID 不同即不是同一 offer', () => {
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r1', sourceRow: 3, offerId: 'OFFER-A' }),
      candidate({ recordId: 'r2', sourceRow: 4, offerId: 'OFFER-B' }),
    ])
    expect(analysis.suspectedGroups).toEqual([])
  })

  it('offer 唯一 ID 相同（大小写 / 空白归一后）才提示确认，此时不再看姓名与启动日期', () => {
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r1', sourceRow: 3, cells: ['a'], offerId: 'OFFER-A' }),
      candidate({
        recordId: 'r2',
        sourceRow: 4,
        cells: ['b'],
        offerId: ' offer-a ',
        candidateName: '候选人乙',
        recruitmentStartDate: null,
      }),
    ])
    expect(analysis.suspectedGroups).toHaveLength(1)
    expect(analysis.suspectedRowCount).toBe(2)
    expect(analysis.suspectedKeyByRecordId.get('r2')).toBe('offer|offer-a')
  })

  it('已在完全重复组里的行不再进入疑似重复组（同一个问题不报两次）', () => {
    const cells: readonly RawCellValue[] = ['REQ-1', '候选人甲', '已入职']
    const analysis = analyzeDuplicates([
      candidate({ recordId: 'r1', sourceRow: 2, cells }),
      candidate({ recordId: 'r2', sourceRow: 3, cells }),
    ])
    expect(analysis.exactGroups).toHaveLength(1)
    expect(analysis.suspectedGroups).toEqual([])
    expect(analysis.suspectedRowCount).toBe(0)
  })
})

describe('初始去重决定（清洗阶段写入记录）', () => {
  it('无重复的行直接保留，且不带任何分组键', () => {
    expect(noneDecision()).toEqual({
      duplicateKind: 'none',
      duplicateGroupKey: null,
      suspectedKey: null,
      action: 'kept',
      decidedBy: 'none',
    })
  })

  it('重复行一律「待用户确认」，默认不删任何数据', () => {
    expect(duplicateDecision('exact#1')).toEqual({
      duplicateKind: 'exact',
      duplicateGroupKey: 'exact#1',
      suspectedKey: null,
      action: 'pendingUserConfirmation',
      decidedBy: 'default',
    })
  })
})

describe('去重策略（必须用户确认后才生效）', () => {
  const records: readonly NormalizedRecord[] = [
    recordStub('r1', noneDecision()),
    recordStub('r2', duplicateDecision('exact#1')),
    recordStub('r3', duplicateDecision('exact#1')),
  ]

  it('每组第一条件为建议保留项（按记录顺序，不改动记录内容）', () => {
    expect([...suggestedKeepRecordIds(records)]).toEqual(['r2'])
  })

  it('未确认时重复行保持待确认，样本不减少', () => {
    const next = applyDedupStrategy(records, { strategy: '确认后每组保留首条', confirmed: false })
    expect(next).toHaveLength(3)
    expect(next[1].dedupDecision.action).toBe('pendingUserConfirmation')
    expect(next[1].dedupDecision.decidedBy).toBe('default')
    expect(next.map((record) => record.recordId)).toEqual(['r1', 'r2', 'r3'])
  })

  it('确认后「每组保留首条」：首条保留，其余标记为按重复移除', () => {
    const next = applyDedupStrategy(records, { strategy: '确认后每组保留首条', confirmed: true })
    expect(next.map((record) => record.dedupDecision.action)).toEqual([
      'kept',
      'kept',
      'removedAsDuplicate',
    ])
    expect(next[1].dedupDecision.decidedBy).toBe('user')
    expect(next[2].dedupDecision.decidedBy).toBe('user')
  })

  it('确认后「保留全部」：重复行全部进入分析，只保留质量标记', () => {
    const next = applyDedupStrategy(records, { strategy: '保留全部', confirmed: true })
    expect(next.every((record) => record.dedupDecision.action === 'kept')).toBe(true)
    expect(next.map((record) => record.dedupDecision.decidedBy)).toEqual(['none', 'user', 'user'])
  })

  it('纯函数：不改动入参（保证「改设置即重算」可撤销）', () => {
    applyDedupStrategy(records, { strategy: '确认后每组保留首条', confirmed: true })
    expect(records[2].dedupDecision.action).toBe('pendingUserConfirmation')
    expect(records[2].dedupDecision.decidedBy).toBe('default')
  })
})

