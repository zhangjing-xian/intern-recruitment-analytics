/**
 * AI 分析摘要生成器（AI-2，docs/PRD.md 17.1 / 17.2、docs/requirements.md.md 16.3）。
 *
 * ## 这一层解决什么问题
 *
 * AI-1 已经把「候选聚合结果 → 脱敏载荷 → 完整预览 → 一次性确认」做完了，但它**不知道**
 * 那些候选结果从哪来：AI-1 的交付状态写得很清楚——「`AnalysisSummary` 生成器（AI-2），
 * 本步用合成夹具」。于是看板组件 `DashboardWorkspace` 里堆了一段装配代码：
 * 手动列维度、拼 `scope`、反推缺失薪资。那段代码有三个问题：
 *
 * 1. **不可测**：口径正确性只能靠渲染冒烟，改一个维度就得重跑界面测试；
 * 2. **会漂移**：装配逻辑住在组件里，看板改口径时没有人会记得同步改它；
 * 3. **与「冻结快照」的语义不符**：PRD 16.2 要求「冻结当前数据版本、去重策略、筛选快照与
 *    统计口径，在本地生成 AnalysisSummary」，而组件内的 `useMemo` 不是一份可传阅的契约。
 *
 * 本模块把这件事变成**一个纯函数**：输入一份已经算好的分析结果，输出一份 `AnalysisSummary`。
 *
 * ## 四条硬规则（都有对应的单测，不是注释里的愿望）
 *
 * 1. **只用预定义表**（PRD 17.1）：`PREDEFINED_TABLES` 是唯一清单，维度必须逐条登记。
 *    禁止「把全量 store 展开」「附原始错误行」——那不是脱敏问题，是**结构上做不到**：
 *    本模块的输出类型里没有能装下原始行的字段。
 * 2. **指标一律取引擎已算好的数**：`counts` / `groupComposition` / `medianDays` 全部来自
 *    `GroupSummary`，本模块**不写任何公式**（AGENTS.md §2.3）。唯一做的算术是「取上界」
 *    与「体积求和」，两者都不是业务口径。
 * 3. **禁用模块不得照旧出数**：薪资单位未确认时 `salaryBand` 维度整维不发，
 *    拒绝原因自由文本永不发送（原因只出受控类别 + 计数）。
 * 4. **超预算先在本地调整**（PRD 17.1）：预算 128 KiB 在构造阶段就检查，
 *    超了就按登记顺序**丢表并如实记录**，绝不静默截断、绝不降低 k。
 *
 * ## 与 `privacy/` 的分工（不要在这里做脱敏）
 *
 * 本层输出的是**候选**摘要：里面还带着 HR 真名、学校全名、岗位全名这类危险取值。
 * 换成代号 / 层次 / 类别 / 区间是 `privacy/aiSummary.ts` 的职责（`safeKeyOf`），
 * 因为它要按**隐私级别**决定粒度，而级别是用户在预览页选的，不属于「快照」。
 * 本层只保证「不去读身份字段」：姓名、候选人 ID、需求 ID、文件名、原始行
 * 在本模块里连输入都没有。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，**不发起任何请求**
 * （唯一的网络适配器是 AI-4，且它不能接收原始记录类型）。
 */

import {
  DEFAULT_CYCLE_TOO_LONG_DAYS,
  GROUP_DIMENSION_LABELS,
  UNFILLED_REASON_LABEL,
  UNKNOWN,
  actualCycleDays,
  aggregateByDimension,
  analyzeRecords,
  cycleTooLongCount,
  groupRecords,
  rejectionReasonDistribution,
  retainedRecords,
  sortGroupsByDenominator,
  summarizeRecords,
  type AnalysisFilters,
  type AnalysisModule,
  type AnalysisResult,
  type DateOnly,
  type DedupStrategy,
  type GroupDimension,
  type GroupSummary,
  type GroupingOptions,
  type MetricAvailability,
  type NormalizedDataset,
  type NormalizedRecord,
  type TimeBasis,
} from '../domain'
// 周期分桶函数与脱敏引擎共用同一份实现（`privacy/aiSummary.ts` 的 `cycleBandOf`），
// 避免出现「本地按 10 天分箱、载荷按别的边界分箱」两处口径。
import { cycleBandOf } from '../privacy/aiSummary'
// 规则版本标签与「本地规则指纹」共用同一个函数（见 `subjectRules.ts` 的说明）
import { ruleVersionLabelOf } from './subjectRules'

/* ------------------------------------------------------------------ 输入契约 */

/**
 * 周期区间分组的内部结构。
 *
 * 为什么在 `src/ai` 里也要有一份 `cycleBandGroupsOf`，而不复用
 * `features/ai/aiSourceCells.ts` 的同名函数：那一层属于**界面层**（`features/`），
 * 而本模块是引擎层。引擎反过来依赖界面层会让依赖方向倒置——界面删一个文件就把引擎
 * 编译坏了，这是本项目一直在避免的事（AGENTS.md §4 的分层调用方向）。
 * 两个函数各自 6 行、口径共用 `cycleBandOf`，重复的成本远低于一个反向依赖。
 */
