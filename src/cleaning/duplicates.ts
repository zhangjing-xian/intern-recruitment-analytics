/**
 * 重复判定与去重（docs/PRD.md 5.4）。
 *
 * 铁律：
 * - **完全重复**只按原始单元格文本比较（任一单元格不同即不算），与清洗规则无关；
 * - **疑似重复**只作提示：没有稳定 offer 唯一 ID 时才用 `需求ID + 姓名 + 启动日期`，
 *   三者不全一致就**不**提示，绝不自动合并；
 * - 有稳定 offer 唯一 ID 时以 ID 为准：ID 不同即不是同一 offer，ID 相同才提示确认；
 * - 默认建议「每组保留首条」，但**必须用户确认**后才生效；未确认时全部标记 `pendingUserConfirmation`。
 */

import {
  buildExactDuplicateKey,
  buildSuspectedDuplicateKey,
  isNullToken,
  normalizeCellText,
  type DedupDecision,
  type DedupStrategy,
  type DuplicateGroup,
  type DuplicateKind,
  type NormalizedRecord,
  type RawCellValue,
} from '../domain'

/** 去重口径说明（界面与决策日志共用，避免同一口径写两遍） */
export const DEDUP_RULES = {
  exact: '原始单元格完全一致 → 完全重复；默认建议保留首行，其余标记待用户确认',
  suspected: '无稳定 offer 唯一 ID 时，`需求ID + 姓名 + 启动日期` 完全一致才作疑似提示，不自动合并',
  offerId: '有稳定 offer 唯一 ID 时以 ID 为准：ID 不同即不是同一 offer，ID 相同才提示确认',
  keepAll: '保留全部：重复行全部进入分析，只保留质量标记，不减少样本',
} as const

/** 参与重复判定的最小信息 */
export type DuplicateCandidate = {
  readonly recordId: string
  readonly sourceRow: number
  /** 原始单元格（完全重复按原值文本比较） */
  readonly cells: readonly RawCellValue[]
  readonly requirementId: string | null
  readonly candidateName: string | null
  readonly recruitmentStartDate: string | null
  /** 稳定 offer 唯一 ID（扩展列）；没有则为 null */
  readonly offerId: string | null
}

export type DuplicateAnalysis = {
  readonly exactGroups: readonly DuplicateGroup[]
  readonly suspectedGroups: readonly DuplicateGroup[]
  /** 记录 → 它所属的重复分组标识（无重复则不含该键） */
  readonly exactGroupKeyByRecordId: ReadonlyMap<string, string>
  readonly suspectedGroupKeyByRecordId: ReadonlyMap<string, string>
  /** 记录 → 疑似重复的可读键（`需求ID + 姓名 + 启动日期` 或 offer ID） */
  readonly suspectedKeyByRecordId: ReadonlyMap<string, string>
  /** 参与完全重复 / 疑似重复的记录数（含每组首条） */
  readonly exactRowCount: number
  readonly suspectedRowCount: number
}

function bucketize(
  candidates: readonly DuplicateCandidate[],
  buildKey: (candidate: DuplicateCandidate) => string | null,
): Map<string, DuplicateCandidate[]> {
  const buckets = new Map<string, DuplicateCandidate[]>()
  for (const candidate of candidates) {
    const key = buildKey(candidate)
    if (key === null) {
      continue
    }
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, [candidate])
    } else {
      bucket.push(candidate)
    }
  }
  return buckets
}

function isBlankRow(cells: readonly RawCellValue[]): boolean {
  return cells.every((cell) => {
    const text = normalizeCellText(cell)
    return text === '' || isNullToken(text)
  })
}

type GroupedCandidates = {
  readonly groups: readonly DuplicateGroup[]
  readonly keyByRecordId: ReadonlyMap<string, string>
  /** 记录 → 桶键（可读键：offer ID，或 需求ID+姓名+启动日期） */
  readonly bucketKeyByRecordId: ReadonlyMap<string, string>
}

function toGroups(
  buckets: Map<string, DuplicateCandidate[]>,
  kind: Exclude<DuplicateKind, 'none'>,
): GroupedCandidates {
  const groups: DuplicateGroup[] = []
  const keyByRecordId = new Map<string, string>()
  const bucketKeyByRecordId = new Map<string, string>()
  let ordinal = 0
  for (const [bucketKey, members] of buckets) {
    if (members.length < 2) {
      continue
    }
    ordinal += 1
    const ordered = [...members].sort((left, right) => left.sourceRow - right.sourceRow)
    const groupKey = `${kind}#${ordinal}`
    const [keep, ...rest] = ordered
    groups.push({
      kind,
      groupKey,
      recordIds: ordered.map((member) => member.recordId),
      sourceRows: ordered.map((member) => member.sourceRow),
      suggestedKeepRecordId: keep.recordId,
      suggestedRemoveRecordIds: rest.map((member) => member.recordId),
    })
    for (const member of ordered) {
      keyByRecordId.set(member.recordId, groupKey)
      bucketKeyByRecordId.set(member.recordId, bucketKey)
    }
  }
  return { groups, keyByRecordId, bucketKeyByRecordId }
}

