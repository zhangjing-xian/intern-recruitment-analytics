/**
 * 拒 offer 专项的**纯函数层**（步骤10，docs/PRD.md 9 章）。
 *
 * 分成三件事，各自只有一个实现：
 * 1. **分析人群**：拒 offer 组 = 拒绝 offer + 拒绝口头 offer；入职组 = 已入职。
 *    待入职与审批中**不进**任何一组，但仍在核心拒 offer 率的分母 D 中——所以每个分组汇总
 *    同时带「全部口径」与「两组口径」数字，界面必须把两个人群说清楚（PRD 9.1）；
 * 2. **原因分类与分布**：只在**附件已有的受控取值**上做精确查表，绝不从自由文本里推断原因。
 *    匹配不上就是「未分类」，绝不猜成「薪酬」；未填写单列；
 * 3. **运营关注标签**：确定性规则 + 可配置阈值，输出证据、未知条件、比较基准与建议核查事项。
 *    这是**规则筛查**，不是概率模型（PRD 9.3）。
 *
 * 边界：本模块是纯函数，不依赖 React / 网络 / 存储，也不读会话；阈值一律由调用方传入
 * （默认值只是初始运营规则，不是行业标准，且必须随报告一起记录）。
 */

import {
  HOUSING_ACCOMMODATION,
  HOUSING_CASH,
  HOUSING_NO_SUBSIDY,
  JOINED_STATUS,
  countsTowardCoreDenominator,
  isRejectedStatus,
  type HousingType,
} from '../enums'
import type { NormalizedRecord, SalaryBenchmarkSummary } from '../types'

import { isWaitingTooLong, waitingDurationFor } from './durations'
import { isBelowBenchmarkMedian } from './salary'

/* ------------------------------------------------------------------ 分析人群 */

/** 拒 offer 专项里的两组；`null` = 不属于任何一组（待入职 / 审批中 / 其他 / 未知） */
export const REJECTION_ANALYSIS_GROUPS = ['rejected', 'joined'] as const
export type RejectionAnalysisGroup = (typeof REJECTION_ANALYSIS_GROUPS)[number]

export const REJECTION_GROUP_LABELS: Readonly<Record<RejectionAnalysisGroup, string>> = {
  rejected: '拒 offer 组（拒绝 offer + 拒绝口头 offer）',
  joined: '入职组（已入职）',
}

export const REJECTION_GROUP_SHORT_LABELS: Readonly<Record<RejectionAnalysisGroup, string>> = {
  rejected: '拒 offer 组',
  joined: '入职组',
}

/**
 * 记录属于哪一组。**只有**拒绝（含口头）与已入职进组：
 * 待入职 / 审批中 / 其他 / 未知一律返回 null，不得混入任何一组比较。
 */
export function rejectionGroupOf(record: NormalizedRecord): RejectionAnalysisGroup | null {
  if (isRejectedStatus(record.offerStatus) === true) {
    return 'rejected'
  }
  if (record.offerStatus === JOINED_STATUS) {
    return 'joined'
  }
  return null
}

/** 两组比较的人群（R ∪ J）；待入职与审批中被排除在外，但调用方仍要用全量记录算 D */
export function comparisonRecords(
  records: readonly NormalizedRecord[],
): readonly NormalizedRecord[] {
  return records.filter((record) => rejectionGroupOf(record) !== null)
}

/* ------------------------------------------------------------------ 原因分类 */

/**
 * 受控的原因类别（PRD 9.2 的默认字典）。
 * `未分类` 与 `未填写` **必须分开**：前者说明该列有值但不在字典内（应提示维护字典），
 * 后者说明根本没填（应提示补充访谈）。
 */
export const REJECTION_REASON_CATEGORIES = [
  '薪酬',
  '住房/住宿',
  '其他offer',
  '岗位内容',
  '地点',
  '实习时间',
  '学业安排',
  '个人原因',
  '其他',
  '未分类',
  '未填写',
] as const
export type RejectionReasonCategory = (typeof REJECTION_REASON_CATEGORIES)[number]

/** 字典内可被命中的类别（不含两个兜底类） */
export const CLASSIFIABLE_REASON_CATEGORIES = REJECTION_REASON_CATEGORIES.filter(
  (category): category is Exclude<RejectionReasonCategory, '未分类' | '未填写'> =>
    category !== '未分类' && category !== '未填写',
)

