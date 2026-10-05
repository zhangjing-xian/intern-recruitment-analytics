/**
 * AI 摘要契约与**白名单重建**（AI-1，docs/PRD.md 16–17 章）。
 *
 * ## 为什么是「白名单重建」而不是「删字段」
 *
 * 本模块从聚合结果出发，构造一个**形状固定**的载荷：只有下面这些字段名可以出现，
 * 其余一律不存在——不是先复制一份再删掉敏感键，而是**只从允许的来源取值**。
 * 两者的差别不是风格问题：
 * - 删字段的安全性取决于「有没有想到该删的键」，新增一个字段就会静默泄漏；
 * - 白名单重建的安全性取决于「有没有显式允许」，新增字段默认**进不去**。
 * 因此只要有人往聚合结果里加字段，本模块的产物自动不含它（AI-1 注意事项明确要求
 * 「不能以正则删字段代替白名单」）。
 *
 * ## 三条不可越过的边界
 *
 * 1. **身份信息永不出现在载荷里**：姓名 / 候选人 ID / 需求 ID / HR 真名 / 学校全名 /
 *    文件名 / 自由文本原文 / 准确薪资 / 完整日期——不是「换成代号就可以」，
 *    而是这些字段在载荷结构里**没有位置**（AGENTS §2.2）；
 * 2. **n < 5 一律抑制且不填 0**：填 0 会被读成「这一格没有拒绝」，直接改变结论；
 *    抑制后必须标注，让阅读者知道「这里有一格被省略了」；
 * 3. **无法安全发布时宁可降级**（更强的聚合 / 整维省略），**不降低 k**。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，**不发起任何请求**
 * （真正的网络适配器是 AI-4 的事，且它不能接收原始记录类型）。
 */

import type { PrivacyLevel } from './sanitize'

/* ------------------------------------------------------------------ Schema */

/** 载荷结构版本：形状变化必须递增，便于回溯「当时发出去的是什么形状」 */
export const AI_SUMMARY_SCHEMA_VERSION = 'ai-summary/2'

/**
 * 提示词版本：system / user 文案变化必须递增，随预览与历史一起保存。
 *
 * v1 → v2（AI-1 收尾）：user 提示词里的 `**聚合脱敏摘要**` 改成无标记写法。
 * 那段文字会逐字渲染进预览面板，Markdown 强调标记在纯文本场景下只会显示成一对星号。
 * 改文案必须递增版本，否则「预览 hash 没变但提示词变了」，历史无法回溯当时发的是什么。
 */
export const AI_PROMPT_VERSION = 'ai-prompt/2'

/** 体积预算（PRD 17.1）：默认 128 KiB */
export const AI_SUMMARY_BYTE_BUDGET = 128 * 1024
/** 每个维度的行数上限（PRD 17.1：每维 Top10） */
export const AI_SUMMARY_TOP_N = 10
/** 默认最多交叉维度数（PRD 17.1：默认最多 2 个交叉维度） */
export const AI_SUMMARY_MAX_CROSS_DIMENSIONS = 2
/** 单元格抑制门槛：任何一格 n < 5 一律抑制（PRD 16.3） */
export const AI_CELL_MIN_SAMPLE = 5

/** 允许出现在载荷里的维度（白名单；顺序即输出顺序，保证同输入同产物） */
export const AI_ALLOWED_DIMENSIONS = [
  'city',
  'channel',
  'referralType',
  'recruiter',
  'positionCategory',
  'jobFamily',
  'department',
  'requirementType',
  'schoolLevel',
  'graduationYear',
  'education',
  'salaryBand',
  'housingType',
  'cycleBand',
] as const
export type AiAllowedDimension = (typeof AI_ALLOWED_DIMENSIONS)[number]

/**
 * 每个隐私级别允许的维度（PRD 18.5）。
 *
 * - `strict`：仅总体 + 城市 + 状态结构；HR / 岗位 / 学校层次**全部省略**；
 * - `standard`（默认）：增加渠道、岗位类别、需求类型、画像层次、薪资 / 周期分桶；
 * - `custom`：只能在 standard 之内**增减允许项**，因此它的上限就是 standard —— 
 *   结构上不可能借此解除任何身份禁出项（身份禁出项根本不在白名单里）。
 */
export const AI_DIMENSIONS_BY_LEVEL: Readonly<Record<PrivacyLevel, readonly AiAllowedDimension[]>> =
  {
    strict: ['city', 'housingType'],
    standard: [
      'city',
      'channel',
      'referralType',
      'recruiter',
      'positionCategory',
      'jobFamily',
      'department',
      'requirementType',
      'schoolLevel',
      'graduationYear',
      'education',
      'salaryBand',
      'housingType',
      'cycleBand',
    ],
    custom: [
      'city',
      'channel',
      'referralType',
      'recruiter',
      'positionCategory',
      'jobFamily',
      'department',
      'requirementType',
      'schoolLevel',
      'graduationYear',
      'education',
      'salaryBand',
      'housingType',
      'cycleBand',
    ],
  }

/** 维度的可读标签（载荷里能出现的中文只有这些固定标签与受控取值） */
export const AI_DIMENSION_LABELS: Readonly<Record<AiAllowedDimension, string>> = {
  city: '城市',
  channel: '渠道',
  referralType: '推荐类型',
  recruiter: '招聘 HR（代号）',
  positionCategory: '岗位类别',
  jobFamily: '序列',
  department: '一级部门',
  requirementType: '需求类型',
  schoolLevel: '学校层次',
  graduationYear: '毕业年级',
  education: '学历',
  salaryBand: '薪资区间',
  housingType: '房补类型',
  cycleBand: '招聘周期区间',
}

