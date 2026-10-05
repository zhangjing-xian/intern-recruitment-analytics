/**
 * 日期解析（docs/PRD.md 5.2、12.3 A04）单测。
 * 铁律：只接受明确写法；Excel 1900 / 1904 都正确换算；日月歧义只提示、不猜；
 * 天数差按日历日算（同日 = 0 天，跨夏令时不偏移）。
 */

import { describe, expect, it } from 'vitest'

import {
  EXCEL_1900_LEAP_BUG_SERIAL,
  dateOnlyToUtcMillis,
  daysBetweenDateOnly,
  excelSerialToDateOnly,
  formatDateOnly,
  isCalendarDate,
  parseDateCell,
  type DateParseOptions,
} from './dates'

/** CSV / 粘贴场景：没有工作簿日期系统信息，日月顺序也未确认 */
const UNSET: DateParseOptions = { date1904: null, ambiguousDateOrder: null }
/** XLSX 1900 系统，日月顺序仍未确认 */
const XLSX_1900: DateParseOptions = { date1904: false, ambiguousDateOrder: null }

/** 2026-05-08 的 1900 系统序列（按日历日反算，测试里不写死魔法数字） */
const SERIAL_2026_05_08 = daysBetweenDateOnly('1899-12-30', '2026-05-08') ?? 0

describe('日历日校验与格式化', () => {
  it('只有真实存在的日历日才合法（拒绝会被 Date 自动进位的写法）', () => {
    expect(isCalendarDate(2026, 5, 8)).toBe(true)
    expect(isCalendarDate(2024, 2, 29)).toBe(true)
    expect(isCalendarDate(2026, 2, 29)).toBe(false)
    expect(isCalendarDate(1900, 2, 29)).toBe(false)
    expect(isCalendarDate(2026, 2, 30)).toBe(false)
    expect(isCalendarDate(2026, 0, 1)).toBe(false)
    expect(isCalendarDate(2026, 13, 1)).toBe(false)
    expect(isCalendarDate(2026, 1, 32)).toBe(false)
    expect(isCalendarDate(2026.5, 1, 1)).toBe(false)
  })

  it('输出固定补零的 YYYY-MM-DD 文本（无时区）', () => {
    expect(formatDateOnly(2026, 5, 8)).toBe('2026-05-08')
    expect(formatDateOnly(2026, 12, 31)).toBe('2026-12-31')
    expect(formatDateOnly(999, 1, 1)).toBe('0999-01-01')
  })

  it('只有合法的 YYYY-MM-DD 才换算成 UTC 毫秒', () => {
    expect(dateOnlyToUtcMillis('2026-05-08')).toBe(Date.UTC(2026, 4, 8))
    expect(dateOnlyToUtcMillis('2026-5-8')).toBeNull()
    expect(dateOnlyToUtcMillis('2026-02-30')).toBeNull()
    expect(dateOnlyToUtcMillis('abc')).toBeNull()
  })
})

describe('日历日天数差', () => {
  it('同日为 0，跨月 / 跨年按日期相减，反向为负', () => {
    expect(daysBetweenDateOnly('2026-05-08', '2026-05-08')).toBe(0)
    expect(daysBetweenDateOnly('2026-05-08', '2026-05-09')).toBe(1)
    expect(daysBetweenDateOnly('2026-04-30', '2026-05-02')).toBe(2)
    expect(daysBetweenDateOnly('2025-12-31', '2026-01-01')).toBe(1)
    expect(daysBetweenDateOnly('2026-05-09', '2026-05-08')).toBe(-1)
  })

  it('跨夏令时切换仍按日历日计算（不会因 23 / 25 小时差一天）', () => {
    expect(daysBetweenDateOnly('2026-03-07', '2026-03-09')).toBe(2)
    expect(daysBetweenDateOnly('2026-11-01', '2026-11-02')).toBe(1)
  })

  it('任一端非法时返回 null，不猜测', () => {
    expect(daysBetweenDateOnly('2026-02-30', '2026-03-01')).toBeNull()
    expect(daysBetweenDateOnly('2026-05-08', '2026-5-9')).toBeNull()
  })
})

