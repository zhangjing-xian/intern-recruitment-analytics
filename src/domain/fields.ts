/**
 * 标准字段定义（docs/PRD.md 4.1「标准字段」、4.3「字段映射机制」、15.5「建议补充字段」）。
 *
 * 21 列标准字段：
 * - 顺序严格等于 PRD 4.1 表格顺序，标准模板第一行必须按此顺序输出；
 * - `key` 是内部键（代码与存储使用），`header` 是新模板的中文表头；
 * - `kind` 决定清洗阶段使用哪个解析口径（文本 / 枚举 / 金额 / 日期 / 年份 / 三值 / 原文）；
 * - `missingHandling` 是缺失时的口径说明，会显示在映射与清洗页，避免用户猜测；
 * - `sensitive` 标记需要在日志、报告与 AI 摘要中脱敏的字段。
 *
 * 扩展列（PRD 15.5）**不要求**用户填写：未映射时不产生任何问题，也不影响任何指标。
 */

/** 字段取值类型，决定清洗阶段使用的解析规则 */
export type StandardFieldKind =
  | 'text'
  | 'enum'
  | 'amount'
  | 'date'
  | 'year'
  | 'triState'
  | 'rawText'

type FieldShape = {
  readonly key: string
  readonly header: string
  readonly kind: StandardFieldKind
  readonly aliases: readonly string[]
  /** 缺失时的处理口径（来自 docs/PRD.md 4.1） */
  readonly missingHandling: string
  /** 是否属于身份 / 薪酬类敏感字段 */
  readonly sensitive: boolean
  /** 缺失即阻断导入（文件级最低条件，当前仅 offer 状态列） */
  readonly required: boolean
  /** 必须按字符串处理并保留前导 0（需求 ID 等，绝不按数字或日期解析） */
  readonly preserveLeadingZeros: boolean
}

const STANDARD_FIELD_DEFS = [
  {
    key: 'requirementId',
    header: '需求ID',
    kind: 'text',
    aliases: [],
    missingHandling: '可导入；需求数与需求相关指标排除该记录并提示，禁止用姓名代替',
    sensitive: false,
    required: false,
    preserveLeadingZeros: true,
  },
  {
    key: 'recruiter',
    header: '招聘HR',
    kind: 'text',
    aliases: ['招聘负责人', '招聘专员'],
    missingHandling: '未知，归入未知组；不得与推荐人互换',
    sensitive: true,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'city',
    header: '城市',
    kind: 'enum',
    aliases: ['工作城市', '工作地点'],
    missingHandling: '未知；额外保留 cityRaw；别名归并需用户确认',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'department',
    header: '一级部门',
    kind: 'text',
    aliases: ['部门', '事业部'],
    missingHandling: '未知',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'position',
    header: '岗位',
    kind: 'text',
    aliases: ['职位', '岗位名称'],
    missingHandling: '未知；禁用该行同岗位薪资基准',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'jobFamily',
    header: '序列',
    kind: 'text',
    aliases: ['职位序列', '岗位序列'],
    missingHandling: '未知；禁用该行同序列基准',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'requirementType',
    header: '需求类型',
    kind: 'enum',
    aliases: ['需求性质'],
    missingHandling: '未知；「替补/替换」不得自动拆分',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'recruitmentStartDate',
    header: '启动招聘时间',
    kind: 'date',
    aliases: ['招聘启动日期', '启动日期'],
    missingHandling: '日期指标排除该记录，但不排除人数',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'joiningDate',
    header: '入职时间',
    kind: 'date',
    aliases: ['到岗日期', '入职日期'],
    missingHandling: '实际 / 计划语义依状态与补充字段决定；不得与 offer 接受时间互换',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'expectedEndDate',
    header: '预计离职时间',
    kind: 'date',
    aliases: ['预计离职日期'],
    missingHandling: '不算预计实习时长，也不推断留存',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'candidateName',
    header: '姓名',
    kind: 'text',
    aliases: ['候选人姓名', '学生姓名'],
    missingHandling: '允许为空；生成记录 ID，不补造姓名',
    sensitive: true,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'graduationYear',
    header: '毕业年级',
    kind: 'year',
    aliases: ['毕业年份', '毕业年度'],
    missingHandling: '未知；不推断年龄',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'education',
    header: '学历',
    kind: 'enum',
    aliases: ['最高学历'],
    missingHandling: '未知；「学位」不得自动映射为学历',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'school',
    header: '学校',
    kind: 'text',
    aliases: ['毕业院校', '就读院校'],
    missingHandling: '未知，不联网补齐；别名冲突必须展示',
    sensitive: true,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'isGptSchool',
    header: '是否GPT院校',
    kind: 'triState',
    aliases: [],
    missingHandling: '未知（三值）；不默认否，可用本地名单给出建议',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'referrer',
    header: '简历推荐人',
    kind: 'text',
    aliases: ['推荐人', '简历来源人'],
    missingHandling: '未知；另派生推荐类型；不得与招聘 HR 互换',
    sensitive: true,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'channel',
    header: '渠道',
    kind: 'enum',
    aliases: ['招聘渠道', '来源渠道'],
    missingHandling: '未知，不与推荐人列混同',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'salaryAmount',
    header: '薪资',
    kind: 'amount',
    aliases: ['offer薪资'],
    missingHandling: '未知，不视为 0；币种与计薪周期由用户确认，不做推断',
    sensitive: true,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'housingRaw',
    header: '房补',
    kind: 'rawText',
    aliases: ['住房补贴', '房补说明'],
    missingHandling: '未知，不视为无补贴；保留原文供派生类型与金额',
    sensitive: true,
    required: false,
    preserveLeadingZeros: false,
  },
  {
    key: 'offerStatus',
    header: 'offer状态',
    kind: 'enum',
    aliases: ['offer进度'],
    missingHandling: '缺失或未识别保留并提示；不进入核心分母 D',
    sensitive: false,
    required: true,
    preserveLeadingZeros: false,
  },
  {
    key: 'rejectionReason',
    header: '拒绝原因分类',
    kind: 'text',
    aliases: ['拒offer原因', '拒绝原因'],
    missingHandling: '拒 offer 中缺失显示「未填写」；非拒 offer 不适用',
    sensitive: false,
    required: false,
    preserveLeadingZeros: false,
  },
] as const satisfies readonly FieldShape[]

