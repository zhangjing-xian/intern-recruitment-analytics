/**
 * 分位与百分位排名单测（docs/PRD.md 6.2 + 12.2 薪资合成例）。
 * 基准（PRD 12.2）：3500 / 4000 / 4000 / 4500 / 5000 → P25 = 4000、P50 = 4000、P75 = 4500；
 * 4000 的分位排名 40%；仅 3500 低于中位数（相等不标低）；空样本 `null`（不是 0）。
 */

import { describe, expect, it } from 'vitest'

import {
  countBelow,
  isBelowMedianValue,
  medianRankPercentile,
  quantile,
  quantilesOf,
  sortNumbersAscending,
} from './quantile'

describe('线性插值分位数', () => {
  it('按 h = (n−1)·p 线性插值（PRD 6.2 公式）', () => {
    const values = [1, 2, 3, 4]
    expect(quantile(values, 0)).toBe(1)
    expect(quantile(values, 0.25)).toBe(1.75)
    expect(quantile(values, 0.5)).toBe(2.5)
    expect(quantile(values, 0.75)).toBe(3.25)
    expect(quantile(values, 1)).toBe(4)
  })

  it('PRD 12.2 薪资例：P25=4000、P50=4000、P75=4500', () => {
    expect(quantilesOf([3500, 4000, 4000, 4500, 5000])).toEqual({
      n: 5,
      p25: 4000,
      p50: 4000,
      p75: 4500,
    })
  })

  it('样本不足：空样本为 null，单样本等于自身', () => {
    expect(quantilesOf([])).toEqual({ n: 0, p25: null, p50: null, p75: null })
    expect(quantilesOf([4200])).toEqual({ n: 1, p25: 4200, p50: 4200, p75: 4200 })
  })

  it('非有限数先被剔除（NaN / Infinity 不是有效样本，也不当 0）', () => {
    expect(sortNumbersAscending([3000, Number.NaN, Number.POSITIVE_INFINITY, 1000])).toEqual([
      1000, 3000,
    ])
    expect(quantilesOf([Number.NaN]).n).toBe(0)
  })

  it('概率越界直接抛错，不「将就着用」', () => {
    expect(() => quantile([1, 2], 1.5)).toThrow(/0–1/)
    expect(() => quantile([1, 2], -0.1)).toThrow(/0–1/)
  })
})

describe('并列中位秩排名', () => {
  const sorted = [3500, 4000, 4000, 4500, 5000]

  it('4000 的排名为 40%（并列取中位秩）', () => {
    expect(medianRankPercentile(sorted, 4000)).toBeCloseTo(0.4, 10)
  })

  it('最小值 / 最大值分别是 10% 与 90%（样本含自身）', () => {
    expect(medianRankPercentile(sorted, 3500)).toBeCloseTo(0.1, 10)
    expect(medianRankPercentile(sorted, 5000)).toBeCloseTo(0.9, 10)
    expect(countBelow(sorted, 4000)).toBe(1)
  })

  it('空样本或非有限薪资返回 null，不返回 0', () => {
    expect(medianRankPercentile([], 4000)).toBeNull()
    expect(medianRankPercentile(sorted, Number.NaN)).toBeNull()
  })
})

describe('低于中位数判定', () => {
  it('salary < P50 才算低；相等不标低（PRD 6.2）', () => {
    expect(isBelowMedianValue(3500, 4000)).toBe(true)
    expect(isBelowMedianValue(4000, 4000)).toBe(false)
    expect(isBelowMedianValue(4500, 4000)).toBe(false)
  })

  it('薪资或基准缺失时返回 null（既不是 true 也不是 false）', () => {
    expect(isBelowMedianValue(null, 4000)).toBeNull()
    expect(isBelowMedianValue(3500, null)).toBeNull()
  })
})
