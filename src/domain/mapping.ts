/**
 * 字段映射（步骤4）：源表头 → 标准字段 / 扩展字段 / 忽略。
 *
 * 口径来源：
 * - docs/PRD.md 4.3：优先级为「标准精确匹配 → 去 BOM / 首尾空格 / 全半角差异 → 用户已确认的别名模板 → 模糊建议」，
 *   模糊建议**永不自动提交**；冲突必须选择或显式合并；多余列默认忽略；模板**不存示例候选人数据**；
 * - docs/PRD.md 4.1：文件级最低条件 = 必须识别 offer 状态列，缺其他列要逐项告知并确认「部分分析导入」；
 * - docs/PRD.md 12.3 A03：精确匹配自动建议，模糊与冲突需确认。
 *
 * 边界：
 * - 纯函数：不依赖 React / 存储 / 网络；只读 `RawSheet` 的表头与单元格，**不做**任何类型转换（那是步骤5）；
 * - 自动识别只是**建议**：别名 / 模糊命中必须由用户确认，用户随时可以改写或忽略任何一列；
 * - 学历 / 学位、招聘 HR / 推荐人、入职时间 / offer 接受时间不互相自动映射（`FORBIDDEN_HEADER_MAPPINGS`）；
 * - 映射模板只保存「表头 + 目标字段 + 版本」，绝不保存任何单元格取值。
 */

import {
  EXTENSION_FIELDS,
  EXTENSION_FIELD_KEYS,
  FORBIDDEN_HEADER_MAPPINGS,
  REQUIRED_STANDARD_FIELDS,
  STANDARD_FIELDS,
  STANDARD_FIELD_KEYS,
  matchStandardHeader,
  normalizeHeader,
  type ColumnMatchLevel,
  type ExtensionFieldKey,
  type StandardFieldKey,
} from './fields'
import {
  ANALYSIS_MODULES,
  createQualityIssue,
  type AnalysisModule,
  type DataQualityIssue,
} from './quality'
import type { ImportMapping, ImportMappingEntry, MappingMergeRule, RawSheet } from './types'
import { TEMPLATE_VERSION } from './version'

/** 匹配级别的中文标签（映射页与后续质量报告共用一份文案，避免两处各写一遍） */
export const MATCH_LEVEL_LABELS: Readonly<Record<ColumnMatchLevel, string>> = {
  exact: '精确匹配',
  normalized: '规范化匹配',
  alias: '别名建议',
  template: '模板命中',
  fuzzy: '模糊建议',
  manual: '人工指定',
  ignored: '忽略',
}

/** 别名命中时的建议置信度：来自 PRD 4.3 的常用别名表，但仍是建议 */
export const ALIAS_CONFIDENCE = 0.9

/** 模糊建议的最低相似度：低于它视为「没有建议」，避免噪音 */
export const FUZZY_MIN_SCORE = 0.6

/* ------------------------------------------------------------------ 相似度与建议 */