export type StandardFieldDefinition = (typeof STANDARD_FIELD_DEFS)[number]
export type StandardFieldKey = StandardFieldDefinition['key']

export const STANDARD_FIELDS: readonly StandardFieldDefinition[] = STANDARD_FIELD_DEFS

/** 21 个内部键，顺序即模板顺序 */
export const STANDARD_FIELD_KEYS: readonly StandardFieldKey[] = STANDARD_FIELD_DEFS.map(
  (field) => field.key,
)

/** 标准模板 21 列表头，顺序即模板顺序 */
export const STANDARD_HEADERS: readonly string[] = STANDARD_FIELD_DEFS.map((field) => field.header)

const FIELD_BY_KEY = new Map<StandardFieldKey, StandardFieldDefinition>(
  STANDARD_FIELD_DEFS.map((field): [StandardFieldKey, StandardFieldDefinition] => [
    field.key,
    field,
  ]),
)

export function getStandardField(key: StandardFieldKey): StandardFieldDefinition {
  const field = FIELD_BY_KEY.get(key)
  if (field === undefined) {
    throw new Error(`未登记的标准字段：${key}`)
  }
  return field
}

/** 文件级最低条件：必须识别 offer 状态列，否则阻断导入 */
export const REQUIRED_STANDARD_FIELDS: readonly StandardFieldKey[] = STANDARD_FIELD_DEFS.filter(
  (field) => field.required,
).map((field) => field.key)

/** 需要脱敏字段（日志、导出报告与 AI 摘要共用同一份白名单依据） */
export const SENSITIVE_STANDARD_FIELDS: readonly StandardFieldKey[] = STANDARD_FIELD_DEFS.filter(
  (field) => field.sensitive,
).map((field) => field.key)

/* ------------------------------------------------------------------ 表头匹配 */

