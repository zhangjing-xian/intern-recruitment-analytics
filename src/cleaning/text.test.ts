/**
 * 文本清洗（docs/PRD.md 5.1 / 12.3 A02、A03）单测。
 * 只做**写法归一**，不做业务猜测：空白 / `-` / `N/A` 视为缺失（缺失 ≠ 0）、
 * 标识列按文本原样保留、学校名不做包含 / 模糊匹配。
 */

import { describe, expect, it } from 'vitest'

import type { SchoolAliasRule } from '../domain'
import { cleanTextCell, resolveSchoolName } from './text'

const ALIASES: readonly SchoolAliasRule[] = [{ alias: '上交', canonical: '上海交通大学' }]

describe('文本单元格清洗（PRD 5.1）', () => {
  it('null 是缺失，不当成空字符串内容', () => {
    expect(cleanTextCell(null)).toEqual({
      value: null,
      changed: false,
      rule: 'text.missing',
      issueCodes: [],
    })
  })

  it('去首尾空白（含全角空格）、压连续空白、去掉零宽字符', () => {
    expect(cleanTextCell('  张  三  ').value).toBe('张 三')
    expect(cleanTextCell('　张三　').value).toBe('张三')
    expect(cleanTextCell('\u200b张三\u200b').value).toBe('张三')
    expect(cleanTextCell(' 张三 ').changed).toBe(true)
    expect(cleanTextCell('张三').changed).toBe(false)
  })

  it('空白 / `-` / `N/A` 视为缺失，但「无」是有效房补原文', () => {
    for (const raw of ['', '   ', '-', '--', 'N/A', 'na']) {
      const resolution = cleanTextCell(raw)
      expect(resolution.value).toBeNull()
      expect(resolution.rule).toBe('text.nullToken')
    }
    expect(cleanTextCell('无').value).toBe('无')
    expect(cleanTextCell('无补贴').value).toBe('无补贴')
  })

  it('数字单元格按原样文本保留：ID 列前导 0 不失真、绝不按日期解析', () => {
    expect(cleanTextCell(43000, { preserveLeadingZeros: true })).toEqual({
      value: '43000',
      changed: true,
      rule: 'text.numericId',
      issueCodes: [],
    })
    expect(cleanTextCell(43000).rule).toBe('text.numeric')
    expect(cleanTextCell(0).value).toBe('0')
    expect(cleanTextCell(12.5).value).toBe('12.5')
  })

  it('布尔与非法数字如实报告问题码，不静默丢弃', () => {
    expect(cleanTextCell(true)).toEqual({
      value: 'true',
      changed: true,
      rule: 'text.boolean',
      issueCodes: ['UNKNOWN_ENUM_VALUE'],
    })
    expect(cleanTextCell(false).value).toBe('false')
    expect(cleanTextCell(Number.POSITIVE_INFINITY)).toEqual({
      value: null,
      changed: true,
      rule: 'text.invalidNumber',
      issueCodes: ['INVALID_SALARY'],
    })
    expect(cleanTextCell(Number.NaN).rule).toBe('text.invalidNumber')
  })
})

describe('学校名归一（PRD 5.1：别名只做写法归一）', () => {
  it('缺失 → null，来源为原值，无需确认', () => {
    expect(resolveSchoolName(null, ALIASES)).toEqual({
      school: null,
      rule: 'school.missing',
      source: 'raw',
      requiresConfirmation: false,
      issueCodes: [],
    })
  })

  it('未命中别名时保留原值，不做任何猜测', () => {
    const resolution = resolveSchoolName('上海交通大学', ALIASES)
    expect(resolution.school).toBe('上海交通大学')
    expect(resolution.rule).toBe('school.raw')
    expect(resolution.source).toBe('raw')
    expect(resolution.requiresConfirmation).toBe(false)
    expect(resolution.issueCodes).toEqual([])
  })

  it('命中等价别名时给出规范名，并要求用户确认', () => {
    const resolution = resolveSchoolName(' 上交 ', ALIASES)
    expect(resolution.school).toBe('上海交通大学')
    expect(resolution.rule).toBe('school.alias')
    expect(resolution.source).toBe('aliasTable')
    expect(resolution.requiresConfirmation).toBe(true)
  })

  it('语义不同的写法不合并：包含 / 模糊匹配一律不生效', () => {
    expect(resolveSchoolName('上海交大', ALIASES).rule).toBe('school.raw')
    expect(resolveSchoolName('上海交大', ALIASES).school).toBe('上海交大')
    expect(resolveSchoolName('复旦大学', ALIASES).school).toBe('复旦大学')
  })

  it('没有配置别名表时一切按原值处理', () => {
    expect(resolveSchoolName('上交', []).school).toBe('上交')
    expect(resolveSchoolName('上交', []).rule).toBe('school.raw')
  })
})