export const UNCLASSIFIED_REASON_LABEL: RejectionReasonCategory = '未分类'
export const UNFILLED_REASON_LABEL: RejectionReasonCategory = '未填写'

/**
 * 原值 → 类别的**精确**字典（先去掉全部空白再比对，因此「其他 offer」也能命中）。
 *
 * 只收录两类键：PRD 9.2 列出的类别名本身，以及附件里确实出现过的等价写法。
 * **不做子串匹配、不做同义词推断**——「薪酬太低所以去了别家」这种自由文本必须落到「未分类」，
 * 由维护字典的人决定怎么归（AGENTS §6：不凭背景推断拒绝原因）。
 */
const REASON_DICTIONARY: Readonly<Record<string, RejectionReasonCategory>> = {
  // 类别名本身
  薪酬: '薪酬',
  '住房/住宿': '住房/住宿',
  住宿: '住房/住宿',
  住房: '住房/住宿',
  其他offer: '其他offer',
  岗位内容: '岗位内容',
  地点: '地点',
  实习时间: '实习时间',
  学业安排: '学业安排',
  个人原因: '个人原因',
  其他: '其他',
  // 附件与口语里常见的等价写法
  薪资: '薪酬',
  薪资不满意: '薪酬',
  薪酬不满意: '薪酬',
  工资低: '薪酬',
  待遇不满意: '薪酬',
  房补: '住房/住宿',
  住房补贴: '住房/住宿',
  无补贴: '住房/住宿',
  住宿问题: '住房/住宿',
  有其他offer: '其他offer',
  拿到其他offer: '其他offer',
  其他机会: '其他offer',
  工作内容不符: '岗位内容',
  岗位不匹配: '岗位内容',
  工作地点: '地点',
  通勤: '地点',
  距离太远: '地点',
  时间不合适: '实习时间',
  实习时间不合适: '实习时间',
  开学: '学业安排',
  课程冲突: '学业安排',
  学业: '学业安排',
  个人: '个人原因',
  家庭原因: '个人原因',
  身体原因: '个人原因',
}

/** 去掉全部空白字符（含全角空格），用于字典比对；不改动原文 */
function normalizeReasonKey(raw: string): string {
  let result = ''
  for (const char of raw) {
    if (!/\s/u.test(char)) {
      result += char
    }
  }
  return result
}

/**
 * 把一条原因原值映射到受控类别。
 *
 * 规则：空 / 纯空白 → `未填写`；字典命中（忽略空白与拉丁字母大小写）→ 对应类别；
 * 其余一律 `未分类`——**不猜**。返回 `matched: false` 时界面应提示「该值不在字典内」。
 */
export function classifyRejectionReason(raw: string | null): {
  readonly category: RejectionReasonCategory
  readonly matched: boolean
} {
  if (raw === null || raw.trim() === '') {
    return { category: UNFILLED_REASON_LABEL, matched: false }
  }
  const key = normalizeReasonKey(raw).toLowerCase()
  for (const [dictionaryKey, category] of Object.entries(REASON_DICTIONARY)) {
    if (normalizeReasonKey(dictionaryKey).toLowerCase() === key) {
      return { category, matched: true }
    }
  }
  return { category: UNCLASSIFIED_REASON_LABEL, matched: false }
}

export type RejectionReasonCategoryCount = {
  readonly category: RejectionReasonCategory
  readonly count: number
  /** 占拒 offer 总数 R 的比例；R = 0 时为 null（不显示 0%） */
  readonly share: number | null
}

export type RejectionReasonDistribution = {
  /** 分母：**全部**拒 offer 记录 R（含「未填写」），不是「已填写」子集 */
  readonly denominator: number
  /** 按 R 的占比分布，顺序固定为 `REJECTION_REASON_CATEGORIES`（计数为 0 的也保留） */
  readonly categories: readonly RejectionReasonCategoryCount[]
  /** 已填写原因数（= R − 未填写数） */
  readonly filledCount: number
  /** 填写率 = filledCount / R；R = 0 时为 null */
  readonly fillRate: number | null
  /** 命中字典的条数（用于提示字典是否需要维护） */
  readonly matchedCount: number
  /** 有值但不在字典内的条数（单列，便于维护字典而不是悄悄归到「其他」） */
  readonly unclassifiedCount: number
  /** 不在字典内的原值样例（去重、截断，仅本机展示；用于让用户自己判断怎么归） */
  readonly unclassifiedSamples: readonly string[]
  readonly note: string
}