/** 二元字符组（中文按字、英文按字母，能同时覆盖「启动招聘日期 / 启动招聘时间」这类差异） */
function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>()
  for (let index = 0; index < value.length - 1; index += 1) {
    const gram = value.slice(index, index + 2)
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

function diceScore(left: string, right: string): number {
  const leftCounts = bigramCounts(left)
  const rightCounts = bigramCounts(right)
  let intersection = 0
  let leftTotal = 0
  let rightTotal = 0
  for (const count of leftCounts.values()) {
    leftTotal += count
  }
  for (const count of rightCounts.values()) {
    rightTotal += count
  }
  if (leftTotal === 0 || rightTotal === 0) {
    return 0
  }
  for (const [gram, count] of leftCounts) {
    intersection += Math.min(count, rightCounts.get(gram) ?? 0)
  }
  return (2 * intersection) / (leftTotal + rightTotal)
}

/**
 * 两个**已规范化**表头的相似度（0–1）。
 * - 完全相同 → 1；
 * - 一个包含另一个（短串 ≥2 字）→ 0.6 ~ 1.0，按长度比例收敛；
 * - 其余用二元字符组 Dice 系数；
 * - 单字表头不做包含判断（噪音太大），但仍可能被 Dice 命中。
 */
export function headerSimilarity(source: string, candidate: string): number {
  if (source === '' || candidate === '') {
    return 0
  }
  if (source === candidate) {
    return 1
  }
  const shorter = source.length <= candidate.length ? source : candidate
  const longer = source.length <= candidate.length ? candidate : source
  if (shorter.length >= 2 && longer.includes(shorter)) {
    return 0.6 + 0.4 * (shorter.length / longer.length)
  }
  if (shorter.length < 2) {
    return 0
  }
  return diceScore(source, candidate)
}

type FuzzyCandidate = {
  readonly header: string
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
}

/**
 * 模糊建议的候选池：标准表头 + 内置别名 + 扩展列表头。
 * 扩展列只在这里「被建议」，最终仍必须由用户在映射页确认（未映射的扩展列不产生任何问题）。
 */
const FUZZY_CANDIDATES: readonly FuzzyCandidate[] = [
  ...STANDARD_FIELDS.map(
    (field): FuzzyCandidate => ({
      header: field.header,
      targetField: field.key,
      targetExtension: null,
    }),
  ),
  ...STANDARD_FIELDS.flatMap((field) =>
    field.aliases.map(
      (alias): FuzzyCandidate => ({
        header: alias,
        targetField: field.key,
        targetExtension: null,
      }),
    ),
  ),
  ...EXTENSION_FIELDS.map(
    (field): FuzzyCandidate => ({
      header: field.header,
      targetField: null,
      targetExtension: field.key,
    }),
  ),
]

function isForbiddenPair(normalizedSource: string, targetField: StandardFieldKey): boolean {
  return FORBIDDEN_HEADER_MAPPINGS.some(
    (entry) => normalizeHeader(entry.header) === normalizedSource && entry.targetField === targetField,
  )
}

/** 取相似度最高的候选；同分时按候选登记顺序（标准字段 → 别名 → 扩展列），保证结果稳定可测 */
function bestFuzzyCandidate(
  normalized: string,
): { readonly candidate: FuzzyCandidate; readonly score: number } | null {
  let best: { candidate: FuzzyCandidate; score: number } | null = null
  for (const candidate of FUZZY_CANDIDATES) {
    const candidateField = candidate.targetField
    if (candidateField !== null && isForbiddenPair(normalized, candidateField)) {
      continue
    }
    const score = headerSimilarity(normalized, normalizeHeader(candidate.header))
    if (score < FUZZY_MIN_SCORE) {
      continue
    }
    if (best === null || score > best.score) {
      best = { candidate, score: Math.round(score * 100) / 100 }
    }
  }
  return best
}

/** 扩展列内部键 → 中文表头（界面与模板摘要展示用） */
export function extensionHeader(key: ExtensionFieldKey): string {
  const field = EXTENSION_FIELDS.find((item) => item.key === key)
  return field?.header ?? key
}

export type HeaderTargetSuggestion = {
  /** 建议的标准字段；与 `targetExtension` 互斥，两个都为 null 表示建议忽略该列 */
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
  readonly matchLevel: ColumnMatchLevel
  /** 0–1；精确 / 规范化 / 人工指定为 1，别名为 0.9，模糊为相似度 */
  readonly confidence: number
  /** true 表示必须由用户逐列确认后才生效（别名 / 模糊 / 禁止组合） */
  readonly requiresConfirmation: boolean
  /** 明确禁止自动映射的原因；非 null 时该列必须人工处理 */
  readonly blockedReason: string | null
  /** 命中的标准 / 别名 / 扩展表头，便于在界面显示「建议来源」 */
  readonly matchedHeader: string | null
}

function ignoreSuggestion(blockedReason: string | null, requiresConfirmation = false): HeaderTargetSuggestion {
  return {
    targetField: null,
    targetExtension: null,
    matchLevel: 'ignored',
    confidence: 0,
    requiresConfirmation,
    blockedReason,
    matchedHeader: null,
  }
}

/**
 * 单个源表头的四级匹配建议（docs/PRD.md 4.3）：
 * 1. `exact`：表头原文与标准 / 扩展表头一字不差 → 自动建议；
 * 2. `normalized`：去 BOM / 零宽字符 / 首尾空格 / 全半角 / 大小写差异后一致 → 自动建议；
 * 3. `alias`：命中 PRD 4.3 常用别名表 → 建议，**必须确认**；
 * 4. `fuzzy`：相似度 ≥ `FUZZY_MIN_SCORE` → 建议，**必须确认**，永不自动提交。
 *
 * 禁止组合（学历 / 学位、招聘 HR / 推荐人、入职时间 / offer 接受时间）不参与模糊候选，
 * 只能由用户在映射页手动指定，并显示 `blockedReason`。
 */
export function suggestHeaderTarget(header: string): HeaderTargetSuggestion {
  const normalized = normalizeHeader(header)
  if (normalized === '') {
    return ignoreSuggestion('源表头为空：无法判断含义，默认忽略。')
  }

  const exactStandard = STANDARD_FIELDS.find((field) => field.header === header)
  if (exactStandard !== undefined) {
    return {
      targetField: exactStandard.key,
      targetExtension: null,
      matchLevel: 'exact',
      confidence: 1,
      requiresConfirmation: false,
      blockedReason: null,
      matchedHeader: exactStandard.header,
    }
  }
  const exactExtension = EXTENSION_FIELDS.find((field) => field.header === header)
  if (exactExtension !== undefined) {
    return {
      targetField: null,
      targetExtension: exactExtension.key,
      matchLevel: 'exact',
      confidence: 1,
      requiresConfirmation: false,
      blockedReason: null,
      matchedHeader: exactExtension.header,
    }
  }

  const standardized = matchStandardHeader(header)
  if (standardized.field !== null && standardized.matchLevel === 'exact') {
    return {
      targetField: standardized.field,
      targetExtension: null,
      matchLevel: 'normalized',
      confidence: 1,
      requiresConfirmation: standardized.requiresConfirmation,
      blockedReason: standardized.blockedReason,
      matchedHeader: standardized.matchedHeader,
    }
  }
  const normalizedExtension = EXTENSION_FIELDS.find(
    (field) => normalizeHeader(field.header) === normalized,
  )
  if (normalizedExtension !== undefined) {
    return {
      targetField: null,
      targetExtension: normalizedExtension.key,
      matchLevel: 'normalized',
      confidence: 1,
      requiresConfirmation: false,
      blockedReason: null,
      matchedHeader: normalizedExtension.header,
    }
  }

  if (standardized.field !== null && standardized.matchLevel === 'alias') {
    return {
      targetField: standardized.field,
      targetExtension: null,
      matchLevel: 'alias',
      confidence: ALIAS_CONFIDENCE,
      requiresConfirmation: true,
      blockedReason: standardized.blockedReason,
      matchedHeader: standardized.matchedHeader,
    }
  }

  const fuzzy = bestFuzzyCandidate(normalized)
  if (fuzzy !== null) {
    return {
      targetField: fuzzy.candidate.targetField,
      targetExtension: fuzzy.candidate.targetExtension,
      matchLevel: 'fuzzy',
      confidence: fuzzy.score,
      requiresConfirmation: true,
      blockedReason: null,
      matchedHeader: fuzzy.candidate.header,
    }
  }

  return ignoreSuggestion(standardized.blockedReason, standardized.requiresConfirmation)
}

/* ------------------------------------------------------------------ 冲突与映射计划 */

/** 目标标识：标准字段与扩展列互斥，两个都为 null 表示忽略该列 */
export function targetKeyOf(entry: {
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
}): string | null {
  if (entry.targetField !== null) {
    return `field:${entry.targetField}`
  }
  if (entry.targetExtension !== null) {
    return `extension:${entry.targetExtension}`
  }
  return null
}

/** 冲突组标识：同一目标字段的多个源列属于同一组（映射模板也用它登记合并规则） */
export function conflictGroupIdFor(
  targetField: StandardFieldKey | null,
  targetExtension: ExtensionFieldKey | null,
): string | null {
  if (targetField !== null) {
    return `conflict:field:${targetField}`
  }
  if (targetExtension !== null) {
    return `conflict:extension:${targetExtension}`
  }
  return null
}

/** 目标字段 / 扩展列的中文标签（标准字段取表头，扩展列取表头，找不到时退回内部键） */
export function targetLabel(
  targetField: StandardFieldKey | null,
  targetExtension: ExtensionFieldKey | null,
): string {
  if (targetField !== null) {
    return STANDARD_FIELDS.find((field) => field.key === targetField)?.header ?? targetField
  }
  if (targetExtension !== null) {
    return extensionHeader(targetExtension)
  }
  return '忽略'
}

export type MappingConflict = {
  /** 与 `conflictGroupIdFor` 一致，作为用户解决选择与模板的键 */
  readonly groupId: string
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
  readonly label: string
  /** 参与竞争的源列下标（升序） */
  readonly columnIndexes: readonly number[]
  readonly sourceHeaders: readonly string[]
  /** 面向用户的说明（含「必须选择或显式合并」的处置要求） */
  readonly reason: string
}

function groupEntriesByTarget(
  entries: readonly ImportMappingEntry[],
): readonly { readonly groupId: string; readonly group: readonly ImportMappingEntry[] }[] {
  const groups = new Map<string, ImportMappingEntry[]>()
  for (const entry of entries) {
    const groupId = conflictGroupIdFor(entry.targetField, entry.targetExtension)
    if (groupId === null) {
      continue
    }
    const bucket = groups.get(groupId)
    if (bucket === undefined) {
      groups.set(groupId, [entry])
    } else {
      bucket.push(entry)
    }
  }
  return [...groups.entries()].map(([groupId, group]) => ({
    groupId,
    group: [...group].sort((left, right) => left.columnIndex - right.columnIndex),
  }))
}

/**
 * 尚未解决的冲突（docs/PRD.md 4.3 / 5.5「目标列冲突」属阻断级）：
 * 同一目标字段被多个源列指向，且用户没有登记该目标的显式合并规则。
 */
export function conflictsFor(
  entries: readonly ImportMappingEntry[],
  merges: readonly MappingMergeRule[] = [],
): readonly MappingConflict[] {
  const mergedTargets = new Set(
    merges.map((merge) => conflictGroupIdFor(merge.targetField, merge.targetExtension)).filter(
      (groupId): groupId is string => groupId !== null,
    ),
  )
  const conflicts: MappingConflict[] = []
  for (const { groupId, group } of groupEntriesByTarget(entries)) {
    if (group.length < 2 || mergedTargets.has(groupId)) {
      continue
    }
    const first = group[0]
    const label = targetLabel(first.targetField, first.targetExtension)
    conflicts.push({
      groupId,
      targetField: first.targetField,
      targetExtension: first.targetExtension,
      label,
      columnIndexes: group.map((entry) => entry.columnIndex),
      sourceHeaders: group.map((entry) => (entry.sourceHeader === '' ? '（空表头）' : entry.sourceHeader)),
      reason: `「${label}」被 ${group.length} 个源列同时指向（第 ${group
        .map((entry) => entry.columnIndex + 1)
        .join('、')} 列）：必须选择其中一列，或显式登记合并规则；系统不会静默覆盖。`,
    })
  }
  return conflicts
}

export type MappingPlan = {
  readonly entries: readonly ImportMappingEntry[]
  readonly sourceHeaderSignature: string
  readonly columnCount: number
  /** 自动结论的列数（精确 + 规范化），用于显示「系统已自动识别」 */
  readonly autoMatchedCount: number
}

/** 源表头签名：规范化表头排序后拼接，用于复用映射模板，**不含**任何单元格数据 */
export function headerSignature(headers: readonly string[]): string {
  return headers
    .map((header) => normalizeHeader(header))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .join('\u0001')
}

/**
 * 根据表头生成初始映射计划：
 * - 每列一条 `ImportMappingEntry`，`matchLevel` / `confidence` / `requiresConfirmation` 来自四级匹配；
 * - 同一目标字段被多列指向时**不自动取舍**，而是登记相同的 `conflictGroupId` 交给用户解决；
 * - 多余列默认 `ignored`，绝不静默导出或参与分析。
 */
export function suggestMapping(headers: readonly string[]): MappingPlan {
  const base: ImportMappingEntry[] = headers.map((header, columnIndex) => {
    const suggestion = suggestHeaderTarget(header)
    return {
      columnIndex,
      sourceHeader: header,
      targetField: suggestion.targetField,
      targetExtension: suggestion.targetExtension,
      matchLevel: suggestion.matchLevel,
      confidence: suggestion.confidence,
      requiresConfirmation: suggestion.requiresConfirmation,
      conflictGroupId: null,
    }
  })

  const duplicatedTargets = new Set<string>()
  const seen = new Set<string>()
  for (const entry of base) {
    const key = targetKeyOf(entry)
    if (key === null) {
      continue
    }
    if (seen.has(key)) {
      duplicatedTargets.add(key)
    }
    seen.add(key)
  }

  const entries = base.map((entry): ImportMappingEntry => {
    const key = targetKeyOf(entry)
    if (key === null || !duplicatedTargets.has(key)) {
      return entry
    }
    return {
      ...entry,
      conflictGroupId: conflictGroupIdFor(entry.targetField, entry.targetExtension),
      requiresConfirmation: true,
    }
  })

  return {
    entries,
    sourceHeaderSignature: headerSignature(headers),
    columnCount: headers.length,
    autoMatchedCount: entries.filter(
      (entry) =>
        targetKeyOf(entry) !== null &&
        (entry.matchLevel === 'exact' || entry.matchLevel === 'normalized'),
    ).length,
  }
}

/* ------------------------------------------------------------------ 缺列 → 禁用模块 */

/**
 * 缺少某个标准列时**不可用**的分析模块（docs/PRD.md 4.1「缺少其他标准列要逐项告知并确认
 * 「部分分析导入」，说明禁用的模块」）。
 *
 * 只登记「明确依赖该列」的模块；未登记的字段缺失时不禁用任何模块（例如姓名缺失只影响展示）。
 * 缺 offer 状态列是**阻断**（不进入分析链路），这里仍登记为「全部模块」以便统一显示。
 */
export const FIELD_DISABLED_MODULES: Readonly<
  Partial<Record<StandardFieldKey, readonly AnalysisModule[]>>
> = {
  requirementId: ['需求分析'],
  recruiter: ['HR效能'],
  city: ['城市对比'],
  position: ['薪资对比'],
  jobFamily: ['薪资对比'],
  requirementType: ['需求分析'],
  recruitmentStartDate: ['招聘周期'],
  joiningDate: ['招聘周期'],
  graduationYear: ['画像分析'],
  education: ['画像分析'],
  school: ['画像分析'],
  isGptSchool: ['画像分析'],
  referrer: ['渠道对比'],
  channel: ['渠道对比'],
  salaryAmount: ['薪资对比'],
  housingRaw: ['房补对比'],
  offerStatus: ANALYSIS_MODULES,
  rejectionReason: ['拒offer原因'],
}

/** 合并缺失列导致的禁用模块；按 `ANALYSIS_MODULES` 的固定顺序返回，便于界面与报告稳定展示 */
export function disabledModulesForMissingFields(
  missingFields: readonly StandardFieldKey[],
): readonly AnalysisModule[] {
  const disabled = new Set<AnalysisModule>()
  for (const field of missingFields) {
    for (const module of FIELD_DISABLED_MODULES[field] ?? []) {
      disabled.add(module)
    }
  }
  return ANALYSIS_MODULES.filter((module) => disabled.has(module))
}

/* ------------------------------------------------------------------ 用户决策与映射状态 */

/** 用户选择的目标（标准字段 / 扩展列 / 都为空表示忽略该列） */
export type MappingTargetChoice = {
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
}

/** 冲突处置：保留唯一列，或登记显式合并规则（不静默覆盖） */
export type ConflictResolution =
  | { readonly kind: 'keep'; readonly columnIndex: number }
  | { readonly kind: 'merge'; readonly strategy: 'first-non-empty' }

/**
 * 映射页的全部用户决策（界面状态只有这一份，其余都由纯函数推导出来）：
 * - `overrides`：按列改写目标（`null` = 明确忽略该列）；
 * - `confirmedColumns`：逐列确认了别名 / 模糊建议；
 * - `conflictResolutions`：按冲突组给出的处置；
 * - `acknowledgedPartialImport`：确认「部分分析导入」（缺列时必填）；
 * - `appliedTemplateName`：应用的映射模板名（仅用于展示 `template` 级别的来源）。
 */
export type MappingDecisions = {
  readonly overrides: Readonly<Record<number, MappingTargetChoice | null>>
  /** 命中映射模板后按表头套用的目标（`template` 级别，与人工改写分开以便回溯） */
  readonly templateOverrides: Readonly<Record<number, MappingTargetChoice | null>>
  readonly confirmedColumns: readonly number[]
  readonly conflictResolutions: Readonly<Record<string, ConflictResolution>>
  readonly acknowledgedPartialImport: boolean
  readonly appliedTemplateName: string | null
}

export const EMPTY_MAPPING_DECISIONS: MappingDecisions = {
  overrides: {},
  templateOverrides: {},
  confirmedColumns: [],
  conflictResolutions: {},
  acknowledgedPartialImport: false,
  appliedTemplateName: null,
}

export type MappingCounts = {
  readonly columnCount: number
  readonly mappedStandardCount: number
  readonly mappedExtensionCount: number
  readonly ignoredCount: number
  /** 系统自动结论的列数（精确 + 规范化） */
  readonly autoMatchedCount: number
  /** 仍需用户逐列确认的建议数（别名 / 模糊 / 冲突） */
  readonly pendingConfirmationCount: number
  readonly conflictCount: number
}

export type MappingState = {
  readonly entries: readonly ImportMappingEntry[]
  readonly merges: readonly MappingMergeRule[]
  /** 仍未解决的冲突（阻断） */
  readonly conflicts: readonly MappingConflict[]
  /** 按标准字段顺序排列的缺失列 */
  readonly missingStandardFields: readonly StandardFieldKey[]
  /** 缺失的必需列（当前只有 offer 状态列）；非空即阻断 */
  readonly missingRequiredFields: readonly StandardFieldKey[]
  readonly disabledModules: readonly AnalysisModule[]
  readonly ignoredColumns: readonly string[]
  readonly counts: MappingCounts
  readonly issues: readonly DataQualityIssue[]
  /** 是否存在阻断级问题（缺必需列 / 未解决冲突） */
  readonly blocking: boolean
  /** 缺列但尚未确认「部分分析导入」 */
  readonly needsPartialImportAcknowledgement: boolean
  /** 是否允许提交确认（无阻断，且待确认建议与缺列确认都已处理） */
  readonly canConfirm: boolean
  /** 逐条说明「为什么还不能确认」（阻断 → 待确认 → 缺列确认） */
  readonly reasons: readonly string[]
  readonly sourceHeaderSignature: string
}

function applyResolutions(
  base: readonly ImportMappingEntry[],
  decisions: MappingDecisions,
): { readonly entries: readonly ImportMappingEntry[]; readonly merges: readonly MappingMergeRule[] } {
  const groups = groupEntriesByTarget(base)
  const mergeColumns = new Map<string, readonly number[]>()
  const keepColumn = new Map<string, number>()

  for (const { groupId, group } of groups) {
    if (group.length < 2) {
      continue
    }
    const resolution = decisions.conflictResolutions[groupId]
    if (resolution === undefined) {
      continue
    }
    if (resolution.kind === 'merge') {
      mergeColumns.set(
        groupId,
        group.map((entry) => entry.columnIndex),
      )
      continue
    }
    // 选择已失效（该列不再指向此目标）时不做静默兜底：冲突会重新出现在冲突面板
    if (group.some((entry) => entry.columnIndex === resolution.columnIndex)) {
      keepColumn.set(groupId, resolution.columnIndex)
    }
  }

  const entries = base.map((entry): ImportMappingEntry => {
    const groupId = conflictGroupIdFor(entry.targetField, entry.targetExtension)
    if (groupId === null) {
      return entry
    }
    if (mergeColumns.has(groupId)) {
      return { ...entry, matchLevel: 'manual', confidence: 1, requiresConfirmation: false }
    }
    const keep = keepColumn.get(groupId)
    if (keep === undefined) {
      return entry
    }
    if (keep === entry.columnIndex) {
      return { ...entry, matchLevel: 'manual', confidence: 1, requiresConfirmation: false }
    }
    return {
      ...entry,
      targetField: null,
      targetExtension: null,
      matchLevel: 'ignored',
      confidence: 0,
      requiresConfirmation: false,
    }
  })

  const merges: MappingMergeRule[] = []
  for (const [groupId, columnIndexes] of mergeColumns) {
    const first = groups.find((candidate) => candidate.groupId === groupId)?.group[0]
    if (first === undefined) {
      continue
    }
    merges.push({
      targetField: first.targetField,
      targetExtension: first.targetExtension,
      strategy: 'first-non-empty',
      columnIndexes,
    })
  }

  return { entries, merges }
}

/**
 * 把「初始建议 + 用户决策」推导为最终映射状态（纯函数）：
 * 1. 覆盖：用户改写的列一律记为 `manual`，明确忽略的列为 `ignored`；
 * 2. 确认：被逐列确认的建议不再计入「待确认」；
 * 3. 冲突：按用户选择保留唯一列或登记合并规则，**未处置的冲突保持阻断**；
 * 4. 缺列：算出缺失标准列、必需列、被禁用模块与确认门槛。
 */
export function applyMappingDecisions(plan: MappingPlan, decisions: MappingDecisions): MappingState {
  const confirmed = new Set(decisions.confirmedColumns)
  const base = plan.entries.map((entry): ImportMappingEntry => {
    if (Object.hasOwn(decisions.overrides, entry.columnIndex)) {
      const choice = decisions.overrides[entry.columnIndex] ?? null
      return {
        ...entry,
        targetField: choice?.targetField ?? null,
        targetExtension: choice?.targetExtension ?? null,
        matchLevel: choice === null ? 'ignored' : 'manual',
        confidence: choice === null ? 0 : 1,
        requiresConfirmation: false,
        conflictGroupId: null,
      }
    }
    if (Object.hasOwn(decisions.templateOverrides, entry.columnIndex)) {
      const choice = decisions.templateOverrides[entry.columnIndex] ?? null
      return {
        ...entry,
        targetField: choice?.targetField ?? null,
        targetExtension: choice?.targetExtension ?? null,
        matchLevel: choice === null ? 'ignored' : 'template',
        confidence: choice === null ? 0 : 1,
        requiresConfirmation: false,
        conflictGroupId: null,
      }
    }
    return confirmed.has(entry.columnIndex) ? { ...entry, requiresConfirmation: false } : entry
  })

  const { entries, merges } = applyResolutions(base, decisions)
  const conflicts = conflictsFor(entries, merges)

  const mappedStandard = new Set<StandardFieldKey>()
  for (const entry of entries) {
    if (entry.targetField !== null) {
      mappedStandard.add(entry.targetField)
    }
  }
  const missingStandardFields = STANDARD_FIELDS.filter(
    (field) => !mappedStandard.has(field.key),
  ).map((field) => field.key)
  const missingRequiredFields = REQUIRED_STANDARD_FIELDS.filter((key) =>
    missingStandardFields.includes(key),
  )
  const disabledModules = disabledModulesForMissingFields(missingStandardFields)
  const ignoredColumns = entries
    .filter((entry) => targetKeyOf(entry) === null)
    .map((entry) => entry.sourceHeader)

  const pendingConfirmationCount = entries.filter((entry) => entry.requiresConfirmation).length
  const mappedExtensionCount = entries.filter((entry) => entry.targetExtension !== null).length
  const mappedStandardCount = entries.filter((entry) => entry.targetField !== null).length
  const blocking = missingRequiredFields.length > 0 || conflicts.length > 0
  const needsPartialImportAcknowledgement =
    missingStandardFields.length > 0 && !decisions.acknowledgedPartialImport

  const reasons: string[] = []
  for (const field of missingRequiredFields) {
    reasons.push(`阻断：缺少必需列「${fieldLabel(field)}」——文件级最低条件要求必须识别该列。`)
  }
  if (conflicts.length > 0) {
    reasons.push(`阻断：${conflicts.length} 组目标列冲突未解决（同一目标被多个源列指向）。`)
  }
  if (pendingConfirmationCount > 0) {
    reasons.push(`还有 ${pendingConfirmationCount} 列是别名 / 模糊建议：需要逐列确认或改写。`)
  }
  if (needsPartialImportAcknowledgement) {
    reasons.push(
      `缺少 ${missingStandardFields.length} 个标准列：确认「部分分析导入」后才能提交${
        disabledModules.length === 0 ? '' : `（将禁用：${disabledModules.join('、')}）`
      }。`,
    )
  }

  const issues: DataQualityIssue[] = []
  for (const conflict of conflicts) {
    issues.push(
      createQualityIssue({ code: 'FIELD_CONFLICT', message: conflict.reason, field: conflict.label }),
    )
  }
  for (const field of missingRequiredFields) {
    issues.push(
      createQualityIssue({
        code: 'MISSING_OFFER_STATUS_COLUMN',
        message: `缺少必需列「${fieldLabel(field)}」：无法计算核心率（D 分母）与状态结构。`,
        field: fieldLabel(field),
      }),
    )
  }

  return {
    entries,
    merges,
    conflicts,
    missingStandardFields,
    missingRequiredFields,
    disabledModules,
    ignoredColumns,
    counts: {
      columnCount: entries.length,
      mappedStandardCount,
      mappedExtensionCount,
      ignoredCount: entries.length - mappedStandardCount - mappedExtensionCount,
      autoMatchedCount: entries.filter(
        (entry) =>
          targetKeyOf(entry) !== null &&
          (entry.matchLevel === 'exact' || entry.matchLevel === 'normalized'),
      ).length,
      pendingConfirmationCount,
      conflictCount: conflicts.length,
    },
    issues,
    blocking,
    needsPartialImportAcknowledgement,
    canConfirm: !blocking && !needsPartialImportAcknowledgement && pendingConfirmationCount === 0,
    reasons,
    sourceHeaderSignature: plan.sourceHeaderSignature,
  }
}

/** 标准字段的中文表头（找不到时退回内部键，绝不沉默返回空串） */
export function fieldLabel(key: StandardFieldKey): string {
  return STANDARD_FIELDS.find((field) => field.key === key)?.header ?? key
}

/**
 * 生成可提交的 `ImportMapping`（步骤5 的输入）。
 * 只做「把已有状态写成契约」这件事，不在这里做任何静默取舍：
 * 调用方必须先用 `canConfirm` 判断，并传入用户确认时间。
 */
export function buildImportMapping(input: {
  readonly state: MappingState
  readonly templateName: string | null
  readonly confirmedAt: string
}): ImportMapping {
  const { state } = input
  return {
    templateVersion: TEMPLATE_VERSION,
    templateName: input.templateName,
    sourceHeaderSignature: state.sourceHeaderSignature,
    entries: state.entries,
    merges: state.merges,
    missingRequiredFields: state.missingRequiredFields,
    ignoredColumns: state.ignoredColumns,
    confirmedAt: input.confirmedAt,
  }
}

/* ------------------------------------------------------------------ 映射模板 */

/**
 * 映射模板结构版本：与 `MAPPING_TEMPLATE_FORMAT_VERSION` 不一致的模板**拒绝导入**，
 * 不做「尽力兼容」（与 `domain/version.ts` 的版本口径一致）。
 */
export const MAPPING_TEMPLATE_FORMAT_VERSION = '1.0.0'

/** 模板里的列映射：按**表头名**复用，不依赖列顺序 */
export type MappingTemplateEntry = {
  readonly sourceHeader: string
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
}

/** 模板里的合并规则：同样按表头名登记取值优先级 */
export type MappingTemplateMerge = {
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
  readonly strategy: 'first-non-empty'
  readonly sourceHeaders: readonly string[]
}

/**
 * 可复用的映射模板（docs/PRD.md 4.3「模板保存源表头签名、字段映射、枚举 / 单位规则和版本，
 * **不存示例候选人数据**」）。
 *
 * 本结构**没有**任何存放单元格取值的字段：只有表头文本、目标字段键与版本。
 */
export type MappingTemplate = {
  readonly formatVersion: string
  /** 标准 21 列模板版本（`RuleVersion.templateVersion`） */
  readonly templateVersion: string
  readonly name: string
  readonly sourceHeaderSignature: string
  readonly headerCount: number
  readonly entries: readonly MappingTemplateEntry[]
  readonly merges: readonly MappingTemplateMerge[]
  readonly createdAt: string
}

/** 从当前映射状态生成模板（`columnIndexes` 按源表头名展开，保证换文件后仍可复用） */
export function buildMappingTemplate(input: {
  readonly name: string
  readonly state: MappingState
  readonly createdAt: string
}): MappingTemplate {
  const { state } = input
  const headerByColumn = new Map<number, string>(
    state.entries.map((entry) => [entry.columnIndex, entry.sourceHeader]),
  )
  const merges: MappingTemplateMerge[] = []
  for (const merge of state.merges) {
    const sourceHeaders = merge.columnIndexes
      .map((columnIndex) => headerByColumn.get(columnIndex))
      .filter((header): header is string => header !== undefined)
    if (sourceHeaders.length < 2) {
      continue
    }
    merges.push({
      targetField: merge.targetField,
      targetExtension: merge.targetExtension,
      strategy: merge.strategy,
      sourceHeaders,
    })
  }

  return {
    formatVersion: MAPPING_TEMPLATE_FORMAT_VERSION,
    templateVersion: TEMPLATE_VERSION,
    name: input.name.trim() === '' ? '未命名模板' : input.name.trim(),
    sourceHeaderSignature: state.sourceHeaderSignature,
    headerCount: state.counts.columnCount,
    entries: state.entries.map((entry) => ({
      sourceHeader: entry.sourceHeader,
      targetField: entry.targetField,
      targetExtension: entry.targetExtension,
    })),
    merges,
    createdAt: input.createdAt,
  }
}

export type MappingTemplateApplication = {
  /** 可直接并入 `MappingDecisions.templateOverrides` 的按列改写（记为 `template` 级别） */
  readonly templateOverrides: Readonly<Record<number, MappingTargetChoice | null>>
  /** 模板登记的冲突处置（合并规则） */
  readonly conflictResolutions: Readonly<Record<string, ConflictResolution>>
  /** 命中的列数（含模板里明确忽略的列） */
  readonly matchedColumnCount: number
  /** 模板里有、当前文件里没有的表头（提示「该列未出现在本次导入中」） */
  readonly unmatchedHeaders: readonly string[]
  /** 当前文件里有、模板里没有的列数（保持自动建议） */
  readonly untouchedColumnCount: number
}

/**
 * 复用模板：按**规范化表头**匹配当前文件的列。
 * - 模板里明确忽略的列（两个目标都为空）同样按「忽略」应用，不会退化为自动建议；
 * - 当前文件里多出来的列不被改动，仍走四级自动建议；
 * - 模板里没有出现的列不会被模板「静默忽略」；
 * - 命中列记为 `template` 级别，与人工改写的 `manual` 分开，便于回溯「这条映射从哪来」。
 */
export function applyMappingTemplate(
  template: MappingTemplate,
  headers: readonly string[],
): MappingTemplateApplication {
  const byHeader = new Map<string, MappingTemplateEntry>()
  for (const entry of template.entries) {
    const key = normalizeHeader(entry.sourceHeader)
    if (!byHeader.has(key)) {
      byHeader.set(key, entry)
    }
  }

  const overrides: Record<number, MappingTargetChoice | null> = {}
  const usedHeaders = new Set<string>()
  headers.forEach((header, columnIndex) => {
    const entry = byHeader.get(normalizeHeader(header))
    if (entry === undefined) {
      return
    }
    usedHeaders.add(normalizeHeader(entry.sourceHeader))
    overrides[columnIndex] =
      entry.targetField === null && entry.targetExtension === null
        ? null
        : { targetField: entry.targetField, targetExtension: entry.targetExtension }
  })
  const conflictResolutions: Record<string, ConflictResolution> = {}
  for (const merge of template.merges) {
    const groupId = conflictGroupIdFor(merge.targetField, merge.targetExtension)
    if (groupId === null) {
      continue
    }
    const columnIndexes: number[] = []
    for (const sourceHeader of merge.sourceHeaders) {
      const key = normalizeHeader(sourceHeader)
      const index = headers.findIndex((header) => normalizeHeader(header) === key)
      if (index >= 0 && !columnIndexes.includes(index)) {
        columnIndexes.push(index)
      }
    }
    if (columnIndexes.length >= 2) {
      conflictResolutions[groupId] = { kind: 'merge', strategy: merge.strategy }
    }
  }

  const unmatchedHeaders = template.entries
    .filter((entry) => !usedHeaders.has(normalizeHeader(entry.sourceHeader)))
    .map((entry) => (entry.sourceHeader === '' ? '（空表头）' : entry.sourceHeader))

  return {
    templateOverrides: overrides,
    conflictResolutions,
    matchedColumnCount: Object.keys(overrides).length,
    unmatchedHeaders,
    untouchedColumnCount: headers.length - Object.keys(overrides).length,
  }
}

/** 模板中**禁止出现**的键（一旦出现说明模板里混入了样例 / 明细数据，直接拒绝） */
const TEMPLATE_FORBIDDEN_KEYS: readonly string[] = [
  'samples',
  'samplevalues',
  'values',
  'rows',
  'cells',
  'data',
  'records',
]

function findForbiddenKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenKey(item)
      if (found !== null) {
        return found
      }
    }
    return null
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (TEMPLATE_FORBIDDEN_KEYS.includes(key.toLowerCase())) {
        return key
      }
      const found = findForbiddenKey(child)
      if (found !== null) {
        return found
      }
    }
  }
  return null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStandardFieldKey(value: unknown): value is StandardFieldKey {
  return typeof value === 'string' && (STANDARD_FIELD_KEYS as readonly string[]).includes(value)
}

