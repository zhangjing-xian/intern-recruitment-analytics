/**
 * 取值映射配置与纯函数解析器（docs/PRD.md 0.2「取值映射建议」、4.3「字段映射机制」、
 * 5.1「解析与类型」、5.3「状态与单位」）。
 *
 * 分工与边界：
 * - 本文件只做「字典 / 明确写法 / 别名」级别的映射，结果可解释、可回溯、可撤销；
 * - **不做**模糊匹配（步骤4）、不做 Excel 日期序列换算与去重（步骤5）、
 *   不推断薪资币种与计薪周期（必须由用户在导入页确认）；
 * - 凡属「建议」的规则一律 `requiresConfirmation = true`，未确认前不得写回正式数据；
 * - 未识别的原值一律保留（`*Raw` 字段）并提示，绝不静默归入某个业务值。
 */

import {
  BOSS_CHANNEL,
  HOUSING_ACCOMMODATION,
  HOUSING_CASH,
  HOUSING_NO_SUBSIDY,
  OTHER,
  TARGET_CITIES,
  UNKNOWN,
  UNSPLIT_REQUIREMENT_TYPE,
  type Channel,
  type City,
  type Currency,
  type Education,
  type HousingPeriod,
  type HousingType,
  type OfferStatus,
  type ReferralType,
  type RequirementType,
  type SalaryUnit,
  type SalaryUnitOption,
  type TargetCity,
  type TriState,
} from './enums'
import { isValidGraduationYear, normalizeHeader } from './fields'
import type { DataQualityIssueCode } from './quality'
import type { RawCellValue, SalarySetting, ValueSource } from './types'

/** 所有解析器共用的元信息：命中规则、是否需确认、结论来源与触发的问题代码 */
export type ResolutionMeta = {
  /** 命中的规则键，例如 `status.已送审批`；未命中为 `status.unrecognized` */
  readonly rule: string
  /** 是否需要用户确认后才生效（建议类规则一律 true） */
  readonly requiresConfirmation: boolean
  readonly source: ValueSource
  readonly issueCodes: readonly DataQualityIssueCode[]
}

const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g
const WHITESPACE_PATTERN = /\s+/g

/**
 * 单元格文本规范化：null → ''；布尔 → 'true' / 'false'；数字保持原样字符串
 * （**不**做隐式数值转换，Excel 日期序列留给步骤5 按 1900 / 1904 系统处理）。
 */
export function normalizeCellText(raw: RawCellValue): string {
  if (raw === null) {
    return ''
  }
  if (typeof raw === 'boolean') {
    return raw ? 'true' : 'false'
  }
  const text = typeof raw === 'number' ? String(raw) : raw
  return text
    .replace(ZERO_WIDTH_PATTERN, '')
    .normalize('NFKC')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
}

/** 按缺失处理的占位符（docs/PRD.md 5.1：空白、`-`、`N/A`）。注意「无」对房补是有效值，不在此列 */
export const NULL_TOKENS: readonly string[] = ['', '-', '--', '—', 'N/A', 'NA', 'null', '无数据']

const NULL_TOKEN_SET: ReadonlySet<string> = new Set(
  NULL_TOKENS.map((token) => token.toLowerCase()),
)

export function isNullToken(text: string): boolean {
  return NULL_TOKEN_SET.has(text.toLowerCase())
}

/** 单元格文本与任一表头同名 → 判为表头残留行（docs/PRD.md 0.1），按无法识别处理 */
export function isHeaderEchoValue(text: string, headers: readonly string[] = []): boolean {
  if (text === '') {
    return false
  }
  const normalized = normalizeHeader(text)
  return headers.some((header) => normalizeHeader(header) === normalized)
}

/* ------------------------------------------------------------------ 城市 */

export type CityMappingRule = {
  readonly match: string
  readonly city: City
  readonly kind: 'exact' | 'alias'
  readonly requiresConfirmation: boolean
  readonly note: string
}

