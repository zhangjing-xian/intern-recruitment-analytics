/**
 * 率与比例（docs/PRD.md 6.1）。
 *
 * 三条不可退让的规则：
 * 1. **每项都返回分子、分母、有效样本与排除数**：页面必须能显示「这个百分比是谁除以谁」；
 * 2. 分母为 0（或没有有效样本）时 `value` 一律 `null` → 展示「—/无有效样本」，**绝不显示 0%**；
 * 3. **汇总率必须合计分子分母后再相除**，不能平均各分组百分比（所以本模块只接收计数，不接收率数组）。
 *
 * 核心率分母固定为 D = J + P + R（排除审批中、其他、未知）；「审批中占比」「状态结构占比」
 * 的分母是 N，属于**不同分母**的指标，必须单独构造并标注（见 ./statusCounts.ts）。
 */

import { isRejectedStatus } from '../enums'
import type { NormalizedRecord } from '../types'

import type { StatusCounts } from './statusCounts'

/** 一个率 / 比例的完整口径；`value` 为 null 表示分母不足，不是 0 */
export type RateMetric = {
  readonly numerator: number
  readonly denominator: number
  /** 分子 / 分母；分母为 0 时为 null */
  readonly value: number | null
  /** 不在该指标分母口径内的记录数（用于说明「有多少记录没进这个分母」） */
  readonly excludedCount: number
  /** 口径提示（中文，直接展示给用户，说明分母是谁） */
  readonly note: string | null
}

export type RateInput = {
  readonly excludedCount?: number
  readonly note?: string | null
}

/** 构造一个率；分母为 0 时 value = null（**不用 0% 掩盖**） */
export function rateOf(numerator: number, denominator: number, input: RateInput = {}): RateMetric {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
    excludedCount: input.excludedCount ?? 0,
    note: input.note ?? null,
  }
}

/** 自动高低率结论的最小核心分母（docs/PRD.md 8 章；可配置，但默认值只在这里写一次） */
export const AUTO_CONCLUSION_MIN_DENOMINATOR = 10

const D_NOTE = '分母 D = 已入职 + 待入职 + 拒绝 offer（排除审批中、其他、未知）'

export type SampleSufficiencyTag = 'none' | 'small' | 'sufficient'

/** 样本是否够格参与自动结论（**不等于**统计显著） */
export type SampleSufficiency = {
  readonly tag: SampleSufficiencyTag
  readonly denominator: number
  readonly note: string
}

/**
 * 样本门槛判定：D ≥ 10 才参与自动高低率结论；0 < D < 10 显示率但标注小样本；
 * D = 0 表示无有效样本。`sufficient` 也**不代表**统计显著（PRD 8 章）。
 */
export function sampleSufficiencyOf(
  denominator: number,
  minDenominator: number = AUTO_CONCLUSION_MIN_DENOMINATOR,
): SampleSufficiency {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return {
      tag: 'none',
      denominator: 0,
      note: '无有效样本：不显示百分比，也不参与自动结论',
    }
  }
  if (denominator < minDenominator) {
    return {
      tag: 'small',
      denominator,
      note: `有效样本 ${denominator} < ${minDenominator}：可显示率，但标注小样本、不参与自动排名与结论`,
    }
  }
  return {
    tag: 'sufficient',
    denominator,
    note: `有效样本 ${denominator} ≥ ${minDenominator}：可参与自动结论，但不代表统计显著`,
  }
}

/** 全部核心率与占比；每项自带分子分母，页面不必再算 */
export type CoreRateSummary = {
  readonly counts: StatusCounts
  /** 基于核心分母 D 的样本门槛判定 */
  readonly sufficiency: SampleSufficiency
  /** 接受率 = (J + P) / D；接受不等于实际入职 */
  readonly acceptanceRate: RateMetric
  /** 入职率 = J / D（**不得**用 J/N 冒充） */
  readonly joinedRate: RateMetric
  /** 拒 offer 率 = R / D */
  readonly rejectionRate: RateMetric
  /** 待入职占比 = P / D（核心率分母，默认展示口径） */
  readonly pendingShareRate: RateMetric
  /** 待入职占全部记录 = P / N（分母不同，需明示） */
  readonly pendingShareOfAllRate: RateMetric
  /** 审批中占比 = A / N（分母与核心率不同，需明示） */
  readonly approvingShareRate: RateMetric
}

/** 由状态计数构造全部核心率（唯一实现，页面与报告都从这里取） */
export function buildCoreRates(counts: StatusCounts): CoreRateSummary {
  const excludedFromD = counts.total - counts.coreDenominator
  return {
    counts,
    sufficiency: sampleSufficiencyOf(counts.coreDenominator),
    acceptanceRate: rateOf(counts.accepted, counts.coreDenominator, {
      excludedCount: excludedFromD,
      note: `接受 = 已入职 + 待入职；${D_NOTE}`,
    }),
    joinedRate: rateOf(counts.joined, counts.coreDenominator, {
      excludedCount: excludedFromD,
      note: `入职率使用 J / D，不是 J / N；${D_NOTE}`,
    }),
    rejectionRate: rateOf(counts.rejected, counts.coreDenominator, {
      excludedCount: excludedFromD,
      note: `R = 拒绝 offer + 拒绝口头 offer；${D_NOTE}`,
    }),
    pendingShareRate: rateOf(counts.pending, counts.coreDenominator, {
      excludedCount: excludedFromD,
      note: `待入职占比默认用核心率分母；${D_NOTE}`,
    }),
    pendingShareOfAllRate: rateOf(counts.pending, counts.total, {
      note: '分母为 N（全部保留记录），用于「占全部记录」的说法，与核心率分母不同',
    }),
    approvingShareRate: rateOf(counts.approving, counts.total, {
      note: '分母为 N（全部保留记录），与核心率分母 D 不同，必须明示',
    }),
  }
}

/** 原因是否已填写（空白也算未填写；不需要先判断是否拒 offer） */
export function isReasonFilled(reason: string | null): boolean {
  return reason !== null && reason.trim() !== ''
}

/**
 * 原因填写率 = 有有效原因的拒 offer 数 / R。
 * 非拒 offer 记录**不进分母**（单独计入 `excludedCount`）；「未填写」也算在分母内，
 * 所以原因全缺失时结果是 0%（而不是 null）——这正是 PRD 9.2 要求的「填写率 0%」。
 */
export function rejectionReasonFillRate(records: readonly NormalizedRecord[]): RateMetric {
  let rejected = 0
  let filled = 0
  for (const record of records) {
    if (isRejectedStatus(record.offerStatus) !== true) {
      continue
    }
    rejected += 1
    if (isReasonFilled(record.rejectionReason)) {
      filled += 1
    }
  }
  return rateOf(filled, rejected, {
    excludedCount: records.length - rejected,
    note: '分母仅为拒 offer 记录 R：非拒 offer 不入分母，「未填写」仍计入分母',
  })
}