function isExtensionFieldKey(value: unknown): value is ExtensionFieldKey {
  return typeof value === 'string' && (EXTENSION_FIELD_KEYS as readonly string[]).includes(value)
}

type TargetParseResult =
  | {
      readonly ok: true
      readonly targetField: StandardFieldKey | null
      readonly targetExtension: ExtensionFieldKey | null
    }
  | { readonly ok: false; readonly error: string }

function parseTarget(raw: Record<string, unknown>, where: string): TargetParseResult {
  const targetField = raw.targetField ?? null
  const targetExtension = raw.targetExtension ?? null
  if (targetField !== null && !isStandardFieldKey(targetField)) {
    return { ok: false, error: `${where} 的标准字段键非法：${String(targetField)}` }
  }
  if (targetExtension !== null && !isExtensionFieldKey(targetExtension)) {
    return { ok: false, error: `${where} 的扩展列键非法：${String(targetExtension)}` }
  }
  if (targetField !== null && targetExtension !== null) {
    return { ok: false, error: `${where} 同时指向标准字段与扩展列：两者必须互斥` }
  }
  return { ok: true, targetField, targetExtension }
}

/** 序列化为文本（只有表头与目标字段，**不含**任何单元格取值） */
export function serializeMappingTemplate(template: MappingTemplate): string {
  return JSON.stringify(template, null, 2)
}

