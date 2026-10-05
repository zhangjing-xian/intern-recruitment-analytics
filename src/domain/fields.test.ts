import { describe, expect, it } from 'vitest'

import {
  EMPTY_EXTENSION_VALUES,
  EXTENSION_FIELDS,
  FORBIDDEN_HEADER_MAPPINGS,
  REQUIRED_STANDARD_FIELDS,
  SENSITIVE_STANDARD_FIELDS,
  STANDARD_FIELDS,
  STANDARD_FIELD_KEYS,
  STANDARD_HEADERS,
  getStandardField,
  isDateOnlyText,
  isValidAmount,
  isValidGraduationYear,
  matchStandardHeader,
  normalizeHeader,
} from './fields'

describe('标准字段定义（21 列）', () => {
  it('列数与表头顺序严格按 PRD 4.1', () => {
    expect(STANDARD_FIELDS).toHaveLength(21)
    expect(STANDARD_HEADERS).toEqual([
      '需求ID',
      '招聘HR',
      '城市',
      '一级部门',
      '岗位',
      '序列',
      '需求类型',
      '启动招聘时间',
      '入职时间',
      '预计离职时间',
      '姓名',
      '毕业年级',
      '学历',
      '学校',
      '是否GPT院校',
      '简历推荐人',
      '渠道',
      '薪资',
      '房补',
      'offer状态',
      '拒绝原因分类',
    ])
  })

  it('内部键唯一且可按键取回定义', () => {
    expect(new Set(STANDARD_FIELD_KEYS).size).toBe(STANDARD_FIELD_KEYS.length)
    expect(getStandardField('offerStatus').header).toBe('offer状态')
    expect(getStandardField('housingRaw').kind).toBe('rawText')
  })

  it('只有 offer 状态列属于导入必须识别的字段', () => {
    expect(REQUIRED_STANDARD_FIELDS).toEqual(['offerStatus'])
    expect(getStandardField('candidateName').required).toBe(false)
  })

  it('身份与薪酬类字段标记为敏感，用于日志与导出脱敏', () => {
    expect(SENSITIVE_STANDARD_FIELDS).toContain('candidateName')
    expect(SENSITIVE_STANDARD_FIELDS).toContain('salaryAmount')
    expect(SENSITIVE_STANDARD_FIELDS).toContain('school')
    expect(SENSITIVE_STANDARD_FIELDS).not.toContain('offerStatus')
  })

  it('需求 ID 必须按字符串处理并保留前导 0', () => {
    expect(getStandardField('requirementId').preserveLeadingZeros).toBe(true)
    expect(getStandardField('requirementId').kind).toBe('text')
    expect(getStandardField('offerStatus').preserveLeadingZeros).toBe(false)
  })

  it('每个字段都写明缺失时的口径说明', () => {
    for (const field of STANDARD_FIELDS) {
      expect(field.missingHandling.length).toBeGreaterThan(0)
    }
  })
})

describe('表头匹配（精确 / 规范化 / 别名）', () => {
  it('精确匹配标准表头且无需确认', () => {
    const match = matchStandardHeader('offer状态')
    expect(match.field).toBe('offerStatus')
    expect(match.matchLevel).toBe('exact')
    expect(match.requiresConfirmation).toBe(false)
    expect(match.blockedReason).toBeNull()
  })

  it('大小写与全半角差异走规范化匹配', () => {
    expect(normalizeHeader('Ｏｆｆｅｒ状态')).toBe('offer状态')
    expect(matchStandardHeader('OFFER状态').field).toBe('offerStatus')
  })

  it('去 BOM / 首尾空格后仍能匹配', () => {
    expect(matchStandardHeader('\uFEFF offer状态 ').field).toBe('offerStatus')
  })

  it('常用别名只给建议，必须用户确认', () => {
    const match = matchStandardHeader('招聘负责人')
    expect(match.field).toBe('recruiter')
    expect(match.matchLevel).toBe('alias')
    expect(match.requiresConfirmation).toBe(true)
  })

  it('未匹配表头默认忽略，不猜字段', () => {
    const match = matchStandardHeader('面试轮次')
    expect(match.field).toBeNull()
    expect(match.matchLevel).toBe('ignored')
  })

  it('显式禁止：学位不得自动当作学历', () => {
    const match = matchStandardHeader('学位')
    expect(match.field).toBeNull()
    expect(match.blockedReason).not.toBeNull()
  })

  it('显式禁止：招聘 HR 与推荐人不得互换', () => {
    expect(matchStandardHeader('招聘负责人').field).toBe('recruiter')
    expect(matchStandardHeader('简历推荐人').field).toBe('referrer')
    expect(
      FORBIDDEN_HEADER_MAPPINGS.some(
        (entry) => entry.header === '招聘负责人' && entry.targetField === 'referrer',
      ),
    ).toBe(true)
  })
})

describe('字段值校验', () => {
  it('只接受真实存在的日历日期', () => {
    expect(isDateOnlyText('2026-08-03')).toBe(true)
    expect(isDateOnlyText('2026-02-30')).toBe(false)
    expect(isDateOnlyText('2026/08/03')).toBe(false)
    expect(isDateOnlyText('2026-8-3')).toBe(false)
  })

  it('金额允许 0，但拒绝负数与非有限数', () => {
    expect(isValidAmount(0)).toBe(true)
    expect(isValidAmount(4000)).toBe(true)
    expect(isValidAmount(-1)).toBe(false)
    expect(isValidAmount(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidAmount(Number.NaN)).toBe(false)
  })

  it('毕业年级限定在合理年份区间，不做两位推断', () => {
    expect(isValidGraduationYear(2027)).toBe(true)
    expect(isValidGraduationYear(27)).toBe(false)
    expect(isValidGraduationYear(1800)).toBe(false)
  })
})

describe('可选扩展列', () => {
  it('扩展列存在且默认缺省，不影响必需字段', () => {
    expect(EXTENSION_FIELDS.length).toBeGreaterThan(0)
    expect(EMPTY_EXTENSION_VALUES).toEqual({})
    expect(EXTENSION_FIELDS.map((field) => field.key)).not.toContain('offerStatus')
  })

  it('每个扩展列都写明用途与没有该列时的替代方案', () => {
    for (const field of EXTENSION_FIELDS) {
      expect(field.purpose.length).toBeGreaterThan(0)
      expect(field.fallback.length).toBeGreaterThan(0)
    }
  })
})
