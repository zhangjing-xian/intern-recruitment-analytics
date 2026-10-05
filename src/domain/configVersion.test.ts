/**
 * 规则配置版本单测（步骤12，docs/PRD.md 4.2 / 10.5）。
 *
 * 钉住步骤12 的两条验收标准：
 * 1.「变更名单 / 规则先展示影响并生成新版本」——所以配置变了摘要必须变，并列出变更项；
 * 2.「旧报告不变」——摘要只由**当时那份配置**决定，与后来怎么改无关（本模块是纯函数，
 *   旧数据集保存的是它自己被创建时算出的摘要，不可能被后续修改追溯影响）。
 */

import { describe, expect, it } from 'vitest'

import type { CleaningSettings } from './types'

import {
  CONFIG_REVISION_FIELDS,
  buildConfigRevision,
  configRevisionLabel,
  describeConfigChanges,
  stableDigest,
} from './configVersion'

/** 一份基准配置；用工厂函数避免测试之间互相污染 */
function settings(overrides: Partial<CleaningSettings> = {}): CleaningSettings {
  return {
    dataAsOf: '2026-09-26',
    salary: { option: '人民币元/月', currency: 'CNY', salaryUnit: '元/月', comparable: true, confirmedAt: null },
    ambiguousDateOrder: 'day-first',
    dedupStrategy: '确认后每组保留首条',
    dedupConfirmed: false,
    importMode: '新建快照',
    includeHiddenRows: true,
    dropHeaderEchoRows: false,
    gptListMode: 'raw-first',
    gptListComplete: false,
    gptList: ['合成大学', '示例理工大学'],
    schoolAliases: [],
    cycleTooLongDays: 180,
    // 用户需求 ②（2026-09-27）：默认关闭；它影响结果，因此必须参与配置摘要
    channelFromReferrer: false,
    // 用户需求 ①（2026-09-27）：默认没有人工修正
    manualCorrections: [],
    manualCorrectionsSheetSignature: null,
    ...overrides,
  }
}

describe('stableDigest', () => {
  it('同一输入给同一摘要，不同输入给不同摘要', () => {
    expect(stableDigest('abc')).toBe(stableDigest('abc'))
    expect(stableDigest('abc')).not.toBe(stableDigest('abd'))
  })

  it('固定 8 位大写十六进制', () => {
    for (const text of ['', 'a', '合成大学', 'x'.repeat(500)]) {
      expect(stableDigest(text)).toMatch(/^[0-9A-F]{8}$/)
    }
  })
})

