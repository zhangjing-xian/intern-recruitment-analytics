/**
 * 指标引擎的组合入口（步骤7，docs/PRD.md 6 / 9 / 12 章）。
 *
 * 两条使用方式，页面按需取：
 * 1. `analyzeRecords(records, options)`：一次拿到「状态计数 + 全部率 + 周期 + 覆盖需求数 + 原因填写率 +
 *    同岗基准 + 筛选结果」，作为看板 KPI、报告与 AI 摘要的**唯一数据来源**；
 * 2. `decorateRecords(records, options)`：按契约把步骤7 负责的派生字段（基准、分位排名、低于中位数，
 *    以及周期缺失时的重算）填回记录，供明细表与风险规则使用。
 *
 * 铁律：引擎是**纯函数**，不依赖 React、网络或浏览器存储；`dataAsOf`（数据快照声明）、去重策略、
 * 规则版本、基准范围都会随结果一起返回，避免「结论对应哪份数据」说不清（PRD 6.3 / 10 章）。
 */

import {
  PENDING_JOINING_STATUS,
  countsTowardCoreDenominator,
  isAcceptedStatus,
  isRejectedStatus,
  type DedupStrategy,
} from '../enums'
import type {
  DateOnly,
  DerivedRecordFields,
  NormalizedRecord,
  SalaryBenchmarkSummary,
} from '../types'
import { CURRENT_RULE_VERSION, type RuleVersion } from '../version'

import {
  actualCycleDays,
  actualCycleStats,
  expectedInternshipStats,
  plannedCycleDays,
  plannedCycleStats,
  type CycleStats,
} from './durations'
import {
  EMPTY_FILTERS,
  applyFilters,
  retainedRecords,
  unconfirmedDuplicateCount,
  type AnalysisFilters,
  type FilterOutcome,
} from './filters'
import { requirementCoverageOf, type RequirementCoverage } from './grouping'
import { buildCoreRates, rejectionReasonFillRate, type CoreRateSummary, type RateMetric } from './rates'
import {
  benchmarkGroupKey,
  benchmarkScopeNote,
  buildSalaryBenchmarks,
  collectBenchmarkSamples,
  indexBenchmarks,
  isBelowBenchmarkMedian,
  salaryPercentileRankOf,
  type BenchmarkScope,
  type SalaryBenchmarkOptions,
  type SalaryBenchmarkSample,
} from './salary'
import { countStatuses, type StatusCounts } from './statusCounts'

/** 一次分析的全部输入口径；默认值都取最保守口径 */
export type AnalysisOptions = {
  /** 分析截止日（数据快照声明，由用户在清洗页确认） */
  readonly dataAsOf: DateOnly
  /** 去重策略（PRD 5.4）：随结果冻结，便于报告标注 */
  readonly dedupStrategy: DedupStrategy
  /** 币种与计薪周期是否已确认；false 时禁用基准与低薪标签 */
  readonly salaryComparable: boolean
  readonly filters?: AnalysisFilters
  readonly benchmarkScope?: BenchmarkScope
  readonly benchmarkMinSample?: number
  readonly salaryBandEdges?: readonly number[]
  /**
   * 基准参照集合：默认**全部保留记录**（不经过业务筛选，避免基准漂移）。
   * 显式传入时视为用户自定义范围，`benchmarkScope` 也必须标为 `userDefined`。
   */
  readonly referenceRecords?: readonly NormalizedRecord[]
}

/** 基准所需的输入子集（供 `decorateRecords` 复用） */
export type BenchmarkDecorationOptions = Pick<
  AnalysisOptions,
  'salaryComparable' | 'benchmarkScope' | 'benchmarkMinSample' | 'referenceRecords'
>

/** 派生字段已由本引擎填满的记录（`derived` 不再是 null） */
export type DecoratedRecord = Omit<NormalizedRecord, 'derived'> & {
  readonly derived: DerivedRecordFields
}

function resolveBenchmarkOptions(options: BenchmarkDecorationOptions): SalaryBenchmarkOptions {
  return {
    scope: options.benchmarkScope ?? 'dataset',
    minSample: options.benchmarkMinSample,
    comparable: options.salaryComparable,
  }
}

/**
 * 填充步骤7 负责的派生字段（PRD 4.2 契约：组件不得自行计算）：
 * 周期与接受 / 拒绝标记按统一口径重算，薪资基准、百分位排名与「低于中位数」由引擎给出；
 * 清洗阶段已有的 `dataQualityFlags` 原样保留，不在引擎里追加主观标签。
 */
