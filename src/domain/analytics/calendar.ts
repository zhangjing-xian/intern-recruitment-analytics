/**
 * 日历日工具（纯函数，步骤7 指标引擎自用；docs/PRD.md 6.1「招聘周期天」）。
 *
 * 为什么领域层自带一份，而不复用 `cleaning/dates.ts`：
 * 分层方向是 `cleaning → domain`，`domain` **不得**反向依赖清洗层（AGENTS.md §4）。
 * 这里只保留「`YYYY-MM-DD` 校验 → UTC 毫秒 → 天数差」这三步，口径与清洗层完全一致：
 * - 按**日历日**相减（同日 = 0 天），用 UTC 秒数做差，跨夏令时不会偏移一天；
 * - 非法日期（`2026-02-30` 之类会被 `Date` 自动进位）一律返回 `null`，**不**猜测、**不**取 0；
 * - 负值不在这里截断：是否算「周期为负」由调用方按业务口径处理（见 ./durations.ts）。
 */

import type { DateOnly } from '../types'

export const MILLISECONDS_PER_DAY = 86_400_000

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** `YYYY-MM-DD` → UTC 毫秒；格式或日历非法返回 null */
export function dateOnlyToUtcMillis(date: DateOnly): number | null {
  const matched = DATE_ONLY_PATTERN.exec(date)
  if (matched === null) {
    return null
  }

  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const millis = Date.UTC(year, month - 1, day)
  const parsed = new Date(millis)
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null
  }
  return millis
}

/** 是否为合法的日历日文本 */
export function isCalendarDateOnly(date: DateOnly): boolean {
  return dateOnlyToUtcMillis(date) !== null
}

/** 日历日天数差，`to − from`；任一端非法返回 null（**不**当作 0 天） */
export function calendarDaysBetween(from: DateOnly, to: DateOnly): number | null {
  const fromMs = dateOnlyToUtcMillis(from)
  const toMs = dateOnlyToUtcMillis(to)
  if (fromMs === null || toMs === null) {
    return null
  }
  return Math.round((toMs - fromMs) / MILLISECONDS_PER_DAY)
}

/** 日期先后比较：左早于右为 −1，相等为 0，左晚于右为 1；任一端非法返回 null */
export function compareDateOnly(left: DateOnly, right: DateOnly): number | null {
  const leftMs = dateOnlyToUtcMillis(left)
  const rightMs = dateOnlyToUtcMillis(right)
  if (leftMs === null || rightMs === null) {
    return null
  }
  if (leftMs === rightMs) {
    return 0
  }
  return leftMs < rightMs ? -1 : 1
}
