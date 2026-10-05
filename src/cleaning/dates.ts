/**
 * 日期解析（docs/PRD.md 5.2、12.3 A04）：Excel 序列、明确写法、日月歧义与日历日天数差。
 *
 * 铁律：
 * - 只对**日期列**调用本模块；需求 ID 等文本列永不按数字或日期解析（由调用方保证）；
 * - Excel 1900 / 1904 两个系统都要正确换算；1900 系统序列 60（并不存在的 1900-02-29）判无效；
 * - 只接受明确写法；`01/02/2026` 这类日月歧义必须由用户确认，**不**按系统区域猜；
 * - 输出固定 `YYYY-MM-DD` 无时区文本；天数差按日历日相减（同日 = 0 天，跨夏令时不偏移）。
 */

import {
  isNullToken,
  normalizeCellText,
  type AmbiguousDateOrder,
  type DataQualityIssueCode,
  type DateOnly,
  type RawCellValue,
  type ValueSource,
} from '../domain'

/** 1900 系统里 Excel 误当作闰年的序列（1900-02-29 并不存在，按无效日期提示） */
export const EXCEL_1900_LEAP_BUG_SERIAL = 60

/** 五位数字文本（CSV / 粘贴里常见的 Excel 序列写法），只在日期列上才按序列解读 */
export const EXCEL_SERIAL_TEXT_PATTERN = /^\d{5}(?:\.\d+)?$/

/** 年在前：`2026-05-08`、`2026/5/8`、`2026年5月8日` */
const YEAR_FIRST_PATTERN = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/

/** 年在后：`01/02/2026`、`1-2-2026`（日与月谁在前需要用户确认） */
const YEAR_LAST_PATTERN = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/

export type DateCellResolution = {
  readonly date: DateOnly | null
  /** 命中的规则键，例如 `date.ymd` / `date.serialExcel1900` */
  readonly rule: string
  readonly source: ValueSource
  /** 是否必须由用户确认后才当结论（歧义、序列、无法解析都为 true） */
  readonly requiresConfirmation: boolean
  /** 是否为日月顺序歧义（`01/02/2026`） */
  readonly ambiguousOrder: boolean
  readonly issueCodes: readonly DataQualityIssueCode[]
}

export type DateParseOptions = {
  /** 工作簿日期系统；CSV / 粘贴为 null（无系统信息 → 按 1900 系统换算并标注需确认） */
  readonly date1904: boolean | null
  /** 日月顺序；null = 未确认（歧义值不转换） */
  readonly ambiguousDateOrder: AmbiguousDateOrder | null
}

