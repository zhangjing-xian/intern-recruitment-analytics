/**
 * 中文展示格式化工具（纯函数，不依赖 React / DOM / 存储）。
 *
 * 口径约定（见 docs/PRD.md 第 4 章）：
 * - 分母为 0 或没有有效样本时，一律传入 `null`，展示为「—」，不用 0% 掩盖；
 * - 比率按百分数展示，默认保留 1 位小数；
 * - 日期字符串一律按本地日历解析，避免 UTC 解析导致的跨时区错一天。
 */

/** 无有效值时的统一占位符 */
export const EMPTY_VALUE = '—'

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const integerFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
})

function isMissing(value: number | null | undefined): boolean {
  return value === null || value === undefined || !Number.isFinite(value)
}

function toLocalDate(value: Date | string): Date | null {
  const dateOnly = typeof value === 'string' ? DATE_ONLY_PATTERN.exec(value) : null
  if (dateOnly !== null) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    const parsed = new Date(year, month - 1, day)
    // JS 的 Date 会把 2026-13-45 这类非法日期自动进位（→ 2027-02-14），
    // 必须回读校验；非法日期返回 null，由调用方显示「—」并在清洗阶段标记为问题行。
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null
    }
    return parsed
  }

  const parsed = value instanceof Date ? value : new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 整数计数，如 1234 → 1,234 */
export function formatInteger(value: number | null | undefined): string {
  if (isMissing(value)) {
    return EMPTY_VALUE
  }
  return integerFormatter.format(value as number)
}

/** 比率（0.4 → 40.0%），无效值 → 「—」 */
export function formatPercent(
  ratio: number | null | undefined,
  fractionDigits = 1,
): string {
  if (isMissing(ratio)) {
    return EMPTY_VALUE
  }
  return `${((ratio as number) * 100).toFixed(fractionDigits)}%`
}

/** 普通小数（2.35 → 2.4），无效值 → 「—」 */
export function formatDecimal(
  value: number | null | undefined,
  fractionDigits = 1,
): string {
  if (isMissing(value)) {
    return EMPTY_VALUE
  }
  return (value as number).toFixed(fractionDigits)
}

/** 平均周期等以「天」为单位的数值（15 → 15.0 天） */
export function formatDays(value: number | null | undefined, fractionDigits = 1): string {
  if (isMissing(value)) {
    return EMPTY_VALUE
  }
  return `${(value as number).toFixed(fractionDigits)} 天`
}

/** 金额（薪资分位等），按币种展示，默认人民币 */
export function formatCurrency(
  value: number | null | undefined,
  currency = 'CNY',
  fractionDigits = 0,
): string {
  if (isMissing(value)) {
    return EMPTY_VALUE
  }
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    maximumFractionDigits: fractionDigits,
    minimumFractionDigits: fractionDigits,
  }).format(value as number)
}

/** 日期，展示到天：2026-09-26 */
export function formatDate(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) {
    return EMPTY_VALUE
  }
  const parsed = toLocalDate(value)
  if (parsed === null) {
    return EMPTY_VALUE
  }
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`
}

/** 日期时间，展示到分钟：2026-09-26 09:05 */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (value === null || value === undefined) {
    return EMPTY_VALUE
  }
  const parsed = toLocalDate(value)
  if (parsed === null) {
    return EMPTY_VALUE
  }
  return `${formatDate(parsed)} ${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`
}