export type CycleBandGroups = {
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
}

/* ------------------------------------------------------------------ 常量与预算 */

/** 体积预算（PRD 17.1：默认 128 KiB）。与 `privacy/aiSummary.ts` 的同名常量同源同值。 */
export const AI_SUMMARY_BYTE_BUDGET = 128 * 1024

/**
 * 预定义表清单（PRD 17.1「只包含预定义表」）。
 *
 * 顺序即**裁剪顺序**：超预算时从后往前丢，因此越靠前越重要。
 * 被丢掉的表必须出现在 `adjustments` 里并给出原因——静默少发是不允许的，
 * 用户核对预览时会以为「本来就没这一项」。
 */
export const PREDEFINED_TABLES = [
  { id: 'kpi', label: '总体指标' },
  { id: 'dimension.city', label: '按城市' },
  { id: 'dimension.channel', label: '按渠道' },
  { id: 'dimension.referralType', label: '按推荐类型' },
  { id: 'dimension.recruiter', label: '按 HR（代号）' },
  { id: 'dimension.position', label: '按岗位类别' },
  { id: 'dimension.jobFamily', label: '按序列' },
  { id: 'dimension.department', label: '按一级部门' },
  { id: 'dimension.requirementType', label: '按需求类型' },
  { id: 'dimension.education', label: '按学历' },
  { id: 'dimension.school', label: '按学校层次' },
  { id: 'dimension.graduationYear', label: '按毕业年级' },
  { id: 'rejection.profile', label: '拒 offer 组间构成' },
  { id: 'rejection.featureRates', label: '拒 offer 特征内结果' },
  { id: 'dimension.housingType', label: '按房补类型' },
  { id: 'dimension.salaryBand', label: '按薪资区间' },
  { id: 'dimension.cycleBand', label: '按招聘周期区间' },
  { id: 'cycle', label: '招聘周期' },
  { id: 'rejection.reasons', label: '拒 offer 原因' },
  { id: 'quality', label: '数据质量' },
] as const

export type PredefinedTableId = (typeof PREDEFINED_TABLES)[number]['id']

/**
 * 维度 → 它所属的分析模块（用于「模块被禁用时整维不发」）。
 *
 * 为什么需要显式登记：`AnalysisModule` 是中文联合类型，没有 `.includes()` 的类型安全。
 * 用 `Record<GroupDimension, AnalysisModule | null>` 后，**新增一个维度却忘了登记模块**
 * 会变成编译错误，而不是「忘了判断于是多发了一维」这种运行时才发现的隐私问题。
 */
const DIMENSION_MODULE: Readonly<Record<GroupDimension, AnalysisModule | null>> = {
  city: '城市对比',
  channel: '渠道对比',
  referralType: null,
  recruiter: 'HR效能',
  position: '需求分析',
  jobFamily: '需求分析',
  department: '需求分析',
  requirementType: '需求分析',
  graduationYear: '画像分析',
  education: '画像分析',
  school: '画像分析',
  isGptSchool: '画像分析',
  housingType: '房补对比',
  salaryBand: '薪资对比',
}

/**
 * 交给 AI 的维度清单（顺序 = `dimensions` 数组顺序 = 载荷里的表顺序）。
 *
 * 三条「为什么不在清单里」：
 * - `isGptSchool` 不发：它与 `school` 是同一份信息（引擎把 school 换成 GPT 层次），
 *   两个都发会触发引擎的「同一维度重复出现」整维省略（AI06 的跨表检查）；
 * - `position` 与 `jobFamily` / `department` 都发：前者出「类别」，后两者出标签，
 *   粒度不同，不是重复；
 * - 这里**不出现**身份类字段（姓名 / 候选人 ID / 需求 ID / 文件名），
 *   因为它们不是 `GroupDimension`，结构上进不来。
 */
export const SUMMARY_DIMENSIONS = [
  'city',
  'channel',
  'referralType',
  'recruiter',
  'position',
  'jobFamily',
  'department',
  'requirementType',
  'education',
  'school',
  'graduationYear',
  'housingType',
  'salaryBand',
] as const satisfies readonly GroupDimension[]

/**
 * 拒 offer 组间比较用的维度（PRD 9.1 / requirements 16.3「拒 offer 专项」）。
 *
 * 与上面的清单刻意不同：这里只要**能形成可比较人群**的维度。
 * 薪资区间与周期区间不进组间比较——它们的取值本身就是结果变量，
 * 拿结果去解释结果会得出「拒 offer 的人薪资偏低」这种同义反复。
 */
export const REJECTION_COMPARISON_DIMENSIONS = [
  'channel',
  'referralType',
  'recruiter',
  'position',
  'jobFamily',
  'department',
  'requirementType',
  'education',
  'school',
  'housingType',
] as const satisfies readonly GroupDimension[]

/* ------------------------------------------------------------------ 输出契约 */