/** 未分类样例最多展示几条（只做提示，不替代字典维护） */
const UNCLASSIFIED_SAMPLE_LIMIT = 5
/** 样例原文最大长度（避免把一整段自由文本带进界面与报告） */
const UNCLASSIFIED_SAMPLE_MAX_LENGTH = 24

export const REASON_DISTRIBUTION_NOTE =
  '分母是全部拒 offer 记录 R（含「未填写」），不是「已填写」子集；「未分类」表示该列有值但不在字典内，需要维护字典而不是猜。'

/**
 * 拒 offer 原因分布（PRD 9.2）。
 *
 * 分母恒为 R：原因全缺失时应得到填写率 **0%** 与一个 100% 的「未填写」，
 * 而不是 null，也绝不允许据此输出「主要因为薪酬」。
 */
export function rejectionReasonDistribution(
  records: readonly NormalizedRecord[],
): RejectionReasonDistribution {
  const counts = new Map<RejectionReasonCategory, number>(
    REJECTION_REASON_CATEGORIES.map((category) => [category, 0]),
  )
  const samples: string[] = []
  /** 已收录的未分类**原文**（用于去重；展示串可能被截断，不能拿来比对） */
  const seenUnclassified: string[] = []
  let denominator = 0
  let matchedCount = 0
  let unclassifiedCount = 0

  for (const record of records) {
    if (rejectionGroupOf(record) !== 'rejected') {
      continue
    }
    denominator += 1
    const { category, matched } = classifyRejectionReason(record.rejectionReason)
    counts.set(category, (counts.get(category) ?? 0) + 1)
    if (category === UNCLASSIFIED_REASON_LABEL) {
      unclassifiedCount += 1
      const raw = (record.rejectionReason ?? '').trim()
      // 去重要用**原文**比对，并且把「已记下的原文」单独存一份：
      // 若拿截断后的展示串去 `includes`，超过长度上限的原值永远匹配不上，
      // 同一条长文本会被重复记满整个样例列表（反而看不见别的未分类值）。
      if (raw !== '' && seenUnclassified.length < UNCLASSIFIED_SAMPLE_LIMIT) {
        if (!seenUnclassified.includes(raw)) {
          seenUnclassified.push(raw)
          samples.push(
            raw.length > UNCLASSIFIED_SAMPLE_MAX_LENGTH
              ? `${raw.slice(0, UNCLASSIFIED_SAMPLE_MAX_LENGTH)}…`
              : raw,
          )
        }
      }
    } else if (matched) {
      matchedCount += 1
    }
  }

  const unfilledCount = counts.get(UNFILLED_REASON_LABEL) ?? 0
  const filledCount = denominator - unfilledCount

  return {
    denominator,
    categories: REJECTION_REASON_CATEGORIES.map((category) => {
      const count = counts.get(category) ?? 0
      return {
        category,
        count,
        share: denominator === 0 ? null : count / denominator,
      }
    }),
    filledCount,
    fillRate: denominator === 0 ? null : filledCount / denominator,
    matchedCount,
    unclassifiedCount,
    unclassifiedSamples: samples,
    note: REASON_DISTRIBUTION_NOTE,
  }
}

/* ------------------------------------------------------------------ 标签规则 */

/** 规则可用的基础条件（PRD 9.3）；`unknown` 与「不满足」严格区分 */
export const REJECTION_CONDITIONS = [
  'gpt',
  'noSubsidy',
  'belowBenchmarkMedian',
  'waitingTooLong',
] as const
export type RejectionCondition = (typeof REJECTION_CONDITIONS)[number]

export const REJECTION_CONDITION_LABELS: Readonly<Record<RejectionCondition, string>> = {
  gpt: 'GPT 院校',
  noSubsidy: '房补类型明确为「无补贴」',
  belowBenchmarkMedian: '同岗有效薪资低于 P50',
  waitingTooLong: '招聘等待超阈值',
}

