/**
 * 独立复核（步骤11）：哨兵不泄漏 —— 与实现者自己的测试**分开写**，用不同的数据与检索方式，
 * 目的是「即使实现者的测试有盲点，这一条也能发现泄漏」。
 *
 * 手法：构造一份含真实敏感值的合成数据集 → 走完整脱敏管线 → 对整份报告做
 * 深度遍历（不只是 JSON 字符串，还逐个 key / value 检查），确认：
 * 1. 任何被禁**字段名**都不出现；
 * 2. 任何**哨兵值**（姓名 / HR 名 / 推荐人 / 需求 ID / 原因原文）都不出现；
 * 3. 准确薪资数字不以任何形式出现（只能出现区间）。
 */
import { describe, expect, it } from 'vitest'

import { analyzeRecords } from '../domain'
import { buildRejectionInsight } from '../insights'
import { syntheticRecords } from '../domain/analytics/fixtures'

import { buildSanitizedReport } from './report'
import { FORBIDDEN_FIELD_NAMES, findSensitiveFields } from './sanitize'

/* 与实现者测试**不同**的哨兵值，避免共用常量导致的假通过 */
const NAME = '复核姓名-甲'
const HR = '复核HR-乙'
const REFERRER = '复核推荐人-丙'
const REQUIREMENT = 'REQ-复核-9901'
const REASON = '复核用自由文本原因'
const SALARY = 4321

const DATA_AS_OF = '2026-09-26'

/*
 * `SyntheticRecordInput` 刻意没有 `candidateName`（夹具里它恒为 null），
 * 所以姓名哨兵在构造后再挂上去——这样「清洗层真的可能带姓名」这一情形仍然被覆盖，
 * 而不是靠夹具恰好没有姓名来假通过。
 */
const RECORDS = syntheticRecords([
  {
    recordId: 'REC-1',
    recruiter: HR,
    referrer: REFERRER,
    requirementId: REQUIREMENT,
    rejectionReason: REASON,
    offerStatus: '拒绝offer',
    city: '上海',
    channel: 'Boss',
    position: '前端开发',
    salaryAmount: SALARY,
    currency: 'CNY',
    salaryUnit: '元/月',
    recruitmentStartDate: '2026-01-01',
  },
  {
    recordId: 'REC-2',
    recruiter: HR,
    requirementId: REQUIREMENT,
    offerStatus: '已入职',
    city: '上海',
    channel: '内推',
    position: '前端开发',
    salaryAmount: SALARY,
    currency: 'CNY',
    salaryUnit: '元/月',
    recruitmentStartDate: '2026-01-02',
    joiningDate: '2026-01-20',
  },
]).map((record) => ({ ...record, candidateName: NAME }))

const DATASET = {
  metadata: {
    dataAsOf: DATA_AS_OF,
    dedupStrategy: '确认后每组保留首条',
    ruleVersion: { rulesVersion: 'rules/1' },
  },
  report: {
    counts: { keptRowCount: 2, issueRowCount: 0 },
    metricAvailability: [],
  },
} as unknown as Parameters<typeof buildSanitizedReport>[0]['dataset']

function buildReport() {
  const analysis = analyzeRecords(RECORDS, {
    dataAsOf: DATA_AS_OF,
    dedupStrategy: '确认后每组保留首条',
    salaryComparable: true,
  })
  const rejection = buildRejectionInsight(RECORDS, {
    dataAsOf: DATA_AS_OF,
    salaryComparable: true,
  })
  /*
   * 刻意**带上 HR 维度**：不带的话报告里根本不会出现任何 HR 分组，
   * 「HR 代号生效」这条断言就会因为「没有东西可泄漏」而假通过。
   */
  return buildSanitizedReport(
    {
      dataset: DATASET,
      filters: [],
      analysis,
      dimensions: [
        {
          dimension: 'recruiter',
          label: '招聘HR',
          groups: rejection.dimensions.find((view) => view.dimension === 'recruiter')?.groups ?? [],
          total: rejection.overall,
          notes: [],
        },
        {
          dimension: 'city',
          label: '城市',
          groups: rejection.dimensions.find((view) => view.dimension === 'city')?.groups ?? [],
          total: rejection.overall,
          notes: [],
        },
      ],
      rejection,
      charts: [],
      generatedAt: '2026-09-26T00:00:00.000Z',
    },
    undefined,
  )
}

/** 深度收集所有 key 与所有字符串 / 数值叶子 */
function walk(value: unknown, keys: string[] = [], leaves: unknown[] = []): { keys: string[]; leaves: unknown[] } {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, keys, leaves)
    return { keys, leaves }
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      keys.push(key)
      walk(child, keys, leaves)
    }
    return { keys, leaves }
  }
  leaves.push(value)
  return { keys, leaves }
}

describe('独立复核：脱敏报告不泄漏任何敏感值', () => {
  it('被禁字段名一个都不出现', () => {
    const report = buildReport()
    const { keys } = walk(report)
    const present = FORBIDDEN_FIELD_NAMES.filter((name) =>
      keys.some((key) => key.toLowerCase() === name.toLowerCase()),
    )
    expect(present).toEqual([])
  })

  it('哨兵值（姓名 / HR / 推荐人 / 需求 ID / 记录 ID / 原因原文）一个都不出现', () => {
    const serialized = JSON.stringify(buildReport())
    for (const sentinel of [NAME, HR, REFERRER, REQUIREMENT, REASON, 'REC-1', 'REC-2']) {
      expect(serialized.includes(sentinel), `泄漏了哨兵：${sentinel}`).toBe(false)
    }
  })

  it('准确薪资数字不以任何叶子形式出现（只能出现区间）', () => {
    const report = buildReport()
    const { leaves } = walk(report)
    // 数值型叶子不得等于准确薪资
    const numericHit = leaves.some((leaf) => leaf === SALARY)
    expect(numericHit).toBe(false)
    // 字符串叶子也不得把它拼进去（例如 "4321 元/月"）
    const stringHit = leaves.some(
      (leaf) => typeof leaf === 'string' && leaf.includes(String(SALARY)),
    )
    expect(stringHit).toBe(false)
  })

  it('报告自带 allowedKeys，且实际出现的 key 都在其中', () => {
    const report = buildReport()
    const { keys } = walk(report)
    const allowed = new Set(report.allowedKeys)
    const unexpected = [...new Set(keys)].filter((key) => !allowed.has(key))
    expect(unexpected).toEqual([])
  })

  it('findSensitiveFields 对这份报告给出通过（空数组）', () => {
    expect(findSensitiveFields(buildReport())).toEqual([])
  })

  it('HR 在报告里只以代号出现（且不是姓名本身）', () => {
    const report = buildReport()
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(HR)
    // 报告里应当至少出现过一个 HR 代号形态
    expect(serialized).toMatch(/HR-\d+/)
  })
})
