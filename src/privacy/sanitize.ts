/**
 * 脱敏原语层（步骤11，docs/PRD.md 10.6 / 11.3 / 18.5）。
 *
 * 这一层是**纯函数**：不依赖 React / DOM / 网络 / 存储，可被 Node 单测直接覆盖。
 * 为什么要把「分桶、抑制、互补抑制、敏感字段检查」单独成层：
 * 1. 这些规则一旦写进导出组件，XLSX / Markdown / 打印 HTML / PNG 四条路径就会各写一遍，
 *    只要有一条漏掉，报告就会泄漏准确薪资或单个人数很少的小组（PRD 10.6）；
 * 2. 「抑制」不是「显示 0」：被抑制的字段必须是 `null`，由展示层显示「—」，
 *    否则读者会把「抑制」误读成「0 人」（AGENTS.md §6 明令禁止）；
 * 3. 敏感字段检查必须在**导出前**对最终模型再跑一次，作为最后一道闸门。
 *
 * 三条隐私判断（每条都在下面代码里注明理由）：
 * - 薪资只以区间出现：准确金额 + 小组人数可以反推出个人待遇（PRD 10.6）；
 * - 小组 n < 5 合并/抑制：交叉识别的最小可识别单元是「小组」，不是「整表」；
 * - 互补抑制：只抑制**一个**小组等于没抑制——总计减去其余组就能还原它。
 */

/* ------------------------------------------------------------------ 薪资区间 */

export type PrivacyLevel = 'strict' | 'standard' | 'custom'

/**
 * 薪资固定区间（docs/PRD.md 10.6，仅针对已确认「人民币元 / 月」）。
 * 用 `[3000,4000)` 这种半开区间表示，报文字面上不带方括号：
 * 区间字符串本身不给任何「更精确」的暗示（不写小数、不写成 `3000–3999`）。
 */
export type SalaryBand = '<3000' | '3000-4000' | '4000-5000' | '5000-6000' | '>=6000'

/** 分档边界（升序），与 PRD 10.6 的五个区间一一对应 */
export const SALARY_BAND_EDGES: readonly number[] = [3000, 4000, 5000, 6000]

/**
 * 金额 → 薪资区间。
 *
 * - `null` / 非法值 / 负值 → `null`：**缺失不等于 0 元**，也不能落进 `<3000`
 *   （否则「没填薪资」会被读成「低薪」，直接改变结论）；
 * - 边界取左闭右开：恰好 4000 落在 `4000-5000`，与 PRD 的 `[4000,5000)` 一致；
 * - 只接受有限数值；`NaN` / `Infinity` 一律 `null`（显示「—」而不是硬塞进某个桶）。
 */
export function salaryBandOf(
  amount: number | null,
  edges: readonly number[] = SALARY_BAND_EDGES,
): SalaryBand | null {
  if (amount === null || !Number.isFinite(amount) || amount < 0) {
    return null
  }
  const sorted = [...new Set(edges)]
    .filter((edge) => Number.isFinite(edge) && edge >= 0)
    .sort((left, right) => left - right)
  if (sorted.length === 0) {
    // 未配置边界时不发明区间：宁可不给薪资维度，也不给一个「凭感觉」的桶
    return null
  }

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const lower = sorted[index]
    if (amount >= lower) {
      const upper = sorted[index + 1]
      if (upper === undefined) {
        return `>=${lower}` as SalaryBand
      }
      return `${lower}-${upper}` as SalaryBand
    }
  }
  return `<${sorted[0]}` as SalaryBand
}

/* ------------------------------------------------------------------ 脱敏规则 */

export type SanitizeRules = {
  readonly suppressBelow: number
  readonly privacyLevel: PrivacyLevel
  /** true = 完全移除该校验项；false = 以分桶 / 代号形式保留 */
  readonly removeHrNames: boolean
  readonly removeRequirementIds: boolean
  readonly removeReferrerNames: boolean
  readonly removeFreeTextReasons: boolean
  /** 精确分位改为区间（PRD 10.6：准确中位数必须改为区间或隐藏） */
  readonly quantileMode: 'band' | 'hide'
  /** 明细默认不导出；开启时必须使用报告内记录代号 */
  readonly includeRecordDetail: boolean
  readonly title: string
  /**
   * 以下为**新增**（不改动上面的冻结契约），用于把 PRD 18.5 的三个隐私级别落到可执行开关上：
   * 没有它们，strict 与 standard 的差别只能写死在组件里，等于把隐私决策散到界面层。
   */
  readonly removeCityNames: boolean
  readonly removeDimensionLabels: boolean
  readonly removeSourceFileNames: boolean
  readonly salaryBandEdges: readonly number[]
}