describe('buildConfigRevision：同配置同版本，改配置换版本', () => {
  it('同一份配置反复计算结果一致', () => {
    expect(buildConfigRevision(settings())).toBe(buildConfigRevision(settings()))
  })

  it('改动名单会换版本（步骤12：变更规则必须生成新版本）', () => {
    const before = buildConfigRevision(settings())
    const after = buildConfigRevision(settings({ gptList: ['合成大学', '示例理工大学', '新学校'] }))
    expect(after).not.toBe(before)
  })

  it('改动别名表 / 去重策略 / 名单模式 / 名单完整性 / 隐藏行 / 回声行都会换版本', () => {
    const base = buildConfigRevision(settings())
    const variants: readonly Partial<CleaningSettings>[] = [
      { schoolAliases: [{ alias: '合成大', canonical: '合成大学' }] },
      { dedupStrategy: '保留全部' },
      { gptListMode: 'list-mode' },
      { gptListComplete: true },
      { includeHiddenRows: false },
      { dropHeaderEchoRows: true },
    ]
    for (const variant of variants) {
      expect(buildConfigRevision(settings(variant)), JSON.stringify(variant)).not.toBe(base)
    }
  })

  it('名单的录入顺序与重复不影响版本（同一集合 = 同一版本）', () => {
    const ordered = buildConfigRevision(settings({ gptList: ['甲大学', '乙大学'] }))
    const reordered = buildConfigRevision(settings({ gptList: ['乙大学', '甲大学'] }))
    const withDuplicate = buildConfigRevision(settings({ gptList: ['甲大学', '乙大学', '甲大学'] }))
    const withWhitespace = buildConfigRevision(settings({ gptList: [' 甲大学 ', '乙大学'] }))
    expect(reordered).toBe(ordered)
    expect(withDuplicate).toBe(ordered)
    expect(withWhitespace).toBe(ordered)
  })

  it('不含结果的配置不参与摘要（改截止日 / 薪资口径不换版本）', () => {
    const base = buildConfigRevision(settings())
    // 截止日只影响「截至日」展示与计划周期，不改变清洗出的记录集合
    expect(buildConfigRevision(settings({ dataAsOf: '2026-10-01' }))).toBe(base)
    // 薪资口径影响基准与低薪标签的可用性，但不改变名单匹配结果；它单独记录在 salary 字段里
    expect(
      buildConfigRevision(
        settings({
          salary: { option: '人民币元/天', currency: 'CNY', salaryUnit: '元/天', comparable: false, confirmedAt: null },
        }),
      ),
    ).toBe(base)
    // 未确认列表完整性与周期阈值同理
    expect(buildConfigRevision(settings({ cycleTooLongDays: 90 }))).toBe(base)
  })

  it('摘要字段清单本身是稳定的（新增字段必须显式加入，不靠默认）', () => {
    expect([...CONFIG_REVISION_FIELDS]).toEqual([
      'gptListMode',
      'gptListComplete',
      'gptList',
      'schoolAliases',
      'dedupStrategy',
      'includeHiddenRows',
      'dropHeaderEchoRows',
      // 用户需求 ②：渠道补内推会改渠道取值，因此必须参与摘要（否则渠道分布变化无法解释）
      'channelFromReferrer',
      // 用户需求 ①：人工修正改的是清洗结果本身，必须参与摘要
      'manualCorrections',
    ])
  })

  it('渠道补内推开关变化会换摘要（它改的是渠道取值，不是展示项）', () => {
    const off = buildConfigRevision(settings({ channelFromReferrer: false }))
    const on = buildConfigRevision(settings({ channelFromReferrer: true }))
    expect(on).not.toBe(off)
    expect(buildConfigRevision(settings({ channelFromReferrer: true }))).toBe(on)
    expect(describeConfigChanges(
      settings({ channelFromReferrer: false }),
      settings({ channelFromReferrer: true }),
    )).toEqual([
      {
        field: 'channelFromReferrer',
        label: '渠道缺失时是否按推荐人补成内推',
        before: '未开启（渠道缺失保持未知）',
        after: '已开启（渠道缺失时补成内推）',
        affectsResult: true,
      },
    ])
  })

  it('别名按「别名=>标准名」排序，录入顺序不同不换版本', () => {
    const a = buildConfigRevision(
      settings({
        schoolAliases: [
          { alias: '甲', canonical: '甲大学' },
          { alias: '乙', canonical: '乙大学' },
        ],
      }),
    )
    const b = buildConfigRevision(
      settings({
        schoolAliases: [
          { alias: '乙', canonical: '乙大学' },
          { alias: '甲', canonical: '甲大学' },
        ],
      }),
    )
    expect(a).toBe(b)
  })
})

describe('describeConfigChanges：只报真正变化的项', () => {
  it('配置没变时返回空数组（界面据此说明「版本不变」）', () => {
    expect(describeConfigChanges(settings(), settings())).toEqual([])
    // 名单顺序变化不算变更
    expect(
      describeConfigChanges(
        settings({ gptList: ['甲大学', '乙大学'] }),
        settings({ gptList: ['乙大学', '甲大学'] }),
      ),
    ).toEqual([])
  })

  it('列出变化的字段与前后取值', () => {
    const changes = describeConfigChanges(settings(), settings({ gptListMode: 'list-mode' }))
    expect(changes.length).toBe(1)
    expect(changes[0].field).toBe('gptListMode')
    expect(changes[0].before).toBe('raw-first')
    expect(changes[0].after).toBe('list-mode')
    expect(changes[0].affectsResult).toBe(true)
  })

  it('名单变化只报**数量**，不回显具体学校名', () => {
    const changes = describeConfigChanges(
      settings({ gptList: [] }),
      settings({ gptList: ['秘密合成大学', '绝密示例学院'] }),
    )
    expect(changes.length).toBe(1)
    expect(changes[0].field).toBe('gptList')
    expect(changes[0].after).toBe('2 所')
    const serialized = JSON.stringify(changes)
    expect(serialized).not.toContain('秘密合成大学')
    expect(serialized).not.toContain('绝密示例学院')
  })

  it('多处同时变化时全部列出', () => {
    const changes = describeConfigChanges(
      settings(),
      settings({ gptListComplete: true, dropHeaderEchoRows: true, dedupStrategy: '保留全部' }),
    )
    expect(changes.map((change) => change.field).sort()).toEqual([
      'dedupStrategy',
      'dropHeaderEchoRows',
      'gptListComplete',
    ])
  })

  it('非摘要字段变化不产生任何变更项（避免噪声）', () => {
    expect(describeConfigChanges(settings(), settings({ dataAsOf: '2026-12-31' }))).toEqual([])
  })
})

describe('configRevisionLabel', () => {
  it('把语义基线与配置摘要拼成可读形式', () => {
    expect(configRevisionLabel('1.0.0', '3F2A19C4')).toBe('1.0.0+3F2A19C4')
  })
})