/** 城市精确值 + 已记录的园区 / 区域别名（别名归并必须由用户在预览中确认，不静默归并） */
export const CITY_MAPPING_RULES: readonly CityMappingRule[] = [
  { match: '上海', city: '上海', kind: 'exact', requiresConfirmation: false, note: '标准值' },
  { match: '广州', city: '广州', kind: 'exact', requiresConfirmation: false, note: '标准值' },
  { match: '杭州', city: '杭州', kind: 'exact', requiresConfirmation: false, note: '标准值' },
  {
    match: '上海青浦',
    city: '上海',
    kind: 'alias',
    requiresConfirmation: true,
    note: '园区 / 区域别名，需在预览中确认，原始地区保留在 cityRaw',
  },
  {
    match: '广州网易大厦',
    city: '广州',
    kind: 'alias',
    requiresConfirmation: true,
    note: '园区 / 区域别名，需在预览中确认，保留园区信息',
  },
  {
    match: '杭州二园区',
    city: '杭州',
    kind: 'alias',
    requiresConfirmation: true,
    note: '园区 / 区域别名，需在预览中确认',
  },
]

const CITY_RULE_BY_KEY = new Map<string, CityMappingRule>(
  CITY_MAPPING_RULES.map((rule) => [normalizeHeader(rule.match), rule]),
)

/** 前缀兜底建议（如「上海（浦东）」）；只给建议，必须用户确认后生效 */
export const CITY_PREFIX_SUGGESTIONS: readonly TargetCity[] = TARGET_CITIES

export type CityResolution = ResolutionMeta & {
  readonly city: City
  /** 城市原值；缺失时为 null */
  readonly cityRaw: string | null
}

export function resolveCity(raw: RawCellValue): CityResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      city: UNKNOWN,
      cityRaw: null,
      rule: 'city.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const rule = CITY_RULE_BY_KEY.get(normalizeHeader(text))
  if (rule !== undefined) {
    return {
      city: rule.city,
      cityRaw: text,
      rule: `city.${rule.match}`,
      requiresConfirmation: rule.requiresConfirmation,
      source: rule.kind === 'alias' ? 'aliasTable' : 'raw',
      issueCodes: [],
    }
  }

  const prefixCity = CITY_PREFIX_SUGGESTIONS.find((city) => text.startsWith(city))
  if (prefixCity !== undefined) {
    return {
      city: prefixCity,
      cityRaw: text,
      rule: 'city.prefix',
      requiresConfirmation: true,
      source: 'aliasTable',
      issueCodes: [],
    }
  }

  return {
    city: OTHER,
    cityRaw: text,
    rule: 'city.unrecognized',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['UNKNOWN_ENUM_VALUE'],
  }
}

/* ------------------------------------------------------------------ offer 状态 */

export type StatusMappingRule = {
  readonly match: string
  readonly status: OfferStatus
  readonly requiresConfirmation: boolean
  readonly note: string
}

/**
 * 状态字典（docs/PRD.md 0.2 / 5.3）：
 * - 「已送审批」按明确口径归 `offer审批中`，**不得**当作待入职；
 * - 离职 / 撤回 / 取消等进入「其他」并保留原值；
 * - 「审批通过」**不在**字典内：审批通过不等于候选人接受，按未识别处理并提示核实。
 */