/**
 * 匹配级别（docs/PRD.md 4.3 的优先级：精确 → 规范化 → 别名模板 → 模糊建议）。
 *
 * - `exact` / `normalized`：系统自动结论，可直接作为建议；
 * - `alias` / `fuzzy`：建议，必须由用户确认（模糊建议**永不**自动提交）；
 * - `template`：命中用户已确认的映射模板，只由步骤4（`domain/mapping.ts`）产生；
 * - `manual`：用户在映射页下拉里亲自指定；
 * - `ignored`：忽略该列（多余列默认忽略，且不得意外导出）。
 */
export const COLUMN_MATCH_LEVELS = [
  'exact',
  'normalized',
  'alias',
  'template',
  'fuzzy',
  'manual',
  'ignored',
] as const
export type ColumnMatchLevel = (typeof COLUMN_MATCH_LEVELS)[number]

const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/g

/**
 * 规范化表头文本：去 BOM / 零宽字符 → NFKC（全角转半角）→ 去首尾空白 → ASCII 转小写。
 * 注意：不改动表头内部文字，因此「需求 ID」不会自动等于「需求ID」，交由步骤4 的模糊建议处理。
 */
export function normalizeHeader(header: string): string {
  return header.replace(ZERO_WIDTH_PATTERN, '').normalize('NFKC').trim().toLowerCase()
}

/** 明确禁止自动映射的组合（docs/PRD.md 4.3）：建议字段命中禁止项时必须由用户手动确认 */
export type ForbiddenHeaderMapping = {
  readonly header: string
  readonly targetField: string
  readonly reason: string
}

export const FORBIDDEN_HEADER_MAPPINGS: readonly ForbiddenHeaderMapping[] = [
  { header: '学位', targetField: 'education', reason: '学历与学位不是同一个字段' },
  { header: '推荐人', targetField: 'recruiter', reason: '推荐人不是招聘 HR' },
  { header: '简历推荐人', targetField: 'recruiter', reason: '推荐人不是招聘 HR' },
  { header: '招聘负责人', targetField: 'referrer', reason: '招聘 HR 不是推荐人' },
  { header: '招聘HR', targetField: 'referrer', reason: '招聘 HR 不是推荐人' },
  { header: 'offer接受时间', targetField: 'joiningDate', reason: '接受时间不是入职时间' },
  { header: '入职时间', targetField: 'offerAcceptedDate', reason: '入职时间不是 offer 接受时间' },
]

type HeaderIndex = {
  readonly exact: ReadonlyMap<string, StandardFieldKey>
  readonly alias: ReadonlyMap<string, StandardFieldKey>
}

function buildHeaderIndex(): HeaderIndex {
  const exact = new Map<string, StandardFieldKey>()
  const alias = new Map<string, StandardFieldKey>()
  // 先登记标准表头，别名不得覆盖标准表头
  for (const field of STANDARD_FIELD_DEFS) {
    exact.set(normalizeHeader(field.header), field.key)
  }
  for (const field of STANDARD_FIELD_DEFS) {
    for (const aliasHeader of field.aliases) {
      const key = normalizeHeader(aliasHeader)
      if (!exact.has(key) && !alias.has(key)) {
        alias.set(key, field.key)
      }
    }
  }
  return { exact, alias }
}

const HEADER_INDEX = buildHeaderIndex()

export type HeaderMatch = {
  /** 建议的目标字段；null 表示未匹配（默认忽略该列） */
  readonly field: StandardFieldKey | null
  readonly matchLevel: ColumnMatchLevel
  readonly matchedHeader: string | null
  /** 是否需要用户确认后才生效 */
  readonly requiresConfirmation: boolean
  /** 被禁止自动映射的原因；非 null 时必须由用户手动确认 */
  readonly blockedReason: string | null
}

/**
 * 表头匹配（步骤2 只提供精确 / 规范化 / 别名三级）：
 * - 精确与规范化结果可直接作为建议；
 * - 别名一律 `requiresConfirmation = true`（来自 PRD 4.3 的常用别名表，仍属建议）；
 * - 模糊建议（fuzzy）与冲突解决在步骤4 实现，本函数对未匹配表头返回 `ignored`。
 */
