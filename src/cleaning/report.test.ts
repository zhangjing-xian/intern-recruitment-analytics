/**
 * 质量报告（docs/PRD.md 5.5）单测：问题计数与「模块可用性 + 有效样本数」。
 * 规则：可用性只由问题码决定（样本为 0 不等于模块被禁用），
 * 模块口径不适用时 `validSampleCount` 可以是 null，但**不用 0 冒充**。
 */

import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_MODULES,
  BOSS_CHANNEL,
  CITIES,
  EDUCATIONS,
  HOUSING_CASH,
  UNKNOWN,
  createQualityIssue,
  disabledModulesFor,
  summarizeIssues,
  type AnalysisModule,
  type Channel,
  type City,
  type DataQualityIssueCode,
  type DatasetCounts,
  type DerivedRecordFields,
  type Education,
  type HousingType,
  type MetricAvailability,
  type NormalizedRecord,
  type SalarySetting,
  type TriState,
} from '../domain'

import { buildMetricAvailability, countIssuesByCode } from './report'

/** 各模块在 `ANALYSIS_MODULES` 中的位置（顺序由 domain 固定，这里按位取名避免复制中文枚举值） */
const [
  CORE_RATE,
  APPROVAL_SHARE,
  CYCLE,
  SALARY,
  HOUSING,
  REJECTION,
  CITY,
  CHANNEL,
  HR,
  PROFILE,
  REQUIREMENT,
] = ANALYSIS_MODULES

const COUNTS: DatasetCounts = {
  rawRowCount: 10,
  emptyRowCount: 2,
  keptRowCount: 8,
  removedDuplicateCount: 0,
  issueRowCount: 3,
  distinctRequirementCount: 3,
}

/** 薪资口径未确认（默认） */
const UNCONFIRMED_SALARY: SalarySetting = {
  option: '暂不确定',
  currency: null,
  salaryUnit: null,
  comparable: false,
  confirmedAt: null,
}

type DerivedSubset = Partial<
  Pick<
    DerivedRecordFields,
    'actualCycleEligible' | 'plannedCycleEligible' | 'countedInCoreDenominator' | 'isRejected'
  >
>

/**
 * 模块可用性只读这些字段，其余字段与本用例无关；
 * 用桩对象避免在测试里复制整条记录的 30 个字段（`as unknown as` 说明这是刻意的窄桩）。
 */
function recordStub(input: {
  readonly salaryAmount?: number | null
  readonly housingType?: HousingType
  readonly city?: City
  readonly channel?: Channel
  readonly recruiter?: string | null
  readonly education?: Education
  readonly school?: string | null
  readonly graduationYear?: number | null
  readonly isGptSchool?: TriState
  readonly derived?: DerivedSubset
} = {}): NormalizedRecord {
  return {
    salaryAmount: input.salaryAmount ?? null,
    housingType: input.housingType ?? UNKNOWN,
    city: input.city ?? UNKNOWN,
    channel: input.channel ?? UNKNOWN,
    recruiter: input.recruiter ?? null,
    education: input.education ?? UNKNOWN,
    school: input.school ?? null,
    graduationYear: input.graduationYear ?? null,
    isGptSchool: input.isGptSchool ?? null,
    derived: {
      actualCycleEligible: false,
      plannedCycleEligible: false,
      countedInCoreDenominator: false,
      isRejected: null,
      ...input.derived,
    },
  } as unknown as NormalizedRecord
}

function availabilityOf(records: readonly NormalizedRecord[]) {
  return buildMetricAvailability({
    records,
    issues: [],
    counts: COUNTS,
    salary: UNCONFIRMED_SALARY,
  })
}

function byModule(
  availability: readonly MetricAvailability[],
  module: AnalysisModule,
): MetricAvailability | undefined {
  return availability.find((entry) => entry.module === module)
}