/**
 * 默认（standard）规则：PRD 18.5 的 standard 级别 + PRD 10.6 的默认导出口径。
 * 默认就是「聚合报告」：不含逐条明细、HR 用代号、需求 ID / 推荐人 / 自由文本原因全部移除。
 */
export const DEFAULT_SANITIZE_RULES: SanitizeRules = {
  // PRD 10.6：学校 / 岗位小组 n < 5 合并或抑制
  suppressBelow: 5,
  privacyLevel: 'standard',
  removeHrNames: true,
  removeRequirementIds: true,
  removeReferrerNames: true,
  removeFreeTextReasons: true,
  // 准确中位数一律改为区间：区间仍可读（团队薪资水平），原值不可还原
  quantileMode: 'band',
  // 默认不导出逐条明细（PRD 11.4 第一条）
  includeRecordDetail: false,
  title: '实习生招聘复盘报告',
  removeCityNames: false,
  removeDimensionLabels: false,
  removeSourceFileNames: true,
  salaryBandEdges: SALARY_BAND_EDGES,
}

/**
 * strict 规则：PRD 18.5 的 strict 级别——仅总体 + 城市 + 状态结构，量化维度更粗分桶，
 * HR / 岗位 / 学校层次全部省略，原因仅类别。
 *
 * 与 standard 的差别刻意做成「更粗 + 更少维度」，而不是「换个说法」：
 * 城市名保留但维度标签一律换成代号（D1 / D2…），这样即使维度名本身可识别（例如岗位名），
 * 也不会出现在报告里。抑制门槛同时提高到 10：分桶更粗时只剩更少的组，
 * 门槛若仍是 5，一个 6 人的组在粗分桶下反而更容易被交叉识别。
 */
export const STRICT_SANITIZE_RULES: SanitizeRules = {
  suppressBelow: 10,
  privacyLevel: 'strict',
  removeHrNames: true,
  removeRequirementIds: true,
  removeReferrerNames: true,
  removeFreeTextReasons: true,
  quantileMode: 'hide',
  includeRecordDetail: false,
  title: '实习生招聘复盘报告（严格脱敏）',
  removeCityNames: true,
  removeDimensionLabels: true,
  removeSourceFileNames: true,
  salaryBandEdges: SALARY_BAND_EDGES,
}

/** 按级别取规则；custom 不在本函数内解析（custom 必须由调用方显式给出每一项开关） */
export function rulesOfLevel(level: PrivacyLevel): SanitizeRules {
  if (level === 'strict') {
    return STRICT_SANITIZE_RULES
  }
  return DEFAULT_SANITIZE_RULES
}

/* ------------------------------------------------------------------ 抑制说明 */

/** 一条抑制说明：只写「哪个路径被抑制、为什么、抑制了几组」，绝不写被抑制的组名 */
export type SuppressionNote = {
  readonly path: string
  readonly reason: string
  readonly suppressedCount: number
}

/* ------------------------------------------------------------------ 小组抑制与互补抑制 */

/**
 * 抑制计算用的中间结构。
 *
 * 为什么不复用 `GroupSummary`：抑制是**导出决策**，输入里不需要（也不应该）携带原始记录，
 * 只需要计数。少带一段原始数据，就少一条「把明细写进报告」的路径。
 */
export type SuppressibleGroup = {
  readonly key: string
  readonly total: number
  readonly coreDenominator: number
  readonly suppressed: boolean
  /** 该行代表几个原始分组合并而来；1 表示未合并 */
  readonly mergedCount: number
}

