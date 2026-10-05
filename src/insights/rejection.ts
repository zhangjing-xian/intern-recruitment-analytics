/**
 * 本地确定性结论与规则化行动建议（步骤10，docs/PRD.md 9 章）。
 *
 * 分层理由（AGENTS.md §4）：`domain/analytics` 只负责**计数与率**（纯指标，任何页面都能用），
 * 本目录负责**结论**——把指标按 PRD 9 章的规则组合成「可解释的运营关注标签 + 行动建议」。
 * 结论层的三条铁律：
 * 1. **全部确定性**：同一份数据 + 同一套配置得到同一段文案，不调用 AI、不做随机、不做概率预测；
 * 2. **可回溯**：每条结论都带规则 ID、规则版本、命中条件、未知条件、比较基准与适用范围；
 * 3. **不越界**：不输出个人拒 offer 概率、不说「高薪一定提升入职」、不把学校 / 学历标签
 *    转成录用建议，也不把「提供住宿」当「无房补待遇」。
 *
 * 本模块不依赖 React / 网络 / 存储；界面只做展示。
 */

import {
  ACTION_ADVICE_RULES,
  DEFAULT_REJECTION_THRESHOLDS,
  GROUP_DIMENSION_LABELS,
  REJECTION_RULE_VERSION,
  aggregateByDimension,
  buildSalaryBenchmarks,
  comparisonRecords,
  evaluateRejectionRules,
  indexBenchmarks,
  isWaitingTooLong,
  rejectionReasonDistribution,
  sortGroupsByDenominator,
  summarizeRecords,
  waitingDurationFor,
  type ActionAdvice,
  type AnalysisFilters,
  type GroupDimension,
  type GroupSummary,
  type GroupingOptions,
  type RejectionReasonDistribution,
  type RejectionRule,
  type RejectionRuleEvaluation,
  type RejectionThresholds,
  type SalaryBenchmarkSummary,
  type NormalizedRecord,
} from '../domain'

/** 一个维度的拒 offer 对比：特征内结果 + 组内构成两份数字（PRD 9.1 的两种视角） */
export type RejectionDimensionView = {
  readonly dimension: GroupDimension
  readonly label: string
  /** 特征内结果：该取值的 N/J/P/A/R/D 与各率（分母为该取值的 D） */
  readonly groups: readonly GroupSummary[]
  /** 合计行（当前筛选下的全量口径，不是两组之和） */
  readonly total: GroupSummary
  /** 组内构成的可读说明（提醒这不是「该特征的拒 offer 率」） */
  readonly compositionNote: string
}

/** 一次拒 offer 专项分析的全部结果；界面只展示，不再计算 */
export type RejectionInsight = {
  readonly ruleVersion: string
  /** 分析截止日（与看板同一份快照声明） */
  readonly dataAsOf: string
  /** 全部口径汇总（含待入职与审批中，拒 offer 率分母 D 用它） */
  readonly overall: GroupSummary
  /** 两组比较人群 R ∪ J */
  readonly comparison: GroupSummary
  readonly comparisonNote: string
  /** 原因分布（分母恒为 R，含「未填写」） */
  readonly reasons: RejectionReasonDistribution
  /** 各维度的对比（渠道 / HR / 岗位 / 序列 / 部门 / 需求类型 / 学历 / 学校 / GPT / 年级 / 薪资 / 房补） */
  readonly dimensions: readonly RejectionDimensionView[]
  /** 规则评估：可解释的运营关注标签 */
  readonly evaluations: readonly RejectionRuleEvaluation[]
  /** 规则化行动建议（由观察推导，不含任何淘汰 / 歧视类建议） */
  readonly advice: readonly ActionAdvice[]
  /** 结论层的统一免责声明 */
  readonly disclaimer: string
  /** 阈值与规则配置（随报告一起记录，阈值是运营配置不是行业标准） */
  readonly thresholds: RejectionThresholds
  readonly waitingThresholdDays: number
  /** 生成这份结论时生效的筛选快照（随结论冻结，供报告标注适用范围） */
  readonly filters: AnalysisFilters | null
  /** 币种与计薪周期是否可比（低薪条件是否可用；false 时该条件恒为未知） */
  readonly salaryComparable: boolean
  /** 基准参照集合的可读说明（报告必须能说明「跟谁比」） */
  readonly benchmarkScopeNote: string
}

/** 本步覆盖的维度（PRD 9.1 的比较维度清单） */
export const REJECTION_DIMENSIONS: readonly GroupDimension[] = [
  'channel',
  'referralType',
  'recruiter',
  'position',
  'jobFamily',
  'department',
  'requirementType',
  'graduationYear',
  'education',
  'school',
  'isGptSchool',
  'salaryBand',
  'housingType',
]