export function matchStandardHeader(header: string): HeaderMatch {
  const normalized = normalizeHeader(header)
  const blocked = FORBIDDEN_HEADER_MAPPINGS.find(
    (entry) => normalizeHeader(entry.header) === normalized,
  )
  if (normalized === '') {
    return {
      field: null,
      matchLevel: 'ignored',
      matchedHeader: null,
      requiresConfirmation: false,
      blockedReason: blocked?.reason ?? null,
    }
  }

  const exact = HEADER_INDEX.exact.get(normalized)
  if (exact !== undefined) {
    const isBlocked = blocked?.targetField === exact
    return {
      field: exact,
      matchLevel: 'exact',
      matchedHeader: getStandardField(exact).header,
      requiresConfirmation: isBlocked,
      blockedReason: isBlocked ? (blocked?.reason ?? null) : null,
    }
  }

  const alias = HEADER_INDEX.alias.get(normalized)
  if (alias !== undefined) {
    const isBlocked = blocked?.targetField === alias
    return {
      field: alias,
      matchLevel: 'alias',
      matchedHeader: getStandardField(alias).header,
      requiresConfirmation: true,
      blockedReason: isBlocked ? (blocked?.reason ?? null) : null,
    }
  }

  return {
    field: null,
    matchLevel: 'ignored',
    matchedHeader: null,
    requiresConfirmation: blocked !== undefined,
    blockedReason: blocked?.reason ?? null,
  }
}

/* ------------------------------------------------------------------ 字段值校验 */

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 是否为合法 `YYYY-MM-DD` 日历日期（回读校验，避免 2026-02-30 被 Date 自动进位） */
export function isDateOnlyText(value: string): boolean {
  const matched = DATE_ONLY_PATTERN.exec(value)
  if (matched === null) {
    return false
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const parsed = new Date(year, month - 1, day)
  return (
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day
  )
}

/** 薪资 / 现金房补金额：非负有限数。0 是有效值，缺失必须是 null（docs/PRD.md 4.1） */
export function isValidAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0
}

/** 毕业年级：四位年份且落在有意义区间内，不推断年龄 */
export function isValidGraduationYear(value: number): boolean {
  return Number.isInteger(value) && value >= 1900 && value <= 2100
}

/* ------------------------------------------------------------------ 可选扩展列 */

type ExtensionFieldShape = {
  readonly key: string
  readonly header: string
  readonly kind: StandardFieldKind
  /** 用途 */
  readonly purpose: string
  /** 没有该列时的替代方案（docs/PRD.md 15.5） */
  readonly fallback: string
}

/**
 * 可选扩展列（docs/PRD.md 15.5）：保持 21 列模板不变，**不要求**用户一次性补齐；
 * 未映射的扩展列不产生问题、不参与任何指标，只有显式映射后才启用对应分析。
 */
