/**
 * 合成测试夹具（**仅供单测 / 回归使用**，不由 `src/domain/index.ts` 或 `./index.ts` 导出）。
 *
 * 为什么放在引擎旁边：`vite.config.ts` 的 vitest `include` 只覆盖 `src/**\/*.test.ts`，
 * 各测试文件需要一个**完整形状**的 `NormalizedRecord`（30 余字段），
 * 若每个用例自己拼一遍，很容易漏字段或误用 0 冒充缺失。
 *
 * 数据红线：全部为人工构造的合成值，**不含**任何真实候选人、HR、薪资或文件名（AGENTS.md §6）。
 * 口径：未提供的字段一律取「缺失 = null / 未知 = 未知」，重复判定取「无重复、已保留」。
 */

import {
  OTHER,
  UNKNOWN,
  type Channel,
  type City,
  type Currency,
  type Education,
  type HousingPeriod,
  type HousingType,
  type OfferStatus,
  type ReferralType,
  type RequirementType,
  type SalaryUnit,
  type TriState,
} from '../enums'
import type { ValueSource } from '../types'
import type { DateOnly, DerivedRecordFields, NormalizedRecord } from '../types'
import { CURRENT_RULE_VERSION } from '../version'

/** 夹具的导入时间与快照日（固定值，保证测试可复现） */
export const FIXTURE_IMPORTED_AT = '2026-09-26T00:00:00.000Z'
export const FIXTURE_DATA_AS_OF: DateOnly = '2026-09-26'

export type SyntheticRecordInput = {
  readonly recordId?: string
  readonly requirementId?: string | null
  readonly recruiter?: string | null
  readonly city?: City
  readonly cityRaw?: string | null
  readonly department?: string | null
  readonly position?: string | null
  readonly jobFamily?: string | null
  readonly requirementType?: RequirementType
  readonly recruitmentStartDate?: DateOnly | null
  readonly joiningDate?: DateOnly | null
  readonly expectedEndDate?: DateOnly | null
  readonly graduationYear?: number | null
  readonly education?: Education
  readonly school?: string | null
  readonly isGptSchool?: TriState
  readonly referrer?: string | null
  readonly referralType?: ReferralType
  readonly channel?: Channel
  readonly salaryAmount?: number | null
  readonly currency?: Currency | null
  readonly salaryUnit?: SalaryUnit | null
  readonly housingType?: HousingType
  readonly housingAmount?: number | null
  readonly housingPeriod?: HousingPeriod | null
  readonly offerStatus?: OfferStatus
  readonly rejectionReason?: string | null
  readonly dataAsOf?: DateOnly
  /** 清洗阶段已算出的派生字段；默认 null（由引擎在 `decorateRecords` 中重算） */
  readonly derived?: DerivedRecordFields | null
}

const DEFAULT_SCHOOL_SOURCE: ValueSource = 'raw'

/** 构造一条完整的合成记录；未给出的字段取最保守的缺失值 */
export function syntheticRecord(input: SyntheticRecordInput = {}): NormalizedRecord {
  const recordId = input.recordId ?? 'SYN-0001'
  return {
    recordId,
    datasetId: 'SYN-DATASET',
    batchId: 'SYN-BATCH',
    sourceSheet: '合成表',
    sourceRow: 2,
    values: [],
    normalizationLog: [],
    dedupDecision: {
      duplicateKind: 'none',
      duplicateGroupKey: null,
      suspectedKey: null,
      action: 'kept',
      decidedBy: 'default',
    },
    schemaVersion: CURRENT_RULE_VERSION.schemaVersion,
    rulesVersion: CURRENT_RULE_VERSION.rulesVersion,
    importedAt: FIXTURE_IMPORTED_AT,
    dataAsOf: input.dataAsOf ?? FIXTURE_DATA_AS_OF,
    candidateDisplayId: recordId,

    requirementId: input.requirementId ?? null,
    recruiter: input.recruiter ?? null,
    city: input.city ?? UNKNOWN,
    cityRaw: input.cityRaw ?? null,
    department: input.department ?? null,
    position: input.position ?? null,
    jobFamily: input.jobFamily ?? null,
    requirementType: input.requirementType ?? UNKNOWN,
    recruitmentStartDate: input.recruitmentStartDate ?? null,
    joiningDate: input.joiningDate ?? null,
    expectedEndDate: input.expectedEndDate ?? null,
    candidateName: null,
    graduationYear: input.graduationYear ?? null,
    education: input.education ?? UNKNOWN,
    school: input.school ?? null,
    schoolSource: input.school === undefined || input.school === null ? 'unknown' : DEFAULT_SCHOOL_SOURCE,
    isGptSchool: input.isGptSchool ?? null,
    isGptSchoolSource: 'unknown',
    referrer: input.referrer ?? null,
    referralType: input.referralType ?? UNKNOWN,
    channel: input.channel ?? UNKNOWN,
    channelRaw: null,
    salaryAmount: input.salaryAmount ?? null,
    currency: input.currency ?? null,
    salaryUnit: input.salaryUnit ?? null,
    housingRaw: null,
    housingType: input.housingType ?? UNKNOWN,
    housingAmount: input.housingAmount ?? null,
    housingPeriod: input.housingPeriod ?? null,
    housingReason: null,
    offerStatus: input.offerStatus ?? UNKNOWN,
    offerStatusRaw: null,
    rejectionReason: input.rejectionReason ?? null,

    extensions: {},
    derived: input.derived ?? null,
  }
}