/** 总体指标：字段名即载荷里的 N/J/P/A/R/D，避免中间再起一套名字 */
export type SummaryKpi = {
  readonly N: number
  readonly J: number
  readonly P: number
  readonly A: number
  readonly R1: number
  readonly R2: number
  readonly R: number
  /** 核心分母 = J + P + R（排除审批中 / 其他 / 未知） */
  readonly D: number
  readonly U: number
}

/** 分析范围：全部字段都必须已脱敏（不含文件名、学校全名、HR 真名） */
export type SummaryScope = {
  readonly rowCount: number
  readonly dedupPolicy: string
  readonly filters: readonly string[]
  readonly ruleVersion: string
  readonly dataAsOf: DateOnly
  readonly timeBasis: TimeBasis | null
}

/**
 * 一张预定义表：维度 + 已排序的分组（引擎算好的 `GroupSummary`，本层不重算）。
 *
 * 同时给出 `summaries`（引擎原始对象）与 `groups`（投影行）：
 * - `summaries` 给**下游的候选格换算层**用（它按 `GroupSummary` 的契约工作，
 *   包括 `groupComposition` 与 `cycles`），这样那一层不必认识本模块的行类型，
 *   也就没有「把行再伪造成 GroupSummary」这种容易出错的转换；
 * - `groups` 给**载荷与体积统计**用（只有计数，不含整批 `records`），
 *   避免把记录数组顺着载荷一路带出去。
 */
export type SummaryDimensionTable = {
  readonly metricId: string
  readonly dim: GroupDimension
  readonly dimLabel: string
  readonly groups: readonly SummaryGroupRow[]
  readonly summaries: readonly GroupSummary[]
}

/** 一行：计数取引擎，组内构成也取引擎（`groupComposition` 已算好，不在本层重数） */
export type SummaryGroupRow = {
  readonly key: string
  readonly N: number
  readonly D: number
  readonly R: number
  /** 拒 offer 组内构成（该特征在拒 offer 组的记录数，PRD 9.1 视角一） */
  readonly rejectedGroupCount: number
  /** 入职组内构成 */
  readonly joinedGroupCount: number
  /** 两组比较人群合计；它 + 未进组记录 = N */
  readonly comparedCount: number
  /** 有周期的记录数（`medianDays = null` 表示无有效周期，不等于中位数为 0） */
  readonly cycleSampleCount: number
  readonly medianCycleDays: number | null
}

/**
 * 组间构成表（PRD 9.1 视角一）。
 *
 * 刻意**不带** D / R：那两个数属于「特征内结果」，与「组内构成」分母不同。
 * 放在同一行会让人把「拒 offer 组里的构成比」当成「该特征的拒 offer 率」——
 * 这正是 PRD 反复强调、要求必须区分的那件事。结构上不给，就不必靠读者自律。
 */
export type SummaryProfileTable = {
  readonly metricId: string
  readonly dim: GroupDimension
  readonly dimLabel: string
  readonly groups: readonly SummaryProfileRow[]
  /** 引擎原始分组（候选格换算层按 `groupComposition` 读，不需要伪造形状） */
  readonly summaries: readonly GroupSummary[]
}

export type SummaryProfileRow = {
  readonly key: string
  /** 该特征在拒 offer 组的记录数（分母是 R） */
  readonly rejectedGroupCount: number
  /** 该特征在入职组的记录数（分母是 J） */
  readonly joinedGroupCount: number
}

/** 拒 offer 原因：只允许受控类别 + 计数（自由文本原文在本模块里没有位置） */
export type SummaryRejectionReason = {
  readonly category: string
  readonly count: number
  /** 是否为「未填写」：它是缺失统计，不是一个原因 */
  readonly unfilled: boolean
}

/** 拒 offer 原因分布：分母必须写清用的是 R 还是「已填写」 */
export type SummaryRejectionReasons = {
  readonly distribution: readonly SummaryRejectionReason[]
  /** 拒 offer 记录数 R（分布的分母） */
  readonly rejectedTotal: number
  /** 已填写原因的记录数 */
  readonly filledCount: number
  /** 原因填写率相关说明（已算好的描述性文本，不在这里算率） */
  readonly note: string
}

/** 拒 offer 专项：两个**不同分母**的视角必须同时在场（PRD 9.1） */
export type SummaryRejection = {
  /** 视角一：组内构成（拒 offer 组 / 入职组），分母分别是 R 与 J */
  readonly profile: {
    readonly rejectedTotal: number
    readonly joinedTotal: number
    readonly note: string
    readonly tables: readonly SummaryProfileTable[]
  }
  /** 视角二：特征内结果（该特征的拒 offer 数 ÷ 该特征的 D） */
  readonly featureRates: {
    readonly note: string
    readonly tables: readonly SummaryDimensionTable[]
  }
  /** 原因分布（含「未填写」，但明确它不是原因） */
  readonly reasons: SummaryRejectionReasons
  /** 本次**没有**参与组间比较的记录数（待入职 + 审批中 + 其他 + 未知） */
  readonly excludedFromComparison: number
}