/* ------------------------------------------------------------------ 分桶 */

/** 招聘周期区间（按 10 天等宽分箱；左闭右开，最后一箱含右端） */
export function cycleBandOf(days: number | null, binDays = 10): string | null {
  if (days === null || !Number.isFinite(days) || days < 0) {
    return null
  }
  const width = Number.isFinite(binDays) && binDays > 0 ? Math.trunc(binDays) : 10
  const lower = Math.floor(days / width) * width
  return `${String(lower)}-${String(lower + width - 1)}天`
}

/**
 * 学校 → **层次**（AI08：学校仅以层次出现，未知不猜测）。
 *
 * 本项目没有「重点 / 普通」这类院校分档数据，唯一可靠且与业务相关的标签是
 * GPT 名单标记。因此层次只由它派生，三值严格分开：
 * - `true` → `GPT 院校`；`false` → `非 GPT 院校`；`null`/`undefined` → `未标注`（**不猜**）。
 *
 * 不输出学校全名：全名属于「学校全名长尾」，明确在禁止发送之列（PRD 16.3）。
 */
export function schoolLevelOf(isGptSchool: boolean | null | undefined): string {
  if (isGptSchool === true) {
    return 'GPT 院校'
  }
  if (isGptSchool === false) {
    return '非 GPT 院校'
  }
  return '未标注'
}

/* ------------------------------------------------------------------ 岗位类别映射（AI-6） */

/**
 * 岗位类别映射的一条规则：`岗位写法 → 类别`。
 *
 * ## 为什么映射属于**脱敏层**而不是界面层
 *
 * 岗位全名属于「不得外发」的取值（PRD 16.3），把它换成类别这一步**就是**脱敏动作本身。
 * 如果让界面各自映射，同一个岗位在设置页与载荷里会得到不同类别，而「设置页说发了 A、
 * 实际发了 B」正是本项目一直在防的事故（口径只实现一次）。
 *
 * ## 三条取值纪律
 *
 * 1. **只查表不推断**：与拒绝原因字典同一口径——去掉全部空白、忽略拉丁字母大小写后
 *    **精确**比对。**不做**子串匹配、不做同义词猜测（「算法工程师」不等于「算法」）；
 * 2. **没配映射时退回中性标签**：`有岗位记录`（不是岗位名、也不是「未知」——
 *    有值却说未知是错的）；分组键为空才是 `未知`；
 * 3. **类别本身也是外发文本**：长度、形状都要过闸门（`normalizePositionCategoryRules`），
 *    否则「映射」会变成一条把任意原文送出去的旁路。
 */
export type PositionCategoryRule = {
  readonly keyword: string
  readonly category: string
}

/** 分组键为空时的类别（缺失 ≠ 有值） */
export const POSITION_CATEGORY_UNKNOWN = '未知'
/** 有值但没有命中任何映射规则时的中性类别（**不猜**具体类别） */
export const POSITION_CATEGORY_FALLBACK = '有岗位记录'
/** 类别文本长度上限：类别是给人看的短标签，不是自由文本 */
export const POSITION_CATEGORY_MAX_LENGTH = 12
/** 映射规则条数上限：防止把整张岗位表当映射塞进来 */
export const POSITION_CATEGORY_MAX_RULES = 50

/** 查表用的归一化：去掉全部空白（含全角空格）并统一小写；不改动原文 */
function normalizeLookupKey(raw: string): string {
  let result = ''
  for (const char of raw) {
    if (!/\s/u.test(char)) {
      result += char.toLowerCase()
    }
  }
  return result
}

/**
 * 规范化映射规则：去空白、去重（**先出现的优先**）、丢掉不能安全外发的规则。
 *
 * 为什么丢掉而不是抛错：偏好可能来自旧版本或被用户手改过的仓内容（`parseAiSettings`
 * 的原则一致）——读回时按「不认识就丢掉」处理，而不是让整个设置页打不开。
 * 但**绝不**把不合格的类别「将就着用」：它会被直接发出去。
 */
export function normalizePositionCategoryRules(
  raw: readonly PositionCategoryRule[],
): readonly PositionCategoryRule[] {
  const rules: PositionCategoryRule[] = []
  const seen = new Set<string>()
  for (const rule of raw.slice(0, POSITION_CATEGORY_MAX_RULES)) {
    const keyword = rule.keyword.trim()
    // 类别折叠内部空白：` 研发  岗 ` → `研发 岗`，避免把排版差异带进载荷
    const category = rule.category.trim().replace(/\s+/gu, ' ')
    const key = normalizeLookupKey(keyword)
    if (key === '' || category === '' || seen.has(key)) {
      continue
    }
    if (category.length > POSITION_CATEGORY_MAX_LENGTH || looksLikeIdentifier(category)) {
      continue
    }
    seen.add(key)
    rules.push({ keyword, category })
  }
  return rules
}

/**
 * 岗位写法 → **类别**（AI08：岗位仅以类别出现）。
 *
 * `rules` 为空是正常状态（用户没配映射）：此时只区分「有值 / 缺失」，
 * 具体类别名交由映射表提供，**不编造**。真正按序列 / 部门区分岗位的职责在
 * `jobFamily` / `department` 两个维度上。
 */