/** 批量构造；未指定 `recordId` 时按顺序生成稳定的合成 ID */
export function syntheticRecords(
  inputs: readonly SyntheticRecordInput[],
): readonly NormalizedRecord[] {
  return inputs.map((input, index) =>
    syntheticRecord({ recordId: `SYN-${String(index + 1).padStart(4, '0')}`, ...input }),
  )
}

/** 「其他」桶与「未知」的显式构造（用于验证两者不被合并） */
export const OTHER_BUCKET = OTHER
export const UNKNOWN_BUCKET = UNKNOWN

/* ------------------------------------------------------------------ PRD 12.2 合成验收集 */

/**
 * docs/PRD.md 12.2 的状态验收集（6 条）：
 * 已入职 ×2（周期分别 10 / 20 天）、待入职、offer审批中、拒绝offer、拒绝口头offer。
 * 预期：N=6、J=2、P=1、A=1、R=2、D=5，接受率 60%、拒 offer 率 40%、入职率 40%、
 * 待入职占比 20%、审批中占比 16.67%、平均实际周期 15 天。
 */
export const PRD_12_2_STATUS_INPUTS: readonly SyntheticRecordInput[] = [
  {
    offerStatus: '已入职',
    requirementId: 'REQ-001',
    recruitmentStartDate: '2026-01-05',
    joiningDate: '2026-01-15',
  },
  {
    offerStatus: '已入职',
    requirementId: 'REQ-002',
    recruitmentStartDate: '2026-02-01',
    joiningDate: '2026-02-21',
  },
  {
    offerStatus: '待入职',
    requirementId: 'REQ-003',
    recruitmentStartDate: '2026-03-01',
    joiningDate: '2026-03-21',
  },
  { offerStatus: 'offer审批中', requirementId: 'REQ-004', recruitmentStartDate: '2026-03-10' },
  {
    offerStatus: '拒绝offer',
    requirementId: 'REQ-005',
    recruitmentStartDate: '2026-03-05',
    rejectionReason: null,
  },
  {
    offerStatus: '拒绝口头offer',
    requirementId: 'REQ-006',
    recruitmentStartDate: '2026-03-08',
    rejectionReason: '薪酬',
  },
]

export const PRD_12_2_RECORDS: readonly NormalizedRecord[] = syntheticRecords(
  PRD_12_2_STATUS_INPUTS,
)

/** 同岗基准的严格同组取值（城市 + 序列 + 岗位 + 币种 + 计薪周期），供薪资用例复用 */
export const SALARY_GROUP_INPUT: SyntheticRecordInput = {
  city: '上海',
  jobFamily: '技术',
  position: '前端开发',
  currency: 'CNY',
  salaryUnit: '元/月',
}

/**
 * docs/PRD.md 12.2 的薪资合成例（同岗同单位 3500 / 4000 / 4000 / 4500 / 5000）：
 * P25 = 4000、P50 = 4000、P75 = 4500；仅 3500 低于中位数；4000 的分位排名 40%；
 * 同组 n=4 时基准不足。这里刻意混入不同 offer 状态，验证基准不受状态筛选影响。
 */
export const PRD_12_2_SALARY_RECORDS: readonly NormalizedRecord[] = syntheticRecords([
  { ...SALARY_GROUP_INPUT, offerStatus: '已入职', salaryAmount: 3500 },
  { ...SALARY_GROUP_INPUT, offerStatus: '待入职', salaryAmount: 4000 },
  { ...SALARY_GROUP_INPUT, offerStatus: '拒绝offer', salaryAmount: 4000 },
  { ...SALARY_GROUP_INPUT, offerStatus: 'offer审批中', salaryAmount: 4500 },
  { ...SALARY_GROUP_INPUT, offerStatus: '拒绝口头offer', salaryAmount: 5000 },
])