/** 数据质量：全部是聚合计数或模块可用性，不含原始错误行 */
export type SummaryQuality = {
  readonly unknownStatus: number
  readonly missingSalary: number
  readonly unknownSchool: number
  readonly cycleMissing: number
  readonly cycleTooLongCount: number
  readonly cycleTooLongDays: number
  /** 被质量层**禁用**的模块（禁用原因随 `caliberNotes` 一起说明，不在这里重述） */
  readonly disabledModules: readonly AnalysisModule[]
  /** 每条模块可用性（取引擎结论） */
  readonly availability: readonly MetricAvailability[]
}

/** 周期：只有已算好的统计量，没有任何逐人天数 */
export type SummaryCycle = {
  readonly actualSampleCount: number
  readonly actualMeanDays: number | null
  readonly actualMedianDays: number | null
  readonly actualP75Days: number | null
  readonly plannedSampleCount: number
  readonly plannedMedianDays: number | null
  readonly tooLongCount: number
  readonly tooLongThresholdDays: number
  readonly note: string
}

/** 被本地调整（丢表）的记录：必须如实列出，不能静默少发 */
export type SummaryAdjustment = {
  readonly tableId: PredefinedTableId | string
  readonly reason: string
}

/** 冻结的分析版本：数据集 / 去重 / 规则 / 截至日的声明 */
export type SummaryFrozenVersion = {
  readonly datasetId: string | null
  readonly schemaVersion: string
  readonly rulesVersion: string
  /** 规则版本 + 配置摘要（步骤12 的 `1.0.0+3F2A19C4` 形式） */
  readonly ruleVersionLabel: string
  readonly configRevision: string | null
  readonly dedupPolicy: DedupStrategy
  readonly dataAsOf: DateOnly
  readonly importedAt: string
}

/**
 * AI 分析摘要（**唯一的本地到 AI 交接契约**）。
 *
 * 刻意**没有** `records` 字段：本类型的消费者是脱敏引擎，而引擎只需要候选单元格。
 * 把记录留在结构外，才能让「AI 摘要里出现原始行」变成**类型错误**而不是代码审查问题。
 */
export type AnalysisSummary = {
  readonly frozen: SummaryFrozenVersion
  readonly scope: SummaryScope
  readonly kpi: SummaryKpi
  readonly dimensions: readonly SummaryDimensionTable[]
  readonly cycleBandGroups: CycleBandGroups
  readonly rejection: SummaryRejection
  readonly cycle: SummaryCycle
  readonly quality: SummaryQuality
  readonly caliberNotes: readonly string[]
  /**
   * 本次分组用的薪资区间边界（原样带出，数值型）。
   *
   * 为什么要随摘要交出去：候选格换算层要用它反查「这个分组键到底是不是区间标签」，
   * 而**从分组键反推边界是做不到的**（`<3000` 这个标签无法告诉你边界是 3000 还是 2500）。
   * 边界本来就在 `groupingOptions` 里，直接带出来比让下游猜安全。
   */
  readonly salaryBandEdges: readonly number[]
  /** 体积统计：按当前摘要重新序列化算出的字节数（含裁剪后） */
  readonly totalBytes: number
  readonly byteBudget: number
  /** 本地调整记录（超预算丢表 / 禁用模块整维不发），空数组表示没有任何裁剪 */
  readonly adjustments: readonly SummaryAdjustment[]
  /** 被统计进摘要的记录数（= 各维度分组之和的来源，也用于空摘要判断） */
  readonly includedRecordCount: number
}

/* ------------------------------------------------------------------ 输入契约 */

export type AnalysisSummaryInput = {
  readonly records: readonly NormalizedRecord[]
  readonly metadata: NormalizedDataset['metadata']
  readonly report: NormalizedDataset['report']
  readonly filters: AnalysisFilters
  readonly timeBasis: TimeBasis
  readonly groupingOptions: GroupingOptions
  readonly filtersSummary: readonly string[]
  readonly cycleTooLongDays?: number
  /** 体积预算；只用于测试与「用户显式缩小范围」，默认 128 KiB */
  readonly byteBudget?: number
}

/**
 * 构造 AI 分析摘要（**唯一入口**）。
 *
 * 全程只读引擎结论：
 * 1. `analyzeRecords` 出总体计数与筛选结果（不复用看板的那一份，因为本函数要能被单独测试）；
 * 2. `aggregateByDimension` + `sortGroupsByDenominator` 出各维度分组；
 * 3. `summarizeRecords` 的 `groupComposition` 出组间构成（PRD 9.1 视角一）；
 * 4. 组装、按预算裁剪、算出体积统计。
 *
 * 空摘要（没有任何可发布的分组、也没有核心计数）必须能被调用方识别：
 * `includedRecordCount === 0` 且 `kpi.N === 0`。PRD 明确「空摘要不能发」，
 * 但**拒绝**这件事由界面 / 适配器决定，本函数只如实报告事实（不抛异常，
 * 因为「为什么空」需要展示给用户：可能是筛选后无记录，也可能是模块全被禁用）。
 */
