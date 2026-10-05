/**
 * 质量报告（docs/PRD.md 5.5）：问题分级汇总、各指标有效样本、模块可用性与决策日志。
 *
 * 这里只做**计数与可用性**：率、分位、基准等公式一律留给步骤7 的统一指标引擎
 * （`domain/analytics`），组件与本层都不实现指标公式。
 */

import {
  ANALYSIS_MODULES,
  UNKNOWN,
  disabledModulesFor,
  type AnalysisModule,
  type DataQualityIssue,
  type DataQualityIssueCode,
  type DatasetCounts,
  type MetricAvailability,
  type NormalizedRecord,
  type SalarySetting,
} from '../domain'

/** 问题码 → 条数（界面按问题码过滤与展示用） */
export function countIssuesByCode(
  issues: readonly DataQualityIssue[],
): Readonly<Partial<Record<DataQualityIssueCode, number>>> {
  const counts: Partial<Record<DataQualityIssueCode, number>> = {}
  for (const issue of issues) {
    counts[issue.code] = (counts[issue.code] ?? 0) + 1
  }
  return counts
}

/** 各模块「有效样本数」的口径说明（与 PRD 6.3 一致，只描述不计算） */
const MODULE_SAMPLE_NOTES: Readonly<Record<AnalysisModule, string>> = {
  核心率: 'D = 已入职 + 待入职 + 拒绝 offer（排除审批中 / 其他 / 未知）',
  审批中占比: '样本为全部保留记录数 N（分母与核心率不同，必须明示）',
  招聘周期: '已入职实际周期 + 待入职计划周期；日期必须合法且非负',
  薪资对比: '需要已确认币种与计薪周期，且金额为有效非负数值',
  房补对比: '住宿不折现；房补未知不计入对比',
  拒offer原因: '仅拒 offer 记录；原因为空时显示「未填写」',
  城市对比: '城市未知不计入对比',
  渠道对比: '渠道未知 / 其他单列，不并入已知渠道',
  HR效能: '需要 HR / 招聘负责人字段非空',
  画像分析: '学历 / 学校 / 毕业年份 / GPT 院校任一非空即可画像',
  需求分析: '名单覆盖需求数 = countDistinct(非空需求 ID)，不等于公司全部在招需求',
}

export type MetricAvailabilityInput = {
  readonly records: readonly NormalizedRecord[]
  readonly issues: readonly DataQualityIssue[]
  readonly counts: DatasetCounts
  readonly salary: SalarySetting
}

function countWhere(
  records: readonly NormalizedRecord[],
  predicate: (record: NormalizedRecord) => boolean,
): number {
  let total = 0
  for (const record of records) {
    if (predicate(record)) {
      total += 1
    }
  }
  return total
}

function sampleCountFor(module: AnalysisModule, input: MetricAvailabilityInput): number | null {
  const { records, counts } = input
  switch (module) {
    case '核心率':
      return countWhere(records, (record) => record.derived?.countedInCoreDenominator === true)
    case '审批中占比':
      return records.length
    case '招聘周期':
      return countWhere(
        records,
        (record) =>
          record.derived?.actualCycleEligible === true || record.derived?.plannedCycleEligible === true,
      )
    case '薪资对比':
      return countWhere(records, (record) => record.salaryAmount !== null)
    case '房补对比':
      return countWhere(records, (record) => record.housingType !== UNKNOWN)
    case '拒offer原因':
      return countWhere(records, (record) => record.derived?.isRejected === true)
    case '城市对比':
      return countWhere(records, (record) => record.city !== UNKNOWN)
    case '渠道对比':
      return countWhere(records, (record) => record.channel !== UNKNOWN)
    case 'HR效能':
      return countWhere(records, (record) => record.recruiter !== null)
    case '画像分析':
      return countWhere(
        records,
        (record) =>
          record.education !== UNKNOWN ||
          record.school !== null ||
          record.graduationYear !== null ||
          record.isGptSchool !== null,
      )
    case '需求分析':
      return counts.distinctRequirementCount
  }
}

/**
 * 模块可用性 + 有效样本数。
 * `available` 只由问题码（缺列、未确认口径、非法值）决定：样本为 0 不等于模块被禁用。
 */
export function buildMetricAvailability(
  input: MetricAvailabilityInput,
): readonly MetricAvailability[] {
  const disabled = disabledModulesFor(input.issues)
  return ANALYSIS_MODULES.map((module) => {
    const available = !disabled.includes(module)
    const validSampleCount = sampleCountFor(module, input)
    return {
      module,
      available,
      validSampleCount,
      reason: availabilityReason(module, available, validSampleCount, input.salary),
    }
  })
}

function availabilityReason(
  module: AnalysisModule,
  available: boolean,
  validSampleCount: number | null,
  salary: SalarySetting,
): string | null {
  if (!available) {
    return module === '薪资对比' || module === '房补对比'
      ? `薪资口径未确认（当前：${salary.option}），已禁用该模块`
      : '存在未确认口径或非法值，已禁用该模块'
  }
  if (validSampleCount === 0) {
    return '当前数据集没有该模块的有效样本'
  }
  return MODULE_SAMPLE_NOTES[module]
}
