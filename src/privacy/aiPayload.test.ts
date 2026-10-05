/**
 * AI 载荷的**历史结构**（v1）测试。
 *
 * 这组测试守的是 v1 的两条性质：
 * 1. 结构只可能是「聚合字段 + 样本量 + 分母说明」，没有位置装原始行；
 * 2. 校验器能把它与当前版本（`ai-summary/1`）以及损坏数据区分开，
 *    使「从加密仓读回一条旧历史」不会被误判为损坏、也不会被误当成当前结构。
 *
 * 当前版本载荷（`ai-summary/1`）的契约与白名单校验在 `aiSummary.test.ts`。
 */

import { describe, expect, it } from 'vitest'

import {
  AI_PAYLOAD_VERSION,
  isLegacyAiPayloadV1,
  type AiPayloadField,
  type LegacyAiPayloadV1,
} from './aiPayload'
import { AI_SUMMARY_SCHEMA_VERSION } from './aiSummary'

/** 一份合法的 v1 聚合载荷：只有指标 ID、数值、样本量与分母说明 */
const VALID_V1: LegacyAiPayloadV1 = {
  payloadVersion: AI_PAYLOAD_VERSION,
  generatedAt: '2026-09-26T10:00:00.000Z',
  privacyLevel: 'standard',
  fields: [
    {
      metricId: 'core.rejectionRate',
      value: 0.4,
      sampleSize: 5,
      denominatorNote: '分母 D = 已入职 + 待入职 + 拒绝 offer',
    },
  ],
  omitted: [{ metricId: 'salary.median', reason: '准确中位数不外发（PRD 10.6）' }],
  contentBytes: 128,
}

describe('isLegacyAiPayloadV1', () => {
  it('接受合法 v1 载荷', () => {
    expect(isLegacyAiPayloadV1(VALID_V1)).toBe(true)
  })

  it('拒绝缺字段 / 类型不对 / 非法隐私级别的载荷', () => {
    expect(isLegacyAiPayloadV1(null)).toBe(false)
    expect(isLegacyAiPayloadV1([])).toBe(false)
    expect(isLegacyAiPayloadV1('文本')).toBe(false)
    expect(isLegacyAiPayloadV1({ ...VALID_V1, payloadVersion: 1 })).toBe(false)
    expect(isLegacyAiPayloadV1({ ...VALID_V1, privacyLevel: '公开' })).toBe(false)
    expect(isLegacyAiPayloadV1({ ...VALID_V1, contentBytes: -1 })).toBe(false)
    expect(
      isLegacyAiPayloadV1({ ...VALID_V1, fields: [{ metricId: 'x', sampleSize: 1 }] }),
    ).toBe(false)
    expect(isLegacyAiPayloadV1({ ...VALID_V1, omitted: [{ metricId: 'x' }] })).toBe(false)
  })

  it('不把当前版本（ai-summary/1）误认成 v1', () => {
    // 当前结构的 schemaVersion 与 v1 的 payloadVersion 取值不同，因此不会被混起来
    expect(AI_SUMMARY_SCHEMA_VERSION).not.toBe(AI_PAYLOAD_VERSION)
    expect(
      isLegacyAiPayloadV1({ ...VALID_V1, payloadVersion: AI_SUMMARY_SCHEMA_VERSION }),
    ).toBe(false)
  })

  it('字段类型只承载「值 + 指标 ID + 样本量 + 分母说明 + 是否抑制」五件套', () => {
    // `AiPayloadField<T>` 是泛型，这里用一次具体实例把契约钉住：
    // 一旦有人往里加「记录列表」「姓名」之类的字段，这个对象字面量会编译失败。
    const field: AiPayloadField<number> = {
      value: 6,
      metricId: 'core.total',
      sampleSize: 6,
      denominatorNote: 'N：全部保留记录，含审批中',
      suppressed: false,
    }

    expect(isLegacyAiPayloadV1({ ...VALID_V1, fields: [field] })).toBe(true)
    // 载荷里的字段**没有** suppressed（抑制项整体进 `omitted`，而不是留一个「被抑制的 0」）
    expect('suppressed' in VALID_V1.fields[0]).toBe(false)
  })
})