export function positionCategoryOf(
  rawKey: string,
  rules: readonly PositionCategoryRule[] = [],
): string {
  const key = normalizeLookupKey(rawKey)
  if (key === '') {
    return POSITION_CATEGORY_UNKNOWN
  }
  for (const rule of rules) {
    if (normalizeLookupKey(rule.keyword) === key) {
      return rule.category
    }
  }
  return POSITION_CATEGORY_FALLBACK
}

/* ------------------------------------------------------------------ 输入 */

/** 调用方交给本模块的一个**待脱敏**指标行（可能含需要被挡掉的字段） */
export type AiSourceCell = {
  readonly dimension: string
  /** 原始分组值；**可能是学校全名、HR 真名、文件名等危险值**，因此由本模块决定怎么处理 */
  readonly key: string
  readonly total: number
  readonly coreDenominator: number
  readonly rejected: number
  /**
   * 拒 offer **组内构成**（AI-2 引入）。
   *
   * 为什么三个计数都要来自调用方、而不是在这里现算：这两个数属于「组间比较人群」
   * （拒 offer 组 + 入职组），与 `coreDenominator`（含待入职）**分母不同**。
   * 本模块拿不到记录，无法自己分组，只能接收引擎已经算好的 `groupComposition`。
   * 缺省（`undefined`）表示调用方没有提供，此时该维度不发组内构成——
   * **绝不**退化成用 `rejected` / `total` 凑一个数，那会把两个分母混成一个（PRD 9.1）。
   */
  readonly rejectedGroupCount?: number
  readonly joinedGroupCount?: number
  /** 仅当来源是 HR 维度时提供；用于换成代号 */
  readonly recruiterCode?: string
  /** 仅当来源是学校维度时提供 */
  readonly isGptSchool?: boolean | null
  /** 仅当来源是薪资维度时提供（可能被已分桶的字符串覆盖） */
  readonly salaryBand?: string | null
  /** 仅当来源是周期维度时提供 */
  readonly cycleDays?: number | null
}

/** 状态计数（载荷里作为总体 KPI，全部是聚合计数） */
export type AiSourceKpi = {
  readonly total: number
  readonly joined: number
  readonly pending: number
  readonly approving: number
  readonly rejectedOffer: number
  readonly rejectedVerbally: number
  readonly coreDenominator: number
}

export type AiScopeInput = {
  readonly rowCount: number
  readonly dedupPolicy: string
  /** 筛选说明的可读文本（**已脱敏**：不得含文件名、学校全名、HR 真名） */
  readonly filters: readonly string[]
  /** 规则版本（含配置摘要，步骤12） */
  readonly ruleVersion: string
  readonly dataAsOf: string
}

/**
 * 拒 offer 组间构成的一个来源格（AI-2）。
 *
 * 与 `AiSourceCell` 的区别：这里只有两个**组内构成**计数，**没有** D / R。
 * 结构上不给，就不存在「把构成比当成特征内率」的误用（PRD 9.1 的两种视角必须分开）。
 */
export type AiSourceProfileCell = {
  readonly dimension: string
  readonly key: string
  readonly rejectedGroupCount: number
  readonly joinedGroupCount: number
  readonly recruiterCode?: string
  readonly isGptSchool?: boolean | null
}

export type AiSummaryInput = {
  readonly privacyLevel: PrivacyLevel
  readonly scope: AiScopeInput
  readonly kpi: AiSourceKpi
  readonly cells: readonly AiSourceCell[]
  readonly reasons: readonly { readonly category: string; readonly count: number }[]
  readonly quality: {
    readonly unknownStatus: number
    readonly missingSalary: number
    readonly unknownSchool: number
  }
  /** 本地口径说明（会随 user message 一起展示，必须已是可外发文本） */
  readonly caliberNotes: readonly string[]
  readonly generatedAt: string
  /** custom 级别下实际允许的维度；缺省时取该级别的全部允许维度 */
  readonly allowedDimensions?: readonly string[]
  /**
   * 岗位类别映射（AI-6，可选）：`岗位写法 → 类别`。
   *
   * 缺省（或空数组）时岗位维度退回中性标签 `有岗位记录`——
   * **绝不**因为「没配映射」就把岗位全名发出去。传入的规则会先经
   * `normalizePositionCategoryRules` 过滤，不合格的规则在这里被丢掉。
   */
  readonly positionCategories?: readonly PositionCategoryRule[]
  /**
   * 拒 offer 组间构成（AI-2，可选）：只出「组内构成」两个计数（PRD 9.1 视角一）。
   *
   * 缺省时载荷里不会出现这一块——绝不是发一个空的或补 0 的版本。
   */
  readonly rejectionProfile?: readonly AiSourceProfileCell[]
  /** 组间比较的总人数（拒 offer 组 R + 入职组 J），用于说明两个分母各是多少 */
  readonly rejectionTotals?: {
    readonly rejectedTotal: number
    readonly joinedTotal: number
    /** 未进入比较人群的记录数（待入职 + 审批中 + 其他 + 未知） */
    readonly excludedFromComparison: number
  }
}

/* ------------------------------------------------------------------ 输出 */

