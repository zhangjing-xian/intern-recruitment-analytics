/**
 * 「渠道缺失时按推荐人补成内推」的单测（用户需求 ②，2026-09-27）。
 *
 * 口径由用户在问答中确认，写进 `docs/PRD.md` 5.2 与 `docs/DECISIONS.md` D-092：
 *
 * 1. **默认关闭**：AGENTS §6 明文禁止「自动把 `-` 渠道判为内推」，因此不勾选时行为必须与从前
 *    **逐字节一致**（渠道保持未知、没有任何新增标记）；
 * 2. **只补缺失**：渠道是空 / `-` 且推荐人是「内推」才补成内推，来源标为推断；
 * 3. **绝不覆盖已有值**：渠道已经写着 Boss / 其他 / 显式「未知」时保持不动，只标一条
 *    「渠道与推荐人不一致，请核对」；
 * 4. **可撤销**：关掉开关重新清洗，渠道与整套标记必须完全回到未开启时的样子。
 *
 * 本文件不碰指标引擎，也不断言任何率——它只验证「渠道这一个取值 + 留痕」。
 */

import { describe, expect, it } from 'vitest'

import type { DataQualityIssueCode } from '../domain'
import { cleanFixture } from './testFixtures'

/** 一行最小可用数据：只关心渠道与推荐人，其余给能过清洗的最小值 */
function rowWith(input: { readonly channel?: string | null; readonly referrer?: string | null }) {
  return {
    offerStatus: '已入职',
    requirementId: 'REQ-9001',
    recruitmentStartDate: '2026-01-01',
    joiningDate: '2026-01-15',
    salaryAmount: 4000,
    channel: input.channel === undefined ? null : input.channel,
    referrer: input.referrer === undefined ? null : input.referrer,
  }
}

function codesOf(dataset: ReturnType<typeof cleanFixture>['dataset']): readonly DataQualityIssueCode[] {
  const record = dataset.records[0]
  return record?.derived?.dataQualityFlags ?? []
}

function channelOf(dataset: ReturnType<typeof cleanFixture>['dataset']): string {
  return String(dataset.records[0]?.channel)
}

describe('渠道补内推：默认关闭时行为不变', () => {
  it('渠道为 `-` 且推荐人是内推，但开关关闭 → 渠道保持未知，且没有任何推断标记', () => {
    const { dataset } = cleanFixture({
      rows: [rowWith({ channel: '-', referrer: '内推' })],
      settings: { channelFromReferrer: false },
    })
    expect(channelOf(dataset)).toBe('未知')
    expect(codesOf(dataset)).not.toContain('CHANNEL_INFERRED_FROM_REFERRER')
    // 也不该冒出「不一致」提示：关闭时这条规则整个不参与
    expect(codesOf(dataset)).not.toContain('CHANNEL_REFERRER_CONFLICT')
  })
})

describe('渠道补内推：开启后只补缺失', () => {
  it('渠道为 `-` → 补成内推，来源标为推断，并留一条可撤销的日志', () => {
    const { dataset } = cleanFixture({
      rows: [rowWith({ channel: '-', referrer: '内推' })],
      settings: { channelFromReferrer: true },
    })
    expect(channelOf(dataset)).toBe('内推')
    expect(codesOf(dataset)).toContain('CHANNEL_INFERRED_FROM_REFERRER')

    const record = dataset.records[0]
    const channelLogs = (record?.normalizationLog ?? []).filter((entry) => entry.field === 'channel')
    // 两条：先记录「缺失」，再记录「按推荐人推断」
    expect(channelLogs).toHaveLength(2)
    const inferred = channelLogs.find((entry) => entry.rule === 'channel.inferredFromReferrer')
    expect(inferred, '必须留下推断这条日志').toBeDefined()
    expect(inferred?.source).toBe('derived')
    expect(inferred?.inferred).toBe(true)
    // 未确认：推断值不是用户确认过的结论
    expect(inferred?.confirmed).toBe(false)
    expect(inferred?.normalizedValue).toBe('内推')
    // 原值仍在第一条日志里（这里是 `-`；真正空白时是 null）→ 关掉开关就能还原
    const missing = channelLogs.find((entry) => entry.rule === 'channel.missing')
    expect(missing, '原「缺失」这条日志必须保留').toBeDefined()
    expect(missing?.rawValue).toBe('-')
  })

  it('渠道为空（null）同样补成内推', () => {
    const { dataset } = cleanFixture({
      rows: [rowWith({ channel: null, referrer: '内推' })],
      settings: { channelFromReferrer: true },
    })
    expect(channelOf(dataset)).toBe('内推')
  })

  it('推荐人不是「内推」时不补：渠道保持未知', () => {
    for (const referrer of ['张样例推', '样例推荐人', 'HR推', null]) {
      const { dataset } = cleanFixture({
        rows: [rowWith({ channel: '-', referrer })],
        settings: { channelFromReferrer: true },
      })
      expect(channelOf(dataset), `推荐人=${String(referrer)} 不该补`).toBe('未知')
      expect(codesOf(dataset)).not.toContain('CHANNEL_INFERRED_FROM_REFERRER')
    }
  })
})

