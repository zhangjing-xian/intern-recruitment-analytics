/**
 * 同岗薪酬基准（docs/PRD.md 6.2）。
 *
 * 严格同组：`城市 + 序列 + 规范化岗位 + 币种 + 计薪周期`。约定与红线：
 * - 参照集合默认是当前数据集**全部保留状态记录中有效薪资**的记录，不受渠道 / HR / offer 状态 /
 *   薪资筛选影响，避免切换「拒 offer 组」时基准漂移；用户切换基准范围必须显式记录（`scope`）；
 * - 有效样本 `n ≥ 5` 才出基准；`n < 5` 显示「同岗样本不足」，**不打低薪标签**，也不自动扩展到不同岗位 / 城市；
 * - 「未知」「其他」是**合并桶**，无法保证严格同组，因此不参与基准（宁可判样本不足）；
 * - 分位数线性插值、排名用并列中位秩（见 ./quantile.ts）；`低于中位数 = salary < P50`，相等不标低；
 * - 「薪资 + 现金房补」仅在同币种同周期且金额明确时加总；**住宿不折现**，房补缺失时总额未知（不填 0）。
 */

import {
  HOUSING_ACCOMMODATION,
  HOUSING_CASH,
  HOUSING_NO_SUBSIDY,
  OTHER,
  UNKNOWN,
  type SalaryUnit,
} from '../enums'
import type { NormalizedRecord, SalaryBenchmarkSummary } from '../types'

import {
  isBelowMedianValue,
  medianRankPercentile,
  quantilesOf,
  sortNumbersAscending,
} from './quantile'

/** 同岗基准的最小有效样本（PRD 6.2：n ≥ 5 才出基准） */
export const DEFAULT_BENCHMARK_MIN_SAMPLE = 5

/** 基准范围：默认 `dataset`；用户显式切换时必须记录为 `userDefined` */
export type BenchmarkScope = 'dataset' | 'userDefined'

/** 组键分隔符：用控制字符，避免城市 / 岗位名里出现分隔符导致误合并 */
const KEY_SEPARATOR = '\u001F'

/** 去掉 C0 控制字符与 DEL（这类字符不可能出现在正常单元格里，但也不能让它破坏组键结构） */
function stripControlCharacters(value: string): string {
  let result = ''
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) {
      result += character
    }
  }
  return result
}

/** 「未知」「其他」这类合并桶不能保证严格同组，一律不参与基准 */
const NON_SPECIFIC_VALUES: ReadonlySet<string> = new Set<string>([UNKNOWN, OTHER])

function keyPart(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const cleaned = stripControlCharacters(value).trim()
  if (cleaned === '' || NON_SPECIFIC_VALUES.has(cleaned)) {
    return null
  }
  return cleaned
}

/**
 * 严格同组键；任一组件缺失 / 未知 / 其他，或币种与计薪周期未确认（`null` / 其他）时返回 null，
 * 该记录不参与基准、也不获得低薪标签。
 */
export function benchmarkGroupKey(record: NormalizedRecord): string | null {
  const city = keyPart(record.city)
  const jobFamily = keyPart(record.jobFamily)
  const position = keyPart(record.position)
  const currency = record.currency
  const salaryUnit = record.salaryUnit

  if (
    city === null ||
    jobFamily === null ||
    position === null ||
    currency === null ||
    salaryUnit === null ||
    NON_SPECIFIC_VALUES.has(currency) ||
    NON_SPECIFIC_VALUES.has(salaryUnit)
  ) {
    return null
  }

  return [city, jobFamily, position, currency, salaryUnit].join(KEY_SEPARATOR)
}

/** 组键的可读写法，用于「参照集合定义显示在图旁」：`上海 / 技术 / 前端开发 / CNY / 元/月` */
export function benchmarkGroupLabel(groupKey: string): string {
  return groupKey.split(KEY_SEPARATOR).join(' / ')
}