/** 载荷里的一行：只有计数，没有率（率由「分子 ÷ 分母」自行读出，不额外给一个可能被误读的百分数） */
export type AiPayloadRow = {
  readonly key: string
  readonly N: number
  readonly D: number
  readonly R: number
  /**
   * 拒 offer **组内构成**（AI-2，PRD 9.1 视角一）：该特征在拒 offer 组 / 入职组的记录数。
   *
   * 为什么与 N/D/R **同一行**而不是另开一张表：另开表会在同一维度上造出可反算量
   * （见 `AiProfileTable` 的说明）。同一行里两者分母不同，由 `rejectionComparison.note` 与
   * `caliber` 明确写清，不存在「看起来像同一个分母」的歧义。
   *
   * 缺省（`undefined`）表示调用方没有提供组间比较数据：此时**不填 0**，直接不出这两个键。
   */
  readonly rejectedGroupCount?: number
  readonly joinedGroupCount?: number
}

export type AiPayloadTable = {
  readonly metricId: string
  readonly dim: string
  readonly dimLabel: string
  readonly rows: readonly AiPayloadRow[]
}

/**
 * 被否决的「同维度双表」设计（AI-2）——**这里刻意不再定义类型**。
 *
 * 最初的设计是「每个维度出两张表：一张特征内率（N/D/R）、一张组内构成
 * （拒 offer 组 / 入职组）」。否决理由：两张表在**同一维度**上按 key 对齐后能反算出
 * 不在比较人群里的量——该组的 D 与 R 已知、组内构成已知，两者相减就得到剩下的部分。
 * PRD 16.3 明确要求「同一请求中的总体、城市、HR、交叉表一起检查，
 * 不能每张表各自过关后拼接」。
 *
 * 现在的做法是把两个视角并排放进 `AiPayloadRow` 同一行（`rejectedGroupCount` /
 * `joinedGroupCount` 与 N/D/R 同格）：既不重复，也不存在跨表交叉。
 *
 * 这段说明保留在类型位置（而不是只写在注释里）的原因：留着那个类型的定义，
 * 下一个人就会顺手用它把双表结构再加回来；类型不存在，这条路才是关着的。
 */

/** 拒 offer 组间比较块：两个人群的分母必须写明（组间比较人群 ≠ 核心率人群） */
export type AiRejectionComparison = {
  readonly rejectedTotal: number
  readonly joinedTotal: number
  readonly excludedFromComparison: number
  readonly note: string
}

/** 被省略的指标：必须如实列出原因，预览与实际发送内容不一致是不允许的 */
export type AiOmittedEntry = {
  readonly metricId: string
  readonly reason: string
}

/**
 * 脱敏后的 AI 载荷（**只有聚合**）。
 *
 * 形状与 PRD 17.2 的示意一致：`scope` + `kpi` + `dimensions` + `housing` +
 * `rejectionReasons` + `quality` + `limits`。刻意**没有**任何字段能装下原始行。
 */
export type SanitizedAiPayload = {
  /**
   * **字面量**类型而不是 `string`，这不是风格问题：
   * 若写成 `string`，`SanitizedReport` 会**结构上可赋值**给本载荷
   * （两者都有 `schemaVersion` / `generatedAt` / `quality` 之类的键），
   * 于是「把本地报告当 AI 载荷传进去」在类型层面就能通过——那正是本模块要防的事故。
   * 钉成字面量后，报告永远不可能满足本类型（有编译期断言守这一点）。
   */
  readonly schemaVersion: typeof AI_SUMMARY_SCHEMA_VERSION
  readonly generatedAt: string
  readonly privacyLevel: PrivacyLevel
  readonly dataAsOf: string
  readonly scope: {
    readonly rowCount: number
    readonly dedupPolicy: string
    readonly filters: readonly string[]
    readonly ruleVersion: string
  }
  readonly kpi: {
    readonly N: number
    readonly J: number
    readonly P: number
    readonly A: number
    readonly R1: number
    readonly R2: number
    readonly D: number
  }
  readonly dimensions: readonly AiPayloadTable[]
  readonly rejectionReasons: readonly { readonly key: string; readonly count: number }[]
  readonly quality: {
    readonly unknownStatus: number
    readonly missingSalary: number
    readonly unknownSchool: number
  }
  readonly limits: readonly string[]
  /**
   * 本地口径说明（AI-2）：这些文本**会随 user message 一起发送**，
   * 因此进载荷不是「多存一份」，而是让预览能逐字展示「模型看到的解释里有没有算错分母」。
   */
  readonly caliber: readonly string[]
  /**
   * 拒 offer 组间构成（AI-2）。`null` 表示调用方没有提供组间比较数据
   * ——此时整个块不出现，**不是**发一个空表或 0。
   */
  readonly rejectionComparison: AiRejectionComparison | null
  /** 被省略的指标与原因（含被抑制的单元格计数） */
  readonly omitted: readonly AiOmittedEntry[]
  /** 被抑制的单元格数（n < 5），只给计数、不给位置，避免反向定位 */
  readonly suppressedCellCount: number
  readonly contentBytes: number
}

/* ------------------------------------------------------------------ 白名单重建 */

/** 允许出现的键（递归结构，供运行时校验；少一个键就会在测试里失败，不会静默放行新字段） */
export const AI_SUMMARY_KEYS = {
  schemaVersion: true,
  generatedAt: true,
  privacyLevel: true,
  dataAsOf: true,
  scope: { rowCount: true, dedupPolicy: true, filters: true, ruleVersion: true },
  kpi: { N: true, J: true, P: true, A: true, R1: true, R2: true, D: true },
  dimensions: {
    metricId: true,
    dim: true,
    dimLabel: true,
    rows: {
      key: true,
      N: true,
      D: true,
      R: true,
      rejectedGroupCount: true,
      joinedGroupCount: true,
    },
  },
  rejectionReasons: { key: true, count: true },
  quality: { unknownStatus: true, missingSalary: true, unknownSchool: true },
  limits: true,
  caliber: true,
  rejectionComparison: {
    rejectedTotal: true,
    joinedTotal: true,
    excludedFromComparison: true,
    note: true,
  },
  omitted: { metricId: true, reason: true },
  suppressedCellCount: true,
  contentBytes: true,
} as const