export type ComplementarySuppressionOptions = {
  /** 至少要有多少个分组被抑制；默认 2（PRD 10.6 互补抑制） */
  readonly minSuppressed: number
  /** 主抑制使用的门槛，用于「优先抑制本来就小的组」的排序 */
  readonly suppressBelow: number
  /**
   * 已经被**主抑制**隐藏掉的分组数（合并行代表的那些原始分组）。
   *
   * 为什么必须传进来：合并行本身已经不给标签、不给原分组数字，读者无法再点名还原它们；
   * 若不算进「已隐藏」的数量，本函数会以为「一个组都没隐藏」而额外再抑制一个**可见**组，
   * 结果是整个维度只剩被抑制的行——报告彻底不可读，而隐私上并没有多保护什么。
   */
  readonly hiddenGroupCount?: number
}

/**
 * 互补抑制：每个维度内保证**至少两个**分组的信息被隐藏。
 *
 * 为什么必须是两个：只隐藏一个组时，读者用「总计 − 其余组」就能把这个组精确还原，
 * 抑制等于没做。这与 PRD 10.6「必要时做互补抑制，避免用总计减去其他组还原小组」一致。
 *
 * 选择规则（确定性，可单测）：
 * 1. 主抑制已合并掉的分组（`hiddenGroupCount`）与已标记 `suppressed` 的组先计入；
 * 2. 不足时从**未抑制**的组里补，顺序 = 总数升序 → 核心分母升序 → key 升序：
 *    先牺牲信息量最小（人数最少）的组，既减少影响，也避免「每次都固定牺牲最后一组」的偏向；
 * 3. **不会把可见分组全部抑制**：至少留一个可见组，否则这个维度就等于整维消失，
 *    那样应该由调用方显式整维抑制并给出理由，而不是让读者看到一张空表；
 * 4. 候选不足时**不补充**：这时「至少两个」在数学上做不到，硬标一个只是自欺欺人
 *    （读者仍能用总计减其余还原它），交给调用方整维抑制并写明原因才是诚实的做法。
 *
 * 本函数不改动入参，返回新的数组。
 */
export function applyComplementarySuppression(
  groups: readonly SuppressibleGroup[],
  options: ComplementarySuppressionOptions,
): readonly SuppressibleGroup[] {
  const minSuppressed = Math.max(0, Math.floor(options.minSuppressed))
  const hiddenByPrimary = Math.max(0, Math.floor(options.hiddenGroupCount ?? 0))
  const alreadySuppressed =
    groups.filter((group) => group.suppressed).length + hiddenByPrimary
  if (groups.length === 0 || alreadySuppressed >= minSuppressed) {
    return [...groups]
  }

  const need = minSuppressed - alreadySuppressed
  const candidates = groups
    .map((group, index) => ({ group, index }))
    .filter((item) => !item.group.suppressed)
    .sort((left, right) => {
      if (left.group.total !== right.group.total) {
        return left.group.total - right.group.total
      }
      if (left.group.coreDenominator !== right.group.coreDenominator) {
        return left.group.coreDenominator - right.group.coreDenominator
      }
      return left.group.key < right.group.key ? -1 : left.group.key > right.group.key ? 1 : 0
    })

  // 至少留一个可见分组：候选数不超过 need 时不补充（否则整维只剩被抑制的行）
  const shouldSuppress = candidates.length > need
  const toSuppress = new Set(
    shouldSuppress ? candidates.slice(0, need).map((item) => item.index) : [],
  )
  return groups.map((group, index) =>
    toSuppress.has(index) ? { ...group, suppressed: true } : group,
  )
}

/* ------------------------------------------------------------------ 敏感字段检查 */

/**
 * 禁止出现在任何导出内容 / AI 载荷里的**字段名**（PRD 10.6、AGENTS.md §2.2）。
 *
 * 为什么按「字段名」而不是「字段含义」列：含义无法自动检查，字段名可以。
 * 这份清单同时是 `findSensitiveFields` 的判定表，因此它必须覆盖
 * domain 层 `SENSITIVE_STANDARD_FIELDS` / `IDENTITY_RULES.forbiddenIdentityFields`
 * 里的全部角色字段（candidateName / requirementId / referrer / recruiter / salaryAmount 等），
 * 否则「导出前本地检查」会漏掉真实附件里最危险的那几列。
 */
