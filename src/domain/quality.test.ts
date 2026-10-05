import { describe, expect, it } from 'vitest'

import {
  ANALYSIS_MODULES,
  DATA_QUALITY_ISSUE_CODES,
  DATA_QUALITY_SEVERITIES,
  ISSUE_SEVERITY,
  ISSUE_TITLES,
  createQualityIssue,
  disabledModulesFor,
  hasBlockingIssue,
  isBlockingIssue,
  summarizeIssues,
} from './quality'

describe('质量问题分级', () => {
  it('每个问题代码都有严重度与中文标题，且严重度取值合法', () => {
    for (const code of DATA_QUALITY_ISSUE_CODES) {
      expect(DATA_QUALITY_SEVERITIES).toContain(ISSUE_SEVERITY[code])
      expect(ISSUE_TITLES[code].length).toBeGreaterThan(0)
    }
    expect(Object.keys(ISSUE_SEVERITY).sort()).toEqual([...DATA_QUALITY_ISSUE_CODES].sort())
  })

  it('缺 offer 状态列阻断导入，非法日期只算字段错误，未识别枚举只是警告', () => {
    expect(createQualityIssue({ code: 'MISSING_OFFER_STATUS_COLUMN' }).severity).toBe('阻断')
    expect(createQualityIssue({ code: 'EMPTY_DATASET' }).severity).toBe('阻断')
    expect(createQualityIssue({ code: 'INVALID_DATE' }).severity).toBe('字段错误')
    expect(createQualityIssue({ code: 'VALUE_RANGE_UNCERTAIN' }).severity).toBe('警告')
    expect(createQualityIssue({ code: 'HOUSING_VALUE_UNCERTAIN' }).severity).toBe('警告')
  })

  it('问题默认不携带任何敏感内容（原值需显式传入）', () => {
    const issue = createQualityIssue({ code: 'EXACT_DUPLICATE' })
    expect(issue.rawValue).toBeNull()
    expect(issue.sourceRow).toBeNull()
    expect(issue.field).toBeNull()
    expect(issue.confirmed).toBe(false)
    expect(issue.message).toBe(ISSUE_TITLES.EXACT_DUPLICATE)
  })

  it('显式传入的消息 / 行号 / 原值会被保留', () => {
    const issue = createQualityIssue({
      code: 'UNKNOWN_ENUM_VALUE',
      field: 'offerStatus',
      sourceSheet: 'Sheet1',
      sourceRow: 42,
      rawValue: '审批通过',
    })
    expect(issue.field).toBe('offerStatus')
    expect(issue.sourceRow).toBe(42)
    expect(issue.rawValue).toBe('审批通过')
  })
})

describe('阻断判定与汇总', () => {
  it('存在阻断问题即不得进入分析链路', () => {
    const blocking = [createQualityIssue({ code: 'LIMIT_EXCEEDED' })]
    expect(hasBlockingIssue(blocking)).toBe(true)
    expect(isBlockingIssue(blocking[0])).toBe(true)
    expect(hasBlockingIssue([createQualityIssue({ code: 'UNKNOWN_ENUM_VALUE' })])).toBe(false)
    expect(hasBlockingIssue([])).toBe(false)
  })

  it('按严重度汇总条数', () => {
    const issues = [
      createQualityIssue({ code: 'INVALID_DATE' }),
      createQualityIssue({ code: 'INVALID_DATE' }),
      createQualityIssue({ code: 'UNKNOWN_ENUM_VALUE' }),
    ]
    expect(summarizeIssues(issues)).toEqual({ 阻断: 0, 字段错误: 2, 警告: 1 })
  })
})

describe('被禁用的分析模块', () => {
  it('缺少 offer 状态映射时禁用全部模块', () => {
    const disabled = disabledModulesFor([
      createQualityIssue({ code: 'MISSING_OFFER_STATUS_COLUMN' }),
    ])
    expect(disabled).toEqual([...ANALYSIS_MODULES])
  })

  it('未确认计薪口径只禁用薪资 / 房补对比', () => {
    expect(disabledModulesFor([createQualityIssue({ code: 'SALARY_UNIT_UNCONFIRMED' })])).toEqual([
      '薪资对比',
      '房补对比',
    ])
  })

  it('不影响模块可用性的问题不返回任何模块，且结果按固定顺序去重', () => {
    expect(disabledModulesFor([createQualityIssue({ code: 'INVALID_DATE' })])).toEqual([])
    expect(
      disabledModulesFor([
        createQualityIssue({ code: 'UNKNOWN_ENUM_VALUE' }),
        createQualityIssue({ code: 'SALARY_UNIT_UNCONFIRMED' }),
      ]),
    ).toEqual(['薪资对比', '房补对比', '渠道对比'])
  })
})
