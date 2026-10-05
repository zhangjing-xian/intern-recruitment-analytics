import { describe, expect, it } from 'vitest'

import { BOSS_CHANNEL, UNKNOWN } from './enums'
import {
  buildSalarySetting,
  isNullToken,
  normalizeCellText,
  resolveChannel,
  resolveCity,
  resolveEducation,
  resolveGraduationYear,
  resolveHousing,
  resolveOfferStatus,
  resolveReferralType,
  resolveRequirementType,
  resolveSalaryAmount,
  resolveTriState,
} from './valueMappings'

describe('单元格文本规范化', () => {
  it('null → 空串；数字 / 布尔保持原义，不做隐式换算', () => {
    expect(normalizeCellText(null)).toBe('')
    expect(normalizeCellText(0)).toBe('0')
    // Excel 日期序列只保留文本，换算由步骤5 按 1900 / 1904 系统处理
    expect(normalizeCellText(43000)).toBe('43000')
    expect(normalizeCellText(true)).toBe('true')
  })

  it('去 BOM / 零宽字符 / 全半角差异与多余空白', () => {
    expect(normalizeCellText('\uFEFF 待入职 ')).toBe('待入职')
    expect(normalizeCellText('待\u200B入职')).toBe('待入职')
    expect(normalizeCellText('４０００')).toBe('4000')
    expect(normalizeCellText('已送  审批')).toBe('已送 审批')
  })

  it('占位符按缺失处理，但「无」是有效值', () => {
    expect(isNullToken('-')).toBe(true)
    expect(isNullToken('n/a')).toBe(true)
    expect(isNullToken('')).toBe(true)
    expect(isNullToken('无')).toBe(false)
  })
})

describe('城市映射', () => {
  it('标准三城直接映射且无需确认', () => {
    const result = resolveCity('上海')
    expect(result.city).toBe('上海')
    expect(result.requiresConfirmation).toBe(false)
  })

  it('园区别名给建议并要求确认，同时保留原值', () => {
    const result = resolveCity('上海青浦')
    expect(result.city).toBe('上海')
    expect(result.cityRaw).toBe('上海青浦')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.source).toBe('aliasTable')
  })

  it('缺失城市是未知，不是其他', () => {
    expect(resolveCity('-').city).toBe(UNKNOWN)
    expect(resolveCity(null).city).toBe(UNKNOWN)
    expect(resolveCity(null).cityRaw).toBeNull()
    expect(resolveCity(null).issueCodes).toEqual([])
  })

  it('未登记城市归其他并提示，不静默并入三城', () => {
    const result = resolveCity('北京')
    expect(result.city).toBe('其他')
    expect(result.cityRaw).toBe('北京')
    expect(result.issueCodes).toContain('UNKNOWN_ENUM_VALUE')
  })
})

describe('offer 状态', () => {
  it('「已送审批」映射为 offer审批中，绝不能当作待入职', () => {
    const result = resolveOfferStatus('已送审批')
    expect(result.offerStatus).toBe('offer审批中')
    expect(result.offerStatus).not.toBe('待入职')
    expect(result.requiresConfirmation).toBe(false)
  })

  it('「审批通过」不等于接受：按未知处理并要求核实', () => {
    const result = resolveOfferStatus('审批通过')
    expect(result.offerStatus).toBe(UNKNOWN)
    expect(result.offerStatusRaw).toBe('审批通过')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.issueCodes).toContain('UNKNOWN_ENUM_VALUE')
  })

  it('撤回 / 取消 / 离职进入其他并保留原值', () => {
    for (const raw of ['撤回', '取消入职', '离职']) {
      const result = resolveOfferStatus(raw)
      expect(result.offerStatus).toBe('其他')
      expect(result.offerStatusRaw).toBe(raw)
    }
  })

  it('缺失是未知且不额外报错（不污染 D，也不误报）', () => {
    const result = resolveOfferStatus('-')
    expect(result.offerStatus).toBe(UNKNOWN)
    expect(result.offerStatusRaw).toBeNull()
    expect(result.issueCodes).toEqual([])
  })

  it('识别第 2 行表头残留单元格', () => {
    const result = resolveOfferStatus('offer状态', ['需求ID', 'offer状态'])
    expect(result.issueCodes).toContain('HEADER_ECHO_CELL')
    expect(result.offerStatus).toBe(UNKNOWN)
  })
})

describe('渠道与推荐类型', () => {
  it('Boss 大小写统一为标准写法', () => {
    expect(resolveChannel('boss').channel).toBe(BOSS_CHANNEL)
    expect(resolveChannel('Boss').channel).toBe(BOSS_CHANNEL)
    expect(resolveChannel('ＢＯＳＳ').channel).toBe(BOSS_CHANNEL)
  })

  it('渠道占位符是未知，不自动判为内推', () => {
    expect(resolveChannel('-').channel).toBe(UNKNOWN)
    expect(resolveChannel('-').channelRaw).toBeNull()
  })

  it('未登记渠道归其他并提示，字典可扩展', () => {
    const result = resolveChannel('猎聘')
    expect(result.channel).toBe('其他')
    expect(result.channelRaw).toBe('猎聘')
    expect(result.issueCodes).toContain('UNKNOWN_ENUM_VALUE')
  })

  it('「XX推」建议为 HR推，但必须确认并提示核实', () => {
    const result = resolveReferralType('示例推')
    expect(result.referralType).toBe('HR推')
    expect(result.requiresConfirmation).toBe(true)
    expect(result.needsReview).toBe(true)
  })

  it('任意人名归未知，但渠道为内推时给出待核实提示', () => {
    const result = resolveReferralType('张三', '内推')
    expect(result.referralType).toBe(UNKNOWN)
    expect(result.needsReview).toBe(true)
  })
})