export const FORBIDDEN_FIELD_NAMES: readonly string[] = [
  'candidateName',
  'candidateId',
  'candidateDisplayId',
  'recordId',
  'requirementId',
  'requirementIds',
  'referrer',
  'referrers',
  'recruiter',
  'recruiters',
  'hrName',
  'ownerName',
  'salaryAmount',
  'salaryAmounts',
  'exactSalary',
  'salaryRaw',
  'housingAmount',
  'housingRaw',
  'rejectionReason',
  'rejectionReasons',
  'reasonText',
  'freeTextReason',
  'sourceFileName',
  'sourceRow',
  'sourceSheet',
  'rawValue',
  'rows',
  'rawRows',
  'cells',
  'values',
  'phone',
  'mobile',
  'email',
  'wechat',
  'idCard',
  '姓名',
  '候选人',
  '推荐人',
  '需求ID',
  '需求 ID',
  '招聘HR',
  '薪资原值',
  '拒绝原因原文',
  '原始行',
  '源文件名',
]

/**
 * 禁止出现的键（与字段名同源，单独一份便于按「键」做结构化检查）。
 *
 * 注意：这里刻意**不**包含 `details`、`reasons`、`salary`、`city`、`position` 这类
 * 「结构名」——它们既是报告自身的合法章节名，本身也不指向任何个人。
 * 把它们列进来只会让导出的最后一道闸门永远报错，从而被迫加豁免，反而更危险。
 */
export const FORBIDDEN_KEYS: readonly string[] = [...FORBIDDEN_FIELD_NAMES]

/**
 * 把字段名归一化成小写 token 序列。
 *
 * 分隔符：下划线 / 连字符 / 点 / 全角下划线 / 空白；驼峰边界也拆开
 * （`candidateName` → `candidate` `name`），否则 `candidate_name` 与 `candidateName`
 * 会被当成两个不同的东西（PRD 11.5 明确要求两种写法都要能被检索出来）。
 */