function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length
}

/**
 * 调用方传入的维度名 → 载荷里的白名单维度名。
 *
 * 为什么需要这一步：来源系统用的是「记录上的字段名」（`school` / `position` / `recruiter`），
 * 而载荷白名单用的是「能对外说的粒度名」（`schoolLevel` / `positionCategory`）。
 * 直接把来源名当载荷维度名去比对白名单，会把这三个维度**整维误判为「当前级别不发送」**
 * ——那是静默丢功能（少发了本该发的东西），而不是更安全。
 */
/** 来源维度名归一化为载荷维度名 */
export function canonicalDimensionOf(dimension: string): string {
  switch (dimension) {
    case 'school':
      return 'schoolLevel'
    case 'position':
      return 'positionCategory'
    default:
      return dimension
  }
}

/**
 * 判断一个取值**长得像 ID**（需求 ID / 候选人 ID / 记录 ID）。
 *
 * 为什么要这道闸门：AI05 明确要求载荷里没有需求 ID，而标准表里就有一列叫「需求ID」，
 * 其取值形如 `REQ-0001`。这类值可能被填进任何一列，逐维度列举必然漏，因此统一在取值层判断。
 *
 * 判定分两档，刻意**不**把「短的纯字母数字」也算进来——那会误伤 `Boss`、`HR推` 这类
 * 受控枚举取值（渠道就叫 Boss），把正常功能整维丢掉：
 * - **强特征**：含分隔符（`-` / `_`）或长度 ≥ 12，且以 ASCII 字母数字开头；
 *   覆盖 `REQ-0001`、`REQ-合成-9901`、`C-3F2A19`、`20260926001`。
 * - 纯字母数字且很短（如 `abc1`）不判为 ID：它更像枚举取值，误伤代价高于收益。
 *
 * 宁可少发一格（并计入抑制数），也不发一个可能是 ID 的字符串。
 */
export function looksLikeIdentifier(value: string): boolean {
  const trimmed = value.trim()
  if (!/^[A-Za-z0-9]/.test(trimmed)) {
    return false
  }
  const hasSeparator = /[-_]/.test(trimmed)
  const longEnough = trimmed.length >= 12
  return hasSeparator || longEnough
}

/**
 * 把维度取值换成**允许外发**的取值。
 *
 * 返回 `null` 表示「该取值不能外发」——此时**整行省略**（不换成一个猜的值）。
 */
function safeKeyOf(
  level: PrivacyLevel,
  cell: AiSourceCell,
  positionCategories: readonly PositionCategoryRule[],
): string | null {
  switch (cell.dimension) {
    case 'recruiter':
      // HR：只出代号。没有代号（调用方没给）就整行不发——绝不回退成真实姓名
      return cell.recruiterCode ?? null
    case 'school':
      // 学校：只出层次，未知不猜（AI08）
      return schoolLevelOf(cell.isGptSchool ?? null)
    case 'position':
      // 岗位：只出类别；岗位全名不进载荷。映射由调用方传入（AI-6），没配就用中性标签
      return positionCategoryOf(cell.key, positionCategories)
    case 'salaryBand':
      // 薪资：必须是已分桶的区间字符串；未分桶的原始金额不发
      return cell.salaryBand ?? null
    case 'cycleBand':
      return cycleBandOf(cell.cycleDays ?? null)
    default:
      break
  }
  // 其余维度：本身是受控枚举（城市 / 渠道 / 学历…）或用户业务标签，按隐私级别决定是否保留
  if (level === 'strict' && cell.dimension !== 'city') {
    return null
  }
  /*
   * 长得像 ID 的取值一律不发（AI05：摘要里不得有需求 ID）。
   *
   * 为什么放在最后而不是各维度分别判断：ID 可能出现在**任何**一份名单里
   * （需求类型列被填成 `REQ-001`、渠道列被填成工号…），逐维度列举必然漏。
   * 宁可少发一格并计入抑制数，也不赌「这个维度的取值不会是 ID」。
   */
  if (looksLikeIdentifier(cell.key)) {
    return null
  }
  return cell.key
}

/** 一行是否可发布：D 必须达到门槛，否则整行抑制（不填 0） */
function rowIsPublishable(cell: AiSourceCell): boolean {
  return cell.coreDenominator >= AI_CELL_MIN_SAMPLE
}

/**
 * 组间构成索引（AI-2）：把调用方给的组内构成格按 `维度\u0000原始取值` 建索引，
 * 供主循环在生成每一行时**就地合并**。
 *
 * 为什么用「原始取值」而不是换算后的可外发取值做键：HR 的原始取值是分组序号、
 * 可外发取值是 `HR-1`，两者不同；用换算后的值做键会匹配不上，于是组内构成**静默丢失**
 * ——那是功能坏了，不是更安全。
 */
function rejectionProfileIndexOf(
  input: AiSummaryInput,
): ReadonlyMap<string, { readonly rejectedGroupCount: number; readonly joinedGroupCount: number }> {
  const index = new Map<string, { rejectedGroupCount: number; joinedGroupCount: number }>()
  for (const cell of input.rejectionProfile ?? []) {
    index.set(`${canonicalDimensionOf(cell.dimension)}\u0000${cell.key}`, {
      rejectedGroupCount: cell.rejectedGroupCount,
      joinedGroupCount: cell.joinedGroupCount,
    })
  }
  return index
}

