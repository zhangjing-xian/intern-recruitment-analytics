/**
 * 清洗与规范化（docs/PRD.md 第 5 章）：`RawSheet` + 已确认 `ImportMapping` + `CleaningSettings`
 * → `NormalizedDataset`（记录 + 数据集元数据 + 质量报告）。
 *
 * 铁律：
 * - 未确认映射、缺 offer 状态列一律**拒绝清洗**（不允许先出结论再补确认）；
 * - 空单元格 / 占位符 → null，**绝不**用 0 代替；住宿不折现；未知 ≠ 否；
 * - 日期只在日期列解析；需求 ID 永远按文本保留前导 0；
 * - 未识别的值只记录问题码与来源（`source`），不凭空下结论；
 * - 隐藏行默认包含、表头回声行默认保留；任何排除都写入质量报告与决策日志。
 */

import {
  CURRENT_RULE_VERSION,
  buildConfigRevision,
  EMPTY_EXTENSION_VALUES,
  EXTENSION_FIELDS,
  JOINED_STATUS,
  PENDING_JOINING_STATUS,
  RULES_VERSION,
  SCHEMA_VERSION,
  UNKNOWN,
  buildDisplayId,
  countsTowardCoreDenominator,
  createQualityIssue,
  disabledModulesFor,
  extractAmount,
  getStandardField,
  isAcceptedStatus,
  isHeaderEchoValue,
  isNullToken,
  isRejectedStatus,
  isValidAmount,
  isValidGraduationYear,
  newRecordId,
  normalizeCellText,
  normalizeHeader,
  resolveChannel,
  resolveCity,
  resolveEducation,
  resolveGraduationYear,
  resolveHousing,
  resolveOfferStatus,
  resolveReferralType,
  resolveRequirementType,
  resolveSalaryAmount,
  resolveTriState,
  summarizeIssues,
  type Channel,
  type City,
  type CleaningDecision,
  type CleaningReport,
  type CleaningSettings,
  type Currency,
  type DataQualityIssue,
  type DataQualityIssueCode,
  type DateOnly,
  type DatasetCounts,
  type DatasetMetadata,
  type DedupDecision,
  type DerivedRecordFields,
  type DuplicateGroup,
  type DuplicateKind,
  type Education,
  type ExtensionFieldKey,
  type ExtensionFieldValues,
  type HousingPeriod,
  type HousingType,
  type ImportMapping,
  type ManualCorrection,
  type NormalizationLogEntry,
  type NormalizedDataset,
  type NormalizedRecord,
  type OfferStatus,
  type RawCellValue,
  type RawRow,
  type RawSheet,
  type ReferralType,
  type RequirementType,
  type SalaryUnit,
  type StandardFieldKey,
  type TriState,
  type ValueSource,
} from '../domain'

import { daysBetweenDateOnly, parseDateCell, type DateParseOptions } from './dates'
import { sheetSignatureOf } from './sheetSignature'
import {
  DEDUP_RULES,
  analyzeDuplicates,
  applyDedupStrategy,
  initialDedupDecision,
  type DuplicateAnalysis,
  type DuplicateCandidate,
} from './duplicates'
import { buildMetricAvailability, countIssuesByCode } from './report'
import { cleanTextCell, resolveSchoolName } from './text'

export type CleanSheetInput = {
  readonly sheet: RawSheet
  readonly mapping: ImportMapping
  readonly settings: CleaningSettings
  readonly datasetId: string
  readonly batchId: string
  readonly datasetName: string
  /** 导入时间（ISO 字符串）；测试可注入固定值 */
  readonly importedAt: string
  /** 记录 ID 生成器；默认用本地随机 UUID（测试可注入确定性实现） */
  readonly createRecordId?: () => string
}

/**
 * 清洗前置条件：映射未确认、缺 offer 状态列都不允许进入清洗。
 * 返回 null 表示可以清洗；返回文案时界面应直接展示并阻断提交。
 */
export function cleaningPreconditionError(mapping: ImportMapping): string | null {
  if (mapping.confirmedAt === null) {
    return '字段映射尚未确认：请先在「字段映射」页确认列映射，再进入清洗与校验'
  }
  if (mapping.missingRequiredFields.length > 0) {
    return '缺少 offer 状态列：offer 状态是唯一必需字段，缺失时不得继续导入或分析'
  }
  return null
}

/** 某目标字段 / 扩展列的取值来源：单列或显式合并的多个源列（顺序即优先级） */
type TargetSpec = {
  readonly columnIndexes: readonly number[]
  /** 是否来自显式合并规则（按列顺序取第一个非空值） */
  readonly merged: boolean
}

type RowContext = {
  readonly fields: ReadonlyMap<StandardFieldKey, TargetSpec>
  readonly extensions: ReadonlyMap<ExtensionFieldKey, TargetSpec>
  /** 源表头原文（用于识别表头回声单元格） */
  readonly headerTexts: readonly string[]
}

type RowContextBuildInput = {
  readonly mapping: ImportMapping
  readonly sheet: RawSheet
}

function buildRowContext(input: RowContextBuildInput): RowContext {
  const fields = new Map<StandardFieldKey, TargetSpec>()
  const extensions = new Map<ExtensionFieldKey, TargetSpec>()
  for (const entry of input.mapping.entries) {
    if (entry.targetField !== null) {
      fields.set(entry.targetField, { columnIndexes: [entry.columnIndex], merged: false })
    } else if (entry.targetExtension !== null) {
      extensions.set(entry.targetExtension, { columnIndexes: [entry.columnIndex], merged: false })
    }
  }
  for (const rule of input.mapping.merges) {
    const spec: TargetSpec = { columnIndexes: rule.columnIndexes, merged: true }
    if (rule.targetField !== null) {
      fields.set(rule.targetField, spec)
    } else if (rule.targetExtension !== null) {
      extensions.set(rule.targetExtension, spec)
    }
  }
  return { fields, extensions, headerTexts: input.sheet.header.headers }
}

/** 单个目标字段的取值：单列该列原值，或显式合并命中的那一列 */
type CellPick = {
  readonly value: RawCellValue
  readonly columnIndex: number | null
}

/**
 * 取值：未映射 → null（不产生任何问题）；单列 → 该列原值；显式合并 → 按列顺序第一个非空。
 * 合并**不**拼接、不换算、缺值**不**填 0（docs/PRD.md 4.3）。
 */
function pickCell(spec: TargetSpec | undefined, cells: readonly RawCellValue[]): CellPick {
  if (spec === undefined) {
    return { value: null, columnIndex: null }
  }
  if (!spec.merged) {
    const index: number | undefined = spec.columnIndexes[0]
    if (index === undefined) {
      return { value: null, columnIndex: null }
    }
    return { value: cells[index] ?? null, columnIndex: index }
  }
  for (const index of spec.columnIndexes) {
    const value = cells[index] ?? null
    const text = normalizeCellText(value)
    if (text !== '' && !isNullToken(text)) {
      return { value, columnIndex: index }
    }
  }
  return { value: null, columnIndex: null }
}

