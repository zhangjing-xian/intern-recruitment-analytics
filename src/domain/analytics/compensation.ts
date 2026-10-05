/**
 * 薪酬与房补分析（步骤9，docs/PRD.md 6.2、8 章「薪酬房补」）。
 *
 * 三条红线（违反即产生错误结论）：
 * 1. 「元/月」与「元/天」是不同计薪周期，**永不**合算，也不放在同一条分位里；
 * 2. 有效样本不足（默认 n < 5）只报 n，**不出分位、不画直方图**，也不打低薪标签；
 * 3. 「无补贴」= 0 元、「提供住宿」不折现也不算无补贴、房补未知 / 金额缺失**不填 0**。
 *
 * 本模块只消费 `salaryAmountOf`（有效金额口径在 ./salary.ts）与 `quantilesOf`（分位公式在 ./quantile.ts），
 * 不重复实现任何公式。
 */

import {
  HOUSING_ACCOMMODATION,
  HOUSING_CASH,
  HOUSING_NO_SUBSIDY,
  OTHER,
  UNKNOWN,
  type HousingPeriod,
  type SalaryUnit,
} from '../enums'
import type { NormalizedRecord } from '../types'

import { aggregateByDimension, sortGroupsByDenominator, type GroupSummary } from './grouping'
import { quantilesOf, type Quantiles } from './quantile'
import { DEFAULT_BENCHMARK_MIN_SAMPLE, salaryAmountOf, totalCashCompensation } from './salary'

/** 计薪单位分组标签（单位缺失是「未知单位」，与「其他单位」分开） */
export const SALARY_UNIT_UNKNOWN_LABEL = '计薪单位未知'
export const SALARY_UNIT_OTHER_LABEL = '其他单位'

/** 未确认币种 / 计薪周期时的禁用说明（与清洗层的模块禁用口径一致） */
export const SALARY_COMPARISON_DISABLED_REASON =
  '数据集的币种或计薪周期尚未确认：按口径要求禁用薪资 / 房补对比（含分位与直方图），确认后再查看。'

/** 单位不可比的统一提示 */
export const SALARY_UNIT_NOTE =
  '「元/月」与「元/天」是不同计薪周期，只能并列展示、不能合算；分位与直方图只在该单位有效样本 n ≥ 5 时给出，n < 5 只报记录数。'

/** 房补口径提示（住宿 ≠ 无补贴，缺失 ≠ 0 元） */
export const HOUSING_NOTE =
  '「无补贴」按 0 元计入合计；「提供住宿」不折算成现金，也不算「无补贴」；房补类型未知或现金金额缺失时总额未知，不填 0。'

/** 一个直方图分箱（左闭右闭，最后一个箱包含最大值） */
export type SalaryHistogramBin = {
  readonly index: number
  readonly from: number
  /** 上界；单值样本时为 null（区间退化为一个点） */
  readonly to: number | null
  readonly label: string
  readonly count: number
}

/** 一个计薪单位的薪资分布；分位与直方图只在 `sufficient` 为 true 时给出 */
export type SalaryUnitDistribution = {
  /** 计薪单位；null 表示未知单位（不与其他单位合算） */
  readonly unit: SalaryUnit | null
  readonly label: string
  /** 该单位下的记录数（含薪资缺失的记录） */
  readonly recordCount: number
  /** 有效薪资样本数 n */
  readonly n: number
  /** 薪资缺失 / 非法的记录数（不进样本，也不当 0 元） */
  readonly excludedCount: number
  readonly sufficient: boolean
  readonly quantiles: Quantiles
  readonly mean: number | null
  readonly min: number | null
  readonly max: number | null
  readonly histogram: readonly SalaryHistogramBin[]
  /**
   * 本次直方图**用了哪种分箱方式**（2026-09-27）。
   *
   * 为什么必须随图给出：同一张图在不同数据上可能是「逐值出箱」也可能是「等宽分箱」，
   * 读图的人不该去猜；而且这两种方式下「18–19」这种标签的含义完全不同
   * （逐值箱的标签就是一个真实取值，不是区间）。
   */
  readonly histogramNote: string
}