export function decorateRecords(
  records: readonly NormalizedRecord[],
  options: BenchmarkDecorationOptions,
): readonly DecoratedRecord[] {
  const reference = options.referenceRecords ?? records
  const benchmarkIndex = indexBenchmarks(
    buildSalaryBenchmarks(reference, resolveBenchmarkOptions(options)),
  )
  const samples = new Map<string, SalaryBenchmarkSample>(
    collectBenchmarkSamples(reference).map((sample) => [sample.groupKey, sample]),
  )

  return records.map((record) => {
    const cycleDays = actualCycleDays(record)
    const groupKey = benchmarkGroupKey(record)
    const benchmark = groupKey === null ? undefined : benchmarkIndex.get(groupKey)
    return {
      ...record,
      derived: {
        recruitmentCycleDays: cycleDays,
        actualCycleEligible: cycleDays !== null,
        plannedCycleEligible:
          record.offerStatus === PENDING_JOINING_STATUS && plannedCycleDays(record) !== null,
        isAccepted: isAcceptedStatus(record.offerStatus),
        isRejected: isRejectedStatus(record.offerStatus),
        countedInCoreDenominator: countsTowardCoreDenominator(record.offerStatus),
        salaryBenchmark: benchmark ?? null,
        salaryPercentileRank: salaryPercentileRankOf(record, samples),
        isBelowMedian: isBelowBenchmarkMedian(record, benchmarkIndex),
        dataQualityFlags: record.derived?.dataQualityFlags ?? [],
      },
    }
  })
}

/** 分析结果：口径快照 + 全部指标；页面只展示，不再计算 */
export type AnalysisResult = {
  readonly dataAsOf: DateOnly
  readonly dedupStrategy: DedupStrategy
  readonly ruleVersion: RuleVersion
  readonly benchmarkScope: BenchmarkScope
  readonly benchmarkNote: string
  readonly filters: AnalysisFilters
  readonly filterOutcome: FilterOutcome
  /** 状态筛选生效时的「当前子集率」提示；未筛选为 null */
  readonly subsetRateNote: string | null
  readonly statusCounts: StatusCounts
  readonly rates: CoreRateSummary
  readonly cycles: {
    readonly actual: CycleStats
    readonly planned: CycleStats
    readonly expectedInternship: CycleStats
  }
  readonly coverage: RequirementCoverage
  readonly rejectionReasonFillRate: RateMetric
  readonly benchmarks: readonly SalaryBenchmarkSummary[]
  /** 保留但尚未确认去重的重复行数（必须提示，不得当已确认） */
  readonly unconfirmedDuplicateCount: number
}

/** 一次算齐全部共享指标（KPI 卡片、分组表、报告与 AI 摘要都取这里的结果） */
export function analyzeRecords(
  records: readonly NormalizedRecord[],
  options: AnalysisOptions,
): AnalysisResult {
  const filters = options.filters ?? EMPTY_FILTERS
  const reference = options.referenceRecords ?? retainedRecords(records)
  const benchmarkOptions = resolveBenchmarkOptions(options)
  const outcome = applyFilters(records, filters, { salaryBandEdges: options.salaryBandEdges })
  const counts = countStatuses(outcome.records)

  return {
    dataAsOf: options.dataAsOf,
    dedupStrategy: options.dedupStrategy,
    ruleVersion: CURRENT_RULE_VERSION,
    benchmarkScope: benchmarkOptions.scope ?? 'dataset',
    benchmarkNote: `${benchmarkScopeNote(benchmarkOptions)}；参照记录 ${reference.length} 条`,
    filters,
    filterOutcome: outcome,
    subsetRateNote: outcome.statusSubset
      ? '已启用 offer 状态筛选：以下全部比率均为当前子集率，与整体率不可直接比较'
      : null,
    statusCounts: counts,
    rates: buildCoreRates(counts),
    cycles: {
      actual: actualCycleStats(outcome.records),
      planned: plannedCycleStats(outcome.records),
      expectedInternship: expectedInternshipStats(outcome.records),
    },
    coverage: requirementCoverageOf(outcome.records),
    rejectionReasonFillRate: rejectionReasonFillRate(outcome.records),
    benchmarks: buildSalaryBenchmarks(reference, benchmarkOptions),
    unconfirmedDuplicateCount: unconfirmedDuplicateCount(outcome.records),
  }
}