export function buildAnalysisSummary(input: AnalysisSummaryInput): AnalysisSummary {
  const budget = input.byteBudget ?? AI_SUMMARY_BYTE_BUDGET
  const tooLongDays = input.cycleTooLongDays ?? DEFAULT_CYCLE_TOO_LONG_DAYS
  const retained = retainedRecords(input.records)

  const analysis = analyzeRecords(retained, {
    dataAsOf: input.metadata.dataAsOf,
    dedupStrategy: input.metadata.dedupStrategy,
    salaryComparable: input.metadata.salary.comparable,
    filters: input.filters,
    salaryBandEdges: input.groupingOptions.salaryBandEdges,
  })
  const filtered = analysis.filterOutcome.records

  const adjustments: SummaryAdjustment[] = []
  /*
   * 被禁用的模块取**数据集元数据**（`metadata.disabledModules`，由清洗阶段写定），
   * 而不是 `analyzeRecords` 的结果：后者只算指标，不携带「哪些模块不可用」这件事。
   * 元数据里的这份清单才是「部分分析导入」的正式结论。
   */
  const disabledModules = input.metadata.disabledModules

  /** 模块被禁用意味着该维度的数字不可比，整维不发（禁用原因随 caliberNotes 说明） */
  const allowedDimensions = SUMMARY_DIMENSIONS.filter((dimension) => {
    const module = DIMENSION_MODULE[dimension]
    if (module !== null && disabledModules.includes(module)) {
      adjustments.push({
        tableId: `dimension.${dimension}`,
        reason: `分析模块「${module}」被质量层禁用，该维度整维不发送`,
      })
      return false
    }
    return true
  })

  /**
   * 所有维度共用同一批记录，因此合计只需汇总一次。
   *
   * 它只给周期区间分组用（`AiCycleBandGroupsInput` 的契约要求带一份合计）；
   * 各维度表自己已经带着 `summaries`，不需要再塞一份合计进去。
   */
  const dimensionTotal = summarizeRecords('全部（当前筛选）', filtered)

  const dimensions = allowedDimensions.map((dimension) => tableOf(filtered, dimension, input))

  const cycleBandGroups: CycleBandGroups = {
    groups: cycleBandGroupsOf(filtered),
    total: dimensionTotal,
  }

  const comparisonTables = REJECTION_COMPARISON_DIMENSIONS.filter((dimension) =>
    allowedDimensions.includes(dimension),
  ).map((dimension) => tableOf(filtered, dimension, input))

  const summaryWithoutSize = {
    frozen: frozenVersionOf(input),
    scope: scopeOf(input, filtered.length),
    kpi: kpiOf(analysis),
    dimensions,
    cycleBandGroups,
    rejection: rejectionOf(filtered, comparisonTables, analysis),
    cycle: cycleOf(filtered, tooLongDays),
    quality: qualityOf(filtered, analysis, tooLongDays, input),
    caliberNotes: caliberNotesOf(input),
    salaryBandEdges: input.groupingOptions.salaryBandEdges ?? [],
    adjustments,
    includedRecordCount: filtered.length,
  }

  return applyBudget(summaryWithoutSize, budget)
}

/* ------------------------------------------------------------------ 组装细节 */

/**
 * 把记录按**实际招聘周期区间**分组（用与载荷完全相同的分箱函数）。
 *
 * 无法计算周期的记录（日期缺失 / 非法 / 为负）**不进任何桶**：
 * 「未知周期」不是一个可外发的周期区间，把它当区间发出去会被读成
 * 「这些人的周期落在某个区间」。这些记录由 `quality.cycleMissing` 单列说明。
 */
export function cycleBandGroupsOf(records: readonly NormalizedRecord[]): readonly GroupSummary[] {
  return groupRecords(records, (record) => cycleBandOf(actualCycleDays(record)) ?? UNKNOWN)
    .filter((group) => group.key !== UNKNOWN)
    .map((group) => summarizeRecords(group.key, group.records))
}

/**
 * 「缺失薪资」计数：有多少条记录的薪资**不可用于分析**。
 *
 * 用「总数 − 引擎已算好的有效样本数」而不是遍历记录去数，是为了复用既有口径
 * （`metricAvailability` 里「薪资对比」的 `validSampleCount` 正好是金额非空的记录数）。
 * `null`（模块不可用）时按「全部不可用」计，**不填 0**：0 会被读成「没有记录缺薪资」，
 * 而实际是「全部记录的薪资都不可用」（AI-1 的 D-061 是同一条口径）。
 */
export function missingSalaryCount(
  totalRecords: number,
  usableSalarySample: number | null,
): number {
  return Math.max(0, totalRecords - (usableSalarySample ?? 0))
}

function frozenVersionOf(input: AnalysisSummaryInput): SummaryFrozenVersion {
  const version = input.metadata.ruleVersion
  return {
    datasetId: input.metadata.datasetId ?? null,
    schemaVersion: version.schemaVersion,
    rulesVersion: version.rulesVersion,
    ruleVersionLabel: ruleVersionLabelOf(version),
    configRevision: version.configRevision ?? null,
    dedupPolicy: input.metadata.dedupStrategy,
    dataAsOf: input.metadata.dataAsOf,
    importedAt: input.metadata.importedAt,
  }
}