/**
 * 组间构成的**样本量闸门**：比较人群不足 k 时这两个计数整对不发（不填 0）。
 *
 * 注意门槛用的是「拒 offer 组 + 入职组」而不是 D——这一块讲的就是比较人群，
 * 用 D 判断会让「D 够大但组间只有 3 人」的行混进来，而那正是可反算出个人的情形。
 */
function usableProfileOf(
  profile: { readonly rejectedGroupCount: number; readonly joinedGroupCount: number } | undefined,
): { readonly rejectedGroupCount: number; readonly joinedGroupCount: number } | undefined {
  if (profile === undefined) {
    return undefined
  }
  const compared = profile.rejectedGroupCount + profile.joinedGroupCount
  return compared >= AI_CELL_MIN_SAMPLE ? profile : undefined
}

/** 拒 offer 组间比较块：只有两个人群的分母与说明，数据行在主表的行里 */
function rejectionComparisonOf(input: AiSummaryInput): AiRejectionComparison | null {
  if (input.rejectionTotals === undefined) {
    return null
  }
  return {
    rejectedTotal: input.rejectionTotals.rejectedTotal,
    joinedTotal: input.rejectionTotals.joinedTotal,
    excludedFromComparison: input.rejectionTotals.excludedFromComparison,
    note: '组内构成写在 dimensions 每一行的 rejectedGroupCount / joinedGroupCount 上：分子是「该特征在拒 offer 组 / 入职组里的记录数」，分母分别是这里的 rejectedTotal（= R）与 joinedTotal（= J）。这是画像构成，不是该特征的拒 offer 率；特征内率的分子是同一行的 R、分母是 D（含待入职）。两个分母不同，必须分别说明。',
  }
}

/**
 * 构造脱敏后的 AI 载荷（白名单重建，唯一入口）。
 *
 * 步骤固定，且**每一步都可能省略内容**，省略必须记进 `omitted` 或 `limits`：
 * 1. 按隐私级别取允许维度（custom 只能在其允许集合内收窄，不能扩张）；
 * 2. 逐格换算出可外发取值（危险维度换代号 / 层次 / 类别 / 区间，换不出来就丢整行）；
 * 3. 抑制 `D < 5` 的格；
 * 4. 每维取 Top N 并**合并其余**（合并后重新合计，不平均百分比）；
 * 5. 跨表检查：同一维度只出现一次；出现两次说明调用方把同一维度拆到了多张表，
 *    直接整维省略（避免用两张表交叉还原小单元）；
 * 6. 算体积；超预算时**降级而不是截断**（丢最细的维度、只保留总体与城市）。
 */