const EXTENSION_FIELD_DEFS = [
  {
    key: 'offerId',
    header: 'offer唯一ID',
    kind: 'text',
    purpose: '跨次导入去重与状态更新',
    fallback: '新建快照 + 疑似重复人工确认，不自动合并',
  },
  {
    key: 'candidateInternalId',
    header: '候选人内部ID',
    kind: 'text',
    purpose: '识别同人多 offer、稳定脱敏',
    fallback: '随机记录代号，不按姓名自动认人',
  },
  {
    key: 'offerSentDate',
    header: 'offer发出日期',
    kind: 'date',
    purpose: '发放批次趋势、offer 到接受周期',
    fallback: '只做启动招聘批次分析，明确不是发 offer 趋势',
  },
  {
    key: 'offerAcceptedDate',
    header: 'offer接受日期',
    kind: 'date',
    purpose: '决策耗时',
    fallback: '不做决策耗时，只做当前状态分析',
  },
  {
    key: 'offerRejectedDate',
    header: 'offer拒绝日期',
    kind: 'date',
    purpose: '拒 offer 发生时间',
    fallback: '不做决策耗时，只看拒 offer 率与原因',
  },
  {
    key: 'plannedJoiningDate',
    header: '计划入职日期',
    kind: 'date',
    purpose: '区分计划与实际周期',
    fallback: '待入职用入职时间列作计划日期，单独展示',
  },
  {
    key: 'actualJoiningDate',
    header: '实际入职日期',
    kind: 'date',
    purpose: '区分计划与实际周期',
    fallback: '已入职用入职时间列作实际日期；拒 offer 不算实际',
  },
  {
    key: 'statusUpdatedAt',
    header: '状态更新时间',
    kind: 'date',
    purpose: '判断快照新鲜度与状态是否过期',
    fallback: '导入时由用户声明确认截止日，不反推历史',
  },
  {
    key: 'salaryCurrency',
    header: '薪资币种',
    kind: 'text',
    purpose: '可比薪资与分位',
    fallback: '导入批次确认；混合或不明时禁用待遇比较',
  },
  {
    key: 'salaryPeriod',
    header: '计薪周期',
    kind: 'text',
    purpose: '可比薪资与分位',
    fallback: '导入批次确认；未确认时禁用待遇对比',
  },
  {
    key: 'housingPeriodValue',
    header: '房补周期',
    kind: 'text',
    purpose: '现金房补按周期对齐',
    fallback: '从房补原文中提取显式周期，不换算、不估价',
  },
  {
    key: 'housingValue',
    header: '住宿价值',
    kind: 'amount',
    purpose: '比较现金与实物待遇',
    fallback: '住宿一律不折现，金额视为未知',
  },
  {
    key: 'requirementTypeDetail',
    header: '需求类型细分',
    kind: 'text',
    purpose: '分别比较替补与替换',
    fallback: '保留「替补替换未拆分」，不做猜测拆分',
  },
  {
    key: 'primaryRejectionReason',
    header: '主拒绝原因',
    kind: 'text',
    purpose: '原因分布与可信度',
    fallback: '显示「未填写」，并建议补充访谈信息',
  },
  {
    key: 'rejectionReasonSource',
    header: '原因来源',
    kind: 'text',
    purpose: '标注原因的可信来源',
    fallback: '原因来源未知，仅在报告中说明缺失',
  },
  {
    key: 'referralTypeColumn',
    header: '推荐类型',
    kind: 'text',
    purpose: '区分 HR 推、内推与具体推荐人贡献',
    fallback: '使用已确认字典派生，无法识别则为未知',
  },
  {
    key: 'requirementOpenDate',
    header: '需求开放时间',
    kind: 'date',
    purpose: '需求关闭率与负荷',
    fallback: '仅报告名单覆盖需求数，不称完整需求完成率',
  },
  {
    key: 'requirementCloseDate',
    header: '需求关闭时间',
    kind: 'date',
    purpose: '需求关闭率与负荷',
    fallback: '仅报告名单覆盖需求数',
  },
  {
    key: 'plannedHc',
    header: '计划HC',
    kind: 'amount',
    purpose: '需求负荷',
    fallback: '不做 HC 完成率，只用记录数',
  },
  {
    key: 'actualEndDate',
    header: '实际离职时间',
    kind: 'date',
    purpose: '真实实习时长',
    fallback: '只展示预计离职时间，不推断留存',
  },
  {
    key: 'postJoiningStatus',
    header: '到岗后状态',
    kind: 'text',
    purpose: '留存观察',
    fallback: '仅展示入职状态，不推断留存',
  },
] as const satisfies readonly ExtensionFieldShape[]

export type ExtensionFieldDefinition = (typeof EXTENSION_FIELD_DEFS)[number]
export type ExtensionFieldKey = ExtensionFieldDefinition['key']

export const EXTENSION_FIELDS: readonly ExtensionFieldDefinition[] = EXTENSION_FIELD_DEFS

export const EXTENSION_FIELD_KEYS: readonly ExtensionFieldKey[] = EXTENSION_FIELD_DEFS.map(
  (field) => field.key,
)

/** 扩展列取值：日期类扩展列同样存 `YYYY-MM-DD` 字符串；未映射的键直接缺省 */
export type ExtensionFieldValues = Readonly<
  Partial<Record<ExtensionFieldKey, string | number | boolean | null>>
>

/** 无任何扩展列时的默认值（缺失不产生问题，也不影响指标） */
export const EMPTY_EXTENSION_VALUES: ExtensionFieldValues = {}
