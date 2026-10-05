import { describe, expect, it } from 'vitest'

import {
  DISPLAY_ID_PREFIX,
  IDENTITY_RULES,
  SUSPECTED_DUPLICATE_KEY_FIELDS,
  buildDisplayId,
  buildExactDuplicateKey,
  buildSuspectedDuplicateKey,
  isUuidV4,
  newRecordId,
} from './identity'

describe('记录身份', () => {
  it('唯一键是本地随机 UUID，且不会重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRecordId()))
    expect(ids.size).toBe(50)
    for (const id of ids) {
      expect(isUuidV4(id)).toBe(true)
    }
  })

  it('展示代号稳定、带前缀且不含可识别信息', () => {
    const recordId = newRecordId()
    const displayId = buildDisplayId(recordId)
    expect(buildDisplayId(recordId)).toBe(displayId)
    expect(displayId.startsWith(DISPLAY_ID_PREFIX)).toBe(true)
    expect(displayId).not.toContain(recordId)
  })

  it('姓名 / 需求 ID / 推荐人明确不得作为身份键', () => {
    expect(IDENTITY_RULES.uniqueKey).toBe('recordId')
    expect(IDENTITY_RULES.displayIdField).toBe('candidateDisplayId')
    expect(IDENTITY_RULES.forbiddenIdentityFields).toContain('candidateName')
    expect(IDENTITY_RULES.forbiddenIdentityFields).toContain('requirementId')
    expect(IDENTITY_RULES.forbiddenIdentityFields).toContain('referrer')
    expect(IDENTITY_RULES.forbiddenIdentityFields).not.toContain('recordId')
  })
})

describe('疑似重复（仅提示，必须用户确认）', () => {
  it('三个部分全空时不制造重复', () => {
    const key = buildSuspectedDuplicateKey({
      requirementId: null,
      candidateName: null,
      recruitmentStartDate: null,
    })
    expect(key).toBeNull()
  })

  it('忽略大小写与首尾空白，便于人工核对', () => {
    expect(
      buildSuspectedDuplicateKey({
        requirementId: 'R-001',
        candidateName: '样例',
        recruitmentStartDate: '2026-05-08',
      }),
    ).toBe('r-001|样例|2026-05-08')
  })

  it('匹配键字段组合固定为需求 ID + 姓名 + 启动日期', () => {
    expect(SUSPECTED_DUPLICATE_KEY_FIELDS).toEqual([
      'requirementId',
      'candidateName',
      'recruitmentStartDate',
    ])
  })
})

describe('完全重复签名', () => {
  it('只做文本比较：数字 1 与文本 "1"、含空白的单元格视为相同文本', () => {
    expect(buildExactDuplicateKey(['A', 1, ' 上海 '])).toBe(
      buildExactDuplicateKey(['A', '1', '上海']),
    )
  })

  it('任一单元格不同即不是完全重复', () => {
    expect(buildExactDuplicateKey(['A', '1'])).not.toBe(buildExactDuplicateKey(['A', '2']))
  })
})