/** 疑似键：有稳定 offer 唯一 ID 时优先用它，否则用「需求ID + 姓名 + 启动日期」（缺 ID 或缺姓名不提示） */
function suspectedKeyOf(candidate: DuplicateCandidate): string | null {
  if (candidate.offerId !== null && candidate.offerId !== '') {
    return `offer|${normalizeCellText(candidate.offerId).toLowerCase()}`
  }
  if (candidate.requirementId === null || candidate.candidateName === null) {
    return null
  }
  return buildSuspectedDuplicateKey({
    requirementId: candidate.requirementId,
    candidateName: candidate.candidateName,
    recruitmentStartDate: candidate.recruitmentStartDate,
  })
}

/**
 * 分析重复。已在完全重复组里的行不再进入疑似重复组（避免同一个问题报两次）。
 * 分组标识用稳定序号（`exact#1` / `suspected#1`），**不**把行内容复制进标识。
 */
export function analyzeDuplicates(candidates: readonly DuplicateCandidate[]): DuplicateAnalysis {
  const exact = toGroups(
    bucketize(candidates, (candidate) =>
      isBlankRow(candidate.cells) ? null : buildExactDuplicateKey(candidate.cells),
    ),
    'exact',
  )
  const suspected = toGroups(
    bucketize(
      candidates.filter((candidate) => !exact.keyByRecordId.has(candidate.recordId)),
      suspectedKeyOf,
    ),
    'suspected',
  )
  return {
    exactGroups: exact.groups,
    suspectedGroups: suspected.groups,
    exactGroupKeyByRecordId: exact.keyByRecordId,
    suspectedGroupKeyByRecordId: suspected.keyByRecordId,
    suspectedKeyByRecordId: suspected.bucketKeyByRecordId,
    exactRowCount: exact.groups.reduce((total, group) => total + group.recordIds.length, 0),
    suspectedRowCount: suspected.groups.reduce((total, group) => total + group.recordIds.length, 0),
  }
}

/** 清洗阶段写入记录的初始去重决定：重复行一律「待用户确认」，无重复行直接保留 */
export function initialDedupDecision(input: {
  readonly duplicateKind: DuplicateKind
  readonly duplicateGroupKey: string | null
  readonly suspectedKey: string | null
}): DedupDecision {
  if (input.duplicateKind === 'none') {
    return {
      duplicateKind: 'none',
      duplicateGroupKey: null,
      suspectedKey: null,
      action: 'kept',
      decidedBy: 'none',
    }
  }
  return {
    duplicateKind: input.duplicateKind,
    duplicateGroupKey: input.duplicateGroupKey,
    suspectedKey: input.suspectedKey,
    action: 'pendingUserConfirmation',
    decidedBy: 'default',
  }
}

/** 每组按记录顺序的第一条（建议保留项）；分组标识由清洗阶段生成，此处只认键 */
export function suggestedKeepRecordIds(
  records: readonly NormalizedRecord[],
): ReadonlySet<string> {
  const seen = new Set<string>()
  const keep = new Set<string>()
  for (const record of records) {
    const groupKey = record.dedupDecision.duplicateGroupKey
    if (groupKey === null || seen.has(groupKey)) {
      continue
    }
    seen.add(groupKey)
    keep.add(record.recordId)
  }
  return keep
}

/**
 * 应用去重策略（纯函数，不改动原数组）。
 * - 未确认（`confirmed: false`）：重复行保持 `pendingUserConfirmation`，**不**减少样本；
 * - 已确认 + `保留全部`：全部保留；
 * - 已确认 + `确认后每组保留首条`：每组首条保留，其余标记 `removedAsDuplicate`。
 */
export function applyDedupStrategy(
  records: readonly NormalizedRecord[],
  options: { readonly strategy: DedupStrategy; readonly confirmed: boolean },
): readonly NormalizedRecord[] {
  const keepIds = suggestedKeepRecordIds(records)
  return records.map((record) => {
    const decision = dedupActionFor(record, keepIds, options)
    return decision === record.dedupDecision ? record : { ...record, dedupDecision: decision }
  })
}

function dedupActionFor(
  record: NormalizedRecord,
  keepIds: ReadonlySet<string>,
  options: { readonly strategy: DedupStrategy; readonly confirmed: boolean },
): DedupDecision {
  const base = record.dedupDecision
  if (base.duplicateKind === 'none') {
    return base.action === 'kept' && base.decidedBy === 'none'
      ? base
      : { ...base, action: 'kept', decidedBy: 'none' }
  }
  if (!options.confirmed) {
    return base.action === 'pendingUserConfirmation' && base.decidedBy === 'default'
      ? base
      : { ...base, action: 'pendingUserConfirmation', decidedBy: 'default' }
  }
  if (options.strategy === '保留全部') {
    return { ...base, action: 'kept', decidedBy: 'user' }
  }
  return {
    ...base,
    action: keepIds.has(record.recordId) ? 'kept' : 'removedAsDuplicate',
    decidedBy: 'user',
  }
}