export const OFFER_STATUS_RULES: readonly StatusMappingRule[] = [
  { match: '已入职', status: '已入职', requiresConfirmation: false, note: '标准值' },
  { match: '待入职', status: '待入职', requiresConfirmation: false, note: '标准值' },
  { match: 'offer审批中', status: 'offer审批中', requiresConfirmation: false, note: '标准值' },
  { match: 'offer 审批中', status: 'offer审批中', requiresConfirmation: false, note: '同义写法' },
  { match: '审批中', status: 'offer审批中', requiresConfirmation: false, note: '同义写法' },
  {
    match: '已送审批',
    status: 'offer审批中',
    requiresConfirmation: false,
    note: 'PRD 0.2 指定映射，绝不能映射为待入职',
  },
  { match: '拒绝offer', status: '拒绝offer', requiresConfirmation: false, note: '标准值' },
  { match: '拒绝 offer', status: '拒绝offer', requiresConfirmation: false, note: '同义写法' },
  { match: '拒绝口头offer', status: '拒绝口头offer', requiresConfirmation: false, note: '标准值' },
  { match: '拒绝口头 offer', status: '拒绝口头offer', requiresConfirmation: false, note: '同义写法' },
  { match: '拒绝口头Offer', status: '拒绝口头offer', requiresConfirmation: false, note: '同义写法' },
  { match: '其他', status: OTHER, requiresConfirmation: false, note: '标准值' },
  { match: '未知', status: UNKNOWN, requiresConfirmation: false, note: '标准值' },
  {
    match: '离职',
    status: OTHER,
    requiresConfirmation: false,
    note: 'PRD 5.3：离职 / 撤回 / 取消等进入「其他」并保留原值',
  },
  { match: '已离职', status: OTHER, requiresConfirmation: false, note: '同义写法' },
  { match: '撤回', status: OTHER, requiresConfirmation: false, note: '同义写法' },
  { match: '已撤回', status: OTHER, requiresConfirmation: false, note: '同义写法' },
  { match: '取消', status: OTHER, requiresConfirmation: false, note: '同义写法' },
  { match: '取消入职', status: OTHER, requiresConfirmation: false, note: '同义写法' },
]

const STATUS_RULE_BY_KEY = new Map<string, StatusMappingRule>(
  OFFER_STATUS_RULES.map((rule) => [normalizeHeader(rule.match), rule]),
)

export type StatusResolution = ResolutionMeta & {
  readonly offerStatus: OfferStatus
  /** 状态原值；缺失时为 null（保留原值用于回溯与人工核实） */
  readonly offerStatusRaw: string | null
}

/**
 * 解析 offer 状态。`headers` 用于识别表头残留单元格（附件第 2 行的同名字段行）。
 * 未识别的非空值统一归 `未知` 并提示核实：其他 / 未知都不进入核心分母 D，不会污染核心率。
 */
export function resolveOfferStatus(
  raw: RawCellValue,
  headers: readonly string[] = [],
): StatusResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      offerStatus: UNKNOWN,
      offerStatusRaw: null,
      rule: 'status.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  if (isHeaderEchoValue(text, headers)) {
    return {
      offerStatus: UNKNOWN,
      offerStatusRaw: text,
      rule: 'status.headerEcho',
      requiresConfirmation: true,
      source: 'unknown',
      issueCodes: ['HEADER_ECHO_CELL'],
    }
  }

  const rule = STATUS_RULE_BY_KEY.get(normalizeHeader(text))
  if (rule !== undefined) {
    return {
      offerStatus: rule.status,
      offerStatusRaw: text,
      rule: `status.${rule.match}`,
      requiresConfirmation: rule.requiresConfirmation,
      source: 'aliasTable',
      issueCodes: [],
    }
  }

  return {
    offerStatus: UNKNOWN,
    offerStatusRaw: text,
    rule: 'status.unrecognized',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['UNKNOWN_ENUM_VALUE'],
  }
}

/* ------------------------------------------------------------------ 渠道 */

export type ChannelMappingRule = {
  readonly match: string
  readonly channel: Channel
  readonly note: string
}

/** 渠道字典（可扩展）：大小写统一为 `Boss`；`-` 等占位符归未知，**不**自动判为内推 */
export const CHANNEL_MAPPING_RULES: readonly ChannelMappingRule[] = [
  { match: '官网', channel: '官网', note: '标准值' },
  { match: 'boss', channel: BOSS_CHANNEL, note: '大小写统一为 Boss（PRD 0.2）' },
  { match: '实习僧', channel: '实习僧', note: '标准值' },
  { match: '内推', channel: '内推', note: '标准值' },
  { match: '其他', channel: OTHER, note: '标准值' },
  { match: '未知', channel: UNKNOWN, note: '标准值' },
]

const CHANNEL_RULE_BY_KEY = new Map<string, ChannelMappingRule>(
  CHANNEL_MAPPING_RULES.map((rule) => [normalizeHeader(rule.match), rule]),
)