function scopeOf(input: AnalysisSummaryInput, rowCount: number): SummaryScope {
  return {
    rowCount,
    dedupPolicy: input.metadata.dedupStrategy,
    /*
     * 筛选描述**不是**在这里生成的：它由看板的纯逻辑层 `activeFilterSummary` 给出，
     * 因为「筛选项怎么写」是界面措辞问题，而不是统计口径问题。
     * 本层只负责原样搬运，并保证类型上是一串**已经脱敏过**的可读文本。
     */
    filters: input.filtersSummary,
    ruleVersion: input.metadata.ruleVersion.rulesVersion,
    dataAsOf: input.metadata.dataAsOf,
    timeBasis: input.timeBasis,
  }
}

function kpiOf(analysis: AnalysisResult): SummaryKpi {
  const counts = analysis.statusCounts
  return {
    N: counts.total,
    J: counts.joined,
    P: counts.pending,
    A: counts.approving,
    R1: counts.rejectedOffer,
    R2: counts.rejectedVerbally,
    R: counts.rejectedOffer + counts.rejectedVerbally,
    D: counts.coreDenominator,
    U: counts.unknown + counts.other,
  }
}

/** 一张预定义表：维度 + 已排序的分组（引擎算好的 `GroupSummary`，本层不重算） */
function tableOf(
  records: readonly NormalizedRecord[],
  dimension: GroupDimension,
  input: AnalysisSummaryInput,
): SummaryDimensionTable {
  const summaries = sortGroupsByDenominator(
    aggregateByDimension(records, dimension, input.groupingOptions),
  )
  return {
    metricId: `dimension.${dimension}`,
    dim: dimension,
    dimLabel: GROUP_DIMENSION_LABELS[dimension],
    groups: summaries.map(groupRowOf),
    summaries,
  }
}

function groupRowOf(group: GroupSummary): SummaryGroupRow {
  return {
    key: group.key,
    N: group.counts.total,
    D: group.counts.coreDenominator,
    R: group.counts.rejectedOffer + group.counts.rejectedVerbally,
    rejectedGroupCount: group.groupComposition.rejectedGroupCount,
    joinedGroupCount: group.groupComposition.joinedGroupCount,
    comparedCount: group.groupComposition.comparedCount,
    cycleSampleCount: group.cycles.actual.n,
    medianCycleDays: group.cycles.actual.medianDays,
  }
}

/**
 * 拒 offer 专项（PRD 9.1）。
 *
 * **两个人群必须同时说清**，这是本节唯一的难点：
 * - 核心率人群 D = J + P + R（含待入职）；
 * - 组间比较人群 = 拒 offer 组 + 入职组（待入职与审批中**一律不进**）。
 *
 * 因此 `excludedFromComparison` 是必填字段：只说「拒 offer 组 vs 入职组」而不说
 * 少了多少人，读者会把两个分母当成同一个。
 */
function rejectionOf(
  records: readonly NormalizedRecord[],
  comparisonTables: readonly SummaryDimensionTable[],
  analysis: AnalysisResult,
): SummaryRejection {
  const counts = analysis.statusCounts
  const rejectedTotal = counts.rejectedOffer + counts.rejectedVerbally
  const joinedTotal = counts.joined
  const reasons = rejectionReasonDistribution(records)

  return {
    profile: {
      rejectedTotal,
      joinedTotal,
      note: '组内构成：某特征在拒 offer 组的记录数 ÷ R，对比在入职组的记录数 ÷ J。这是画像构成，不是该特征的拒 offer 率。',
      tables: comparisonTables.map(profileTableOf),
    },
    featureRates: {
      note: '特征内结果：该特征的拒 offer 数 ÷ 该特征的核心分母 D。D 含待入职，与上面的组间构成分母不同。',
      tables: comparisonTables,
    },
    reasons: {
      distribution: reasons.categories.map((item) => ({
        category: item.category,
        count: item.count,
        unfilled: item.category === UNFILLED_REASON_LABEL,
      })),
      rejectedTotal,
      filledCount: reasons.categories
        .filter((item) => item.category !== UNFILLED_REASON_LABEL)
        .reduce((sum, item) => sum + item.count, 0),
      note: '原因分布以全部拒 offer 记录 R 为分母，包含「未填写」；「未填写」是缺失统计，不是一个原因。',
    },
    excludedFromComparison: counts.pending + counts.approving + counts.other + counts.unknown,
  }
}

/** 组内构成表：**只保留比较用的两个计数**，不带 D/R（见 `SummaryProfileTable` 的说明） */
function profileTableOf(table: SummaryDimensionTable): SummaryProfileTable {
  return {
    metricId: table.metricId,
    dim: table.dim,
    dimLabel: table.dimLabel,
    groups: table.groups.map((row) => ({
      key: row.key,
      rejectedGroupCount: row.rejectedGroupCount,
      joinedGroupCount: row.joinedGroupCount,
    })),
    summaries: table.summaries,
  }
}