export function buildSanitizedAiPayload(input: AiSummaryInput): SanitizedAiPayload {
  const level = input.privacyLevel
  /**
   * 岗位类别映射（AI-6）：**在这里规范化一次**，此后整条路径只用这一份。
   * 理由：映射来自加密仓里的偏好（可能被手改或来自旧版本），不合格的规则必须
   * 在这里就被丢掉，而不是「发出去之后才发现类别里带着一段自由文本」。
   */
  const positionCategories = normalizePositionCategoryRules(input.positionCategories ?? [])
  const allowed = new Set(
    input.allowedDimensions === undefined
      ? AI_DIMENSIONS_BY_LEVEL[level]
      : // custom / 显式传入：只允许在「基础白名单」之内收窄，不允许扩张
        input.allowedDimensions.filter((dimension) =>
          (AI_DIMENSIONS_BY_LEVEL.standard as readonly string[]).includes(dimension),
        ),
  )

  const omitted: AiOmittedEntry[] = []
  const limits: string[] = []
  let suppressedCellCount = 0

  /** 组内构成索引：按「载荷维度名 + 原始取值」建好，主循环里就地合并到同一行 */
  const profileIndex = rejectionProfileIndexOf(input)

  /** 维度 → 已换算好的格（保持输入顺序，保证同输入同产物） */
  const byDimension = new Map<string, AiPayloadRow[]>()
  const seenDimensions = new Set<string>()

  for (const cell of input.cells) {
    /*
     * 先把来源维度名归一化成载荷维度名再做白名单判断。
     * 来源系统给的是记录字段名（`school` / `position`），载荷白名单用的是
     * 能对外说的粒度名（`schoolLevel` / `positionCategory`）；不归一化会把这两个维度
     * 整维误判成「当前级别不发送」——那是静默丢功能，不是更安全。
     */
    const dimension = canonicalDimensionOf(cell.dimension)

    // 维度不在白名单：整维省略并记录原因（不静默丢弃）
    if (!allowed.has(dimension)) {
      if (!seenDimensions.has(dimension)) {
        seenDimensions.add(dimension)
        omitted.push({
          metricId: dimension,
          reason: `当前隐私级别（${level}）不发送该维度`,
        })
      }
      continue
    }

    // 跨表检查：同一维度只允许出现一次，重复出现时整维省略
    if (seenDimensions.has(dimension) && !byDimension.has(dimension)) {
      omitted.push({
        metricId: dimension,
        reason: '同一维度在多张表中重复出现，为避免交叉还原整维省略',
      })
      continue
    }

    const key = safeKeyOf(level, cell, positionCategories)
    if (key === null) {
      // 取值换不出来（HR 没代号 / 薪资没分桶 / 岗位未知）：整行不发
      suppressedCellCount += 1
      continue
    }

    if (!rowIsPublishable(cell)) {
      // n < 5：整格抑制，不填 0（AI06）
      suppressedCellCount += 1
      continue
    }

    const rows = byDimension.get(dimension) ?? []
    /*
     * 组内构成与 N/D/R 写在**同一行**：两个视角分母不同（组间比较人群 vs 核心率人群），
     * 但同行不会造出跨表可反算量（另开一张同维度的表就会，见 `AiProfileTable`）。
     * 比较人群不足 k 时整对不发——不填 0，也不退化成 `total` 之类的替代值。
     */
    const profileKey = `${dimension}\u0000${cell.key}`
    const rawProfile = profileIndex.get(profileKey)
    const profile = usableProfileOf(rawProfile)
    if (rawProfile !== undefined && profile === undefined) {
      suppressedCellCount += 1
    }
    rows.push(
      profile === undefined
        ? { key, N: cell.total, D: cell.coreDenominator, R: cell.rejected }
        : {
            key,
            N: cell.total,
            D: cell.coreDenominator,
            R: cell.rejected,
            rejectedGroupCount: profile.rejectedGroupCount,
            joinedGroupCount: profile.joinedGroupCount,
          },
    )
    byDimension.set(dimension, rows)
  }

  const dimensions: AiPayloadTable[] = []
  for (const [dimension, rows] of byDimension) {
    dimensions.push({
      metricId: `${dimension}.counts`,
      dim: dimension,
      dimLabel: AI_DIMENSION_LABELS[dimension as AiAllowedDimension] ?? dimension,
      rows: collapseTopN(rows),
    })
  }

  // 原因：只发受控类别与计数（自由文本原文没有位置）
  const rejectionReasons = input.reasons
    .filter((item) => item.count >= AI_CELL_MIN_SAMPLE)
    .map((item) => ({ key: item.category, count: item.count }))
  if (rejectionReasons.length < input.reasons.length) {
    suppressedCellCount += input.reasons.length - rejectionReasons.length
  }

  const rejectionComparison = rejectionComparisonOf(input)

  if (suppressedCellCount > 0) {
    limits.push(
      `有 ${String(suppressedCellCount)} 个单元格的有效样本不足 ${String(AI_CELL_MIN_SAMPLE)}，已整格省略（不是 0）。`,
    )
  }
  const smallDenominatorDims = dimensions
    .filter((table) => table.rows.some((row) => row.D < 10))
    .map((table) => table.dimLabel)
  if (smallDenominatorDims.length > 0) {
    limits.push(`以下维度的部分分组有效分母不足 10，只可描述、不可比较：${smallDenominatorDims.join('、')}。`)
  }

  const payload: SanitizedAiPayload = {
    schemaVersion: AI_SUMMARY_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    privacyLevel: level,
    dataAsOf: input.scope.dataAsOf,
    scope: {
      rowCount: input.scope.rowCount,
      dedupPolicy: input.scope.dedupPolicy,
      filters: input.scope.filters,
      ruleVersion: input.scope.ruleVersion,
    },
    kpi: {
      N: input.kpi.total,
      J: input.kpi.joined,
      P: input.kpi.pending,
      A: input.kpi.approving,
      R1: input.kpi.rejectedOffer,
      R2: input.kpi.rejectedVerbally,
      D: input.kpi.coreDenominator,
    },
    dimensions,
    rejectionReasons,
    quality: input.quality,
    limits,
    caliber: input.caliberNotes,
    rejectionComparison,
    omitted,
    suppressedCellCount,
    contentBytes: 0,
  }

  const sized = { ...payload, contentBytes: utf8Bytes(JSON.stringify(payload)) }
  if (sized.contentBytes > AI_SUMMARY_BYTE_BUDGET) {
    // 超预算：降级为只保留城市维度（更强的聚合），**不截断**、不降低 k
    const degraded: SanitizedAiPayload = {
      ...sized,
      dimensions: sized.dimensions.filter((table) => table.dim === 'city'),
      limits: [
        ...sized.limits,
        `摘要超过体积预算（${String(AI_SUMMARY_BYTE_BUDGET)} 字节）：已在本机降级为仅发送城市维度，请缩小筛选范围后重新生成。`,
      ],
    }
    return { ...degraded, contentBytes: utf8Bytes(JSON.stringify({ ...degraded, contentBytes: 0 })) }
  }
  return { ...sized, contentBytes: utf8Bytes(JSON.stringify({ ...sized, contentBytes: 0 })) }
}

/**
 * 每维取 Top N + 合并其余。
 *
 * 合并行必须**重新合计** N / D / R，绝不平均百分比（与看板的 TopN 口径一致）；
 * 合并行是一个聚合值，不是某个具体取值，因此命名为「其他（N 个分组合并）」。
 */