export type ChannelResolution = ResolutionMeta & {
  readonly channel: Channel
  readonly channelRaw: string | null
}

export function resolveChannel(raw: RawCellValue): ChannelResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      channel: UNKNOWN,
      channelRaw: null,
      rule: 'channel.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const rule = CHANNEL_RULE_BY_KEY.get(normalizeHeader(text))
  if (rule !== undefined) {
    return {
      channel: rule.channel,
      channelRaw: text,
      rule: `channel.${rule.channel}`,
      requiresConfirmation: false,
      source: 'aliasTable',
      issueCodes: [],
    }
  }

  return {
    channel: OTHER,
    channelRaw: text,
    rule: 'channel.unrecognized',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['UNKNOWN_ENUM_VALUE'],
  }
}

/* ------------------------------------------------------------------ 推荐类型 */

/** 「XX推」后缀：可建议为 `HR推`（确认后生效），**不**泛化到其他写法 */
export const REFERRAL_HR_SUFFIX_PATTERN = /推$/

/** 渠道为 `-` 但有推荐人时，可选的「推断为内推」开关（默认关闭，开启后来源标记为推断） */
export const CHANNEL_FROM_REFERRER_INFERENCE = {
  id: 'channel-from-referrer',
  label: '渠道缺失但有推荐人时推断为内推',
  defaultEnabled: false,
  requiresConfirmation: true,
  note: '开启后新增结论来源为「推断」的渠道值，原缺失仍保留并可随时撤销',
} as const

export type ReferralResolution = ResolutionMeta & {
  readonly referralType: ReferralType
  /** 是否需要展示「待核实」提示（如渠道为内推但推荐类型未知） */
  readonly needsReview: boolean
}

/**
 * 从「简历推荐人」原文派生推荐类型。
 * 只认「内推」「HR推」与「XX推」后缀；任意人名一律为未知，**不**因渠道为内推就自动判定。
 */
export function resolveReferralType(
  raw: RawCellValue,
  channel: Channel = UNKNOWN,
): ReferralResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      referralType: UNKNOWN,
      rule: 'referral.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
      needsReview: false,
    }
  }
  if (text === '内推') {
    return {
      referralType: '内推',
      rule: 'referral.内推',
      requiresConfirmation: false,
      source: 'aliasTable',
      issueCodes: [],
      needsReview: false,
    }
  }
  if (text === 'HR推') {
    return {
      referralType: 'HR推',
      rule: 'referral.HR推',
      requiresConfirmation: false,
      source: 'aliasTable',
      issueCodes: [],
      needsReview: false,
    }
  }
  if (REFERRAL_HR_SUFFIX_PATTERN.test(text)) {
    return {
      referralType: 'HR推',
      rule: 'referral.hrSuffix',
      requiresConfirmation: true,
      source: 'derived',
      issueCodes: [],
      needsReview: true,
    }
  }
  return {
    referralType: UNKNOWN,
    rule: 'referral.unrecognized',
    requiresConfirmation: false,
    source: 'unknown',
    issueCodes: [],
    needsReview: channel === '内推',
  }
}

/* ------------------------------------------------------------------ 房补 */

/** 金额写法：`1000`、`1,000`、`1000.5`；只取原文第一个数字，**不**做单位换算 */
export const AMOUNT_PATTERN = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/

/** 表示「无补贴」的写法（注意：`无` 是有效值，只有整格缺失才算未知） */
export const HOUSING_NO_SUBSIDY_PATTERN = /无|没有/

/** 表示「提供住宿」的写法：一律不折算为现金（docs/PRD.md 5.1） */
export const HOUSING_ACCOMMODATION_PATTERN = /住宿|宿舍|公寓/

/** 表示现金金额的写法：出现金额单位或符号 */
export const HOUSING_CASH_PATTERN = /元|¥|￥|RMB|人民币/

export type HousingPeriodRule = {
  readonly match: string
  readonly period: HousingPeriod
}