/** 逐行解析出的标准字段值（重复决定与质量标记在重复分析后补齐） */
export type ResolvedFieldValues = {
  requirementId: string | null
  recruiter: string | null
  city: City
  cityRaw: string | null
  department: string | null
  position: string | null
  jobFamily: string | null
  requirementType: RequirementType
  recruitmentStartDate: DateOnly | null
  joiningDate: DateOnly | null
  expectedEndDate: DateOnly | null
  candidateName: string | null
  graduationYear: number | null
  education: Education
  school: string | null
  schoolSource: ValueSource
  isGptSchool: TriState
  isGptSchoolSource: ValueSource
  referrer: string | null
  referralType: ReferralType
  channel: Channel
  channelRaw: string | null
  salaryAmount: number | null
  currency: Currency | null
  salaryUnit: SalaryUnit | null
  housingRaw: string | null
  housingType: HousingType
  housingAmount: number | null
  housingPeriod: HousingPeriod | null
  housingReason: string | null
  offerStatus: OfferStatus
  offerStatusRaw: string | null
  rejectionReason: string | null
  extensions: ExtensionFieldValues
}

type MutableFieldValues = { -readonly [K in keyof ResolvedFieldValues]: ResolvedFieldValues[K] }

/** 未映射 / 缺失时的初始值：未知就是未知，**不**用 0 / 否 / 空字符串冒充 */
function missingFieldValues(): MutableFieldValues {
  return {
    requirementId: null,
    recruiter: null,
    city: UNKNOWN,
    cityRaw: null,
    department: null,
    position: null,
    jobFamily: null,
    requirementType: UNKNOWN,
    recruitmentStartDate: null,
    joiningDate: null,
    expectedEndDate: null,
    candidateName: null,
    graduationYear: null,
    education: UNKNOWN,
    school: null,
    schoolSource: 'raw',
    isGptSchool: null,
    isGptSchoolSource: 'unknown',
    referrer: null,
    referralType: UNKNOWN,
    channel: UNKNOWN,
    channelRaw: null,
    salaryAmount: null,
    currency: null,
    salaryUnit: null,
    housingRaw: null,
    housingType: UNKNOWN,
    housingAmount: null,
    housingPeriod: null,
    housingReason: null,
    offerStatus: UNKNOWN,
    offerStatusRaw: null,
    rejectionReason: null,
    extensions: EMPTY_EXTENSION_VALUES,
  }
}

/* ------------------------------------------------------------------ 行内解析状态 */

/**
 * 日志条目在行内可变（`issueCodes` 由紧随其后的 `emitResolutionIssues` 补齐），
 * 写进记录时仍是只读契约 `NormalizationLogEntry`。
 */
type MutableLogEntry = {
  -readonly [K in keyof NormalizationLogEntry]: NormalizationLogEntry[K]
}

/** 行内解析状态：所有字段解析都通过它记录结论、问题与日志，避免各写一套 */
type RowState = {
  readonly sheet: RawSheet
  readonly row: RawRow
  readonly settings: CleaningSettings
  readonly context: RowContext
  readonly values: MutableFieldValues
  readonly log: MutableLogEntry[]
  readonly issues: DataQualityIssue[]
  readonly rowCodes: DataQualityIssueCode[]
  /** 未确认日月顺序的歧义日期原值样例（只保留少量，避免报告里堆原值） */
  readonly ambiguousDateSamples: string[]
  ambiguousDateCount: number
  cycleTooLongCount: number
  negativeCycleCount: number
  plannedDateUncertainCount: number
  headerEchoCount: number
}

/** 问题行数按行去重：同一行同一问题码只算一次，但保留首个原值便于定位 */
function flagCodes(state: RowState, codes: readonly DataQualityIssueCode[]): void {
  for (const code of codes) {
    if (!state.rowCodes.includes(code)) {
      state.rowCodes.push(code)
    }
  }
}

type IssueOptions = {
  readonly field?: string | null
  readonly rawValue?: string | null
  readonly message?: string
}

/** 记录单行问题（只带**单个**单元格原值，禁止整行拼接） */
function addIssue(state: RowState, code: DataQualityIssueCode, options: IssueOptions = {}): void {
  flagCodes(state, [code])
  state.issues.push(
    createQualityIssue({
      code,
      field: options.field ?? null,
      sourceSheet: state.sheet.sourceSheet,
      sourceRow: state.row.sourceRow,
      rawValue: options.rawValue ?? null,
      message: options.message,
    }),
  )
}

/** 单格原值文本（仅用于日志与提示；缺失保持 null，**不**转成空字符串以外的东西） */
function rawTextOf(raw: RawCellValue): string | null {
  return raw === null ? null : normalizeCellText(raw)
}

type LogInput = {
  readonly rule: string
  readonly source: ValueSource
  readonly normalizedValue: string | null
  readonly requiresConfirmation?: boolean
  readonly inferred?: boolean
}

/** 写一条规范化日志：结论、规则键、来源与版本都可回溯（docs/PRD.md 5.5） */
function logResolution(
  state: RowState,
  field: StandardFieldKey,
  rawValue: RawCellValue,
  input: LogInput,
): void {
  state.log.push({
    field,
    rawValue: rawTextOf(rawValue),
    normalizedValue: input.normalizedValue,
    rule: input.rule,
    ruleVersion: RULES_VERSION,
    source: input.source,
    inferred: input.inferred === true,
    confirmed: input.requiresConfirmation !== true,
    issueCodes: [],
  })
}

function fieldHeader(field: StandardFieldKey): string {
  return getStandardField(field).header
}

/**
 * 只对**非空**单元格上报问题：空单元格是缺失，不是错误（缺失口径由字段定义说明）。
 * 必须紧跟同一字段的 `logResolution` 调用：上报的同时把问题码写进该字段的日志条目，
 * 让「这条结论触发了哪些问题」可回溯（`docs/PRD.md 5.5`）。
 */
function emitResolutionIssues(
  state: RowState,
  field: StandardFieldKey,
  rawValue: RawCellValue,
  issueCodes: readonly DataQualityIssueCode[],
): void {
  const text = normalizeCellText(rawValue)
  if (text === '' || isNullToken(text)) {
    return
  }
  const rawText = rawTextOf(rawValue)
  for (const code of issueCodes) {
    addIssue(state, code, { field: fieldHeader(field), rawValue: rawText })
  }
  const lastEntry = state.log[state.log.length - 1]
  if (lastEntry !== undefined && lastEntry.field === field) {
    lastEntry.issueCodes = [...issueCodes]
  }
}

/** 文本类字段：只做写法归一；ID 列保留前导 0，永不按数字或日期解析 */
function applyTextField(
  state: RowState,
  field: StandardFieldKey,
  assign: (value: string | null) => void,
): void {
  const pick = pickCell(state.context.fields.get(field), state.row.cells)
  const cleaned = cleanTextCell(pick.value, {
    preserveLeadingZeros: getStandardField(field).preserveLeadingZeros,
  })
  assign(cleaned.value)
  logResolution(state, field, pick.value, {
    rule: cleaned.rule,
    source: cleaned.value === null ? 'unknown' : 'raw',
    normalizedValue: cleaned.value,
  })
  emitResolutionIssues(state, field, pick.value, cleaned.issueCodes)
}

function applyTextFields(state: RowState): void {
  applyTextField(state, 'requirementId', (value) => {
    state.values.requirementId = value
  })
  applyTextField(state, 'recruiter', (value) => {
    state.values.recruiter = value
  })
  applyTextField(state, 'department', (value) => {
    state.values.department = value
  })
  applyTextField(state, 'position', (value) => {
    state.values.position = value
  })
  applyTextField(state, 'jobFamily', (value) => {
    state.values.jobFamily = value
  })
  applyTextField(state, 'candidateName', (value) => {
    state.values.candidateName = value
  })
  applyTextField(state, 'referrer', (value) => {
    state.values.referrer = value
  })
}