/** 条件判定结果：三值，`null` = 未知（**不得**当作不满足，也不得当作满足） */
export type ConditionEvaluation = {
  readonly condition: RejectionCondition
  readonly label: string
  readonly met: boolean | null
  /** 判定依据（例如实际天数、基准说明），便于界面解释「为什么算未知」 */
  readonly detail: string
}

/**
 * 判定一条记录是否命中某个基础条件。
 *
 * 三条硬约束（PRD 9.3）：
 * - 房补未知 / 提供住宿**都**不命中「无补贴」（提供住宿不是「无房补待遇」）；
 * - 薪资单位不可比（`salaryComparable = false`）或基准不足时，低薪条件为**未知**，不当不满足；
 * - 拒 offer 记录没有拒绝日期 → 等待条件恒为**未知**，不得当成「未超时」。
 */
export function evaluateCondition(
  record: NormalizedRecord,
  condition: RejectionCondition,
  options: {
    readonly dataAsOf: string
    readonly waitingThresholdDays: number
    readonly salaryComparable: boolean
    /** 同岗基准索引（由调用方用 `indexBenchmarks(buildSalaryBenchmarks(...))` 预先算好并复用） */
    readonly benchmarks?: ReadonlyMap<string, SalaryBenchmarkSummary>
  },
): ConditionEvaluation {
  const label = REJECTION_CONDITION_LABELS[condition]

  if (condition === 'gpt') {
    // 三值严格判定：只有 `true` / `false` 才算已知；`null` **与** `undefined`（旧结构 / 手工构造的
    // 记录）都必须落到「未知」，绝不能被 `met: undefined` 这种值绕过三值检查后被当成「不满足」。
    if (record.isGptSchool !== true && record.isGptSchool !== false) {
      return { condition, label, met: null, detail: 'GPT 名单标签缺失（原值未填且名单未覆盖）' }
    }
    return {
      condition,
      label,
      met: record.isGptSchool,
      detail: `GPT 原值为「${record.isGptSchool ? '是' : '否'}」`,
    }
  }

  if (condition === 'noSubsidy') {
    const housing: HousingType = record.housingType
    if (housing === HOUSING_NO_SUBSIDY) {
      return { condition, label, met: true, detail: '房补类型明确为「无补贴」' }
    }
    if (housing === HOUSING_ACCOMMODATION) {
      return {
        condition,
        label,
        met: false,
        detail: '房补类型为「提供住宿」：不是「无房补待遇」，不命中该条件',
      }
    }
    if (housing === HOUSING_CASH) {
      return { condition, label, met: false, detail: '房补类型为「现金房补」：不是无补贴' }
    }
    return { condition, label, met: null, detail: `房补类型为「${housing}」：未知条件保持未知` }
  }

  if (condition === 'belowBenchmarkMedian') {
    if (!options.salaryComparable) {
      return {
        condition,
        label,
        met: null,
        detail: '币种或计薪周期未确认：薪资不可比，低薪条件为未知',
      }
    }
    if (options.benchmarks === undefined) {
      return { condition, label, met: null, detail: '未提供同岗基准索引：低薪条件为未知' }
    }
    const below = isBelowBenchmarkMedian(record, options.benchmarks)
    if (below === null) {
      return {
        condition,
        label,
        met: null,
        detail: '同岗有效样本不足或金额 / 分组缺失：不出低薪判定（未知条件保持未知）',
      }
    }
    return {
      condition,
      label,
      met: below,
      detail: below ? '有效薪资低于同岗（城市+序列+岗位+币种+周期）P50' : '有效薪资不低于同岗 P50',
    }
  }

  // waitingTooLong
  const duration = waitingDurationFor(record, options.dataAsOf)
  const tooLong = isWaitingTooLong(duration, options.waitingThresholdDays)
  if (tooLong === null) {
    return { condition, label, met: null, detail: `${duration.note}；天数未知时不算超时` }
  }
  return {
    condition,
    label,
    met: tooLong,
    detail: `${duration.note}；实际 ${duration.days} 天，阈值 ${options.waitingThresholdDays} 天`,
  }
}