describe('房补', () => {
  it('「无」是无补贴：金额为 0 且保留原因标签，不推断户籍', () => {
    const result = resolveHousing('无（本地院校）')
    expect(result.housingType).toBe('无补贴')
    expect(result.housingAmount).toBe(0)
    expect(result.housingReason).toBe('本地院校')
    expect(result.issueCodes).toEqual([])
  })

  it('现金房补解析金额与周期', () => {
    const result = resolveHousing('1000元/月')
    expect(result.housingType).toBe('现金房补')
    expect(result.housingAmount).toBe(1000)
    expect(result.housingPeriod).toBe('月')
  })

  it('提供住宿一律不折算为现金', () => {
    const result = resolveHousing('杭州长期住宿')
    expect(result.housingType).toBe('提供住宿')
    expect(result.housingAmount).toBeNull()
    expect(result.requiresConfirmation).toBe(false)
  })

  it('住宿与金额同时出现时按最保守处理并提示确认', () => {
    const result = resolveHousing('长期住宿（价值2000元）')
    expect(result.housingType).toBe('提供住宿')
    expect(result.housingAmount).toBeNull()
    expect(result.requiresConfirmation).toBe(true)
    expect(result.issueCodes).toContain('HOUSING_VALUE_UNCERTAIN')
  })

  it('房补缺失是未知，绝不是「无补贴」', () => {
    const result = resolveHousing('-')
    expect(result.housingType).toBe(UNKNOWN)
    expect(result.housingAmount).toBeNull()
    expect(result.housingPeriod).toBeNull()
  })

  it('无法识别的原文保留原值并提示', () => {
    const result = resolveHousing('面议')
    expect(result.housingType).toBe(UNKNOWN)
    expect(result.housingAmount).toBeNull()
    expect(result.issueCodes).toContain('UNKNOWN_ENUM_VALUE')
  })
})

describe('薪资', () => {
  it('单一数值可解析，且不推断币种与周期', () => {
    const result = resolveSalaryAmount(4000)
    expect(result.salaryAmount).toBe(4000)
    expect(result.rule).toBe('salary.number')
    expect(result.issueCodes).toEqual([])
  })

  it('区间值不取中点，保持未知并要求确认', () => {
    const result = resolveSalaryAmount('1000~2000')
    expect(result.salaryAmount).toBeNull()
    expect(result.requiresConfirmation).toBe(true)
    expect(result.issueCodes).toContain('VALUE_RANGE_UNCERTAIN')
  })

  it('负数与非法值不当作 0', () => {
    const negative = resolveSalaryAmount('-500')
    expect(negative.salaryAmount).toBeNull()
    expect(negative.issueCodes).toContain('INVALID_SALARY')
    const unparsed = resolveSalaryAmount('面议')
    expect(unparsed.salaryAmount).toBeNull()
    expect(unparsed.issueCodes).toContain('INVALID_SALARY')
  })

  it('缺失是未知而不是 0', () => {
    const result = resolveSalaryAmount('-')
    expect(result.salaryAmount).toBeNull()
    expect(result.rawText).toBeNull()
    expect(result.issueCodes).toEqual([])
  })
})

describe('需求类型 / 学历 / 年级 / 三值', () => {
  it('「替补/替换」保留未拆分枚举，不猜测拆分', () => {
    expect(resolveRequirementType('替补/替换').requirementType).toBe('替补替换未拆分')
    expect(resolveRequirementType('替补替换').requirementType).toBe('替补替换未拆分')
  })

  it('未登记需求类型归未知并提示', () => {
    const result = resolveRequirementType('转正')
    expect(result.requirementType).toBe(UNKNOWN)
    expect(result.issueCodes).toContain('UNKNOWN_ENUM_VALUE')
  })

  it('学历同义写法映射为专科但需确认', () => {
    const result = resolveEducation('大专')
    expect(result.education).toBe('专科')
    expect(result.requiresConfirmation).toBe(true)
    expect(resolveEducation('本科').requiresConfirmation).toBe(false)
  })

  it('毕业年级只认四位年份，两位写法不猜测', () => {
    expect(resolveGraduationYear('2027届').graduationYear).toBe(2027)
    const twoDigit = resolveGraduationYear('25')
    expect(twoDigit.graduationYear).toBeNull()
    expect(twoDigit.issueCodes).toContain('VALUE_RANGE_UNCERTAIN')
  })

  it('三值缺失 / 无法识别为未知，绝不是「否」', () => {
    expect(resolveTriState('').value).toBeNull()
    expect(resolveTriState('是').value).toBe(true)
    expect(resolveTriState('否').value).toBe(false)
    expect(resolveTriState('待确认').value).toBeNull()
    expect(resolveTriState('待确认').issueCodes).toContain('UNKNOWN_ENUM_VALUE')
  })
})

describe('计薪口径设置', () => {
  it('人民币元/月可比较并记录确认时间', () => {
    const setting = buildSalarySetting('人民币元/月', '2026-09-26')
    expect(setting.currency).toBe('CNY')
    expect(setting.salaryUnit).toBe('元/月')
    expect(setting.comparable).toBe(true)
    expect(setting.confirmedAt).toBe('2026-09-26')
  })

  it('暂不确定禁用待遇对比与低薪标签', () => {
    const setting = buildSalarySetting('暂不确定')
    expect(setting.comparable).toBe(false)
    expect(setting.currency).toBeNull()
    expect(setting.salaryUnit).toBeNull()
    expect(setting.confirmedAt).toBeNull()
  })
})