export const COMPOSITION_NOTE =
  '组内构成 = 该取值在拒 offer 组的记录数（÷ R）与在入职组的记录数（÷ J），这是画像构成，不是该取值的拒 offer 率；特征内的率请看同一行的「拒 offer 率（分子 ÷ 分母）」。'

export const REJECTION_DISCLAIMER =
  '以下全部是规则筛查结果，不是因果结论，也不是个人拒 offer 概率；未达到样本门槛的只作描述，不得当作优劣排名，更不得用于自动淘汰或歧视候选人。'

export type RejectionInsightOptions = {
  readonly dataAsOf: string
  readonly salaryComparable: boolean
  /** 规则与阈值都可由用户配置；不传时用引擎默认值 */
  readonly thresholds?: RejectionThresholds
  /** 关注标签规则集；不传时用引擎的默认规则集（PRD 9.3「可配置组合」的入口） */
  readonly rules?: readonly RejectionRule[]
  readonly waitingThresholdDays?: number
  /** 规则评估的命中范围：默认只看两组比较人群 */
  readonly dimensions?: readonly GroupDimension[]
  /** 分组选项（薪资区间分档边界）；与看板筛选面板共用同一份配置 */
  readonly groupingOptions?: GroupingOptions
  /** 当前筛选快照（随结论一起冻结，便于报告标注） */
  readonly filters?: AnalysisFilters
  /** 基准参照集合：默认用全部保留记录，避免基准随筛选漂移 */
  readonly referenceRecords?: readonly NormalizedRecord[]
}

/**
 * 组装拒 offer 专项结论。
 *
 * 关键口径（与 PRD 9.1 一致）：
 * - `overall` 用**传入的全部记录**算，因此「拒 offer 率 = R / D」里待入职仍在 D 内；
 * - `comparison` 只用 R ∪ J，待入职与审批中**不进**任何一组比较；
 * - 两个人群不同，界面必须同时说清楚（`comparisonNote`）。
 */
export function buildRejectionInsight(
  records: readonly NormalizedRecord[],
  options: RejectionInsightOptions,
): RejectionInsight {
  const waitingThresholdDays = options.waitingThresholdDays ?? 30
  const overall = summarizeRecords('全部（当前筛选）', records)
  const scope = comparisonRecords(records)
  const comparison = summarizeRecords('两组比较人群（拒 offer 组 + 入职组）', scope)

  // 基准用「传给本函数之外」的参照集合（默认就是这批记录），保证与看板同一套口径
  const reference = options.referenceRecords ?? records
  const benchmarks: ReadonlyMap<string, SalaryBenchmarkSummary> = indexBenchmarks(
    buildSalaryBenchmarks(reference, { comparable: options.salaryComparable }),
  )

  const evaluations = evaluateRejectionRules(records, {
    dataAsOf: options.dataAsOf,
    waitingThresholdDays,
    salaryComparable: options.salaryComparable,
    benchmarks,
    thresholds: options.thresholds,
    rules: options.rules,
    baseline: {
      rejected: overall.counts.rejected,
      denominator: overall.counts.coreDenominator,
    },
  })

  const dimensions = (options.dimensions ?? REJECTION_DIMENSIONS).map<RejectionDimensionView>(
    (dimension) => ({
      dimension,
      label: GROUP_DIMENSION_LABELS[dimension],
      // 特征内的率用**全部记录**算：这样 D 与核心拒 offer 率的分母一致，
      // 待入职仍在 D 内（PRD 9.1 明确要求），而组内构成由 GroupSummary 自带。
      groups: sortGroupsByDenominator(
        aggregateByDimension(records, dimension, options.groupingOptions),
      ),
      total: overall,
      compositionNote: COMPOSITION_NOTE,
    }),
  )

  const reasons = rejectionReasonDistribution(records)

  return {
    ruleVersion: REJECTION_RULE_VERSION,
    dataAsOf: options.dataAsOf,
    overall,
    comparison,
    comparisonNote: `核心拒 offer 率的分母 D = ${overall.counts.coreDenominator}（含待入职 P = ${overall.counts.pending}、已排除审批中 A = ${overall.counts.approving}）；两组比较人群只有 ${scope.length} 条（拒 offer 组 + 入职组），待入职与审批中不参与组间比较。两个人群不同，不能混用。`,
    reasons,
    dimensions,
    evaluations,
    advice: [
      ...buildAdvice(evaluations),
      ...reasonsAdvice(reasons),
      ...approvalBacklogAdvice(overall.counts.approving, overall.counts.total),
      ...longWaitingAdvice(records, options.dataAsOf, waitingThresholdDays),
    ],
    filters: options.filters ?? null,
    salaryComparable: options.salaryComparable,
    benchmarkScopeNote: options.referenceRecords === undefined
      ? '基准参照集合：当前筛选下的记录'
      : `基准参照集合：调用方指定的参照集合（${(options.referenceRecords ?? []).length} 条），不随筛选漂移`,
    disclaimer: REJECTION_DISCLAIMER,
    thresholds: options.thresholds ?? DEFAULT_REJECTION_THRESHOLDS,
    waitingThresholdDays,
  }
}