function keyTokens(text: string): readonly string[] {
  return text
    .replace(/[\s_\-.\uFF3F]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim()
    .split(' ')
    .filter((token) => token !== '')
}

/** 报告里出现「命中哨兵值」时返回该标记：只报位置，**绝不**回显命中的原文 */
export const SENTINEL_HIT_LABEL = '<值命中哨兵>'

/**
 * 组合写法的最短长度门槛。
 *
 * 为什么需要：`sourceRowExcludedCount` 这类**合法**的统计字段名，归一化后含 `sourcerow`
 * 子串，整串包含匹配会把它误判成 `sourceRow`。规则改为「只有**较长**的禁名（≥11 个字符）
 * 才允许作为子串命中」后，`sourceRow`(9) / `rows` / `values` 的误伤消失，
 * 而 `candidateName`(13) / `sourceFileName`(14) 这类真正危险的列名在任何拼接写法下仍会被抓到。
 */
const COMPACT_MIN_LENGTH = 11

/**
 * 由 `FORBIDDEN_FIELD_NAMES` **派生**的两张判定表。
 *
 * 为什么派生而不是另写一份常量：两份清单一旦漂移，就会出现「清单里写了禁名、检查却抓不到」
 * 的空档——那种漏洞在评审时完全看不出来。派生之后，新增一个禁名必然同时获得判定能力，
 * 单测里「每个被禁字段名都能被捕获」这条断言才有意义。
 */
const FORBIDDEN_ENGLISH: readonly string[] = FORBIDDEN_FIELD_NAMES.filter(
  (name) => !/[\u4e00-\u9fff]/u.test(name),
)

/** 只有中文（或含中文）的禁词直接做子串匹配：中文没有分词歧义 */
const CJK_FORBIDDEN: readonly string[] = FORBIDDEN_FIELD_NAMES.filter((name) =>
  /[\u4e00-\u9fff]/u.test(name),
).map((name) => name.toLowerCase())

/** 英文禁名的归一化全串（驼峰与下划线写法收敛成同一个键） */
const SINGLE_KEY_BLOCKLIST: readonly string[] = [
  ...new Set(FORBIDDEN_ENGLISH.map((name) => keyTokens(name).join(''))),
]

/** 英文禁名的**组合**写法：归一化后整串包含即命中（受 `COMPACT_MIN_LENGTH` 约束） */
const COMPACT_KEY_BLOCKLIST: readonly string[] = SINGLE_KEY_BLOCKLIST.filter(
  (name) => name.length >= COMPACT_MIN_LENGTH,
)

/**
 * 该字符串是否含被禁字段名（大小写不敏感；`candidateName` 命中 `candidateName` 与 `candidate_name`）。
 *
 * 判定粒度的取舍（这条注释是给以后改这里的人看的）：
 * 早期实现用「去掉结尾 s 再比 token」，结果 `value` 被 `values` 误伤、`row` 被 `rows` 误伤——
 * `values` / `rows` / `cells` 这类**原始数据字段名**必须禁，但报告自己的合法键 `value` / `total`
 * 不能因此被拦（否则导出的最后一道闸门永远报错，只能被迫加豁免，等于没有闸门）。现在的规则：
 * 1. 中文禁名（`姓名` / `推荐人` / `需求ID`）直接子串匹配（`需求id` 与 `需求ID` 都能命中）；
 * 2. 英文禁名按**整键**匹配（`value` ≠ `values`，但 `candidate_name` = `candidateName`）；
 * 3. 再用「归一化整串包含」补一次拼接写法，且只对较长的禁名生效（见 `COMPACT_MIN_LENGTH`）。
 * 代价是 `candidate_name_x` 这类「长禁名 + 后缀」的拼接列会被报出来——这是**有意的**：
 * 宁可让用户手工确认一次，也不能漏掉一列名字。
 */
export function containsForbiddenField(text: string): boolean {
  if (text.trim() === '') {
    return false
  }
  const lower = text.toLowerCase()
  const compact = keyTokens(text).join('')

  if (CJK_FORBIDDEN.some((name) => lower.includes(name))) {
    return true
  }
  if (SINGLE_KEY_BLOCKLIST.includes(compact)) {
    return true
  }
  return COMPACT_KEY_BLOCKLIST.some((name) => compact.includes(name))
}

/**
 * 列出文本里出现的**具体**禁名（用于让界面告诉用户「命中了哪些字段名」）。
 *
 * 为什么需要它：`containsForbiddenField` 只回答「命中没命中」，而界面在提示用户时
 * 需要说清**是哪几个**名字（AI-5 的回复侧检查要求「只列字段名与位置、不回显值」）。
 * 两者共用同一张派生表，因此不可能出现「判定说命中、列举说没有」的矛盾。
 *
 * 返回**去重排序**的禁名清单；拼接写法（如 `candidate_name_x`）命中的是那个较长的禁名本身。
 */
export function forbiddenNamesIn(text: string): readonly string[] {
  if (text.trim() === '') {
    return []
  }
  const lower = text.toLowerCase()
  const compact = keyTokens(text).join('')
  const hits = new Set<string>()

  for (const name of FORBIDDEN_FIELD_NAMES) {
    const isCjk = /[\u4e00-\u9fff]/u.test(name)
    if (isCjk) {
      if (lower.includes(name.toLowerCase())) {
        hits.add(name)
      }
      continue
    }
    const normalized = keyTokens(name).join('')
    // 整键命中，或（较长的禁名）拼接命中——与 `containsForbiddenField` 的判定完全一致
    if (normalized === compact) {
      hits.add(name)
    } else if (normalized.length >= COMPACT_MIN_LENGTH && compact.includes(normalized)) {
      hits.add(name)
    }
  }

  return [...hits].sort()
}

/**
 * 敏感字段检查的结果明细。
 *
 * 为什么要分类而不是只给一个字符串数组：界面必须能分别告诉用户
 * 「报告里出现了不该有的字段名」与「报告里出现了本机已知的敏感值」——
 * 两者的处置完全不同（前者改代码 / 结构，后者要查是哪条数据漏了出去）。
 * 两个列表都**只含字段名与位置标记**，绝不回显命中的值。
 */
export type SensitiveScan = {
  /** 命中的被禁字段名（去重升序，形如 `details[0].candidateName`） */
  readonly forbiddenFieldNames: readonly string[]
  /** 命中的哨兵位置（去重升序，形如 `kpis[0].label:<值命中哨兵>`） */
  readonly sentinelHits: readonly string[]
}

/** 扫描实现（`findSensitiveFields` 与 `scanSensitiveFields` 共用，避免出现两套判定） */
function scanSensitive(input: unknown, sentinels: readonly string[]): SensitiveScan {
  const forbiddenFieldNames = new Set<string>()
  const sentinelHits = new Set<string>()
  const targets = sentinels
    .map((sentinel) => sentinel.trim().toLowerCase())
    .filter((sentinel) => sentinel !== '')

  const visit = (value: unknown, path: string): void => {
    if (value === null || value === undefined) {
      return
    }
    if (typeof value === 'string') {
      const lower = value.toLowerCase()
      if (targets.some((target) => lower.includes(target))) {
        sentinelHits.add(`${path}:${SENTINEL_HIT_LABEL}`)
      }
      return
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      // 数值**不**参与哨兵匹配：报告里的数字都是计数 / 分位 / 分桶边界，
      // 拿文本哨兵去 `includes` 一个数字只会产生巧合命中（'3500' 命中 `6`），
      // 把合法报告整份拦下来——那会逼着调用方给闸门加豁免，反而更危险。
      // 准确薪资的风险已由「金额只以区间出现」从结构上消除（`salaryBandOf`）。
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${String(index)}]`))
      return
    }
    if (typeof value === 'object') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const childPath = path === '' ? key : `${path}.${key}`
        if (containsForbiddenField(key)) {
          forbiddenFieldNames.add(childPath)
        }
        visit(child, childPath)
      }
    }
  }

  visit(input, '')
  return {
    forbiddenFieldNames: [...forbiddenFieldNames].sort(),
    sentinelHits: [...sentinelHits].sort(),
  }
}

/**
 * 敏感字段本地检查：返回命中的字段名 / 位置（空数组 = 通过）。导出前**必须**调用。
 *
 * 两类命中：
 * 1. **字段名命中**：任何一个键（含嵌套键）命中 `FORBIDDEN_FIELD_NAMES` → 返回 `路径.键名`；
 *    这样界面既能显示「哪个字段有问题」，也不会把值打印出来；
 * 2. **哨兵值命中**：调用方传入的哨兵字符串（例如合成候选人姓名 / HR 姓名 / 需求 ID / 原因原文）
 *    出现在任何**字符串值**里 → 返回 `路径:SENTINEL_HIT_LABEL`。
 *    字符级子串匹配（去掉大小写差异）刻意比字段名匹配更宽：哨兵是本机已知的真实敏感值，
 *    宁可多报一次让用户复核，也不能漏。
 *
 * 数值不参与哨兵匹配：报告的数值都是计数 / 分位 / 分桶边界，拿文本哨兵去比只会巧合命中
 * （'3500' 命中 `6`）而把合法报告整份拦下；准确薪资的风险已由「金额只以区间出现」从结构上消除。
 *
 * 输入可以是任意 JSON 值（报告对象、AI 载荷、导出前的中间结构都行）。
 */
/**
 * 敏感字段本地检查：返回命中的字段名 / 位置（空数组 = 通过）。导出前**必须**调用。
 *
 * 两类命中：
 * 1. **字段名命中**：任何一个键（含嵌套键）命中 `FORBIDDEN_FIELD_NAMES` → 返回 `路径.键名`；
 *    这样界面既能显示「哪个字段有问题」，也不会把值打印出来；
 * 2. **哨兵值命中**：调用方传入的哨兵字符串（例如合成候选人姓名 / HR 姓名 / 需求 ID / 原因原文）
 *    出现在任何**字符串值**里 → 返回 `路径:SENTINEL_HIT_LABEL`。
 *    字符级子串匹配（去掉大小写差异）刻意比字段名匹配更宽：哨兵是本机已知的真实敏感值，
 *    宁可多报一次让用户复核，也不能漏。
 *
 * 数值不参与哨兵匹配：报告的数值都是计数 / 分位 / 分桶边界，拿文本哨兵去比只会巧合命中
 * （'3500' 命中 `6`）而把合法报告整份拦下；准确薪资的风险已由「金额只以区间出现」从结构上消除。
 *
 * 输入可以是任意 JSON 值（报告对象、AI 载荷、导出前的中间结构都行）。
 */
export function findSensitiveFields(
  input: unknown,
  sentinels: readonly string[] = [],
): readonly string[] {
  const scan = scanSensitive(input, sentinels)
  return [...scan.forbiddenFieldNames, ...scan.sentinelHits].sort()
}

/**
 * 同上，但返回**分类结果**（供界面分别说明「字段名命中」与「值命中」）。
 *
 * `findSensitiveFields` 与它共用同一份遍历实现，因此两者永远不会出现
 * 「一个说通过、另一个说命中」的分裂——界面用它做展示，导出层用前者做闸门。
 */
export function scanSensitiveFields(
  input: unknown,
  sentinels: readonly string[] = [],
): SensitiveScan {
  return scanSensitive(input, sentinels)
}

/* ------------------------------------------------------------------ allowedKeys */

/** 允许出现在脱敏报告里的键（嵌套只按结构名递归，不展开数组元素名） */
export type AllowedKeys = { readonly [key: string]: true | AllowedKeys }

/**
 * 递归收集一个对象里出现过的全部键名。
 *
 * 为什么用「运行时收集」而不是手写常量：字段名一旦与结构漂移，`allowedKeys` 就会变成
 * 一份骗人的清单；而建好的模型是唯一事实来源——它自己有哪些键就是答案。
 * 返回的键名按字母序排列，保证同一份输入得到同样的清单（报告要可复现）。
 */
export function collectAllowedKeys(value: unknown): readonly string[] {
  const keys = new Set<string>()
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (node === null || typeof node !== 'object') {
      return
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      keys.add(key)
      visit(child)
    }
  }
  visit(value)
  return [...keys].sort()
}

/**
 * 冻结的 `allowedKeys` 常量：把「报告允许有哪些键」显式写下来，
 * 供评审直接比对（PRD 10.6「导出前先构造唯一模型」的可审计形式）。
 * `buildSanitizedReport` 返回的是它与 `collectAllowedKeys(报告)` 的并集。
 */
export const SANITIZE_KEYS = {
  meta: {
    title: true,
    generatedAt: true,
    dataAsOf: true,
    dedupStrategy: true,
    cleaningRuleVersion: true,
    analysisRuleVersion: true,
    privacyLevel: true,
    activeFilters: true,
    suppressionNote: true,
    limitationNote: true,
  },
  section: { id: true, title: true, notes: true },
  kpi: { id: true, label: true, value: true, numerator: true, denominator: true, note: true },
  rate: {
    id: true,
    label: true,
    numerator: true,
    denominator: true,
    value: true,
    suppressed: true,
    note: true,
  },
  cycle: {
    label: true,
    n: true,
    p25: true,
    p25Band: true,
    median: true,
    medianBand: true,
    p75: true,
    p75Band: true,
    meanDays: true,
    suppressed: true,
    note: true,
  },
  group: {
    label: true,
    code: true,
    total: true,
    joined: true,
    pending: true,
    approving: true,
    rejected: true,
    coreDenominator: true,
    rejectedRate: true,
    cycle: true,
    suppressed: true,
  },
  dimension: {
    dimension: true,
    label: true,
    groups: true,
    total: true,
    mergedGroupCount: true,
    suppressedGroupCount: true,
    notes: true,
  },
  reason: { category: true, count: true, share: true, suppressed: true },
  conclusion: {
    level: true,
    text: true,
    ruleId: true,
    ruleVersion: true,
    metConditions: true,
    unknownConditions: true,
    suggestedCheck: true,
    scopeNote: true,
  },
  advice: { observation: true, advice: true },
  detail: {
    recordCode: true,
    status: true,
    city: true,
    channel: true,
    salaryBand: true,
    cycleDays: true,
    cycleBand: true,
  },
  contract: { identityStatus: true, identityNote: true, hasCrossBatchIdentity: true },
  quality: {
    keptRows: true,
    issueRows: true,
    unknownShareNote: true,
    effectiveSampleNotes: true,
  },
  suppression: { path: true, reason: true, suppressedCount: true },
} as const satisfies AllowedKeys