export function collapseTopN(rows: readonly AiPayloadRow[]): readonly AiPayloadRow[] {
  if (rows.length <= AI_SUMMARY_TOP_N) {
    return [...rows]
  }
  const sorted = [...rows].sort((left, right) =>
    right.D !== left.D ? right.D - left.D : right.N !== left.N ? right.N - left.N : left.key < right.key ? -1 : 1,
  )
  const head = sorted.slice(0, AI_SUMMARY_TOP_N)
  const tail = sorted.slice(AI_SUMMARY_TOP_N)
  /*
   * 合并行必须把新增的组内构成也**一起重新合计**，否则「其他」那一行的
   * rejectedGroupCount 会缺失，读者会把它当成「合并组里没有拒 offer 记录」——
   * 与合并 N/D/R 是同一条理由：合并行是一个聚合值，任何一项都不能漏合。
   *
   * 若尾部的构成数据本身不完整（有的行没有这两个键），合并结果**整对不发**：
   * 部分求和会得到一个比真实值小的数，那比不发更危险。
   */
  const profileComplete = tail.every(
    (row) => row.rejectedGroupCount !== undefined && row.joinedGroupCount !== undefined,
  )
  const merged: AiPayloadRow = {
    key: `其他（${String(tail.length)} 个分组合并）`,
    N: tail.reduce((sum, row) => sum + row.N, 0),
    D: tail.reduce((sum, row) => sum + row.D, 0),
    R: tail.reduce((sum, row) => sum + row.R, 0),
    ...(profileComplete
      ? {
          rejectedGroupCount: tail.reduce((sum, row) => sum + (row.rejectedGroupCount ?? 0), 0),
          joinedGroupCount: tail.reduce((sum, row) => sum + (row.joinedGroupCount ?? 0), 0),
        }
      : {}),
  }
  // 合并后若仍达不到门槛，则该合并行也抑制（不填 0）
  return merged.D >= AI_CELL_MIN_SAMPLE ? [...head, merged] : [...head]
}

/* ------------------------------------------------------------------ 校验 */

/**
 * 发送前的本地校验（PRD 17.4）。
 *
 * 与 `findSensitiveFields` 的分工：那个按**字段名**拦（`candidateName` 之类），
 * 这个按**载荷契约**拦（有没有未知属性、有没有越级的取值）。
 * 两者都要跑，因为它们防的是不同的事故。
 */
export type AiPayloadCheck = {
  readonly ok: boolean
  readonly problems: readonly string[]
}

/** 递归收集一个值里出现的所有键 */
export function collectKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, into)
    }
    return into
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      into.add(key)
      collectKeys(child, into)
    }
  }
  return into
}

/** 允许出现的键全集（由 `AI_SUMMARY_KEYS` 递归展开） */
export function allowedAiKeys(): readonly string[] {
  const keys = new Set<string>()
  const walk = (node: unknown): void => {
    if (node === true) {
      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        keys.add(key)
        walk(child)
      }
    }
  }
  walk(AI_SUMMARY_KEYS)
  return [...keys]
}

/**
 * 载荷契约校验：**出现任何未知键即失败**。
 *
 * 这条是白名单重建的运行时兜底：类型系统能挡住手写对象字面量，
 * 但挡不住 `as any` 或从存储读回来的脏数据。
 */
export function checkSanitizedAiPayload(value: unknown): AiPayloadCheck {
  const problems: string[] = []
  if (typeof value !== 'object' || value === null) {
    return { ok: false, problems: ['载荷不是对象'] }
  }
  const payload = value as SanitizedAiPayload
  if (payload.schemaVersion !== AI_SUMMARY_SCHEMA_VERSION) {
    problems.push(`schemaVersion 不是 ${AI_SUMMARY_SCHEMA_VERSION}`)
  }
  const allowed = new Set(allowedAiKeys())
  for (const key of collectKeys(payload)) {
    if (!allowed.has(key)) {
      problems.push(`出现未允许的键：${key}`)
    }
  }
  // 载荷里**不允许**出现任何数组型字符串值承载自由文本（原因只能出受控类别）
  for (const reason of payload.rejectionReasons ?? []) {
    if (typeof reason.key !== 'string' || reason.key.length > 40) {
      problems.push('原因类别异常（过长或非字符串）：疑似自由文本原文')
    }
  }
  return { ok: problems.length === 0, problems }
}

/**
 * 结构校验（类型守卫）：从本地加密仓读回 AI 历史 / 预览时，先确认「读到的确实是聚合载荷」。
 *
 * 与 `checkSanitizedAiPayload` 的分工：那个按**白名单契约**拦（出现未知键即失败，
 * 用于发送前自检）；这个只做**结构完整性**判断（用于读取后决定能不能安全展示），
 * 两者都**不做**脱敏检查——脱敏由 `findSensitiveFields` 负责，职责不同。
 */
export function isSanitizedAiPayload(value: unknown): value is SanitizedAiPayload {  if (typeof value !== 'object' || value === null) {
    return false
  }
  const payload = value as Partial<SanitizedAiPayload>
  if (payload.schemaVersion !== AI_SUMMARY_SCHEMA_VERSION) {
    return false
  }
  if (typeof payload.generatedAt !== 'string' || typeof payload.dataAsOf !== 'string') {
    return false
  }
  if (
    payload.privacyLevel !== 'strict' &&
    payload.privacyLevel !== 'standard' &&
    payload.privacyLevel !== 'custom'
  ) {
    return false
  }
  if (
    typeof payload.contentBytes !== 'number' ||
    !Number.isFinite(payload.contentBytes) ||
    payload.contentBytes < 0
  ) {
    return false
  }
  if (typeof payload.scope !== 'object' || payload.scope === null) {
    return false
  }
  if (typeof payload.kpi !== 'object' || payload.kpi === null) {
    return false
  }
  if (!Array.isArray(payload.dimensions) || !Array.isArray(payload.omitted)) {
    return false
  }
  return payload.omitted.every(
    (entry) => typeof entry?.metricId === 'string' && typeof entry?.reason === 'string',
  )
}