function applyCityField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('city'), state.row.cells)
  const resolution = resolveCity(pick.value)
  state.values.city = resolution.city
  state.values.cityRaw = resolution.cityRaw
  logResolution(state, 'city', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.cityRaw === null ? null : resolution.city,
    requiresConfirmation: resolution.requiresConfirmation,
    inferred: resolution.requiresConfirmation,
  })
  emitResolutionIssues(state, 'city', pick.value, resolution.issueCodes)
}

function applyRequirementTypeField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('requirementType'), state.row.cells)
  const resolution = resolveRequirementType(pick.value)
  state.values.requirementType = resolution.requirementType
  logResolution(state, 'requirementType', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.requirementType,
    requiresConfirmation: resolution.requiresConfirmation,
    inferred: resolution.requiresConfirmation,
  })
  emitResolutionIssues(state, 'requirementType', pick.value, resolution.issueCodes)
}

function applyChannelField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('channel'), state.row.cells)
  const resolution = resolveChannel(pick.value)
  state.values.channel = resolution.channel
  state.values.channelRaw = resolution.channelRaw
  logResolution(state, 'channel', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.channelRaw === null ? null : resolution.channel,
    requiresConfirmation: resolution.requiresConfirmation,
  })
  emitResolutionIssues(state, 'channel', pick.value, resolution.issueCodes)
}

/** 推荐类型必须用**同一行已解析的渠道**交叉判断，不得只看推荐人文本 */
function applyReferralField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('referrer'), state.row.cells)
  const resolution = resolveReferralType(pick.value, state.values.channel)
  state.values.referralType = resolution.referralType
  // 推荐类型没有独立的 21 列字段：结论挂在来源列「推荐人」下，保证日志能回到原列
  logResolution(state, 'referrer', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.referralType,
    requiresConfirmation: resolution.requiresConfirmation,
    inferred: resolution.needsReview,
  })
  emitResolutionIssues(state, 'referrer', pick.value, resolution.issueCodes)

  // 两列都解析完了才能做「渠道补内推」（用户需求 ②）：它同时依赖渠道与推荐类型
  applyChannelFromReferrer(state)
}

/**
 * 渠道缺失时按推荐人补成「内推」（用户需求 ②，2026-09-27）。
 *
 * ## 三条口径（用户确认，见 `docs/DECISIONS.md` D-092 与 `docs/PRD.md` 5.2）
 *
 * 1. **默认关闭**：只有用户在清洗页显式开启 `settings.channelFromReferrer` 才生效。
 *    AGENTS §6 明文禁止「自动把 `-` 渠道判为内推」，因此这一步绝不能是隐式默认行为。
 * 2. **只补缺失**：只有「渠道是空 / `-`（即 `channel === UNKNOWN && channelRaw === null`）」
 *    才补；渠道已经有具体值（`Boss` / `官网` / `其他` / 显式「未知」）时**绝不覆盖**，
 *    改为标一条 `CHANNEL_REFERRER_CONFLICT`（渠道与推荐人不一致，请核对）——
 *    因为「从哪投的」与「谁推荐的」是两件事，覆盖会同时弄丢原始渠道并改写渠道分布。
 * 3. **留痕且可撤销**：补出来的值单写一条日志（规则 `channel.inferredFromReferrer`、
 *    来源 `derived`、`inferred: true`、`confirmed: false`），原缺失值仍在同一行的渠道日志里，
 *    因此关掉开关重新清洗即可完全还原。
 *
 * 本函数**不自己算任何指标**，只改「渠道」这一个取值并留下问题码与日志。
 */
function applyChannelFromReferrer(state: RowState): void {
  if (!state.settings.channelFromReferrer) {
    return
  }
  if (state.values.referralType !== '内推') {
    return
  }
  const channel = state.values.channel
  if (channel === '内推') {
    // 渠道本来就写着内推：两列一致，什么都不做（不加任何提示）
    return
  }
  const pick = pickCell(state.context.fields.get('channel'), state.row.cells)

  if (channel === UNKNOWN && state.values.channelRaw === null) {
    state.values.channel = '内推'
    state.log.push({
      field: 'channel',
      rawValue: rawTextOf(pick.value),
      normalizedValue: '内推',
      rule: 'channel.inferredFromReferrer',
      ruleVersion: RULES_VERSION,
      source: 'derived',
      inferred: true,
      confirmed: false,
      issueCodes: ['CHANNEL_INFERRED_FROM_REFERRER'],
    })
    addIssue(state, 'CHANNEL_INFERRED_FROM_REFERRER', {
      field: fieldHeader('channel'),
      rawValue: rawTextOf(pick.value),
    })
    return
  }

  // 已有具体值：保持不动，只提示两列不一致
  addIssue(state, 'CHANNEL_REFERRER_CONFLICT', {
    field: fieldHeader('channel'),
    rawValue: rawTextOf(pick.value),
  })
}

function applyEducationField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('education'), state.row.cells)
  const resolution = resolveEducation(pick.value)
  state.values.education = resolution.education
  logResolution(state, 'education', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.education,
  })
  emitResolutionIssues(state, 'education', pick.value, resolution.issueCodes)
}

/**
 * offer 状态：唯一必需字段。缺失只提示 `MISSING_REQUIRED_VALUE`，**不**替换成其他状态；
 * 传入表头文本用于识别表头回声单元格，避免把同名表头当成状态值。
 */
function applyOfferStatusField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('offerStatus'), state.row.cells)
  const resolution = resolveOfferStatus(pick.value, state.context.headerTexts)
  state.values.offerStatus = resolution.offerStatus
  state.values.offerStatusRaw = resolution.offerStatusRaw
  logResolution(state, 'offerStatus', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.offerStatusRaw === null ? null : resolution.offerStatus,
    requiresConfirmation: resolution.requiresConfirmation,
  })
  if (rawTextOf(pick.value) === null) {
    addIssue(state, 'MISSING_REQUIRED_VALUE', { field: fieldHeader('offerStatus') })
  }
  emitResolutionIssues(state, 'offerStatus', pick.value, resolution.issueCodes)
}

/** 日期列专用解析选项：工作簿日期系统 + 用户确认的日月顺序（未确认则不转换） */
function dateOptionsFor(state: RowState): DateParseOptions {
  return {
    date1904: state.sheet.date1904,
    ambiguousDateOrder: state.settings.ambiguousDateOrder,
  }
}

/** 歧义日期样例最多保留 5 个：报告只用于让用户判断日月顺序，不是原始数据副本 */
const AMBIGUOUS_DATE_SAMPLE_LIMIT = 5

function applyDateField(
  state: RowState,
  field: StandardFieldKey,
  options: DateParseOptions,
  assign: (value: DateOnly | null) => void,
): void {
  const pick = pickCell(state.context.fields.get(field), state.row.cells)
  const resolution = parseDateCell(pick.value, options)
  assign(resolution.date)
  logResolution(state, field, pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.date,
    requiresConfirmation: resolution.requiresConfirmation,
    inferred: resolution.source === 'derived',
  })
  if (resolution.ambiguousOrder) {
    state.ambiguousDateCount += 1
    const sample = rawTextOf(pick.value)
    if (sample !== null && state.ambiguousDateSamples.length < AMBIGUOUS_DATE_SAMPLE_LIMIT) {
      state.ambiguousDateSamples.push(sample)
    }
  }
  emitResolutionIssues(state, field, pick.value, resolution.issueCodes)
}

/** 日期列：只在日期列解析，文本 / ID 列永不进入这里 */
function applyDateFields(state: RowState): void {
  const options = dateOptionsFor(state)
  applyDateField(state, 'recruitmentStartDate', options, (value) => {
    state.values.recruitmentStartDate = value
  })
  applyDateField(state, 'joiningDate', options, (value) => {
    state.values.joiningDate = value
  })
  applyDateField(state, 'expectedEndDate', options, (value) => {
    state.values.expectedEndDate = value
  })
}