/** 房补周期关键字（只认原文中显式写出的周期，不换算；取值集合见 enums.HOUSING_PERIODS） */
export const HOUSING_PERIOD_KEYWORD_RULES: readonly HousingPeriodRule[] = [
  { match: '月', period: '月' },
  { match: '天', period: '天' },
  { match: '日', period: '天' },
  { match: '次', period: '次' },
]

/** 无补贴原因的展示标签；只作标签，**不**当作户籍证据 */
export const HOUSING_REASON_LABELS = {
  localSchool: '本地院校',
  nonLocal: '非本地 / 外地',
} as const

export function extractAmount(text: string): number | null {
  const matched = AMOUNT_PATTERN.exec(text)
  if (matched === null) {
    return null
  }
  const plain = matched[1].replace(/,/g, '')
  const value = Number(matched[2] === undefined ? plain : `${plain}.${matched[2]}`)
  return Number.isFinite(value) ? value : null
}

export function extractHousingPeriod(text: string): HousingPeriod | null {
  const rule = HOUSING_PERIOD_KEYWORD_RULES.find((candidate) => text.includes(candidate.match))
  return rule === undefined ? null : rule.period
}

export type HousingResolution = ResolutionMeta & {
  readonly housingType: HousingType
  /** 现金房补金额；住宿 / 未知为 null（不折现，docs/PRD.md 5.1） */
  readonly housingAmount: number | null
  readonly housingPeriod: HousingPeriod | null
  readonly housingReason: string | null
}

/**
 * 解析房补原文（`房补` 列）。判定顺序与口径：
 * 1. `无 / 没有`（且不含住宿类写法）→ 无补贴，金额按 **0**（唯一允许为 0 的情形）；
 *    原文含「本地 / 外地」时保留原因标签，但**不**当作户籍证据；
 * 2. `住宿 / 宿舍 / 公寓` → 提供住宿，金额 null（不折现）；同时出现金额时按最保守处理并提示确认；
 * 3. 出现金额单位 → 现金房补，取原文第一个数字，不做单位或周期换算；
 * 4. 其他非空原文 → 未知（保留原文并提示），**不**当作无补贴；
 * 5. 空 / 占位符 → 未知，金额 null。
 */
export function resolveHousing(raw: RawCellValue): HousingResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      housingType: UNKNOWN,
      housingAmount: null,
      housingPeriod: null,
      housingReason: null,
      rule: 'housing.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const period = extractHousingPeriod(text)

  if (HOUSING_NO_SUBSIDY_PATTERN.test(text) && !HOUSING_ACCOMMODATION_PATTERN.test(text)) {
    return {
      housingType: HOUSING_NO_SUBSIDY,
      housingAmount: 0,
      housingPeriod: null,
      housingReason: text.includes('本地')
        ? HOUSING_REASON_LABELS.localSchool
        : text.includes('外地')
          ? HOUSING_REASON_LABELS.nonLocal
          : null,
      rule: 'housing.noSubsidy',
      requiresConfirmation: false,
      source: 'aliasTable',
      issueCodes: [],
    }
  }

  if (HOUSING_ACCOMMODATION_PATTERN.test(text)) {
    const conflict = HOUSING_CASH_PATTERN.test(text)
    return {
      housingType: HOUSING_ACCOMMODATION,
      // 保守口径：住宿不折现，即使原文带金额也保持 null，交由用户判断
      housingAmount: null,
      housingPeriod: period,
      housingReason: null,
      rule: conflict ? 'housing.accommodationCashConflict' : 'housing.accommodation',
      requiresConfirmation: conflict,
      source: 'aliasTable',
      issueCodes: conflict ? ['HOUSING_VALUE_UNCERTAIN'] : [],
    }
  }

  if (HOUSING_CASH_PATTERN.test(text)) {
    const amount = extractAmount(text)
    return {
      housingType: HOUSING_CASH,
      housingAmount: amount,
      housingPeriod: period,
      housingReason: null,
      rule: amount === null ? 'housing.cashAmountUnparsed' : 'housing.cash',
      requiresConfirmation: amount === null,
      source: 'aliasTable',
      issueCodes: amount === null ? ['INVALID_SALARY'] : [],
    }
  }

  return {
    housingType: UNKNOWN,
    housingAmount: null,
    housingPeriod: period,
    housingReason: null,
    rule: 'housing.unrecognized',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['UNKNOWN_ENUM_VALUE'],
  }
}