describe('Excel 日期序列换算', () => {
  it('1900 系统：序列 59 / 60 / 61 的闰年 bug 边界正确', () => {
    expect(EXCEL_1900_LEAP_BUG_SERIAL).toBe(60)
    expect(excelSerialToDateOnly(1, false)).toBe('1900-01-01')
    expect(excelSerialToDateOnly(59, false)).toBe('1900-02-28')
    expect(excelSerialToDateOnly(60, false)).toBeNull()
    expect(excelSerialToDateOnly(61, false)).toBe('1900-03-01')
  })

  it('1900 系统：小于 1 的纯时间值与非法数字都不算日期', () => {
    expect(excelSerialToDateOnly(0, false)).toBeNull()
    expect(excelSerialToDateOnly(0.5, false)).toBeNull()
    expect(excelSerialToDateOnly(-1, false)).toBeNull()
    expect(excelSerialToDateOnly(Number.NaN, false)).toBeNull()
  })

  it('1904 系统：从 1904-01-01 起算', () => {
    expect(excelSerialToDateOnly(0, true)).toBe('1904-01-01')
    expect(excelSerialToDateOnly(1, true)).toBe('1904-01-02')
    expect(excelSerialToDateOnly(-1, true)).toBeNull()
  })

  it('两个系统都能与 YYYY-MM-DD 往返一致，小数时分秒按日历日截断', () => {
    for (const date of ['1900-03-01', '2026-05-08', '2026-12-31']) {
      const serial = daysBetweenDateOnly('1899-12-30', date)
      expect(serial).not.toBeNull()
      expect(excelSerialToDateOnly(serial ?? 0, false)).toBe(date)
      expect(excelSerialToDateOnly((serial ?? 0) + 0.75, false)).toBe(date)
    }
    const serial1904 = daysBetweenDateOnly('1904-01-01', '2026-05-08')
    expect(excelSerialToDateOnly(serial1904 ?? 0, true)).toBe('2026-05-08')
  })
})

describe('parseDateCell：缺失与非法值如实报告', () => {
  it('null / 空白 / 占位符是缺失，不是错误', () => {
    expect(parseDateCell(null, UNSET)).toEqual({
      date: null,
      rule: 'date.missing',
      source: 'raw',
      requiresConfirmation: false,
      ambiguousOrder: false,
      issueCodes: [],
    })
    for (const raw of ['', '   ', '-', 'N/A']) {
      expect(parseDateCell(raw, UNSET).rule).toBe('date.missing')
      expect(parseDateCell(raw, UNSET).issueCodes).toEqual([])
    }
  })

  it('布尔值 / 非有限数字 / 无法解析的文本都报 INVALID_DATE 并要求确认', () => {
    expect(parseDateCell(true, UNSET)).toEqual({
      date: null,
      rule: 'date.boolean',
      source: 'unknown',
      requiresConfirmation: true,
      ambiguousOrder: false,
      issueCodes: ['INVALID_DATE'],
    })
    expect(parseDateCell(Number.POSITIVE_INFINITY, XLSX_1900).rule).toBe('date.invalidNumber')
    expect(parseDateCell('上周', UNSET).rule).toBe('date.unparsed')
    expect(parseDateCell('上周', UNSET).issueCodes).toEqual(['INVALID_DATE'])
    expect(parseDateCell('2026-13-01', UNSET).rule).toBe('date.ymdInvalid')
    expect(parseDateCell('2026-02-30', UNSET).rule).toBe('date.ymdInvalid')
    expect(parseDateCell('15/15/2026', UNSET).rule).toBe('date.yearLastInvalid')
    expect(parseDateCell('15/15/2026', UNSET).issueCodes).toEqual(['INVALID_DATE'])
  })
})

describe('parseDateCell：明确写法直接换算', () => {
  it('年在前（- / . / 年月日）统一归一到 YYYY-MM-DD，且不需要确认', () => {
    for (const raw of ['2026-05-08', '2026/5/8', '2026.05.08', '2026年5月8日']) {
      expect(parseDateCell(raw, UNSET)).toEqual({
        date: '2026-05-08',
        rule: 'date.ymd',
        source: 'raw',
        requiresConfirmation: false,
        ambiguousOrder: false,
        issueCodes: [],
      })
    }
  })

  it('年在后但能唯一确定时不需确认（13/02/2026 只能是 2 月 13 日）', () => {
    const resolution = parseDateCell('13/02/2026', UNSET)
    expect(resolution.date).toBe('2026-02-13')
    expect(resolution.rule).toBe('date.yearLast')
    expect(resolution.requiresConfirmation).toBe(false)
    expect(resolution.ambiguousOrder).toBe(false)
    expect(resolution.issueCodes).toEqual([])
  })
})