/** 本地 GPT 名单命中判定：只在「原值缺失」时使用；名单为空一律返回 null（不猜） */
function lookupGptList(list: readonly string[], school: string | null): boolean | null {
  if (school === null || list.length === 0) {
    return null
  }
  const key = normalizeHeader(school)
  if (key === '') {
    return null
  }
  return list.some((entry) => normalizeHeader(entry) === key)
}

/**
 * 「是否GPT院校」：原值优先。
 * - 原值缺失 + 列表模式：命中名单 → 是；未命中**只有**在用户声明名单完整时才判否，否则保持未知；
 * - 原值为否但名单命中 → 保留原值并提示冲突（原值优先，用户可改）。
 */
function applyGptField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('isGptSchool'), state.row.cells)
  const resolution = resolveTriState(pick.value)
  let value: TriState = resolution.value
  let source: ValueSource = resolution.source
  emitResolutionIssues(state, 'isGptSchool', pick.value, resolution.issueCodes)

  if (value === null && state.settings.gptListMode === 'list-mode') {
    const fromList = lookupGptList(state.settings.gptList, state.values.school)
    if (fromList === true) {
      value = true
      source = 'localList'
    } else if (fromList === false && state.settings.gptListComplete) {
      value = false
      source = 'localList'
    }
  }
  if (value === false && state.settings.gptListMode === 'list-mode') {
    if (lookupGptList(state.settings.gptList, state.values.school) === true) {
      addIssue(state, 'GPT_SOURCE_CONFLICT', {
        field: fieldHeader('isGptSchool'),
        rawValue: rawTextOf(pick.value),
        message: '原值为「否」，但本地 GPT 名单命中该学校：保留原值并提示核实，不自动改写',
      })
    }
  }

  state.values.isGptSchool = value
  state.values.isGptSchoolSource = value === null ? 'unknown' : source
  logResolution(state, 'isGptSchool', pick.value, {
    rule: resolution.rule,
    source: value === null ? 'unknown' : source,
    normalizedValue: value === null ? UNKNOWN : value ? '是' : '否',
    inferred: source === 'localList',
  })
}

/** 学校名：只应用用户显式配置的等价别名，不做包含 / 模糊匹配（语义不同的学校不合并） */
function applySchoolField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('school'), state.row.cells)
  const resolution = resolveSchoolName(pick.value, state.settings.schoolAliases)
  state.values.school = resolution.school
  state.values.schoolSource = resolution.school === null ? 'unknown' : resolution.source
  logResolution(state, 'school', pick.value, {
    rule: resolution.rule,
    source: resolution.school === null ? 'unknown' : resolution.source,
    normalizedValue: resolution.school,
    requiresConfirmation: resolution.requiresConfirmation,
    inferred: resolution.source === 'aliasTable',
  })
  emitResolutionIssues(state, 'school', pick.value, resolution.issueCodes)
}

function applyGraduationYearField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('graduationYear'), state.row.cells)
  const resolution = resolveGraduationYear(pick.value)
  const year =
    resolution.graduationYear !== null && isValidGraduationYear(resolution.graduationYear)
      ? resolution.graduationYear
      : null
  state.values.graduationYear = year
  logResolution(state, 'graduationYear', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: year === null ? null : String(year),
  })
  emitResolutionIssues(state, 'graduationYear', pick.value, resolution.issueCodes)
}

/** 拒 offer 原因：只有拒 offer 记录才有值；非拒 offer 一律 null（不写「未填写」占位） */
function applyRejectionReasonField(state: RowState): void {
  if (isRejectedStatus(state.values.offerStatus) !== true) {
    return
  }
  const pick = pickCell(state.context.fields.get('rejectionReason'), state.row.cells)
  const cleaned = cleanTextCell(pick.value)
  state.values.rejectionReason = cleaned.value
  logResolution(state, 'rejectionReason', pick.value, {
    rule: cleaned.rule,
    source: cleaned.value === null ? 'unknown' : 'raw',
    normalizedValue: cleaned.value,
  })
  emitResolutionIssues(state, 'rejectionReason', pick.value, cleaned.issueCodes)
}

/**
 * 薪资金额：只解析数值，**不**猜币种与计薪周期。
 * 币种 / 周期未确认时保留金额但字段留 null，并由数据集级问题禁用待遇对比（不视为 0）。
 */
function applySalaryField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('salaryAmount'), state.row.cells)
  const resolution = resolveSalaryAmount(pick.value)
  const amount = resolution.salaryAmount
  const valid = amount !== null && isValidAmount(amount)
  state.values.salaryAmount = valid ? amount : null
  if (valid && state.settings.salary.comparable) {
    state.values.currency = state.settings.salary.currency
    state.values.salaryUnit = state.settings.salary.salaryUnit
  }
  logResolution(state, 'salaryAmount', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: valid ? String(amount) : null,
    requiresConfirmation: resolution.requiresConfirmation,
  })
  emitResolutionIssues(state, 'salaryAmount', pick.value, resolution.issueCodes)
  if (amount !== null && !valid) {
    addIssue(state, 'INVALID_SALARY', {
      field: fieldHeader('salaryAmount'),
      rawValue: rawTextOf(pick.value),
      message: `薪资无法解析为有效非负数值（解析结果：${String(amount)}）`,
    })
  }
  if (state.values.salaryAmount !== null && !state.settings.salary.comparable) {
    addIssue(state, 'SALARY_UNIT_UNCONFIRMED', {
      field: fieldHeader('salaryAmount'),
      rawValue: rawTextOf(pick.value),
      message: '薪资币种 / 计薪周期未确认：金额保留，但不参与待遇对比与低薪标签',
    })
  }
}

/** 房补：无补贴 = 0；提供住宿 / 未知 = null（**不**折现）；原文里的金额不做单位换算 */
function applyHousingField(state: RowState): void {
  const pick = pickCell(state.context.fields.get('housingRaw'), state.row.cells)
  const resolution = resolveHousing(pick.value)
  state.values.housingRaw = rawTextOf(pick.value)
  state.values.housingType = resolution.housingType
  state.values.housingAmount = resolution.housingAmount
  state.values.housingPeriod = resolution.housingPeriod
  state.values.housingReason = resolution.housingReason
  logResolution(state, 'housingRaw', pick.value, {
    rule: resolution.rule,
    source: resolution.source,
    normalizedValue: resolution.housingType,
    requiresConfirmation: resolution.requiresConfirmation,
  })
  emitResolutionIssues(state, 'housingRaw', pick.value, resolution.issueCodes)
}

const EXTENSION_KIND_BY_KEY = new Map<ExtensionFieldKey, string>(
  EXTENSION_FIELDS.map((field) => [field.key, field.kind]),
)

/**
 * 扩展列（docs/PRD.md 15.5）：只有用户显式映射后才取值，缺失不产生问题、不影响任何指标。
 * 日期类扩展列同样存 `YYYY-MM-DD`；金额类扩展列**不**参与现金房补 / 薪资口径（住宿不折现）。
 */