/* ------------------------------------------------------------------ 三值（是否GPT院校） */

export type TriStateMappingRule = {
  readonly match: string
  readonly value: boolean
}

/** 三值字典：只认明确的是 / 否写法；**不**默认否（否则会把未知算进分母） */
export const TRI_STATE_MAPPING_RULES: readonly TriStateMappingRule[] = [
  { match: '是', value: true },
  { match: 'y', value: true },
  { match: 'yes', value: true },
  { match: 'true', value: true },
  { match: '1', value: true },
  { match: '否', value: false },
  { match: 'n', value: false },
  { match: 'no', value: false },
  { match: 'false', value: false },
  { match: '0', value: false },
]

const TRI_STATE_RULE_BY_KEY = new Map<string, TriStateMappingRule>(
  TRI_STATE_MAPPING_RULES.map((rule) => [normalizeHeader(rule.match), rule]),
)

export type TriStateResolution = ResolutionMeta & {
  readonly value: TriState
}

export function resolveTriState(raw: RawCellValue): TriStateResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      value: null,
      rule: 'tristate.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const rule = TRI_STATE_RULE_BY_KEY.get(normalizeHeader(text))
  if (rule !== undefined) {
    return {
      value: rule.value,
      rule: `tristate.${rule.match}`,
      requiresConfirmation: false,
      source: 'aliasTable',
      issueCodes: [],
    }
  }

  return {
    value: null,
    rule: 'tristate.unrecognized',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['UNKNOWN_ENUM_VALUE'],
  }
}

/* ------------------------------------------------------------------ 需求类型 */

export type RequirementTypeMappingRule = {
  readonly match: string
  readonly requirementType: RequirementType
  readonly requiresConfirmation: boolean
  readonly note: string
}

/** 需求类型字典（取值集合见 docs/PRD.md 4.1）：`替补/替换` 保留未拆分枚举，**不**自动猜测拆分 */
export const REQUIREMENT_TYPE_MAPPING_RULES: readonly RequirementTypeMappingRule[] = [
  { match: '新增招聘', requirementType: '新增招聘', requiresConfirmation: false, note: '标准值' },
  { match: '新增', requirementType: '新增招聘', requiresConfirmation: false, note: '同义写法' },
  { match: '替补', requirementType: '替补', requiresConfirmation: false, note: '标准值' },
  { match: '替换', requirementType: '替换', requiresConfirmation: false, note: '标准值' },
  { match: '其他', requirementType: OTHER, requiresConfirmation: false, note: '标准值' },
  { match: '未知', requirementType: UNKNOWN, requiresConfirmation: false, note: '标准值' },
  {
    match: '替补/替换',
    requirementType: UNSPLIT_REQUIREMENT_TYPE,
    requiresConfirmation: false,
    note: '同一单元格写两种类型，保留未拆分枚举，不做猜测拆分',
  },
  {
    match: '替补替换',
    requirementType: UNSPLIT_REQUIREMENT_TYPE,
    requiresConfirmation: false,
    note: '同义写法',
  },
  {
    match: '替补替换未拆分',
    requirementType: UNSPLIT_REQUIREMENT_TYPE,
    requiresConfirmation: false,
    note: '标准值',
  },
]

const REQUIREMENT_TYPE_RULE_BY_KEY = new Map<string, RequirementTypeMappingRule>(
  REQUIREMENT_TYPE_MAPPING_RULES.map((rule) => [normalizeHeader(rule.match), rule]),
)

export type RequirementTypeResolution = ResolutionMeta & {
  readonly requirementType: RequirementType
}