/** 一条可配置的拒 offer 关注规则 */
export type RejectionRule = {
  readonly id: string
  readonly version: string
  readonly label: string
  /** 命中的条件（全部满足才算命中） */
  readonly conditions: readonly RejectionCondition[]
  /** 这条规则要核查什么（PRD 9.4 的映射） */
  readonly suggestedCheck: string
}

/** 规则版本（规则集合变化时必须递增，结论要能回溯到版本） */
export const REJECTION_RULE_VERSION = 'rejection-rules/1'

/**
 * 内置的默认规则集。**只使用可比较状态上可观察的特征**，
 * 且不包含任何「用入职结果反推」的字段（PRD 9.3）。
 */
export const DEFAULT_REJECTION_RULES: readonly RejectionRule[] = [
  {
    id: 'R-NOSUB',
    version: REJECTION_RULE_VERSION,
    label: '明确无房补',
    conditions: ['noSubsidy'],
    suggestedCheck: '核查住宿需求与房补资格',
  },
  {
    id: 'R-LOWPAY',
    version: REJECTION_RULE_VERSION,
    label: '同岗低于 P50',
    conditions: ['belowBenchmarkMedian'],
    suggestedCheck: '核查报价与同岗基准',
  },
  {
    id: 'R-GPT-NOSUB-LOWPAY',
    version: REJECTION_RULE_VERSION,
    label: 'GPT 院校 + 无房补 + 低于同岗 P50',
    conditions: ['gpt', 'noSubsidy', 'belowBenchmarkMedian'],
    suggestedCheck: '核查报价、房补资格与院校名单的匹配度',
  },
  {
    id: 'R-LOWPAY-WAIT',
    version: REJECTION_RULE_VERSION,
    label: '低于同岗 P50 + 等待超阈值',
    conditions: ['belowBenchmarkMedian', 'waitingTooLong'],
    suggestedCheck: '核查报价与当前流程节点',
  },
]

/** 组合结论的样本门槛（PRD 9.3：组内 D ≥ 10、拒 offer ≥ 3、率差 ≥ 10 个百分点） */
export type RejectionThresholds = {
  /** 组内有效分母下限 */
  readonly minDenominator: number
  /** 组内拒 offer 数下限 */
  readonly minRejected: number
  /** 与比较基准的拒 offer 率差下限（百分点） */
  readonly minRateGapPoints: number
}

export const DEFAULT_REJECTION_THRESHOLDS: RejectionThresholds = {
  minDenominator: 10,
  minRejected: 3,
  minRateGapPoints: 10,
}

/** 结论等级：只有 `observed` 才允许出现「观察到较高拒 offer 关联」的说法 */
export type RejectionConclusionLevel = 'insufficient' | 'description' | 'observed'

export type RejectionRuleEvaluation = {
  readonly rule: RejectionRule
  /** 命中该规则的记录数（在两组比较人群内） */
  readonly hitCount: number
  /** 命中记录里属于拒 offer 组的条数 */
  readonly hitRejected: number
  /** 命中记录里属于入职组的条数 */
  readonly hitJoined: number
  /**
   * 命中记录的**核心分母 D** = J + P + R（与 `counts.coreDenominator` 同一口径）。
   *
   * 注意：命中记录全部落在两组比较人群内（待入职与审批中不参与命中统计），
   * 所以这里的 P 只可能是「按核心分母口径本应计入、但按比较人群口径被排除」的那些记录。
   * 率与率差必须用这个 D 当分母，否则会与同样用 D 的基准率**不同口径**。
   */
  readonly coreDenominator: number
  /** 命中的拒 offer 数 R */
  readonly rejected: number
  /** 组内拒 offer 率 = R / D（D 含待入职）；D = 0 时为 null */
  readonly rejectionRate: number | null
  /** 比较基准（当前筛选下整体的拒 offer 率 R / D）；分母 0 时为 null */
  readonly baselineRate: number | null
  /** 率差（百分点）；任一侧无法计算时为 null */
  readonly rateGapPoints: number | null
  readonly level: RejectionConclusionLevel
  readonly conclusion: string
  /** 命中条件（全部已满足） */
  readonly metConditions: readonly ConditionEvaluation[]
  /** 未知条件：**必须展示**，说明这条结论还缺什么 */
  readonly unknownConditions: readonly ConditionEvaluation[]
  /** 不满足的条件（用于解释「为什么这条没命中更多」） */
  readonly unmetConditions: readonly ConditionEvaluation[]
  readonly suggestedCheck: string
  readonly scopeNote: string
}