function applyExtensionFields(state: RowState): void {
  if (state.context.extensions.size === 0) {
    return
  }
  const options = dateOptionsFor(state)
  const picked = new Map<string, string | number | boolean | null>()
  for (const [key, spec] of state.context.extensions) {
    const pick = pickCell(spec, state.row.cells)
    const kind = EXTENSION_KIND_BY_KEY.get(key) ?? 'text'
    if (kind === 'date') {
      const resolution = parseDateCell(pick.value, options)
      if (resolution.date !== null) {
        picked.set(key, resolution.date)
      }
    } else if (kind === 'amount') {
      const text = rawTextOf(pick.value)
      const amount = text === null ? null : extractAmount(text)
      if (amount !== null && isValidAmount(amount)) {
        picked.set(key, amount)
      }
    } else {
      const cleaned = cleanTextCell(pick.value)
      if (cleaned.value !== null) {
        picked.set(key, cleaned.value)
      }
    }
  }
  state.values.extensions = picked.size === 0 ? EMPTY_EXTENSION_VALUES : Object.fromEntries(picked)
}

/**
 * 派生字段（本步只做**周期与质量标记**；率、分位、基准留到步骤7 的统一指标引擎）：
 * - 实际周期：仅「已入职」且启动 / 入职日期都合法、差为非负时才有值；
 * - 计划周期：仅「待入职」，用「入职时间」列作计划日期，并提示该列语义待确认；
 * - 负周期与超长周期只提示，**不**自动截尾、不删除记录。
 */
function applyDerivedFields(state: RowState): Omit<DerivedRecordFields, 'dataQualityFlags'> {
  const { values } = state
  const status = values.offerStatus
  let cycle: number | null = null

  if (
    status === JOINED_STATUS &&
    values.recruitmentStartDate !== null &&
    values.joiningDate !== null
  ) {
    const days = daysBetweenDateOnly(values.recruitmentStartDate, values.joiningDate)
    if (days !== null && days < 0) {
      state.negativeCycleCount += 1
      addIssue(state, 'NEGATIVE_CYCLE', {
        field: fieldHeader('joiningDate'),
        rawValue: values.joiningDate,
        message: `入职日期 ${values.joiningDate} 早于启动日期 ${values.recruitmentStartDate}：周期为负，不参与周期与核心分母`,
      })
    } else if (days !== null) {
      cycle = days
      if (days > state.settings.cycleTooLongDays) {
        state.cycleTooLongCount += 1
        addIssue(state, 'CYCLE_TOO_LONG', {
          field: fieldHeader('joiningDate'),
          rawValue: values.joiningDate,
          message: `已入职记录周期 ${days} 天，超过 ${state.settings.cycleTooLongDays} 天：请核实，不自动截尾或删除`,
        })
      }
    }
  }

  if (status === PENDING_JOINING_STATUS && values.joiningDate !== null) {
    state.plannedDateUncertainCount += 1
    addIssue(state, 'PLANNED_DATE_UNCERTAIN', {
      field: fieldHeader('joiningDate'),
      rawValue: values.joiningDate,
      message: '待入职记录的「入职时间」是计划日期：只用于计划周期，实际周期仍为未知',
    })
  }

  return {
    recruitmentCycleDays: cycle,
    actualCycleEligible: status === JOINED_STATUS && cycle !== null,
    plannedCycleEligible: status === PENDING_JOINING_STATUS && values.joiningDate !== null,
    isAccepted: isAcceptedStatus(status),
    isRejected: isRejectedStatus(status),
    countedInCoreDenominator: countsTowardCoreDenominator(status),
    salaryBenchmark: null,
    salaryPercentileRank: null,
    isBelowMedian: null,
  }
}

type RowResolution = {
  readonly state: RowState
  readonly derivedBase: Omit<DerivedRecordFields, 'dataQualityFlags'>
}

/**
 * 单行清洗顺序（顺序有依赖，不能随意调整）：
 * 文本 → 城市 / 需求类型 / 渠道 → 推荐类型（依赖渠道）→ 学历 / 学校 / 毕业年份 / GPT（依赖学校）
 * → 日期 → offer 状态 → 拒 offer 原因（依赖状态）→ 薪资 / 房补 → 扩展列 → 派生字段。
 */
function resolveRow(input: {
  readonly sheet: RawSheet
  readonly row: RawRow
  readonly settings: CleaningSettings
  readonly context: RowContext
}): RowResolution {
  const state: RowState = {
    sheet: input.sheet,
    row: input.row,
    settings: input.settings,
    context: input.context,
    values: missingFieldValues(),
    log: [],
    issues: [],
    rowCodes: [],
    ambiguousDateSamples: [],
    ambiguousDateCount: 0,
    cycleTooLongCount: 0,
    negativeCycleCount: 0,
    plannedDateUncertainCount: 0,
    headerEchoCount: 0,
  }
  // 读取阶段对该行的提示（公式无缓存、引号不配对等）原样继承；表头回声由 cleanSheet 带原值上报
  for (const code of input.row.parseNotes) {
    if (code !== 'HEADER_ECHO_CELL') {
      addIssue(state, code)
    }
  }
  applyTextFields(state)
  applyCityField(state)
  applyRequirementTypeField(state)
  applyChannelField(state)
  applyReferralField(state)
  applyEducationField(state)
  applySchoolField(state)
  applyGraduationYearField(state)
  applyGptField(state)
  applyDateFields(state)
  applyOfferStatusField(state)
  applyRejectionReasonField(state)
  applySalaryField(state)
  applyHousingField(state)
  applyExtensionFields(state)
  return { state, derivedBase: applyDerivedFields(state) }
}

/** 单元格文本与任一表头同名 → 该行是表头回声行（默认只提示，可显式剔除） */
function isHeaderEchoRow(row: RawRow, headerTexts: readonly string[]): boolean {
  return row.cells.some((cell) => isHeaderEchoValue(normalizeCellText(cell), headerTexts))
}

/**
 * 这批人工修正是否适用于当前表（用户需求 ①）。
 *
 * 两种「不适用」的情形都必须**一条都不应用**：
 * 1. 修正清单非空但没记表签名（旧数据 / 手改过的设置）——无从判断，宁可不应用；
 * 2. 记了签名但与当前表不一致（换了另一份表）——应用就会把旧修正套到别的数据上。
 */
function correctionsApplyTo(sheet: RawSheet, settings: CleaningSettings): boolean {
  if (settings.manualCorrections.length === 0) {
    return false
  }
  return (
    settings.manualCorrectionsSheetSignature !== null &&
    settings.manualCorrectionsSheetSignature === sheetSignatureOf(sheet)
  )
}

/**
 * 应用一行上的人工修正（用户需求 ①）。
 *
 * ## 为什么跑两遍解析
 *
 * 展开视图要同时给出**自动清洗值**与**人工修正值**（D-091 的五栏要求）。
 * 因此：第一遍 `baseline` 是「规则本来会算出什么」（调用方已算好），
 * 第二遍把源单元格替换成修正值再跑一次同一套解析 → 得到修正后的值、日志与问题码。
 * 重算而不是「只改最终值」，是为了让问题码（例如「日期非法」）跟着消失或出现——
 * 否则徽章会与实际值不符。
 *
 * 只有**被修正的那几行**才会跑第二遍，因此代价与修正条数成正比，不是全表翻倍。
 */