describe('渠道补内推：绝不覆盖已有渠道值', () => {
  it('渠道已写 Boss → 保持 Boss，改为提示两列不一致', () => {
    const { dataset } = cleanFixture({
      rows: [rowWith({ channel: 'Boss', referrer: '内推' })],
      settings: { channelFromReferrer: true },
    })
    expect(channelOf(dataset)).toBe('Boss')
    expect(codesOf(dataset)).toContain('CHANNEL_REFERRER_CONFLICT')
    expect(codesOf(dataset)).not.toContain('CHANNEL_INFERRED_FROM_REFERRER')
  })

  it('渠道写的是「其他」这类未识别值 → 也不覆盖，只提示', () => {
    const { dataset } = cleanFixture({
      rows: [rowWith({ channel: '某内推群', referrer: '内推' })],
      settings: { channelFromReferrer: true },
    })
    expect(channelOf(dataset)).toBe('其他')
    expect(codesOf(dataset)).toContain('CHANNEL_REFERRER_CONFLICT')
  })

  it('渠道显式写着「未知」→ 视为已有具体值，不覆盖（只提示不一致）', () => {
    const { dataset } = cleanFixture({
      rows: [rowWith({ channel: '未知', referrer: '内推' })],
      settings: { channelFromReferrer: true },
    })
    expect(channelOf(dataset)).toBe('未知')
    expect(codesOf(dataset)).toContain('CHANNEL_REFERRER_CONFLICT')
  })

  it('渠道本来就是「内推」→ 两列一致，不加任何提示', () => {
    const { dataset } = cleanFixture({
      rows: [rowWith({ channel: '内推', referrer: '内推' })],
      settings: { channelFromReferrer: true },
    })
    expect(channelOf(dataset)).toBe('内推')
    expect(codesOf(dataset)).not.toContain('CHANNEL_REFERRER_CONFLICT')
    expect(codesOf(dataset)).not.toContain('CHANNEL_INFERRED_FROM_REFERRER')
  })
})

describe('渠道补内推：可撤销', () => {
  it('同一份数据开 → 关，渠道与配置摘要都回到未开启时的样子', () => {
    const rows = [rowWith({ channel: '-', referrer: '内推' })]
    const off = cleanFixture({ rows, settings: { channelFromReferrer: false } })
    const on = cleanFixture({ rows, settings: { channelFromReferrer: true } })
    const offAgain = cleanFixture({ rows, settings: { channelFromReferrer: false } })

    expect(channelOf(on.dataset)).toBe('内推')
    expect(channelOf(off.dataset)).toBe('未知')
    expect(channelOf(offAgain.dataset)).toBe('未知')
    // 关回去之后，配置摘要与「从未开启」完全一致（它进 CONFIG_REVISION_FIELDS）
    expect(offAgain.dataset.metadata.ruleVersion.configRevision).toBe(
      off.dataset.metadata.ruleVersion.configRevision,
    )
    // 开着时摘要必须不同，否则「同一份数据两次分析渠道不同」无法解释
    expect(on.dataset.metadata.ruleVersion.configRevision).not.toBe(
      off.dataset.metadata.ruleVersion.configRevision,
    )
    // 记录本身也回到原样（逐字段比对渠道，避免「只是摘要一致」的假象）
    expect(offAgain.dataset.records[0]?.channel).toBe(off.dataset.records[0]?.channel)
    expect(codesOf(offAgain.dataset)).toEqual(codesOf(off.dataset))
  })
})