export type RejectionRuleOptions = {
  readonly dataAsOf: string
  readonly waitingThresholdDays: number
  readonly salaryComparable: boolean
  /** 同岗基准索引；缺省时「低于 P50」条件一律为未知（不会猜成满足） */
  readonly benchmarks?: ReadonlyMap<string, SalaryBenchmarkSummary>
  readonly thresholds?: RejectionThresholds
  readonly rules?: readonly RejectionRule[]
  /** 比较基准的拒 offer 率（分子 / 分母）；不传时由传入记录自己算整体率 */
  readonly baseline?: { readonly rejected: number; readonly denominator: number }
}

/** 参数化结论模板（PRD 9.4：确定性模板，不含任何概率表述） */
function buildConclusion(
  rule: RejectionRule,
  level: RejectionConclusionLevel,
  rejected: number,
  denominator: number,
  rate: number | null,
  gapPoints: number | null,
): string {
  if (level === 'insufficient') {
    return `「${rule.label}」的命中样本不足（有效分母 ${denominator}、拒 offer ${rejected}），只作为线索记录，不构成结论。`
  }
  const rateText = rate === null ? '—' : `${(rate * 100).toFixed(2)}%`
  if (level === 'description') {
    const gapText = gapPoints === null ? '' : `，与整体差 ${gapPoints.toFixed(2)} 个百分点`
    return `「${rule.label}」组内拒 offer ${rejected} / 有效分母 ${denominator} = ${rateText}${gapText}；未达到预设门槛，仅供描述。`
  }
  const gapText = gapPoints === null ? '' : `，比整体高 ${gapPoints.toFixed(2)} 个百分点`
  return `观察到「${rule.label}」与较高拒 offer 存在关联：组内拒 offer ${rejected} / 有效分母 ${denominator} = ${rateText}${gapText}。这是规则筛查结果，不是因果结论，也不是个人拒 offer 概率。`
}

/**
 * 逐条评估规则（PRD 9.3）。
 *
 * 铁律：
 * - **未知条件让规则无法判定**：只统计「所有条件都已满足」的记录；任何条件为 `unknown` 的记录
 *   不进命中数（也不当不满足），并在 `unknownConditions` 里如实列出；
 * - 结论分级严格按阈值：D ≥ `minDenominator`、R ≥ `minRejected`、率差 ≥ `minRateGapPoints`
 *   三个条件**同时**满足才给 `observed`；
 * - 小样本只描述，不排名、不下结论。
 */
