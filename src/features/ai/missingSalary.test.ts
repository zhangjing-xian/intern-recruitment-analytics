/**
 * 「缺失薪资」计数的口径回归测试（AI-1 收尾）。
 *
 * 背景：AI 载荷契约里有一个 `quality.missingSalary`（有多少条记录的薪资不可用于分析）。
 * 看板最初把它硬编码成 `0`——理由是统一指标引擎没有直接暴露这个派生计数。
 * 但 0 会被读成「没有记录缺薪资」，而它是一个会**随载荷一起出现在预览与请求里**的数字，
 * 所以那是假数据，不是保守取值。
 *
 * 修法：由引擎**已经算好的** `metricAvailability`（「薪资对比」条目的 `validSampleCount`
 * 正好是「薪资金额非空的记录数」，见 `cleaning/report.ts` 的 `sampleCountFor`）反推：
 * `缺失 = 总记录数 − 可用薪资记录数`。这是对既有口径做一次算术，不是第二处口径实现。
 *
 * 本文件把这个算术钉住，使 `missingSalary` 不能悄悄退回常量 0。
 */

import { describe, expect, it } from 'vitest'

import { missingSalaryCount } from './aiSourceCells'

describe('missingSalaryCount', () => {
  it('总记录数减去可用薪资记录数', () => {
    expect(missingSalaryCount(100, 79)).toBe(21)
    expect(missingSalaryCount(5, 5)).toBe(0)
  })

  it('模块口径不适用（validSampleCount 为 null）时按「全部不可用」计，而不是 0', () => {
    // null 表示该模块口径不适用；此时薪资不可用于分析，因此缺失数 = 全部记录
    expect(missingSalaryCount(100, null)).toBe(100)
    expect(missingSalaryCount(0, null)).toBe(0)
  })

  it('永不产生负数（容错：可用数大于总数时按 0 处理，不显示负缺失）', () => {
    expect(missingSalaryCount(10, 12)).toBe(0)
  })

  it('未知总数按 0 处理（空数据集）', () => {
    expect(missingSalaryCount(0, 0)).toBe(0)
  })
})