export function resolveRequirementType(raw: RawCellValue): RequirementTypeResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      requirementType: UNKNOWN,
      rule: 'requirementType.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const rule = REQUIREMENT_TYPE_RULE_BY_KEY.get(normalizeHeader(text))
  if (rule !== undefined) {
    return {
      requirementType: rule.requirementType,
      rule: `requirementType.${rule.match}`,
      requiresConfirmation: rule.requiresConfirmation,
      source: 'aliasTable',
      issueCodes: [],
    }
  }

  return {
    requirementType: UNKNOWN,
    rule: 'requirementType.unrecognized',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['UNKNOWN_ENUM_VALUE'],
  }
}

/* ------------------------------------------------------------------ 学历 */

export type EducationMappingRule = {
  readonly match: string
  readonly education: Education
  readonly note: string
}

/** 学历字典：只映射「学历」；`学位`（学士 / 硕士）明确不得自动映射为学历（docs/PRD.md 4.3） */
export const EDUCATION_MAPPING_RULES: readonly EducationMappingRule[] = [
  { match: '专科', education: '专科', note: '标准值' },
  { match: '大专', education: '专科', note: '同义写法' },
  { match: '本科', education: '本科', note: '标准值' },
  { match: '硕士', education: '硕士', note: '标准值' },
  { match: '研究生', education: '硕士', note: '同义写法，需用户确认后生效' },
  { match: '博士', education: '博士', note: '标准值' },
  { match: '其他', education: OTHER, note: '标准值' },
  { match: '未知', education: UNKNOWN, note: '标准值' },
]

const EDUCATION_RULE_BY_KEY = new Map<string, EducationMappingRule>(
  EDUCATION_MAPPING_RULES.map((rule) => [normalizeHeader(rule.match), rule]),
)

export type EducationResolution = ResolutionMeta & {
  readonly education: Education
}

export function resolveEducation(raw: RawCellValue): EducationResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      education: UNKNOWN,
      rule: 'education.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const rule = EDUCATION_RULE_BY_KEY.get(normalizeHeader(text))
  if (rule !== undefined) {
    return {
      education: rule.education,
      rule: `education.${rule.match}`,
      requiresConfirmation: rule.education !== text,
      source: 'aliasTable',
      issueCodes: [],
    }
  }

  return {
    education: UNKNOWN,
    rule: 'education.unrecognized',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['UNKNOWN_ENUM_VALUE'],
  }
}

/* ------------------------------------------------------------------ 薪资 */

/** 区间写法：`100~200`、`100-200`、`100至200`；**不**取中点（必须用户确认） */
export const SALARY_RANGE_PATTERN = /(\d[\d,]*(?:\.\d+)?)\s*[~～\-—－至到]\s*(\d[\d,]*(?:\.\d+)?)/

export type SalaryAmountResolution = ResolutionMeta & {
  /** 单一数值金额；区间 / 无法解析 / 缺失 → null（绝不用 0 代替） */
  readonly salaryAmount: number | null
  readonly rawText: string | null
}

/**
 * 解析薪资单元格。铁律：
 * - 只解析**数值**，币种与计薪周期一律不推断，必须由用户在导入页确认（docs/PRD.md 5.3）；
 * - 区间值不取中点，保持 null 并要求确认；
 * - 负数 / 非法值 / 无法解析 → null + `INVALID_SALARY`（警告级，不阻断导入）；
 * - 空 / 占位符 → null（未知 ≠ 0）。
 */
export function resolveSalaryAmount(raw: RawCellValue): SalaryAmountResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      salaryAmount: null,
      rawText: null,
      rule: 'salary.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const range = SALARY_RANGE_PATTERN.exec(text)
  if (range !== null) {
    return {
      salaryAmount: null,
      rawText: text,
      rule: 'salary.rangeUnconfirmed',
      requiresConfirmation: true,
      source: 'unknown',
      issueCodes: ['VALUE_RANGE_UNCERTAIN'],
    }
  }

  if (/-/.test(text)) {
    return {
      salaryAmount: null,
      rawText: text,
      rule: 'salary.negativeOrUnparsed',
      requiresConfirmation: true,
      source: 'unknown',
      issueCodes: ['INVALID_SALARY'],
    }
  }

  const amount = extractAmount(text)
  if (amount === null) {
    return {
      salaryAmount: null,
      rawText: text,
      rule: 'salary.unparsed',
      requiresConfirmation: true,
      source: 'unknown',
      issueCodes: ['INVALID_SALARY'],
    }
  }

  return {
    salaryAmount: amount,
    rawText: text,
    rule: 'salary.number',
    requiresConfirmation: false,
    source: 'raw',
    issueCodes: [],
  }
}