export function evaluateRejectionRules(
  records: readonly NormalizedRecord[],
  options: RejectionRuleOptions,
): readonly RejectionRuleEvaluation[] {
  const rules = options.rules ?? DEFAULT_REJECTION_RULES
  const thresholds = options.thresholds ?? DEFAULT_REJECTION_THRESHOLDS
  const scope = comparisonRecords(records)
  const scopeNote = `适用范围：当前筛选下的两组比较人群（拒 offer 组 + 入职组），共 ${scope.length} 条；待入职与审批中不参与命中统计`

  // 比较基准默认取传入记录自身的整体率（分母为 D）
  const baselineDenominator = options.baseline?.denominator ?? denominatorOf(records)
  const baselineRejected = options.baseline?.rejected ?? rejectedOf(records)
  const baselineRate = baselineDenominator === 0 ? null : baselineRejected / baselineDenominator

  return rules.map((rule) => {
    // 空条件规则会被 `[].every()` 判成「全部满足」，从而命中整个比较人群并可能直接出结论。
    // 这是配置错误，宁可立刻报错，也不能悄悄产出一条假的「观察到关联」。
    if (rule.conditions.length === 0) {
      throw new Error(`拒 offer 规则 ${rule.id} 没有条件：空条件规则会命中所有记录，必须显式配置条件`)
    }

    let hitCount = 0
    let hitRejected = 0
    let hitJoined = 0
    /**
     * 命中「规则条件」且**按核心分母口径计入 D** 的待入职 / 审批中记录数。
     *
     * 这些记录不在比较人群里（PRD 9.1），所以上面那个循环永远看不到它们；
     * 但 D = J + P + R，率的分母必须把它们算进来——否则命中组的率（分母只算 R + J）
     * 与基准率（分母算 J + P + R）就是两种口径相减，率差会被系统性高估。
     * 因此这里对全量记录再判一次条件，只用于**补足分母**，不参与命中数与组内构成。
     */
    let hitPending = 0
    let rejected = 0
    const metConditions = new Map<RejectionCondition, ConditionEvaluation>()
    const unknownConditions = new Map<RejectionCondition, ConditionEvaluation>()
    const unmetConditions = new Map<RejectionCondition, ConditionEvaluation>()

    for (const record of scope) {
      const evaluationList = rule.conditions.map((condition) =>
        evaluateCondition(record, condition, {
          dataAsOf: options.dataAsOf,
          waitingThresholdDays: options.waitingThresholdDays,
          salaryComparable: options.salaryComparable,
          benchmarks: options.benchmarks,
        }),
      )

      const allMet = evaluationList.every((evaluation) => evaluation.met === true)
      if (!allMet) {
        /*
         * 只有**真正命中**的记录才有资格贡献「命中条件」。若在这里就把某条记录上判定为 true 的
         * 条件收进 metConditions，会出现「命中条件」与「未知条件」同时成立、甚至 0 命中的规则
         * 也显示「命中条件」的自相矛盾（那一条记录的另一个条件其实是未知或不满足）。
         * 未命中的记录只贡献「未知」与「不满足」两类，用于解释为什么没有命中。
         */
        for (const evaluation of evaluationList) {
          recordConditionBucket(evaluation, metConditions, unknownConditions, unmetConditions)
        }
        continue
      }

      for (const evaluation of evaluationList) {
        recordConditionBucket(evaluation, metConditions, unknownConditions, unmetConditions)
      }

      hitCount += 1
      const group = rejectionGroupOf(record)
      if (group === 'rejected') {
        hitRejected += 1
        rejected += 1
      } else if (group === 'joined') {
        hitJoined += 1
      }
    }

    for (const record of records) {
      if (rejectionGroupOf(record) !== null || !countsTowardCoreDenominator(record.offerStatus)) {
        continue
      }
      const allMet = rule.conditions.every(
        (condition) =>
          evaluateCondition(record, condition, {
            dataAsOf: options.dataAsOf,
            waitingThresholdDays: options.waitingThresholdDays,
            salaryComparable: options.salaryComparable,
            benchmarks: options.benchmarks,
          }).met === true,
      )
      if (allMet) {
        hitPending += 1
      }
    }

    // 核心分母 D = J + P + R；与基准率使用**同一个** D，否则率差是两种口径相减
    const coreDenominator = hitRejected + hitJoined + hitPending
    const rate = coreDenominator === 0 ? null : rejected / coreDenominator

    // 率差用「四舍五入到 2 位小数」后再比较，避免 (0.5 - 0.4) * 100 === 9.999999999999998
    // 把「恰好 10 个百分点」误判成未达标（PRD 9.3 写的是「高 ≥10 个百分点」）。
    const rateGapPoints =
      rate === null || baselineRate === null
        ? null
        : Math.round((rate - baselineRate) * 10000) / 100

    const level: RejectionConclusionLevel =
      coreDenominator < thresholds.minDenominator || rejected < thresholds.minRejected
        ? 'insufficient'
        : rateGapPoints !== null && rateGapPoints >= thresholds.minRateGapPoints
          ? 'observed'
          : 'description'

    return {
      rule,
      hitCount,
      hitRejected,
      hitJoined,
      coreDenominator,
      rejected,
      rejectionRate: rate,
      baselineRate,
      rateGapPoints,
      level,
      conclusion: buildConclusion(rule, level, rejected, coreDenominator, rate, rateGapPoints),
      metConditions: [...metConditions.values()],
      unknownConditions: [...unknownConditions.values()],
      unmetConditions: [...unmetConditions.values()],
      suggestedCheck: rule.suggestedCheck,
      scopeNote,
    }
  })
}