export type MappingTemplateParseResult =
  | { readonly ok: true; readonly template: MappingTemplate }
  | { readonly ok: false; readonly error: string }

/**
 * 解析映射模板文本（本步只提供结构与版本接口；文件读写由步骤6 / 步骤12 接入加密仓与备份）。
 *
 * 严格校验，不做「尽力兼容」：
 * - 结构版本不一致 → 拒绝；
 * - 出现 samples / values / rows / cells / data 等键 → 拒绝（模板不得含示例候选人数据）；
 * - 目标字段键不在已登记字段内，或标准字段与扩展列同时非空 → 拒绝。
 */
export function parseMappingTemplate(text: string): MappingTemplateParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON 文本，无法作为映射模板读取。' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: '模板内容必须是一个 JSON 对象。' }
  }
  const forbidden = findForbiddenKey(parsed)
  if (forbidden !== null) {
    return { ok: false, error: `模板中出现「${forbidden}」字段：映射模板不得包含任何样例或明细数据。` }
  }
  if (parsed.formatVersion !== MAPPING_TEMPLATE_FORMAT_VERSION) {
    return {
      ok: false,
      error: `模板结构版本不兼容（模板 ${String(parsed.formatVersion)} ≠ 当前 ${MAPPING_TEMPLATE_FORMAT_VERSION}）。`,
    }
  }
  if (typeof parsed.templateVersion !== 'string' || typeof parsed.name !== 'string') {
    return { ok: false, error: '模板缺少 templateVersion 或 name。' }
  }
  if (typeof parsed.sourceHeaderSignature !== 'string' || typeof parsed.createdAt !== 'string') {
    return { ok: false, error: '模板缺少 sourceHeaderSignature 或 createdAt。' }
  }
  if (typeof parsed.headerCount !== 'number' || !Number.isInteger(parsed.headerCount)) {
    return { ok: false, error: '模板的 headerCount 必须是整数。' }
  }
  if (!Array.isArray(parsed.entries)) {
    return { ok: false, error: '模板缺少 entries 数组。' }
  }

  const entries: MappingTemplateEntry[] = []
  for (const [index, raw] of parsed.entries.entries()) {
    if (!isRecord(raw) || typeof raw.sourceHeader !== 'string') {
      return { ok: false, error: `第 ${index + 1} 条列映射缺少 sourceHeader。` }
    }
    const target = parseTarget(raw, `第 ${index + 1} 条列映射`)
    if (!target.ok) {
      return { ok: false, error: target.error }
    }
    entries.push({
      sourceHeader: raw.sourceHeader,
      targetField: target.targetField,
      targetExtension: target.targetExtension,
    })
  }

  const rawMerges = parsed.merges ?? []
  if (!Array.isArray(rawMerges)) {
    return { ok: false, error: '模板的 merges 必须是数组。' }
  }
  const merges: MappingTemplateMerge[] = []
  for (const [index, raw] of rawMerges.entries()) {
    if (!isRecord(raw) || !Array.isArray(raw.sourceHeaders)) {
      return { ok: false, error: `第 ${index + 1} 条合并规则缺少 sourceHeaders。` }
    }
    if (raw.strategy !== 'first-non-empty') {
      return {
        ok: false,
        error: `第 ${index + 1} 条合并规则的 strategy 只支持 first-non-empty（当前为 ${String(raw.strategy)}）。`,
      }
    }
    const sourceHeaders = raw.sourceHeaders.filter(
      (header): header is string => typeof header === 'string',
    )
    if (sourceHeaders.length < 2) {
      return { ok: false, error: `第 ${index + 1} 条合并规则至少需要 2 个源表头。` }
    }
    const target = parseTarget(raw, `第 ${index + 1} 条合并规则`)
    if (!target.ok) {
      return { ok: false, error: target.error }
    }
    merges.push({
      targetField: target.targetField,
      targetExtension: target.targetExtension,
      strategy: 'first-non-empty',
      sourceHeaders,
    })
  }

  return {
    ok: true,
    template: {
      formatVersion: MAPPING_TEMPLATE_FORMAT_VERSION,
      templateVersion: parsed.templateVersion,
      name: parsed.name,
      sourceHeaderSignature: parsed.sourceHeaderSignature,
      headerCount: parsed.headerCount,
      entries,
      merges,
      createdAt: parsed.createdAt,
    },
  }
}

