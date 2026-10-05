import { describe, expect, it } from 'vitest'

import {
  EMPTY_VALUE,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDays,
  formatDecimal,
  formatInteger,
  formatPercent,
} from './format'

describe('format：空值与无效数值', () => {
  it('null / undefined / NaN / Infinity 统一显示「—」', () => {
    expect(formatInteger(null)).toBe(EMPTY_VALUE)
    expect(formatInteger(undefined)).toBe(EMPTY_VALUE)
    expect(formatInteger(Number.NaN)).toBe(EMPTY_VALUE)
    expect(formatInteger(Number.POSITIVE_INFINITY)).toBe(EMPTY_VALUE)
    expect(formatPercent(null)).toBe(EMPTY_VALUE)
    expect(formatPercent(Number.NaN)).toBe(EMPTY_VALUE)
    expect(formatDecimal(undefined)).toBe(EMPTY_VALUE)
    expect(formatDays(null)).toBe(EMPTY_VALUE)
    expect(formatCurrency(null)).toBe(EMPTY_VALUE)
    expect(formatDate(null)).toBe(EMPTY_VALUE)
    expect(formatDateTime(undefined)).toBe(EMPTY_VALUE)
  })

  it('0 是有效值，不能与「—」混淆', () => {
    expect(formatInteger(0)).toBe('0')
    expect(formatPercent(0)).toBe('0.0%')
  })
})

describe('format：数值与比例', () => {
  it('整数使用千分位', () => {
    expect(formatInteger(1234)).toBe('1,234')
  })

  it('比率按百分数展示，默认 1 位小数', () => {
    expect(formatPercent(0.4)).toBe('40.0%')
    expect(formatPercent(0.2)).toBe('20.0%')
  })

  it('可按需增加小数位', () => {
    expect(formatPercent(0.1667, 2)).toBe('16.67%')
  })

  it('平均周期带「天」单位', () => {
    expect(formatDays(15)).toBe('15.0 天')
    expect(formatDays(2.35)).toBe('2.4 天')
  })

  it('金额按币种格式化', () => {
    expect(formatCurrency(4000, 'CNY')).toContain('4,000')
  })
})

describe('format：日期', () => {
  it('纯日期字符串按本地日历解析，不受时区影响', () => {
    expect(formatDate('2026-09-26')).toBe('2026-09-26')
    expect(formatDate(new Date(2026, 8, 26))).toBe('2026-09-26')
  })

  it('日期时间精确到分钟并补零', () => {
    expect(formatDateTime(new Date(2026, 8, 26, 9, 5))).toBe('2026-09-26 09:05')
  })

  it('无法解析的值显示「—」', () => {
    expect(formatDate('不是日期')).toBe(EMPTY_VALUE)
    expect(formatDate('2026-13-45')).toBe(EMPTY_VALUE)
  })
})