/**
 * 把一个条件判定放进**唯一**一类：命中 / 未知 / 不满足。
 *
 * 为什么必须唯一：同一条条件在不同记录上可能一次满足、一次未知（例如有的记录填了房补、
 * 有的没填）。若允许它同时出现在两类里，界面会同时把「房补类型明确为『无补贴』」列进
 * 「命中条件」与「未知条件」，读者根本无法判断哪个成立。
 * 优先级：**命中 > 未知 > 不满足**——命中说明这条条件在这批数据里确实被满足过（最有用），
 * 未知说明还有记录缺数据（次之），「不满足」只在从没有命中也没有未知时才展示。
 *
 * 注意调用方只在 `met === true`（命中记录）或 `!allMet`（未命中记录）时调用，
 * 所以这里只按判定值分派即可。
 */
function recordConditionBucket(
  evaluation: ConditionEvaluation,
  met: Map<RejectionCondition, ConditionEvaluation>,
  unknown: Map<RejectionCondition, ConditionEvaluation>,
  unmet: Map<RejectionCondition, ConditionEvaluation>,
): void {
  if (evaluation.met === true) {
    if (!met.has(evaluation.condition)) {
      met.set(evaluation.condition, evaluation)
    }
    unknown.delete(evaluation.condition)
    unmet.delete(evaluation.condition)
    return
  }
  if (met.has(evaluation.condition)) {
    return
  }
  if (evaluation.met === null) {
    if (!unknown.has(evaluation.condition)) {
      unknown.set(evaluation.condition, evaluation)
    }
    unmet.delete(evaluation.condition)
    return
  }
  if (!unknown.has(evaluation.condition) && !unmet.has(evaluation.condition)) {
    unmet.set(evaluation.condition, evaluation)
  }
}

/** 计入核心分母 D 的记录数（= J + P + R）。
 *
 * 必须与 `countStatuses` 的 `coreDenominator` 完全同口径：用 `countsTowardCoreDenominator`
 * 逐个判定，而不是在这里另写一套状态列表——否则基准率会与看板上的 D 悄悄不一致。
 */
function denominatorOf(records: readonly NormalizedRecord[]): number {
  let count = 0
  for (const record of records) {
    if (countsTowardCoreDenominator(record.offerStatus)) {
      count += 1
    }
  }
  return count
}

/** 拒 offer 数 R（拒 offer + 拒绝口头 offer） */
function rejectedOf(records: readonly NormalizedRecord[]): number {
  let count = 0
  for (const record of records) {
    if (isRejectedStatus(record.offerStatus) === true) {
      count += 1
    }
  }
  return count
}

/* ------------------------------------------------------------------ 行动建议 */

/** 规则化建议（PRD 9.4 的观察 → 建议映射；**不含**「不招某类学校」这类结论） */
export type ActionAdvice = {
  readonly id: string
  readonly observation: string
  readonly advice: string
}

export const ACTION_ADVICE_RULES: Readonly<Record<string, ActionAdvice>> = {
  reasonMissing: {
    id: 'reasonMissing',
    observation: '拒绝原因填写率偏低或存在「未分类」',
    advice: '补充拒绝访谈，并把常用原因补进字典（当前原因分布不足以支撑结论）',
  },
  lowPay: {
    id: 'lowPay',
    observation: '同岗低薪关联',
    advice: '核查报价与同岗基准（同城市 + 序列 + 岗位 + 币种 + 计薪周期）',
  },
  noSubsidy: {
    id: 'noSubsidy',
    observation: '无补贴关联',
    advice: '核查住宿需求与补贴资格（提供住宿不等于无补贴，两者要分开谈）',
  },
  approvalBacklog: {
    id: 'approvalBacklog',
    observation: '审批记录较多',
    advice: '梳理审批节点，确认是否存在可并行的环节',
  },
  longWaiting: {
    id: 'longWaiting',
    observation: '等待过长',
    advice: '跟进当前流程节点，优先处理等待最久的记录',
  },
  smallSample: {
    id: 'smallSample',
    observation: '小样本',
    advice: '继续采集：当前样本量只够描述，不足以形成结论',
  },
}