/* ------------------------------------------------------------------ 列样例摘要（仅本机展示） */

export type MappingColumnSummary = {
  readonly columnIndex: number
  /** 源表头原文（空表头保留空串，由界面显示「（空表头）」） */
  readonly header: string
  /** 源文件是否把该列标记为隐藏列（数据**不排除**，只提示） */
  readonly hidden: boolean
  /** 非空单元格数（跳过空行与空单元格；不把 0 当成空） */
  readonly nonEmptyCount: number
  /** 去重后的前若干样例：**只在本机显示**，绝不写入日志、报告、模板或导出 */
  readonly samples: readonly string[]
  /** 样例是否被截断（超长文本只显示前若干字符） */
  readonly sampleTruncated: boolean
  readonly allEmpty: boolean
}

export type ColumnSummaryOptions = {
  readonly maxSamples?: number
  readonly maxSampleLength?: number
}

export const DEFAULT_MAX_SAMPLES = 3
export const DEFAULT_MAX_SAMPLE_LENGTH = 40

/**
 * 逐列摘要：非空计数 + 少量去重样例，供映射页核对「这一列到底是什么」。
 *
 * 口径：
 * - 空行（`RawSheet.emptyRowCount`）不参与统计；
 * - 空白字符串按缺失处理（与清洗阶段一致），但不做任何类型转换；
 * - 只读，不修改 `RawSheet`，也不缓存到任何存储。
 */