/** 记录的有效薪资金额；非有限数或负数视为无效（缺失不等于 0 元） */
export function salaryAmountOf(record: NormalizedRecord): number | null {
  const amount = record.salaryAmount
  if (amount === null || !Number.isFinite(amount) || amount < 0) {
    return null
  }
  return amount
}

export type SalaryBenchmarkOptions = {
  /** 基准范围；默认 `dataset` */
  readonly scope?: BenchmarkScope
  /** 最小有效样本；默认 5 */
  readonly minSample?: number
  /** 批次是否已确认币种与计薪周期；false 时**不出任何基准**（与清洗层的模块禁用一致） */
  readonly comparable?: boolean
}

/** 一个同组的有效薪资样本（升序），用于分位与百分位排名 */
export type SalaryBenchmarkSample = {
  readonly groupKey: string
  readonly values: readonly number[]
}

/** 按严格同组汇总有效薪资样本（**不**做任何筛选，参照集合由调用方决定） */
export function collectBenchmarkSamples(
  referenceRecords: readonly NormalizedRecord[],
): readonly SalaryBenchmarkSample[] {
  const buckets = new Map<string, number[]>()
  for (const record of referenceRecords) {
    const groupKey = benchmarkGroupKey(record)
    const amount = salaryAmountOf(record)
    if (groupKey === null || amount === null) {
      continue
    }
    const bucket = buckets.get(groupKey)
    if (bucket === undefined) {
      buckets.set(groupKey, [amount])
    } else {
      bucket.push(amount)
    }
  }

  return [...buckets.entries()]
    .map(([groupKey, values]) => ({ groupKey, values: sortNumbersAscending(values) }))
    .sort((left, right) => (left.groupKey < right.groupKey ? -1 : 1))
}

/** 由参照集合构造全部同岗基准（n < 5 时 `sufficient = false` 且各分位为 null） */
export function buildSalaryBenchmarks(
  referenceRecords: readonly NormalizedRecord[],
  options: SalaryBenchmarkOptions = {},
): readonly SalaryBenchmarkSummary[] {
  const scope: BenchmarkScope = options.scope ?? 'dataset'
  const minSample = options.minSample ?? DEFAULT_BENCHMARK_MIN_SAMPLE
  const comparable = options.comparable ?? true

  if (!comparable) {
    return []
  }

  return collectBenchmarkSamples(referenceRecords).map((sample) => {
    const sufficient = sample.values.length >= minSample
    const stats = sufficient
      ? quantilesOf(sample.values)
      : { n: sample.values.length, p25: null, p50: null, p75: null }
    return {
      groupKey: sample.groupKey,
      scope,
      n: sample.values.length,
      p25: stats.p25,
      p50: stats.p50,
      p75: stats.p75,
      sufficient,
    }
  })
}

/** 基准索引：按组键取回，供逐条记录填充 `derived.salaryBenchmark` */
export function indexBenchmarks(
  benchmarks: readonly SalaryBenchmarkSummary[],
): ReadonlyMap<string, SalaryBenchmarkSummary> {
  return new Map(benchmarks.map((benchmark) => [benchmark.groupKey, benchmark]))
}

/** 参照集合与门槛的可读描述（必须显示在基准图旁，避免「基准悄悄变了」） */
export function benchmarkScopeNote(options: SalaryBenchmarkOptions = {}): string {
  const scope = options.scope ?? 'dataset'
  const minSample = options.minSample ?? DEFAULT_BENCHMARK_MIN_SAMPLE
  const scopeText =
    scope === 'dataset'
      ? '当前数据集全部保留状态记录的有效薪资（不受渠道 / HR / offer 状态 / 薪资筛选影响）'
      : '用户显式指定的参照范围（非默认，必须随报告记录）'
  return `参照集合：${scopeText}；最小有效样本 n ≥ ${minSample}；范围标记：${scope}`
}