describe('问题计数', () => {
  it('按问题码计数：未出现的码不出现在结果里（界面按码过滤与展示）', () => {
    const issues = [
      createQualityIssue({ code: 'INVALID_DATE' }),
      createQualityIssue({ code: 'INVALID_DATE' }),
      createQualityIssue({ code: 'EXACT_DUPLICATE' }),
    ]
    expect(countIssuesByCode(issues)).toEqual({ INVALID_DATE: 2, EXACT_DUPLICATE: 1 })
    expect(countIssuesByCode([])).toEqual({})
  })

  it('严重度由问题码唯一决定（调用方不得自行判断）', () => {
    const codes: readonly DataQualityIssueCode[] = ['PARSE_FAILED', 'INVALID_DATE', 'CYCLE_TOO_LONG']
    expect(summarizeIssues(codes.map((code) => createQualityIssue({ code })))).toEqual({
      阻断: 1,
      字段错误: 1,
      警告: 1,
    })
    expect(summarizeIssues([])).toEqual({ 阻断: 0, 字段错误: 0, 警告: 0 })
  })

  it('没有任何问题时没有任何模块被禁用', () => {
    expect(disabledModulesFor([])).toEqual([])
  })
})

describe('模块可用性与有效样本', () => {
  const records = [
    recordStub({
      salaryAmount: 12_000,
      housingType: HOUSING_CASH,
      city: CITIES[0],
      channel: BOSS_CHANNEL,
      recruiter: 'HR-A',
      education: EDUCATIONS[1],
      derived: { actualCycleEligible: true, countedInCoreDenominator: true },
    }),
    recordStub(),
  ]

  it('没有阻断性问题时全部模块可用，顺序与 ANALYSIS_MODULES 完全一致', () => {
    const availability = availabilityOf(records)
    expect(availability.map((entry) => entry.module)).toEqual([...ANALYSIS_MODULES])
    expect(availability.every((entry) => entry.available)).toBe(true)
    expect(availability.every((entry) => entry.reason !== null)).toBe(true)
  })

  it('每个模块的有效样本按各自口径统计（分母不是行数）', () => {
    const availability = availabilityOf(records)
    expect(byModule(availability, CORE_RATE)?.validSampleCount).toBe(1)
    expect(byModule(availability, APPROVAL_SHARE)?.validSampleCount).toBe(2)
    expect(byModule(availability, CYCLE)?.validSampleCount).toBe(1)
    expect(byModule(availability, SALARY)?.validSampleCount).toBe(1)
    expect(byModule(availability, HOUSING)?.validSampleCount).toBe(1)
    expect(byModule(availability, REJECTION)?.validSampleCount).toBe(0)
    expect(byModule(availability, CITY)?.validSampleCount).toBe(1)
    expect(byModule(availability, CHANNEL)?.validSampleCount).toBe(1)
    expect(byModule(availability, HR)?.validSampleCount).toBe(1)
    expect(byModule(availability, PROFILE)?.validSampleCount).toBe(1)
    expect(byModule(availability, REQUIREMENT)?.validSampleCount).toBe(
      COUNTS.distinctRequirementCount,
    )
  })

  it('有效样本为 0 只给提示，不会禁用模块', () => {
    const availability = availabilityOf([recordStub()])
    const rejection = byModule(availability, REJECTION)
    expect(rejection?.validSampleCount).toBe(0)
    expect(rejection?.available).toBe(true)
    expect(rejection?.reason).not.toBeNull()
  })

  it('薪资口径未确认：只禁用依赖薪资口径的模块，样本数照样统计', () => {
    const issues = [createQualityIssue({ code: 'SALARY_UNIT_UNCONFIRMED' })]
    expect(disabledModulesFor(issues)).toEqual([SALARY, HOUSING])

    const availability = buildMetricAvailability({
      records,
      issues,
      counts: COUNTS,
      salary: UNCONFIRMED_SALARY,
    })
    expect(byModule(availability, SALARY)?.available).toBe(false)
    expect(byModule(availability, HOUSING)?.available).toBe(false)
    for (const module of [CORE_RATE, APPROVAL_SHARE, CYCLE, CITY, REQUIREMENT]) {
      expect(byModule(availability, module)?.available).toBe(true)
    }
    expect(byModule(availability, SALARY)?.validSampleCount).toBe(1)
    expect(byModule(availability, SALARY)?.reason).toContain(UNCONFIRMED_SALARY.option)
  })

  it('缺少 offer 状态列属于数据集级问题：全部模块不可用', () => {
    const issues = [createQualityIssue({ code: 'MISSING_OFFER_STATUS_COLUMN' })]
    expect(disabledModulesFor(issues)).toEqual([...ANALYSIS_MODULES])

    const availability = buildMetricAvailability({
      records,
      issues,
      counts: COUNTS,
      salary: UNCONFIRMED_SALARY,
    })
    expect(availability.every((entry) => entry.available === false)).toBe(true)
  })
})