/* ------------------------------------------------------------------ 毕业年级 */

export const GRADUATION_YEAR_PATTERN = /(\d{4})/

export type GraduationYearResolution = ResolutionMeta & {
  readonly graduationYear: number | null
}

/** 毕业年级：只接受原文中的四位年份；两位写法一律不猜测（`25` 可能是 2025，也可能是 1925） */
export function resolveGraduationYear(raw: RawCellValue): GraduationYearResolution {
  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return {
      graduationYear: null,
      rule: 'year.missing',
      requiresConfirmation: false,
      source: 'raw',
      issueCodes: [],
    }
  }

  const matched = GRADUATION_YEAR_PATTERN.exec(text)
  if (matched !== null && isValidGraduationYear(Number(matched[1]))) {
    const year = matched[1]
    return {
      graduationYear: Number(year),
      rule: 'year.fourDigit',
      requiresConfirmation: text !== year,
      source: 'raw',
      issueCodes: [],
    }
  }

  return {
    graduationYear: null,
    rule: matched === null ? 'year.unparsed' : 'year.outOfRange',
    requiresConfirmation: true,
    source: 'unknown',
    issueCodes: ['VALUE_RANGE_UNCERTAIN'],
  }
}

/* ------------------------------------------------------------------ 计薪口径选项 */

export type SalaryUnitOptionDefinition = {
  readonly option: SalaryUnitOption
  readonly currency: Currency | null
  readonly salaryUnit: SalaryUnit | null
  /** 是否可做待遇对比与低薪标签（`其他 / 暂不确定` 为 false） */
  readonly comparable: boolean
  readonly note: string
}

/** 计薪口径选项（docs/PRD.md 5.3）：未确认或选择「其他 / 暂不确定」时禁用待遇对比与低薪标签 */
export const SALARY_UNIT_OPTION_DEFS: readonly SalaryUnitOptionDefinition[] = [
  {
    option: '人民币元/月',
    currency: 'CNY',
    salaryUnit: '元/月',
    comparable: true,
    note: '默认值（用户反馈 ①，2026-09-27 起）：只给币种与计薪周期取值，不做任何换算',
  },
  {
    option: '人民币元/天',
    currency: 'CNY',
    salaryUnit: '元/天',
    comparable: true,
    note: '按天计酬；与月薪不得直接聚合',
  },
  {
    option: OTHER,
    currency: OTHER,
    salaryUnit: OTHER,
    comparable: false,
    note: '其他币种 / 周期：每条记录保留原单位分别展示，不做聚合对比',
  },
  {
    option: '暂不确定',
    currency: null,
    salaryUnit: null,
    comparable: false,
    note: '禁用待遇对比与低薪风险标签，只展示未确认原值概况',
  },
]

const SALARY_UNIT_OPTION_BY_KEY = new Map<SalaryUnitOption, SalaryUnitOptionDefinition>(
  SALARY_UNIT_OPTION_DEFS.map((definition) => [definition.option, definition]),
)

export function getSalaryUnitOption(option: SalaryUnitOption): SalaryUnitOptionDefinition {
  const definition = SALARY_UNIT_OPTION_BY_KEY.get(option)
  if (definition === undefined) {
    throw new Error(`未登记的计薪口径选项：${option}`)
  }
  return definition
}

/** 把用户的计薪口径选择固化为可持久化的 `SalarySetting`（保留确认时间，便于报告标注） */
export function buildSalarySetting(
  option: SalaryUnitOption,
  confirmedAt: string | null = null,
): SalarySetting {
  const definition = getSalaryUnitOption(option)
  return {
    option: definition.option,
    currency: definition.currency,
    salaryUnit: definition.salaryUnit,
    comparable: definition.comparable,
    confirmedAt,
  }
}