describe('parseDateCell：日月歧义只提示、不猜', () => {
  it('顺序未确认时不转换，返回 DATE_NOT_CONVERTED 与歧义标记', () => {
    expect(parseDateCell('01/02/2026', UNSET)).toEqual({
      date: null,
      rule: 'date.ambiguousUnconfirmed',
      source: 'unknown',
      requiresConfirmation: true,
      ambiguousOrder: true,
      issueCodes: ['DATE_NOT_CONVERTED'],
    })
  })

  it('用户确认 month-first / day-first 后按确认顺序换算，且仍标记需确认', () => {
    const monthFirst = parseDateCell('01/02/2026', {
      date1904: false,
      ambiguousDateOrder: 'month-first',
    })
    expect(monthFirst.date).toBe('2026-01-02')
    expect(monthFirst.rule).toBe('date.mdy')
    expect(monthFirst.requiresConfirmation).toBe(true)
    expect(monthFirst.ambiguousOrder).toBe(false)
    expect(monthFirst.issueCodes).toEqual([])

    const dayFirst = parseDateCell('01/02/2026', {
      date1904: false,
      ambiguousDateOrder: 'day-first',
    })
    expect(dayFirst.date).toBe('2026-02-01')
    expect(dayFirst.rule).toBe('date.dmy')
  })

  it('确认顺序后遇到不存在的日期仍然判无效（不悄悄进位）', () => {
    const resolution = parseDateCell('02/30/2026', {
      date1904: false,
      ambiguousDateOrder: 'month-first',
    })
    expect(resolution.date).toBeNull()
    expect(resolution.rule).toBe('date.yearLastInvalid')
    expect(resolution.issueCodes).toEqual(['INVALID_DATE'])
  })
})

describe('parseDateCell：Excel 序列（数字与五位数字文本）', () => {
  it('数字序列按日期系统换算；CSV / 粘贴缺系统信息时标注 assumed1900 并要求确认', () => {
    expect(SERIAL_2026_05_08).toBeGreaterThan(0)

    const xlsx = parseDateCell(SERIAL_2026_05_08, XLSX_1900)
    expect(xlsx.date).toBe('2026-05-08')
    expect(xlsx.rule).toBe('date.serialExcel1900')
    expect(xlsx.requiresConfirmation).toBe(false)
    expect(xlsx.source).toBe('raw')
    expect(xlsx.issueCodes).toEqual([])

    const serial1904 = parseDateCell(SERIAL_2026_05_08, {
      date1904: true,
      ambiguousDateOrder: null,
    })
    expect(serial1904.rule).toBe('date.serialExcel1904')
    expect(serial1904.requiresConfirmation).toBe(false)

    const assumed = parseDateCell(SERIAL_2026_05_08, UNSET)
    expect(assumed.date).toBe('2026-05-08')
    expect(assumed.rule).toBe('date.serialExcel1900.assumed1900')
    expect(assumed.requiresConfirmation).toBe(true)
  })

  it('五位数字文本只按序列解读，且始终要求用户确认', () => {
    const text = String(SERIAL_2026_05_08)
    expect(text).toMatch(/^\d{5}$/)

    const resolution = parseDateCell(text, XLSX_1900)
    expect(resolution.date).toBe('2026-05-08')
    expect(resolution.rule).toBe('date.serialTextExcel1900')
    expect(resolution.requiresConfirmation).toBe(true)
    expect(resolution.issueCodes).toEqual([])
  })

  it('不存在的序列（60 / 纯时间值）按无效日期报告', () => {
    for (const serial of [EXCEL_1900_LEAP_BUG_SERIAL, 0.5]) {
      const resolution = parseDateCell(serial, XLSX_1900)
      expect(resolution.date).toBeNull()
      expect(resolution.rule).toBe('date.serialInvalid')
      expect(resolution.requiresConfirmation).toBe(true)
      expect(resolution.issueCodes).toEqual(['INVALID_DATE'])
    }
  })

  it('六位以上数字文本不是序列写法：按无法解析处理，不当成日期', () => {
    const resolution = parseDateCell('20260508', XLSX_1900)
    expect(resolution.date).toBeNull()
    expect(resolution.rule).toBe('date.unparsed')
    expect(resolution.issueCodes).toEqual(['INVALID_DATE'])
  })
})