export function summarizeColumns(
  sheet: RawSheet,
  options: ColumnSummaryOptions = {},
): readonly MappingColumnSummary[] {
  const maxSamples = options.maxSamples ?? DEFAULT_MAX_SAMPLES
  const maxSampleLength = options.maxSampleLength ?? DEFAULT_MAX_SAMPLE_LENGTH
  const hiddenColumns = new Set(sheet.hiddenColumnIndexes)
  const columnCount = sheet.header.headers.length

  const samples: string[][] = Array.from({ length: columnCount }, () => [])
  const seen = Array.from({ length: columnCount }, () => new Set<string>())
  const nonEmptyCounts = new Array<number>(columnCount).fill(0)
  const truncatedFlags = new Array<boolean>(columnCount).fill(false)

  for (const row of sheet.rows) {
    if (row.emptyRow) {
      continue
    }
    // 只遍历该行真正存在的单元格：解析阶段已按「单元格上限」把关，这里不再放大工作量
    const cellCount = Math.min(row.cells.length, columnCount)
    for (let columnIndex = 0; columnIndex < cellCount; columnIndex += 1) {
      const cell = row.cells[columnIndex] ?? null
      if (cell === null) {
        continue
      }
      const text = (typeof cell === 'string' ? cell : String(cell)).trim()
      if (text === '') {
        continue
      }
      nonEmptyCounts[columnIndex] += 1
      if (samples[columnIndex].length >= maxSamples || seen[columnIndex].has(text)) {
        continue
      }
      seen[columnIndex].add(text)
      if (text.length > maxSampleLength) {
        samples[columnIndex].push(`${text.slice(0, maxSampleLength)}…`)
        truncatedFlags[columnIndex] = true
      } else {
        samples[columnIndex].push(text)
      }
    }
  }

  return sheet.header.headers.map((header, columnIndex) => ({
    columnIndex,
    header,
    hidden: hiddenColumns.has(columnIndex),
    nonEmptyCount: nonEmptyCounts[columnIndex],
    samples: samples[columnIndex],
    sampleTruncated: truncatedFlags[columnIndex],
    allEmpty: nonEmptyCounts[columnIndex] === 0,
  }))
}










