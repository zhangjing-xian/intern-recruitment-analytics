/**
 * 分维度分析的规则与口径文案（步骤9，docs/PRD.md 8 章）。
 *
 * 为什么放在引擎层而不是组件里：这些是**业务口径**（「只有 1 位 HR 时不做排名」「不能宣称替补优于替换」
 * 「画像不得用于淘汰建议」），不是界面措辞。放在组件里会让同一句话在各页各写一遍，
 * 而且「能不能排名」这类判定会退化成界面自己发明的规则（AGENTS.md §2.3）。
 *
 * 边界：本模块只做**判定与文案**，不复制任何计数 / 率 / 分位公式；样本门槛统一取
 * `./rates.ts` 的 `sampleSufficiencyOf` 与 `AUTO_CONCLUSION_MIN_DENOMINATOR`。
 */

import { UNKNOWN, UNSPLIT_REQUIREMENT_TYPE } from '../enums'
import type { NormalizedRecord, ValueSource } from '../types'

import type { GroupSummary } from './grouping'
import { AUTO_CONCLUSION_MIN_DENOMINATOR } from './rates'

/* ------------------------------------------------------------------ 固定口径文案 */

/** 城市对比：区分「规模差异」与「转化差异」，未知城市单列 */
export const CITY_NOTE =
  '三地计数与率并列展示：人数差异会影响率的高低，先看规模再看转化；「其他城市」与「未知城市」各自单列，不并入三地。'

/** HR 效能：多 HR 也不能当个人绩效结论 */
export const HR_RANKING_NOTE =
  'HR 之间的量率差异同时受岗位、城市难度与名单来源影响，不能直接当作个人绩效结论。'

/** HR 只有 1 位时的统一说法 */
export const HR_SINGLE_NOTE =
  '只有 1 位招聘 HR：本页不做 HR 排名，也不比较 HR 之间的优劣，只展示覆盖需求数与量率明细。'

/** 覆盖需求数的口径（与 `requirementCoverageOf` 的 note 同源） */
export const HR_COVERAGE_NOTE =
  '覆盖需求数 = countDistinct(非空需求 ID)：只在单个 HR（或单个分组）内部去重；把多个 HR 的数字相加可能超过全局需求数，不能当作公司全部在招需求或完整需求完成率。'

/** 需求类型：附件里替补 / 替换未拆分时的限制 */
export const REQUIREMENT_TYPE_NOTE =
  '市场需求类型：新增招聘、替补、替换；附件里替补与替换未拆分时统一显示为「替补替换未拆分」并单独成组。在该列未拆分的情况下，只能比较「新增招聘」与「未拆分」，不能宣称替补优于替换。'

/** 画像：只描述分布，不做个人判断 */
export const PROFILE_NOTE =
  '画像只描述分布与分组率：不推断个人能力，不提供录用 / 淘汰建议，也不输出个人拒 offer 概率。'

/** 学校结论来源（别名归一是「规则结论」，必须可见） */
export const SCHOOL_SOURCE_NOTE =
  '学校别名只做写法归一（如「上交」→「上海交通大学」），语义不同的学校不会被合并；命中别名表的记录数单列显示，便于核对归一是否合理。'

/** 岗位 / 序列 / 部门的排行门槛 */
export const POSITION_RANK_NOTE =
  '量大入职少、拒 offer 高必须同时看 N、D、R 三个数字：D ≥ 10 才参与自动排名，0 < D < 10 只显示率并标注小样本；n 大也不代表统计显著。'

/** 时间效率：三类周期不能混用 */
export const EFFICIENCY_NOTE =
  '实际招聘周期只对已入职记录计算（入职日期 − 启动日期，日历日）；待入职用的是计划日期，必须与实际周期分开看；拒 offer 记录缺少拒绝日期，因此不计算决策耗时。'

/* ------------------------------------------------------------------ 结论来源 */

/** 结论来源的固定顺序（表格与报告共用，避免每次顺序不同） */
export const VALUE_SOURCES: readonly ValueSource[] = [
  'raw',
  'aliasTable',
  'localList',
  'derived',
  'manual',
  'unknown',
]

export const VALUE_SOURCE_LABELS: Readonly<Record<ValueSource, string>> = {
  raw: '原值',
  aliasTable: '别名表',
  localList: '本地名单',
  derived: '派生',
  manual: '手工指定',
  unknown: '未知',
}

function emptySourceCounts(): Record<ValueSource, number> {
  return { raw: 0, aliasTable: 0, localList: 0, derived: 0, manual: 0, unknown: 0 }
}

/** 学校结论来源计数（`aliasTable` > 0 说明存在别名归一，界面必须显示出来） */
export function schoolSourceCounts(
  records: readonly NormalizedRecord[],
): Readonly<Record<ValueSource, number>> {
  const counts = emptySourceCounts()
  for (const record of records) {
    counts[record.schoolSource] += 1
  }
  return counts
}

/** GPT 判定来源计数（原值优先；名单补全的条数单列，便于核对） */
export function gptSourceCounts(
  records: readonly NormalizedRecord[],
): Readonly<Record<ValueSource, number>> {
  const counts = emptySourceCounts()
  for (const record of records) {
    counts[record.isGptSchoolSource] += 1
  }
  return counts
}

/** 未拆分需求类型的记录数（附件把「替补 / 替换」写在一起时的计数） */
export function unsplitRequirementTypeCount(records: readonly NormalizedRecord[]): number {
  return records.filter((record) => record.requirementType === UNSPLIT_REQUIREMENT_TYPE).length
}

/* ------------------------------------------------------------------ HR 排名可用性 */

export type RecruiterRankingAvailability = {
  /** 可识别的 HR 个数（不含「未知」） */
  readonly recruiterCount: number
  /** 是否允许做 HR 排名（0 / 1 位时为 false） */
  readonly canRank: boolean
  /** 达到自动排名门槛（D ≥ minDenominator）的 HR 个数 */
  readonly rankableCount: number
  readonly note: string
}

/**
 * HR 排名可用性（PRD 8 章「HR 效能」：仅 1 位 HR 时不做 HR 排名）。
 *
 * 「未知」不参与：把未填写 HR 的记录当成一个「HR」会让排名凭空多出一名。
 * 多位 HR 时也只看 D ≥ 门槛的人数，样本不足的 HR 照常显示量率，但标注小样本。
 */
export function recruiterRankingAvailability(
  groups: readonly GroupSummary[],
  minDenominator: number = AUTO_CONCLUSION_MIN_DENOMINATOR,
): RecruiterRankingAvailability {
  const known = groups.filter((group) => group.key !== UNKNOWN)
  const rankableCount = known.filter(
    (group) => group.counts.coreDenominator >= minDenominator,
  ).length

  if (known.length === 0) {
    return {
      recruiterCount: 0,
      canRank: false,
      rankableCount: 0,
      note: '招聘 HR 字段没有可识别的取值：不排名，先补齐「招聘 HR」列再回来查看。',
    }
  }

  if (known.length === 1) {
    return { recruiterCount: 1, canRank: false, rankableCount, note: HR_SINGLE_NOTE }
  }

  return {
    recruiterCount: known.length,
    canRank: true,
    rankableCount,
    note: `共 ${known.length} 位招聘 HR，其中 ${rankableCount} 位 D ≥ ${minDenominator} 可参与自动排名；${HR_RANKING_NOTE}`,
  }
}