/* ------------------------------------------------------------------ 薪资分布（按计薪单位分开） */

/** 单位标签（未知与「其他」分开显示，避免把未识别单位当成已知单位） */
function unitLabel(unit: SalaryUnit | null): string {
  if (unit === null) {
    return SALARY_UNIT_UNKNOWN_LABEL
  }
  if (unit === OTHER) {
    return SALARY_UNIT_OTHER_LABEL
  }
  return unit
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 「按实际出现的取值逐值出箱」的最大取值种类数（2026-09-27）。
 *
 * 12 是运营意义上「整齐档位」的常见量级（实习生日薪/月薪的档位一般不超过十来个）；
 * 超过它就说明金额是连续的或零碎的，逐值出箱会让分布形状消失，此时退回等宽分箱。
 * 两个分支在图注里都会写明，读图的人不需要猜这次用的是哪一种。
 */
export const VALUE_BIN_MAX_DISTINCT = 12

/**
 * 描述本次直方图用了哪种分箱方式（与 `buildHistogram` 的分支**逐条对应**）。
 *
 * 单独一个函数是为了让「图注」与「实际画法」不会各说一套：两边读的是同一组判据。
 */
function histogramNoteOf(values: readonly number[], binCount: number): string {
  const distinct = new Set(values).size
  if (distinct <= 1) {
    return `分箱方式：本次有效样本的取值全部相同（${String(roundTo2(values[0] ?? 0))}），只出一个箱；右上角不是区间`
  }
  if (distinct <= VALUE_BIN_MAX_DISTINCT) {
    return `分箱方式：按实际出现的 ${String(distinct)} 个取值逐个出箱——每根柱子就是一个真实取值，标签不是区间`
  }
  return `分箱方式：等宽 ${String(Math.max(1, Math.trunc(binCount)))} 档（实际出现 ${String(distinct)} 个不同取值，超过 ${String(VALUE_BIN_MAX_DISTINCT)} 个时逐值出箱会让分布形状消失）`
}

/** 等宽分箱（左闭右闭）；样本全相同时退化为单个箱，不编造区间 */
function buildHistogram(values: readonly number[], binCount: number): readonly SalaryHistogramBin[] {
  if (values.length === 0) {
    return []
  }
  const min = values[0]
  const max = values[values.length - 1]
  if (min === max) {
    return [{ index: 0, from: min, to: null, label: String(roundTo2(min)), count: values.length }]
  }

  /*
   * 取值种类少时**按实际出现的取值逐值出箱**（用户需求，2026-09-27）。
   *
   * 为什么：等宽分箱在「取值是整齐的档位」时会产生一堆空箱。实测用户的真实名单里薪资只有
   * 3500 / 4000 / 4500 / 5000 / 5500（步长 500），而 min=3500、max=5500、8 档 → 档宽 250，
   * 于是 3750–4000、4250–4500、4750–5000 三格恒为 0 条，读图的人会以为数据缺失。
   * 逐值出箱后每根柱子就是一个真实取值，标签就是那个值本身。
   *
   * 为什么仍然保留等宽：取值种类多（连续金额、多币种换算后的零碎值）时逐值出箱会退化成
   * 「一柱一条记录」，分布形状反而看不出来；此时等宽分箱才是对的。阈值见 `VALUE_BIN_MAX_DISTINCT`。
   */
  const distinct = [...new Set(values)].sort((left, right) => left - right)
  if (distinct.length <= VALUE_BIN_MAX_DISTINCT) {
    const counts = new Map<number, number>()
    for (const value of values) {
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return distinct.map((value, index) => ({
      index,
      from: value,
      // 单值箱没有右边界：`to = null` 与「样本全相同」那一支保持同一约定，界面据此不显示区间
      to: null,
      label: String(roundTo2(value)),
      count: counts.get(value) ?? 0,
    }))
  }

  const buckets = Math.max(1, Math.trunc(binCount))
  const width = (max - min) / buckets
  const bins: SalaryHistogramBin[] = []
  for (let index = 0; index < buckets; index += 1) {
    const from = roundTo2(min + index * width)
    const to = index === buckets - 1 ? roundTo2(max) : roundTo2(min + (index + 1) * width)
    bins.push({ index, from, to, label: `${from}–${to}`, count: 0 })
  }

  for (const value of values) {
    const rawIndex = Math.floor((value - min) / width)
    const index = Math.min(Math.max(rawIndex, 0), buckets - 1)
    const bin = bins[index]
    bins[index] = { ...bin, count: bin.count + 1 }
  }
  return bins
}

export type SalaryDistributionOptions = {
  /** 币种与计薪周期是否已确认；false 时禁用比较（不出分位与直方图） */
  readonly comparable?: boolean
  readonly minSample?: number
  /** 直方图分箱数；默认 8 */
  readonly bins?: number
}

export type SalaryDistributionResult = {
  readonly comparable: boolean
  /** 禁用原因；可用时为 null */
  readonly disabledReason: string | null
  readonly byUnit: readonly SalaryUnitDistribution[]
  /** 有效薪资的单位个数（> 1 时说明数据里存在多种计薪周期） */
  readonly unitCount: number
  readonly note: string
}

/**
 * 按计薪单位分别给出薪资分布：每个单位一条记录数 / n / 分位 / 极值 / 直方图。
 * 未确认币种与计薪周期（`comparable = false`）时**不出任何分位**，只返回禁用原因。
 */
export function salaryDistributionByUnit(
  records: readonly NormalizedRecord[],
  options: SalaryDistributionOptions = {},
): SalaryDistributionResult {
  const comparable = options.comparable ?? true
  const minSample = options.minSample ?? DEFAULT_BENCHMARK_MIN_SAMPLE
  const bins = options.bins ?? 8

  if (!comparable) {
    return {
      comparable: false,
      disabledReason: SALARY_COMPARISON_DISABLED_REASON,
      byUnit: [],
      unitCount: 0,
      note: SALARY_UNIT_NOTE,
    }
  }

  const buckets = new Map<string, { readonly unit: SalaryUnit | null; records: NormalizedRecord[] }>()
  for (const record of records) {
    const unit = record.salaryUnit
    const key = unit === null ? 'unknown-unit' : unit
    const bucket = buckets.get(key)
    if (bucket === undefined) {
      buckets.set(key, { unit, records: [record] })
    } else {
      bucket.records.push(record)
    }
  }

  const byUnit = [...buckets.values()].map<SalaryUnitDistribution>((bucket) => {
    const amounts: number[] = []
    for (const record of bucket.records) {
      const amount = salaryAmountOf(record)
      if (amount !== null) {
        amounts.push(amount)
      }
    }
    const sorted = [...amounts].sort((left, right) => left - right)
    const sufficient = sorted.length >= minSample
    const quantiles = sufficient
      ? quantilesOf(sorted)
      : { n: sorted.length, p25: null, p50: null, p75: null }
    const total = sorted.reduce((sum, value) => sum + value, 0)

    return {
      unit: bucket.unit,
      label: unitLabel(bucket.unit),
      recordCount: bucket.records.length,
      n: sorted.length,
      excludedCount: bucket.records.length - sorted.length,
      sufficient,
      quantiles,
      mean: sufficient ? total / sorted.length : null,
      min: sufficient ? sorted[0] : null,
      max: sufficient ? sorted[sorted.length - 1] : null,
      histogram: sufficient ? buildHistogram(sorted, bins) : [],
      histogramNote: sufficient ? histogramNoteOf(sorted, bins) : '',
    }
  })

  byUnit.sort((left, right) => {
    if (right.n !== left.n) {
      return right.n - left.n
    }
    return left.label < right.label ? -1 : left.label > right.label ? 1 : 0
  })

  return {
    comparable: true,
    disabledReason: null,
    byUnit,
    // 只统计「可识别的计薪单位且确有有效薪资样本」的个数：未知 / 其他单位不可比，不计入
    unitCount: byUnit.filter((distribution) => distribution.unit !== null && distribution.unit !== OTHER && distribution.n > 0)
      .length,
    note: SALARY_UNIT_NOTE,
  }
}

/* ------------------------------------------------------------------ 房补类型对比 */

/** 现金房补金额按房补周期分开的统计（周期不同不能合算：月 / 天 / 次口径本就不同） */
export type HousingCashStats = {
  /** 房补周期；null = 未知周期（不与其他周期合算） */
  readonly period: HousingPeriod | null
  readonly label: string
  /** 有效金额样本数 */
  readonly n: number
  readonly sufficient: boolean
  readonly quantiles: Quantiles
  /** 现金房补但金额缺失 / 非法的记录数（总额未知，不填 0） */
  readonly excludedCount: number
}

export type HousingComparisonResult = {
  /** 按房补类型分组的完整汇总（N / J / P / A / R / D、各率、周期），复用通用分组聚合 */
  readonly groups: readonly GroupSummary[]
  readonly cashByPeriod: readonly HousingCashStats[]
  /** 提供住宿的记录数：**不折现**，也不当作无补贴 */
  readonly accommodationCount: number
  /** 无补贴的记录数（金额按 0 元口径） */
  readonly noSubsidyCount: number
  /** 现金房补但金额缺失 / 非法的记录数 */
  readonly cashAmountMissingCount: number
  /** 房补类型为「未知」或「其他」的记录数（不得当 0 元或无补贴） */
  readonly unknownOrOtherCount: number
  readonly note: string
}

const HOUSING_PERIOD_UNKNOWN_LABEL = '房补周期未知'

export type HousingComparisonOptions = {
  readonly minSample?: number
}

/**
 * 房补类型对比：类型分布与各率来自通用分组聚合；现金房补金额另按房补周期分列统计。
 * 「提供住宿」「未知房补」「无补贴」三者在结果里是**三个不同数字**，界面不得合并显示。
 */
export function housingComparisonOf(
  records: readonly NormalizedRecord[],
  options: HousingComparisonOptions = {},
): HousingComparisonResult {
  const minSample = options.minSample ?? DEFAULT_BENCHMARK_MIN_SAMPLE
  const buckets = new Map<string, { readonly period: HousingPeriod | null; amounts: number[]; excluded: number }>()
  let accommodationCount = 0
  let noSubsidyCount = 0
  let unknownOrOtherCount = 0
  let cashAmountMissingCount = 0

  for (const record of records) {
    if (record.housingType === HOUSING_ACCOMMODATION) {
      accommodationCount += 1
      continue
    }
    if (record.housingType === HOUSING_NO_SUBSIDY) {
      noSubsidyCount += 1
      continue
    }
    if (record.housingType === UNKNOWN || record.housingType === OTHER) {
      unknownOrOtherCount += 1
      continue
    }
    if (record.housingType !== HOUSING_CASH) {
      continue
    }

    // 现金房补金额统一取引擎的 `totalCashCompensation`：「无补贴」= 0、缺失不填 0、住宿不折现
    const amount = totalCashCompensation(record).housingCashAmount
    const period = record.housingPeriod
    const key = period === null ? 'unknown-period' : period
    const bucket = buckets.get(key)
    const target = bucket ?? { period, amounts: [] as number[], excluded: 0 }
    if (bucket === undefined) {
      buckets.set(key, target)
    }
    if (amount === null) {
      target.excluded += 1
      cashAmountMissingCount += 1
    } else {
      target.amounts.push(amount)
    }
  }

  const cashByPeriod = [...buckets.values()]
    .map<HousingCashStats>((bucket) => {
      const sorted = [...bucket.amounts].sort((left, right) => left - right)
      const sufficient = sorted.length >= minSample
      return {
        period: bucket.period,
        label: bucket.period ?? HOUSING_PERIOD_UNKNOWN_LABEL,
        n: sorted.length,
        sufficient,
        quantiles: sufficient
          ? quantilesOf(sorted)
          : { n: sorted.length, p25: null, p50: null, p75: null },
        excludedCount: bucket.excluded,
      }
    })
    .sort((left, right) => (right.n !== left.n ? right.n - left.n : left.label < right.label ? -1 : 1))

  return {
    groups: sortGroupsByDenominator(aggregateByDimension(records, 'housingType')),
    cashByPeriod,
    accommodationCount,
    noSubsidyCount,
    cashAmountMissingCount,
    unknownOrOtherCount,
    note: HOUSING_NOTE,
  }
}