/** 日历日校验：拒绝 2026-02-30 这类会被 `Date` 自动进位的写法 */
export function isCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  )
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 组装 `YYYY-MM-DD`（调用方须先校验日历合法性） */
export function formatDateOnly(year: number, month: number, day: number): DateOnly {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

/** `YYYY-MM-DD` → UTC 毫秒（只用 UTC 做差，避免本地时区 / 夏令时造成差一天）；非法返回 null */
export function dateOnlyToUtcMillis(date: DateOnly): number | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (matched === null) {
    return null
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  return isCalendarDate(year, month, day) ? Date.UTC(year, month - 1, day) : null
}

/** 日历日天数差（同日 = 0；任一端非法返回 null，**不**猜测） */
export function daysBetweenDateOnly(from: DateOnly, to: DateOnly): number | null {
  const fromMs = dateOnlyToUtcMillis(from)
  const toMs = dateOnlyToUtcMillis(to)
  if (fromMs === null || toMs === null) {
    return null
  }
  return Math.round((toMs - fromMs) / 86_400_000)
}

/**
 * Excel 日期序列 → `YYYY-MM-DD`。
 * 小数部分（时分秒）按日历日截断；不存在的日期（1900 系统序列 60、小于 1 的纯时间值）返回 null。
 */
export function excelSerialToDateOnly(serial: number, date1904: boolean): DateOnly | null {
  if (!Number.isFinite(serial)) {
    return null
  }
  const days = Math.floor(serial)
  if (date1904) {
    if (days < 0) {
      return null
    }
    const date = new Date(Date.UTC(1904, 0, 1) + days * 86_400_000)
    return formatDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
  }
  if (days < 1 || days === EXCEL_1900_LEAP_BUG_SERIAL) {
    return null
  }
  // 1900 系统：序列 1–59 以 1899-12-31 为基准，序列 ≥ 61 以 1899-12-30 为基准（Excel 的 1900 闰年 bug）
  const baseMs = days <= 59 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30)
  const date = new Date(baseMs + days * 86_400_000)
  return formatDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

type ResolutionOptions = {
  readonly source?: ValueSource
  readonly requiresConfirmation?: boolean
  readonly ambiguousOrder?: boolean
  readonly issueCodes?: readonly DataQualityIssueCode[]
}

function resolution(
  date: DateOnly | null,
  rule: string,
  options: ResolutionOptions = {},
): DateCellResolution {
  return {
    date,
    rule,
    source: options.source ?? 'raw',
    requiresConfirmation: options.requiresConfirmation ?? false,
    ambiguousOrder: options.ambiguousOrder ?? false,
    issueCodes: options.issueCodes ?? [],
  }
}

const MISSING_DATE = resolution(null, 'date.missing')

/** 数字序列（含文本形式的五位序列）→ 日期；按日期系统换算，并如实标注需要确认的来由 */
function fromSerial(
  serial: number,
  options: DateParseOptions,
  rule: string,
  textSerial: boolean,
): DateCellResolution {
  // CSV / 粘贴没有工作簿日期系统信息：按最常见的 1900 系统换算，但标为需确认
  const assumed = options.date1904 === null
  const date = excelSerialToDateOnly(serial, options.date1904 ?? false)
  if (date === null) {
    return resolution(null, 'date.serialInvalid', {
      requiresConfirmation: true,
      issueCodes: ['INVALID_DATE'],
    })
  }
  return resolution(date, assumed ? `${rule}.assumed1900` : rule, {
    requiresConfirmation: assumed || textSerial,
  })
}

/**
 * 解析日期单元格（仅日期列使用）。
 * 优先级：缺失 → 数字序列 → 年在前写法 → 年在后写法（歧义需确认）→ 文本序列 → 无法解析。
 */
export function parseDateCell(raw: RawCellValue, options: DateParseOptions): DateCellResolution {
  if (raw === null) {
    return MISSING_DATE
  }
  if (typeof raw === 'boolean') {
    return resolution(null, 'date.boolean', {
      source: 'unknown',
      requiresConfirmation: true,
      issueCodes: ['INVALID_DATE'],
    })
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return resolution(null, 'date.invalidNumber', {
        source: 'unknown',
        requiresConfirmation: true,
        issueCodes: ['INVALID_DATE'],
      })
    }
    const rule = options.date1904 === true ? 'date.serialExcel1904' : 'date.serialExcel1900'
    return fromSerial(raw, options, rule, false)
  }

  const text = normalizeCellText(raw)
  if (text === '' || isNullToken(text)) {
    return MISSING_DATE
  }

  const yearFirst = YEAR_FIRST_PATTERN.exec(text)
  if (yearFirst !== null) {
    const year = Number(yearFirst[1])
    const month = Number(yearFirst[2])
    const day = Number(yearFirst[3])
    if (isCalendarDate(year, month, day)) {
      return resolution(formatDateOnly(year, month, day), 'date.ymd')
    }
    return resolution(null, 'date.ymdInvalid', {
      source: 'unknown',
      requiresConfirmation: true,
      issueCodes: ['INVALID_DATE'],
    })
  }

  const yearLast = YEAR_LAST_PATTERN.exec(text)
  if (yearLast !== null) {
    return fromYearLast(yearLast, options)
  }

  if (EXCEL_SERIAL_TEXT_PATTERN.test(text)) {
    const rule = options.date1904 === true ? 'date.serialTextExcel1904' : 'date.serialTextExcel1900'
    return fromSerial(Number(text), options, rule, true)
  }

  return resolution(null, 'date.unparsed', {
    source: 'unknown',
    requiresConfirmation: true,
    issueCodes: ['INVALID_DATE'],
  })
}

/** `01/02/2026` 这类年在后的写法：能唯一确定的直接换算，日月都 ≤ 12 时必须由用户确认顺序 */
function fromYearLast(
  matched: RegExpExecArray,
  options: DateParseOptions,
): DateCellResolution {
  const first = Number(matched[1])
  const second = Number(matched[2])
  const year = Number(matched[3])
  const ambiguous = first <= 12 && second <= 12
  const invalidFormat = !ambiguous && first > 12 && second > 12

  if (invalidFormat) {
    return resolution(null, 'date.yearLastInvalid', {
      source: 'unknown',
      requiresConfirmation: true,
      issueCodes: ['INVALID_DATE'],
    })
  }
  if (ambiguous && options.ambiguousDateOrder === null) {
    // 日月顺序未确认：不转换、不猜，只提示用户确认（可能是 1 月 2 日，也可能是 2 月 1 日）
    return resolution(null, 'date.ambiguousUnconfirmed', {
      source: 'unknown',
      requiresConfirmation: true,
      ambiguousOrder: true,
      issueCodes: ['DATE_NOT_CONVERTED'],
    })
  }

  const monthFirst = ambiguous ? options.ambiguousDateOrder === 'month-first' : second > 12
  const month = monthFirst ? first : second
  const day = monthFirst ? second : first
  if (!isCalendarDate(year, month, day)) {
    return resolution(null, 'date.yearLastInvalid', {
      source: 'unknown',
      requiresConfirmation: true,
      issueCodes: ['INVALID_DATE'],
    })
  }
  const rule = ambiguous ? `date.${monthFirst ? 'mdy' : 'dmy'}` : 'date.yearLast'
  return resolution(formatDateOnly(year, month, day), rule, { requiresConfirmation: ambiguous })
}