/** 记录的百分位排名（并列中位秩，比率 0–1）；无基准或无薪资返回 null */
export function salaryPercentileRankOf(
  record: NormalizedRecord,
  samples: ReadonlyMap<string, SalaryBenchmarkSample>,
): number | null {
  const groupKey = benchmarkGroupKey(record)
  const amount = salaryAmountOf(record)
  if (groupKey === null || amount === null) {
    return null
  }
  const sample = samples.get(groupKey)
  if (sample === undefined) {
    return null
  }
  return medianRankPercentile(sample.values, amount)
}

/** 该记录是否低于同岗中位数：`salary < P50`，相等不标低；基准不足 / 薪资未知 → null */
export function isBelowBenchmarkMedian(
  record: NormalizedRecord,
  benchmarks: ReadonlyMap<string, SalaryBenchmarkSummary>,
): boolean | null {
  const groupKey = benchmarkGroupKey(record)
  const amount = salaryAmountOf(record)
  if (groupKey === null || amount === null) {
    return null
  }
  const benchmark = benchmarks.get(groupKey)
  if (benchmark === undefined || !benchmark.sufficient) {
    return null
  }
  return isBelowMedianValue(amount, benchmark.p50)
}

/** 计薪周期 → 房补周期：只有完全对齐才可加总（「次」无法与月 / 天对齐） */
const PERIOD_OF_SALARY_UNIT: Readonly<Record<SalaryUnit, string | null>> = {
  '元/月': '月',
  '元/天': '天',
  其他: null,
}

/** 「薪资 + 现金房补」的可加总结果；不可加总时 `total = null`（**不填 0**） */
export type CompensationTotal = {
  readonly salaryAmount: number | null
  readonly housingCashAmount: number | null
  /** 仅当币种与周期都对齐、金额明确时给出；否则 null */
  readonly total: number | null
  readonly alignable: boolean
  readonly note: string
}

/**
 * 现金待遇合计（docs/PRD.md 6.2「薪资 + 现金房补」）：
 * - 「无补贴」金额视为 0，可合计；「提供住宿」**不折现**，因此总额未知；
 * - 「未知」「其他」房补不得当 0，也不当无补贴；
 * - 现金房补与计薪周期不一致（如「次」）或金额缺失时，总额未知，**不**只报薪资冒充总额。
 */
export function totalCashCompensation(record: NormalizedRecord): CompensationTotal {
  const salary = salaryAmountOf(record)
  const housingAmount = record.housingAmount

  if (record.housingType === HOUSING_NO_SUBSIDY) {
    return {
      salaryAmount: salary,
      housingCashAmount: 0,
      total: salary,
      alignable: true,
      note: '无补贴：房补按 0 计入，合计等于薪资',
    }
  }

  if (record.housingType === HOUSING_CASH) {
    if (housingAmount === null || !Number.isFinite(housingAmount) || housingAmount < 0) {
      return {
        salaryAmount: salary,
        housingCashAmount: null,
        total: null,
        alignable: false,
        note: '现金房补金额缺失或非法：总额未知，不用薪资冒充总额',
      }
    }
    const expectedPeriod =
      record.salaryUnit === null ? null : PERIOD_OF_SALARY_UNIT[record.salaryUnit]
    const aligned =
      expectedPeriod !== null && record.housingPeriod === expectedPeriod && salary !== null
    return {
      salaryAmount: salary,
      housingCashAmount: housingAmount,
      total: aligned ? salary + housingAmount : null,
      alignable: aligned,
      note: aligned
        ? `现金房补按「${expectedPeriod}」与计薪周期对齐后可合计`
        : '房补周期与计薪周期不一致、币种未确认或薪资缺失：不做合计，只分别展示',
    }
  }

  if (record.housingType === HOUSING_ACCOMMODATION) {
    return {
      salaryAmount: salary,
      housingCashAmount: null,
      total: null,
      alignable: false,
      note: '提供住宿：不折算成现金，也不视为「无补贴」，总额未知',
    }
  }

  return {
    salaryAmount: salary,
    housingCashAmount: null,
    total: null,
    alignable: false,
    note: '房补类型未知 / 其他：不得当 0 或无补贴，总额未知',
  }
}