function applyManualCorrections(input: {
  readonly sheet: RawSheet
  readonly row: RawRow
  readonly settings: CleaningSettings
  readonly context: RowContext
  readonly baseline: RowResolution
  readonly corrections: readonly ManualCorrection[]
}): RowResolution & { readonly count: number } {
  const cells = [...input.row.cells]
  /** 每条修正命中的列下标：用于把「原值」还原成用户看到的那一格 */
  const columnIndexes = new Map<ManualCorrection, number>()

  for (const correction of input.corrections) {
    const spec = input.context.fields.get(correction.field)
    const index = spec?.columnIndexes[0]
    if (index === undefined) {
      // 该字段当前映射里不存在（例如这一列被忽略）：跳过，不猜列
      continue
    }
    // 空字符串 = 「改成缺失」；其余原样写入，解析层再按它自己的规则处理
    cells[index] = correction.correctedValue === '' ? null : correction.correctedValue
    columnIndexes.set(correction, index)
  }

  const appliedRow: RawRow = { ...input.row, cells }
  const next = resolveRow({
    sheet: input.sheet,
    row: appliedRow,
    settings: input.settings,
    context: input.context,
  })

  let count = 0
  for (const correction of input.corrections) {
    const index = columnIndexes.get(correction)
    if (index === undefined) {
      continue
    }
    const rawBefore = rawTextOf(input.row.cells[index] ?? null)
    const autoValue = normalizedValueOf(input.baseline.state, correction.field)
    const correctedValue = normalizedValueOf(next.state, correction.field)
    next.state.log.push({
      field: correction.field,
      rawValue: rawBefore,
      normalizedValue: correctedValue,
      rule: 'manual-correction',
      ruleVersion: RULES_VERSION,
      // 已有 `manual`（手工指定）：人工修正正是这个来源，不新造枚举值
      source: 'manual',
      inferred: false,
      // 人工修正本身就是用户明确做过的决定，因此这条日志是「已确认」的
      confirmed: true,
      issueCodes: ['MANUAL_CORRECTION_APPLIED'],
      autoValue,
      reason: correction.reason,
    })
    addIssue(next.state, 'MANUAL_CORRECTION_APPLIED', {
      field: fieldHeader(correction.field),
      rawValue: rawBefore,
      message: `${fieldHeader(correction.field)} 是人工修改的：原值「${
        rawBefore ?? '（缺失）'
      }」→ 修正值「${correctedValue ?? '（缺失）'}」（原因：${correction.reason}）`,
    })
    count += 1
  }

  return { ...next, count }
}

/** 取某个字段在这一次解析里的可读结论（用于「自动清洗值」那一栏） */
function normalizedValueOf(state: RowState, field: StandardFieldKey): string | null {
  const entry = [...state.log].reverse().find((item) => item.field === field)
  return entry?.normalizedValue ?? null
}

/** 已解析完成、等待重复判定与记录组装的行 */
type RowDraft = {
  readonly recordId: string
  readonly sourceRow: number
  readonly cells: readonly RawCellValue[]
  readonly values: ResolvedFieldValues
  readonly log: readonly NormalizationLogEntry[]
  readonly issueCodes: readonly DataQualityIssueCode[]
  readonly derivedBase: Omit<DerivedRecordFields, 'dataQualityFlags'>
}

/** 扩展列取值 → 文本（只用于重复判定；非文本类型不参与身份比较） */
function extensionText(
  extensions: ExtensionFieldValues,
  key: ExtensionFieldKey,
): string | null {
  const value = extensions[key]
  if (value === undefined || value === null || typeof value === 'boolean') {
    return null
  }
  const text = String(value).trim()
  return text === '' ? null : text
}

function toDuplicateCandidate(draft: RowDraft): DuplicateCandidate {
  return {
    recordId: draft.recordId,
    sourceRow: draft.sourceRow,
    cells: draft.cells,
    requirementId: draft.values.requirementId,
    candidateName: draft.values.candidateName,
    recruitmentStartDate: draft.values.recruitmentStartDate,
    offerId: extensionText(draft.values.extensions, 'offerId'),
  }
}

/** 数据集级问题：不挂在某一行上（`sourceRow` 为 null），说明口径或整体处理结果 */
function datasetIssue(
  code: DataQualityIssueCode,
  message: string,
  sourceSheet: string,
): DataQualityIssue {
  return createQualityIssue({ code, message, sourceSheet, sourceRow: null })
}

function decision(
  id: string,
  label: string,
  detail: string,
  confirmed: boolean,
): CleaningDecision {
  return { id, label, detail, ruleVersion: RULES_VERSION, confirmed }
}

/**
 * 决策日志：把「这次清洗用了什么口径、哪些还没确认」写成可读条目，
 * 让用户能撤销（改设置 → 重新计算）与回溯（docs/PRD.md 5.5）。
 */
function buildDecisionLog(input: {
  readonly settings: CleaningSettings
  readonly analysis: DuplicateAnalysis
  readonly emptyRowCount: number
  readonly hiddenRowExcludedCount: number
  readonly droppedRowCount: number
  readonly mappedExtensionCount: number
}): readonly CleaningDecision[] {
  const { settings } = input
  const orderLabel =
    settings.ambiguousDateOrder === null
      ? '未确认'
      : settings.ambiguousDateOrder === 'day-first'
        ? '日/月/年'
        : '月/日/年'
  const entries: CleaningDecision[] = [
    decision(
      'dataAsOf',
      '分析截止日',
      `分析截止日：${settings.dataAsOf}（默认导入当日，可在清洗页修改后重新计算）`,
      true,
    ),
    decision(
      'salary',
      '薪资币种 / 计薪周期',
      `当前口径：${settings.salary.option}；${settings.salary.comparable ? '已确认可比，可参与待遇对比' : '未确认，已禁用待遇对比与低薪标签，金额仍按原值保留'}`,
      settings.salary.confirmedAt !== null,
    ),
    decision(
      'ambiguousDateOrder',
      '歧义日期日月顺序',
      `当前口径：${orderLabel}；未确认时形如 01/02/2026 的写法不转换、只提示`,
      settings.ambiguousDateOrder !== null,
    ),
    decision(
      'dedup',
      '重复处理',
      `${DEDUP_RULES.exact}；当前策略：${settings.dedupStrategy}${settings.dedupConfirmed ? '（已确认）' : '（未确认：重复行保持待确认，样本不减少）'}；本次识别完全重复 ${input.analysis.exactGroups.length} 组、疑似重复 ${input.analysis.suspectedGroups.length} 组`,
      settings.dedupConfirmed,
    ),
    decision('importMode', '导入模式', `导入模式：${settings.importMode}`, true),
    decision(
      'emptyRows',
      '空行处理',
      `已跳过 ${input.emptyRowCount} 行完全空行：跳过不产生记录，也不影响分母`,
      true,
    ),
    decision(
      'hiddenRows',
      '隐藏行处理',
      settings.includeHiddenRows
        ? `包含隐藏行（默认）；本次排除 ${input.hiddenRowExcludedCount} 行隐藏行`
        : `已排除 ${input.hiddenRowExcludedCount} 行隐藏行：统计与原始文件会不一致，请确认`,
      true,
    ),
    decision(
      'headerEcho',
      '表头回声行处理',
      settings.dropHeaderEchoRows
        ? `已剔除 ${input.droppedRowCount} 行表头回声行`
        : `保留表头回声行（默认，只提示）：共发现 ${input.droppedRowCount} 行`,
      settings.dropHeaderEchoRows,
    ),
    decision(
      'gptList',
      'GPT 院校判定',
      settings.gptListMode === 'raw-first'
        ? '原值优先：缺失保持未知，不查本地名单'
        : `原值优先 + 本地名单（${settings.gptList.length} 所）${settings.gptListComplete ? '，名单已声明完整：不在名单可判否' : '，未声明名单完整：不在名单仍为未知'}`,
      settings.gptListMode === 'raw-first' || settings.gptListComplete,
    ),
    decision(
      'schoolAliases',
      '学校别名归一',
      settings.schoolAliases.length === 0
        ? '未配置别名：学校只做写法归一，不做模糊匹配'
        : `已配置 ${settings.schoolAliases.length} 条等价别名（只做写法归一，语义不同的学校不合并）`,
      settings.schoolAliases.length === 0,
    ),
    decision(
      'cycleTooLong',
      '超长周期阈值',
      `周期超过 ${settings.cycleTooLongDays} 天时提示核实，不自动截尾、不删除记录`,
      true,
    ),
  ]
  if (input.mappedExtensionCount > 0) {
    entries.push(
      decision(
        'extensions',
        '扩展列口径',
        `已映射 ${input.mappedExtensionCount} 个扩展列：缺失不产生问题、不影响任何指标；住宿价值等金额类扩展列不折现、不并入现金房补`,
        true,
      ),
    )
  }
  return entries
}