/**
 * 规则化行动建议（PRD 9.4）。
 *
 * 只从**已观察到的证据**推导：原因缺失 / 未分类 → 补充访谈；低薪规则有命中 → 核查报价；
 * 无补贴规则有命中 → 核查住宿与补贴资格；审批积压与等待过长 → 跟进节点；样本不足 → 继续采集。
 * **不得**输出「不招聘某类学校」这类建议。
 */
export function buildAdvice(
  evaluations: readonly RejectionRuleEvaluation[],
): readonly ActionAdvice[] {
  const advice: ActionAdvice[] = []
  const push = (rule: ActionAdvice | undefined) => {
    if (rule !== undefined && !advice.some((item) => item.id === rule.id)) {
      advice.push(rule)
    }
  }

  const anyObserved = evaluations.some((item) => item.level === 'observed')
  const anyInsufficient = evaluations.some((item) => item.level === 'insufficient')

  for (const evaluation of evaluations) {
    if (evaluation.level !== 'observed' && evaluation.level !== 'description') {
      continue
    }
    for (const condition of evaluation.rule.conditions) {
      if (condition === 'belowBenchmarkMedian') {
        push(ACTION_ADVICE_RULES.lowPay)
      } else if (condition === 'noSubsidy') {
        push(ACTION_ADVICE_RULES.noSubsidy)
      } else if (condition === 'waitingTooLong') {
        push(ACTION_ADVICE_RULES.longWaiting)
      }
    }
  }

  if (anyInsufficient && !anyObserved) {
    push(ACTION_ADVICE_RULES.smallSample)
  }

  return advice
}

/**
 * 原因侧的补充建议（PRD 9.4 第 1 行「原因缺失 → 补充拒绝访谈」）。
 *
 * 触发条件刻意包含**填写率偏低**，而不只是「一条都没填」：
 * 规则文案本身写的是「填写率偏低或存在未分类」，若只在 0% 时给建议，
 * 1% 填写率这种最需要补访谈的情况反而不会提示。阈值是可解释的运营阈值：
 * 低于一半即认为原因数据不足以支撑结论。
 */
export const MIN_REASON_FILL_RATE = 0.5

export function reasonsAdvice(reasons: RejectionReasonDistribution): readonly ActionAdvice[] {
  const advice: ActionAdvice[] = []
  if (reasons.denominator === 0) {
    return advice
  }
  const tooFewFilled = reasons.fillRate === null || reasons.fillRate < MIN_REASON_FILL_RATE
  if (tooFewFilled || reasons.unclassifiedCount > 0) {
    const rule = ACTION_ADVICE_RULES.reasonMissing
    if (rule !== undefined) {
      advice.push(rule)
    }
  }
  return advice
}

/**
 * 审批积压建议（PRD 9.4「审批记录较多 → 梳理审批节点」）。
 *
 * 为什么单独一个入口：审批中**不在**两组比较人群内（PRD 9.1），所以它不可能出现在任何
 * 规则命中里，只能从整体状态计数判断。阈值同样是运营阈值（审批中占全部记录的比例）。
 */
export const APPROVAL_BACKLOG_SHARE = 0.2

export function approvalBacklogAdvice(
  approving: number,
  total: number,
): readonly ActionAdvice[] {
  if (total === 0 || approving / total < APPROVAL_BACKLOG_SHARE) {
    return []
  }
  const rule = ACTION_ADVICE_RULES.approvalBacklog
  return rule === undefined ? [] : [rule]
}

/**
 * 等待过长建议（PRD 9.4「等待过长 → 跟进当前节点」）。
 *
 * 为什么不能靠规则命中：拒 offer 记录没有拒绝日期，等待时长恒为**未知**；
 * 真正能算出「当前等待时长」的是待入职与审批中，而它们按 PRD 9.1 不进两组比较人群，
 * 因此永远不会出现在任何规则命中里。这里直接扫全量记录，只统计**已知且超阈值**的当前等待时长，
 * 未知一律不计（也就不会被当成「未超时」）。
 */
export function longWaitingAdvice(
  records: readonly NormalizedRecord[],
  dataAsOf: string,
  thresholdDays: number,
): readonly ActionAdvice[] {
  let tooLong = 0
  for (const record of records) {
    const duration = waitingDurationFor(record, dataAsOf)
    if (duration.kind !== 'currentWaiting') {
      continue
    }
    if (isWaitingTooLong(duration, thresholdDays) === true) {
      tooLong += 1
    }
  }
  if (tooLong === 0) {
    return []
  }
  const rule = ACTION_ADVICE_RULES.longWaiting
  return rule === undefined ? [] : [rule]
}