function cycleOf(records: readonly NormalizedRecord[], tooLongDays: number): SummaryCycle {
  // 一次汇总同时取实际与计划周期：两次 `summarizeRecords` 会白算一遍全部计数
  const cycles = summarizeRecords('全部（当前筛选）', records).cycles
  return {
    actualSampleCount: cycles.actual.n,
    actualMeanDays: cycles.actual.meanDays,
    actualMedianDays: cycles.actual.medianDays,
    actualP75Days: cycles.actual.p75Days ?? null,
    plannedSampleCount: cycles.planned.n,
    plannedMedianDays: cycles.planned.medianDays,
    tooLongCount: cycleTooLongCount(records, tooLongDays),
    tooLongThresholdDays: tooLongDays,
    note: '实际周期只对已入职且日期合法非负的记录计算；待入职的计划周期单列，两者不可相加。',
  }
}

function qualityOf(
  records: readonly NormalizedRecord[],
  analysis: AnalysisResult,
  tooLongDays: number,
  input: AnalysisSummaryInput,
): SummaryQuality {
  const gptGroups = aggregateByDimension(records, 'school', {})
  const unknownSchool = gptGroups.find((group) => group.key === UNKNOWN)?.counts.total ?? 0
  const salaryAvailability = input.report.metricAvailability.find(
    (entry) => entry.module === '薪资对比',
  )
  return {
    unknownStatus: analysis.statusCounts.unknown,
    /*
     * 缺失薪资由**引擎已算好的**有效样本数反推（AI-1 的 D-061 同一条口径）：
     * 直接写 0 会被读成「没有记录缺薪资」，那是假数字。
     * `validSampleCount === null`（模块口径不适用）时按「全部不可用」计，也不填 0。
     */
    missingSalary: missingSalaryCount(records.length, salaryAvailability?.validSampleCount ?? null),
    unknownSchool,
    cycleMissing:
      records.length - records.filter((record) => actualCycleDays(record) !== null).length,
    cycleTooLongCount: cycleTooLongCount(records, tooLongDays),
    cycleTooLongDays: tooLongDays,
    disabledModules: input.metadata.disabledModules,
    availability: input.report.metricAvailability,
  }
}

/**
 * 本地口径说明（随 user message 一起展示，必须已是**可外发文本**）。
 *
 * 为什么由本层生成而不是让看板拼：这段文字会逐字进入发给模型的 messages，
 * 它的正确性直接影响 AI 会不会把 J÷N 当成入职率。放在这里才能被单测钉住。
 * 文案里**不许出现 Markdown 强调标记**（会逐字渲染进预览面板，前几步已多次踩过）。
 */
export function caliberNotesOf(input: AnalysisSummaryInput): readonly string[] {
  const notes = [
    'N = 全部保留记录（含审批中）；D = 已入职 + 待入职 + 拒绝 offer，审批中、其他、未知都不计入 D。',
    '入职率 = J ÷ D，不是 J ÷ N；审批中占比 = A ÷ N，与核心率的分母不同，必须分别说明。',
    '拒 offer 组的组间比较人群 = 拒 offer 组 + 入职组；待入职与审批中不进这个比较，但仍留在 D 里。',
    '率一律由「合计分子 ÷ 合计分母」算出，不是各分组百分比的平均。',
    '招聘周期只对已入职且日期合法非负的记录计算；待入职的计划周期单列，不能混入实际周期。',
    `本次去重策略：${input.metadata.dedupStrategy}。`,
  ]
  const availability = input.report.metricAvailability.filter((entry) => !entry.available)
  if (availability.length > 0) {
    notes.push(
      `以下模块在本数据集不可用，其相关维度没有发送：${availability
        .map((entry) => entry.module)
        .join('、')}。`,
    )
  }
  if (!input.metadata.salary.comparable) {
    notes.push('薪资计薪单位未确认，待遇对比与同岗基准不可用，因此薪资相关维度没有发送。')
  }
  return notes
}

/* ------------------------------------------------------------------ 体积预算 */

/**
 * 体积统计：把摘要按「载荷里真正会发送的部分」重新序列化后算字节数。
 *
 * 为什么不是 `JSON.stringify(summary).length`：摘要里有两块**不会**进入载荷
 * （`quality.availability` 是给本地核对用的，`frozen` 里的数据集 ID 也不外发），
 * 直接量整个对象会高估体积，导致「明明没超预算却先丢了表」。
 * 因此这里只量真正参与外发的部分，口径与引擎的 `payload.contentBytes` 对齐。
 */