function mergeFlags(
  base: readonly DataQualityIssueCode[],
  extra: readonly DataQualityIssueCode[],
): readonly DataQualityIssueCode[] {
  const merged = [...base]
  for (const code of extra) {
    if (!merged.includes(code)) {
      merged.push(code)
    }
  }
  return merged
}

/**
 * 重复分组 → 问题（每组一条，挂在首行；**不**把姓名等整行内容写进消息，只给分组标识与行号）。
 * 未确认去重时消息必须说明「样本尚未减少」，避免用户误以为重复已被移除。
 */
function pushDuplicateGroupIssue(input: {
  readonly group: DuplicateGroup
  readonly code: DataQualityIssueCode
  readonly sourceSheet: string
  readonly dedupConfirmed: boolean
  readonly issues: DataQualityIssue[]
  readonly flags: Map<string, DataQualityIssueCode[]>
}): void {
  const { group } = input
  const firstRow = group.sourceRows[0] ?? null
  const rows = group.sourceRows.join('、')
  input.issues.push(
    createQualityIssue({
      code: input.code,
      message: `${input.code === 'EXACT_DUPLICATE' ? '完全重复' : '疑似重复'}分组 ${group.groupKey}：第 ${rows} 行原始内容一致；默认建议保留第 ${String(firstRow)} 行${input.dedupConfirmed ? '（已按您的选择处理）' : '，待您确认后才会减少样本'}`,
      sourceSheet: input.sourceSheet,
      sourceRow: firstRow,
    }),
  )
  for (const recordId of group.recordIds) {
    const current = input.flags.get(recordId)
    if (current === undefined) {
      input.flags.set(recordId, [input.code])
    } else if (!current.includes(input.code)) {
      current.push(input.code)
    }
  }
}

/**
 * 清洗主入口：`RawSheet` + 已确认 `ImportMapping` + `CleaningSettings` → `NormalizedDataset`。
 *
 * 顺序固定，每一步的排除都计数并写入质量报告：
 * 空行跳过 → 隐藏行（按设置）→ 表头回声行（按设置）→ 逐行解析 → 重复分析 → 去重策略 → 报告组装。
 * 未确认映射 / 缺 offer 状态列 → 直接抛错，不产出半成品数据集。
 */
