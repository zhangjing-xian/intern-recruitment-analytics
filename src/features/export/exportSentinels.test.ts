/**
 * 导出哨兵收集的单测（步骤11 建立，2026-09-27 修「误拦」时补齐）。
 *
 * ## 为什么必须单独测这一层
 *
 * 原实现把源列里的**每一个非空取值**都当哨兵，于是「受控字典词汇」永远自撞：
 * 源里写渠道 / 推荐类型「内推」，聚合报告的渠道标签也是「内推」；
 * 源里写原因「薪酬」，报告的原因类别也是「薪酬」——两者同字，检查就报命中并**阻断导出**。
 * 实测在演示数据（50 行合成样本）上会命中 6 处，把四个导出按钮全部锁死；
 * 而那几个字是**类别标签**，不是任何人的身份信息。
 *
 * 改法：受控字典词汇不进哨兵集合，**具体人名与自由文本照旧进**。
 * 这两条方向都要被钉住，否则下一轮很容易「为了不误拦」把真值也一起放掉。
 */

import { describe, expect, it } from 'vitest'

import { syntheticRecords } from '../../domain/analytics/fixtures'

import {
  SENTINEL_LIMIT_PER_FIELD,
  collectSentinels,
  isControlledDictionaryValue,
} from './exportSentinels'

describe('导出哨兵：受控字典词汇不算身份信息', () => {
  it('推荐类型的两个标准写法被判为字典词汇（报告里本来就会带这两个标签）', () => {
    expect(isControlledDictionaryValue('referrer', '内推')).toBe(true)
    expect(isControlledDictionaryValue('referrer', 'HR推')).toBe(true)
  })

  it('带姓名的推荐人写法**不**算字典词汇（那是具体人，必须继续当哨兵）', () => {
    for (const value of ['示例推', '张某某', '样例推荐人']) {
      expect(isControlledDictionaryValue('referrer', value), value).toBe(false)
    }
  })

  it('原因：字典能命中的写法算类别词汇；字典外的自由文本仍算哨兵', () => {
    for (const value of ['薪酬', '薪资', '住宿', '地点', '实习时间']) {
      expect(isControlledDictionaryValue('rejectionReason', value), value).toBe(true)
    }
    for (const value of ['薪酬太低所以去了别家', '通勤太久且家里有事', '未分类', '未填写']) {
      expect(isControlledDictionaryValue('rejectionReason', value), value).toBe(false)
    }
  })

  it('姓名与 HR 姓名任何时候都不是字典词汇（它们不可能合法出现在报告里）', () => {
    for (const field of ['candidateName', 'recruiter'] as const) {
      expect(isControlledDictionaryValue(field, '内推')).toBe(false)
      expect(isControlledDictionaryValue(field, '薪酬')).toBe(false)
      expect(isControlledDictionaryValue(field, '合成候选人甲')).toBe(false)
    }
  })
})

describe('导出哨兵：收集规则', () => {
  it('字典词汇被排除，人名与自由文本被收进来（这正是误拦修复的方向）', () => {
    const records = syntheticRecords([
      { offerStatus: '拒绝offer', referrer: '内推', rejectionReason: '薪酬', recruiter: '合成HR-甲' },
      {
        offerStatus: '拒绝offer',
        referrer: '示例推',
        rejectionReason: '薪酬太低所以去了别家',
        recruiter: '合成HR-乙',
      },
    ])

    const collected = collectSentinels(records)

    expect(collected.values).not.toContain('内推')
    expect(collected.values).not.toContain('薪酬')
    expect(collected.values).toContain('示例推')
    expect(collected.values).toContain('薪酬太低所以去了别家')
    expect(collected.values).toContain('合成HR-甲')
    expect(collected.values).toContain('合成HR-乙')
    // 字段清单仍然如实列出参与了哪些字段
    expect(collected.fieldLabels).toEqual(['候选人姓名', '具体推荐人', '招聘 HR', '拒绝原因原文'])
  })

  it('空值与缺失不进哨兵集合（空字符串不是敏感值）', () => {
    /*
     * 姓名列在合成夹具里默认是空的，因此这里直接覆盖记录上的字段
     * （夹具的输入类型不含 `candidateName`——那是清洗阶段从源列取的值）。
     */
    const [missing, blank] = syntheticRecords([
      { offerStatus: '已入职', referrer: null, rejectionReason: null },
      { offerStatus: '已入职', referrer: '   ', rejectionReason: '' },
    ])
    if (missing === undefined || blank === undefined) {
      throw new Error('夹具应当返回两条记录')
    }

    expect(
      collectSentinels([
        { ...missing, candidateName: null },
        { ...blank, candidateName: '' },
      ]).values,
    ).toEqual([])
  })

  it('每个字段的上限仍然生效（几万行数据不会把导出前的检查拖垮）', () => {
    const rows = Array.from({ length: SENTINEL_LIMIT_PER_FIELD + 25 }, (_item, index) => ({
      offerStatus: '已入职' as const,
      // 全部是具体人名（不是字典词汇），因此都会被收，直到触到上限
      recruiter: `合成HR-${String(index)}`,
    }))

    const collected = collectSentinels(syntheticRecords(rows))

    expect(collected.values.length).toBe(SENTINEL_LIMIT_PER_FIELD)
    expect(collected.sampledCount).toBe(SENTINEL_LIMIT_PER_FIELD)
  })
})
