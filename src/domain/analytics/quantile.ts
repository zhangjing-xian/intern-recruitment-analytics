/**
 * 分位与百分位排名（docs/PRD.md 6.2「同岗薪酬基准」）。
 *
 * 两件**不同**的事，不能混用：
 * 1. 分位数值：线性插值，`h = (n−1)·p`，`j = floor(h)`，
 *    `Q = x[j] + (h − j) × (x[min(j+1, n−1)] − x[j])`；P25 / P50 / P75 由此计算；
 * 2. 百分位排名：**并列中位秩** `（小于该值的个数 + 0.5 × 等于该值的个数）/ n`，
 *    例如 3500 / 4000 / 4000 / 4500 / 5000 中 4000 的排名为 `(1 + 0.5×2)/5 = 40%`。
 *
 * 口径约定：
 * - 只有**有效数值**参与计算：非有限数（NaN / Infinity）先被剔除，绝不当作 0；
 * - 空样本返回 `null`，由展示层显示「—/无有效样本」，**不显示 0**；
 * - 内部保留完整精度，不提前四舍五入（PRD 6.1 处理规则）；
 * - 排名以**比率**返回（0.4 = 40%），与全部率指标保持同一写法，展示层再乘 100。
 */

/** 分位数结果；n 为有效样本数，样本不足时各分位为 null */
export type Quantiles = {
  readonly n: number
  readonly p25: number | null
  readonly p50: number | null
  readonly p75: number | null
}

const EMPTY_QUANTILES: Quantiles = { n: 0, p25: null, p50: null, p75: null }

/** 升序副本；剔除非有限数（NaN / ±Infinity 不是有效样本，不得当成 0） */
export function sortNumbersAscending(values: readonly number[]): readonly number[] {
  return values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
}

/**
 * 线性插值分位数（要求入参**已升序**且全部为有限数，见 `sortNumbersAscending`）。
 * `probability` 必须在 0–1 之间：越界属于调用错误，直接抛错而不「将就着用」。
 */
export function quantile(sortedAscending: readonly number[], probability: number): number | null {
  if (!(probability >= 0 && probability <= 1)) {
    throw new Error(`分位概率必须在 0–1 之间：${probability}`)
  }
  const n = sortedAscending.length
  if (n === 0) {
    return null
  }
  if (n === 1) {
    return sortedAscending[0]
  }

  const position = (n - 1) * probability
  const lowerIndex = Math.floor(position)
  const lower = sortedAscending[lowerIndex]
  const upper = sortedAscending[Math.min(lowerIndex + 1, n - 1)]
  return lower + (position - lowerIndex) * (upper - lower)
}

/** P25 / P50 / P75（自带排序，调用方不必先排序） */
export function quantilesOf(values: readonly number[]): Quantiles {
  const sorted = sortNumbersAscending(values)
  if (sorted.length === 0) {
    return EMPTY_QUANTILES
  }
  return {
    n: sorted.length,
    p25: quantile(sorted, 0.25),
    p50: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
  }
}

/** 小于给定值的样本个数（要求已升序） */
export function countBelow(sortedAscending: readonly number[], value: number): number {
  let count = 0
  for (const sample of sortedAscending) {
    if (sample < value) {
      count += 1
    }
  }
  return count
}

/**
 * 并列中位秩百分位（比率 0–1）：`（小于 + 0.5 × 等于）/ n`。
 * 样本含自身，这是**描述性定位**，不是独立预测，也不能当概率；空样本返回 null。
 */
export function medianRankPercentile(
  sortedAscending: readonly number[],
  value: number,
): number | null {
  if (!Number.isFinite(value)) {
    return null
  }
  const n = sortedAscending.length
  if (n === 0) {
    return null
  }

  let below = 0
  let equal = 0
  for (const sample of sortedAscending) {
    if (sample < value) {
      below += 1
    } else if (sample === value) {
      equal += 1
    }
  }
  return (below + 0.5 * equal) / n
}

/**
 * 「低于中位数」：`salary < P50`，**相等不标低**。
 * 任一端为 null（薪资未知 / 基准不足）返回 null，不得当 false 或 true（PRD 6.2）。
 */
export function isBelowMedianValue(salary: number | null, p50: number | null): boolean | null {
  if (salary === null || p50 === null || !Number.isFinite(salary) || !Number.isFinite(p50)) {
    return null
  }
  return salary < p50
}