export function cleanSheet(input: CleanSheetInput): NormalizedDataset {
  const precondition = cleaningPreconditionError(input.mapping)
  if (precondition !== null) {
    throw new Error(precondition)
  }
  const { sheet, settings } = input
  const context = buildRowContext({ mapping: input.mapping, sheet })
  const createRecordId = input.createRecordId ?? newRecordId

  const datasetIssues: DataQualityIssue[] = [...sheet.issues]
  if (
    sheet.skippedSheets.length > 0 &&
    !datasetIssues.some((issue) => issue.code === 'EMPTY_SHEET_SKIPPED')
  ) {
    datasetIssues.push(
      datasetIssue(
        'EMPTY_SHEET_SKIPPED',
        `已跳过 ${sheet.skippedSheets.length} 个空工作表：空表不产生记录，只提示`,
        sheet.sourceSheet,
      ),
    )
  }

  const drafts: RowDraft[] = []
  const rowIssues: DataQualityIssue[] = []
  const ambiguousDateSamples: string[] = []
  let emptyRowCount = 0
  let hiddenRowExcludedCount = 0
  let headerEchoRowCount = 0
  let droppedRowCount = 0
  let ambiguousDateCount = 0
  let cycleTooLongCount = 0
  let negativeCycleCount = 0
  let plannedDateUncertainCount = 0

  /*
   * 人工修正（用户需求 ①）：只在**表签名一致**时才应用，否则一条都不应用。
   * 索引键是「物理行号 + 字段」——recordId 每次清洗都会换新，不能当键（见 ManualCorrection 注释）。
   */
  const correctionsApplied = correctionsApplyTo(sheet, settings)
  const correctionsByRow = new Map<number, ManualCorrection[]>()
  if (correctionsApplied) {
    for (const correction of settings.manualCorrections) {
      const existing = correctionsByRow.get(correction.sourceRow)
      if (existing === undefined) {
        correctionsByRow.set(correction.sourceRow, [correction])
      } else {
        existing.push(correction)
      }
    }
  }
  let manualCorrectionCount = 0
  const skippedCorrections =
    settings.manualCorrections.length > 0 && !correctionsApplied
      ? settings.manualCorrections.length
      : 0

  for (const row of sheet.rows) {
    if (row.emptyRow) {
      emptyRowCount += 1
      continue
    }
    if (row.hidden && !settings.includeHiddenRows) {
      hiddenRowExcludedCount += 1
      continue
    }
    const headerEcho = isHeaderEchoRow(row, context.headerTexts)
    if (headerEcho) {
      headerEchoRowCount += 1
      if (settings.dropHeaderEchoRows) {
        droppedRowCount += 1
        continue
      }
    }
    const rowCorrections = correctionsByRow.get(row.sourceRow) ?? []
    const baseline = resolveRow({ sheet, row, settings, context })
    let { state, derivedBase } = baseline
    if (rowCorrections.length > 0) {
      const applied = applyManualCorrections({
        sheet,
        row,
        settings,
        context,
        baseline,
        corrections: rowCorrections,
      })
      state = applied.state
      derivedBase = applied.derivedBase
      manualCorrectionCount += applied.count
    }
    if (headerEcho) {
      state.headerEchoCount += 1
      const echoCell =
        row.cells.find((cell) => isHeaderEchoValue(normalizeCellText(cell), context.headerTexts)) ?? null
      const echoText = rawTextOf(echoCell)
      addIssue(state, 'HEADER_ECHO_CELL', {
        rawValue: echoText,
        message: `该行含表头文本残留（${String(echoText)}）：默认保留，请核实是否为重复表头行`,
      })
    }
    ambiguousDateCount += state.ambiguousDateCount
    cycleTooLongCount += state.cycleTooLongCount
    negativeCycleCount += state.negativeCycleCount
    plannedDateUncertainCount += state.plannedDateUncertainCount
    for (const sample of state.ambiguousDateSamples) {
      if (ambiguousDateSamples.length < AMBIGUOUS_DATE_SAMPLE_LIMIT) {
        ambiguousDateSamples.push(sample)
      }
    }
    drafts.push({
      recordId: createRecordId(),
      sourceRow: row.sourceRow,
      cells: row.cells,
      values: state.values,
      log: state.log,
      issueCodes: state.rowCodes,
      derivedBase,
    })
    rowIssues.push(...state.issues)
  }

  const analysis = analyzeDuplicates(drafts.map(toDuplicateCandidate))
  const duplicateFlags = new Map<string, DataQualityIssueCode[]>()
  for (const group of analysis.exactGroups) {
    pushDuplicateGroupIssue({
      group,
      code: 'EXACT_DUPLICATE',
      sourceSheet: sheet.sourceSheet,
      dedupConfirmed: settings.dedupConfirmed,
      issues: rowIssues,
      flags: duplicateFlags,
    })
  }
  for (const group of analysis.suspectedGroups) {
    pushDuplicateGroupIssue({
      group,
      code: 'SUSPECTED_DUPLICATE',
      sourceSheet: sheet.sourceSheet,
      dedupConfirmed: settings.dedupConfirmed,
      issues: rowIssues,
      flags: duplicateFlags,
    })
  }

  const built: readonly NormalizedRecord[] = drafts.map((draft) => {
    const exactGroupKey = analysis.exactGroupKeyByRecordId.get(draft.recordId) ?? null
    const suspectedGroupKey = analysis.suspectedGroupKeyByRecordId.get(draft.recordId) ?? null
    const duplicateKind: DuplicateKind =
      exactGroupKey !== null ? 'exact' : suspectedGroupKey !== null ? 'suspected' : 'none'
    const dedupDecision: DedupDecision = initialDedupDecision({
      duplicateKind,
      duplicateGroupKey: exactGroupKey ?? suspectedGroupKey,
      suspectedKey:
        duplicateKind === 'suspected'
          ? (analysis.suspectedKeyByRecordId.get(draft.recordId) ?? null)
          : null,
    })
    return {
      recordId: draft.recordId,
      datasetId: input.datasetId,
      batchId: input.batchId,
      sourceSheet: sheet.sourceSheet,
      sourceRow: draft.sourceRow,
      values: draft.cells,
      normalizationLog: draft.log,
      dedupDecision,
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      importedAt: input.importedAt,
      dataAsOf: settings.dataAsOf,
      candidateDisplayId: buildDisplayId(draft.recordId),
      ...draft.values,
      derived: {
        ...draft.derivedBase,
        dataQualityFlags: mergeFlags(draft.issueCodes, duplicateFlags.get(draft.recordId) ?? []),
      },
    }
  })

  const deduped = applyDedupStrategy(built, {
    strategy: settings.dedupStrategy,
    confirmed: settings.dedupConfirmed,
  })
  const records = deduped.filter((record) => record.dedupDecision.action !== 'removedAsDuplicate')
  const allIssues: DataQualityIssue[] = [...datasetIssues, ...rowIssues]

  const counts: DatasetCounts = {
    rawRowCount: sheet.rows.length,
    emptyRowCount,
    keptRowCount: records.length,
    removedDuplicateCount: built.length - records.length,
    issueRowCount: new Set(
      allIssues
        .map((issue) => issue.sourceRow)
        .filter((sourceRow): sourceRow is number => sourceRow !== null),
    ).size,
    distinctRequirementCount: new Set(
      records
        .map((record) => record.requirementId)
        .filter((requirementId): requirementId is string => requirementId !== null),
    ).size,
  }

  const notes: string[] = [
    `行数口径：原始行 ${counts.rawRowCount} − 空行 ${counts.emptyRowCount} − 去重移除 ${counts.removedDuplicateCount} = 保留 ${counts.keptRowCount}`,
    '日期只在日期列解析；需求 ID 等文本列永不按数字或日期解析，前导 0 保留',
    '缺失一律记 null：不用 0 冒充、住宿不折现、未知 ≠ 否',
    `名单覆盖需求数 ${counts.distinctRequirementCount}：只统计本数据集非空需求 ID，不等于公司全部在招需求`,
  ]
  if (ambiguousDateCount > 0) {
    notes.push(
      `存在 ${ambiguousDateCount} 个日月歧义日期：未确认日月顺序前不转换，只提示（样例：${ambiguousDateSamples.join('、')}）`,
    )
  }
  if (plannedDateUncertainCount > 0) {
    notes.push(`待入职记录的「入职时间」按计划日期使用（${plannedDateUncertainCount} 条）：只参与计划周期，实际周期仍为未知`)
  }
  if (sheet.hiddenColumnIndexes.length > 0) {
    notes.push(`源表含 ${sheet.hiddenColumnIndexes.length} 个隐藏列：列数据不排除，只提示`)
  }
  if (sheet.sheetHidden) {
    notes.push('该工作表本身处于隐藏状态：仍按设置读取，不因隐藏而静默排除')
  }
  if (settings.salary.comparable) {
    notes.push(`薪资口径：${settings.salary.option}（已确认可比）`)
  } else {
    notes.push(`薪资口径：${settings.salary.option}（未确认）：金额按原值保留，但禁用待遇对比与低薪标签`)
  }
  /*
   * 人工修正必须出现在报告说明里（用户需求 ①，D-091）：
   * 读报告的人有权知道「哪几处不是规则算出来的」。**同时**说明未应用的那部分，
   * 否则「我明明改过」与「报告里没有」会变成一场无法解释的争执。
   */
  if (manualCorrectionCount > 0) {
    notes.push(
      `本数据集含 ${manualCorrectionCount} 处人工修改：这些格的值由用户手动指定（展开该行可见「原值 / 自动清洗值 / 修正值 / 原因 / 时间」五栏），不是规则算出来的`,
    )
  }
  if (skippedCorrections > 0) {
    notes.push(
      `有 ${skippedCorrections} 处人工修改没有应用：它们记录的源表与当前这份表不一致（表签名不同），因此一条都没有套用`,
    )
  }

  const report: CleaningReport = {
    counts,
    issues: allIssues,
    issueCountsByCode: countIssuesByCode(allIssues),
    issueCountsBySeverity: summarizeIssues(allIssues),
    exactDuplicateGroups: analysis.exactGroups,
    suspectedDuplicateGroups: analysis.suspectedGroups,
    duplicateRowCount: analysis.exactRowCount + analysis.suspectedRowCount,
    ambiguousDateCount,
    ambiguousDateSamples,
    cycleTooLongCount,
    negativeCycleCount,
    headerEchoRowCount,
    droppedRowCount,
    hiddenRowExcludedCount,
    metricAvailability: buildMetricAvailability({
      records,
      issues: allIssues,
      counts,
      salary: settings.salary,
    }),
    decisionLog: buildDecisionLog({
      settings,
      analysis,
      emptyRowCount,
      hiddenRowExcludedCount,
      droppedRowCount,
      mappedExtensionCount: context.extensions.size,
    }),
    notes,
  }

  const metadata: DatasetMetadata = {
    datasetId: input.datasetId,
    datasetName: input.datasetName,
    batchId: input.batchId,
    // 规则版本 = 语义基线 + 本次**配置摘要**（步骤12）：改了名单 / 别名 / 去重策略就会换版本，
    // 而旧数据集保存的是它们当时那份摘要，所以「旧报告不因新名单改变」可被核对。
    ruleVersion: {
      ...CURRENT_RULE_VERSION,
      configRevision: buildConfigRevision(settings),
    },
    sourceKind: sheet.sourceKind,
    sourceFileName: sheet.sourceFileName,
    sourceSheet: sheet.sourceSheet,
    headerRowIndex: sheet.header.sourceRow,
    encoding: sheet.encoding,
    importedAt: input.importedAt,
    dataAsOf: settings.dataAsOf,
    importMode: settings.importMode,
    dedupStrategy: settings.dedupStrategy,
    salary: settings.salary,
    counts,
    disabledModules: disabledModulesFor(allIssues),
    // 完整设置快照：让界面能在改动前把「当前草稿」与「已提交设置」做差并展示影响（步骤12）。
    // 只存设置本身（用户自己填的口径），不含任何单元格内容 / 姓名 / 薪资原值。
    cleaningSettings: settings,
    notes,
  }

  return { metadata, records, report }
}