export function summaryBytesOf(summary: {
  readonly kpi: SummaryKpi
  readonly scope: SummaryScope
  readonly dimensions: readonly SummaryDimensionTable[]
  readonly rejection: SummaryRejection
  readonly quality: SummaryQuality
  readonly caliberNotes: readonly string[]
  readonly cycleBandGroups: CycleBandGroups
}): number {
  const payloadShape = {
    kpi: summary.kpi,
    scope: summary.scope,
    dimensions: summary.dimensions.map((table) => ({
      metricId: table.metricId,
      dim: table.dim,
      rows: table.groups.map((row) => ({
        key: row.key,
        N: row.N,
        D: row.D,
        R: row.R,
      })),
    })),
    rejectionProfile: summary.rejection.profile.tables.map((table) => ({
      metricId: table.metricId,
      rows: table.groups.map((row) => ({
        key: row.key,
        rejectedGroupCount: row.rejectedGroupCount,
        joinedGroupCount: row.joinedGroupCount,
      })),
    })),
    rejectionReasons: summary.rejection.reasons.distribution.map((item) => ({
      key: item.category,
      count: item.count,
    })),
    quality: {
      unknownStatus: summary.quality.unknownStatus,
      missingSalary: summary.quality.missingSalary,
      unknownSchool: summary.quality.unknownSchool,
    },
    caliberNotes: summary.caliberNotes,
    cycleBandGroupCount: summary.cycleBandGroups.groups.length,
  }
  return new TextEncoder().encode(JSON.stringify(payloadShape)).length
}

/**
 * 超预算就**本地调整**（PRD 17.1：调整后重新生成预览，不静默截断）。
 *
 * 裁剪顺序 = 从最细的表开始丢，且每丢一项都写进 `adjustments`。
 * **不降低 k、不截断行**：这两件事都会让载荷里的数字与本地看板不一致，
 * 而「与看板同数」是本步的第一条验收标准。
 */
function applyBudget(
  draft: Omit<AnalysisSummary, 'totalBytes' | 'byteBudget'>,
  budget: number,
): AnalysisSummary {
  let current: Omit<AnalysisSummary, 'totalBytes' | 'byteBudget'> = draft
  let bytes = summaryBytesOf(current)
  const adjustments = [...current.adjustments]

  if (bytes > budget) {
    /*
     * 裁剪顺序：先丢最细的表（薪资 / 周期 / 房补 / 原因），再丢组间比较，
     * 最后才丢城市与渠道；极端情况下连城市也会被丢掉——**只剩总体指标**。
     *
     * 为什么清单是穷尽的、而不是「保留城市」：留下一张装不下的表会让
     * `totalBytes` 继续超过预算，而「超预算还发出去」正是 PRD 17.1 要防的事。
     * 装了什么都由 `adjustments` 如实记录，用户不会以为摘要本来就这么少。
     */
    const droppable = [
      'dimension.salaryBand',
      'dimension.cycleBand',
      'dimension.housingType',
      'rejection.reasons',
      'rejection.featureRates',
      'rejection.profile',
      'dimension.graduationYear',
      'dimension.school',
      'dimension.education',
      'dimension.requirementType',
      'dimension.department',
      'dimension.jobFamily',
      'dimension.position',
      'dimension.recruiter',
      'dimension.referralType',
      'dimension.channel',
      'dimension.city',
    ]
    for (const tableId of droppable) {
      if (bytes <= budget) {
        break
      }
      if (tableId.startsWith('dimension.')) {
        const dim = tableId.slice('dimension.'.length)
        const next = current.dimensions.filter((table) => table.dim !== dim)
        if (next.length === current.dimensions.length) {
          continue
        }
        current = { ...current, dimensions: next }
      } else if (tableId === 'rejection.reasons') {
        current = {
          ...current,
          rejection: {
            ...current.rejection,
            reasons: {
              distribution: [],
              rejectedTotal: current.rejection.reasons.rejectedTotal,
              filledCount: 0,
              note: current.rejection.reasons.note,
            },
          },
        }
      } else if (tableId === 'rejection.featureRates') {
        current = {
          ...current,
          rejection: {
            ...current.rejection,
            featureRates: { note: current.rejection.featureRates.note, tables: [] },
          },
        }
      } else if (tableId === 'rejection.profile') {
        current = {
          ...current,
          rejection: {
            ...current.rejection,
            profile: { ...current.rejection.profile, tables: [] },
          },
        }
      }
      adjustments.push({
        tableId,
        reason: `摘要超过体积预算（${String(budget)} 字节），已在本机丢弃该表以生成可发送的摘要`,
      })
      bytes = summaryBytesOf(current)
    }
  }

  return {
    ...current,
    adjustments,
    totalBytes: bytes,
    byteBudget: budget,
  }
}

/* ------------------------------------------------------------------ 界面辅助 */

/** 供界面提示用：某张预定义表的标签 */
export function predefinedTableLabel(id: string): string {
  return PREDEFINED_TABLES.find((table) => table.id === id)?.label ?? id
}

/** 维度标签的统一入口（界面不得再抄一份中文） */
export function dimensionLabelOf(dimension: GroupDimension): string {
  return GROUP_DIMENSION_LABELS[dimension]
}

/** 供测试与界面复用的「已确认可用维度」判定：与 `buildAnalysisSummary` 同一份规则 */
export function summaryDimensionEnabled(
  dimension: GroupDimension,
  disabledModules: readonly AnalysisModule[],
): boolean {
  const module = DIMENSION_MODULE[dimension]
  return module === null || !disabledModules.includes(module)
}

/** 每个维度对应的分析模块（导出给测试用，避免测试里再写一遍映射） */
export function dimensionModuleOf(dimension: GroupDimension): AnalysisModule | null {
  return DIMENSION_MODULE[dimension]
}
