/**
 * 清洗默认设置（docs/PRD.md 5.2 / 5.3 / 5.4）单测。
 *
 * 默认值只提供**最保守的起点**，但「保守」不等于「什么都不给」：
 * 薪资口径自用户反馈 ①（2026-09-27）起默认「人民币元/月」，理由与边界见
 * `docs/DECISIONS.md` D-095（只给币种与周期取值，不做任何换算；换成别的口径随时可改）。
 */

import { describe, expect, it } from 'vitest'

import { buildSalarySetting } from '../domain'
import {
  CLEANING_SETTING_HELP,
  DEFAULT_CYCLE_TOO_LONG_DAYS,
  cleaningSettingsKey,
  createDefaultCleaningSettings,
  defaultDataAsOf,
} from './settings'

const DEFAULTS = createDefaultCleaningSettings({ dataAsOf: '2026-05-08' })

describe('清洗默认设置', () => {
  it('薪资默认「人民币元/月」：给币种与计薪周期取值，但不做任何换算（用户反馈 ①）', () => {
    expect(DEFAULTS.salary).toEqual({
      option: '人民币元/月',
      currency: 'CNY',
      salaryUnit: '元/月',
      comparable: true,
      // 默认值**不是**用户确认的结果：确认时间保持 null，界面文案据此说明「还没手动改过」
      confirmedAt: null,
    })
  })

  it('默认不再禁用待遇对比；用户仍可显式改回「暂不确定」', () => {
    expect(DEFAULTS.salary.comparable).toBe(true)
    expect(buildSalarySetting('暂不确定')).toEqual({
      option: '暂不确定',
      currency: null,
      salaryUnit: null,
      comparable: false,
      confirmedAt: null,
    })
  })

  it('日月顺序默认未确认（歧义日期不转换，只提示）', () => {
    expect(DEFAULTS.ambiguousDateOrder).toBeNull()
  })

  it('去重默认未确认，策略为每组保留首条', () => {
    expect(DEFAULTS.dedupStrategy).toBe('确认后每组保留首条')
    expect(DEFAULTS.dedupConfirmed).toBe(false)
  })

  it('隐藏行默认包含、表头回声行默认保留（不默默排除、不自动删除）', () => {
    expect(DEFAULTS.includeHiddenRows).toBe(true)
    expect(DEFAULTS.dropHeaderEchoRows).toBe(false)
  })

  it('GPT 名单默认原值优先，且名单未被声明为完整', () => {
    expect(DEFAULTS.gptListMode).toBe('raw-first')
    expect(DEFAULTS.gptListComplete).toBe(false)
    expect(DEFAULTS.gptList).toEqual([])
    expect(DEFAULTS.schoolAliases).toEqual([])
  })

  it('导入方式默认新建快照，可显式改为追加', () => {
    expect(DEFAULTS.importMode).toBe('新建快照')
    expect(
      createDefaultCleaningSettings({ dataAsOf: '2026-05-08', importMode: '追加' }).importMode,
    ).toBe('追加')
  })

  it('周期超长阈值默认 180 天（只提示，不截尾）', () => {
    expect(DEFAULT_CYCLE_TOO_LONG_DAYS).toBe(180)
    expect(DEFAULTS.cycleTooLongDays).toBe(DEFAULT_CYCLE_TOO_LONG_DAYS)
  })

  it('分析截止日按本地日历取，不受时区换算影响', () => {
    expect(defaultDataAsOf(new Date(2026, 4, 8, 23, 30))).toBe('2026-05-08')
    expect(defaultDataAsOf(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
    expect(defaultDataAsOf(new Date(2026, 11, 31, 12, 0))).toBe('2026-12-31')
    expect(defaultDataAsOf(new Date(2026, 8, 9, 0, 0))).toBe('2026-09-09')
  })

  it('设置指纹确定，且对任一设置变化敏感（用于判断是否需要整体重算）', () => {
    const key = cleaningSettingsKey(DEFAULTS)
    expect(cleaningSettingsKey(createDefaultCleaningSettings({ dataAsOf: '2026-05-08' }))).toBe(key)
    expect(cleaningSettingsKey({ ...DEFAULTS, dedupConfirmed: true })).not.toBe(key)
    expect(cleaningSettingsKey({ ...DEFAULTS, includeHiddenRows: false })).not.toBe(key)
    expect(cleaningSettingsKey({ ...DEFAULTS, dataAsOf: '2026-05-09' })).not.toBe(key)
    expect(cleaningSettingsKey({ ...DEFAULTS, gptList: ['某大学'] })).not.toBe(key)
    expect(
      cleaningSettingsKey({
        ...DEFAULTS,
        // 默认已经是「人民币元/月」，因此这里改成**另一个**口径才能证明指纹对薪资敏感
        salary: { ...DEFAULTS.salary, option: '人民币元/天', currency: 'CNY', salaryUnit: '元/天' },
      }),
    ).not.toBe(key)
    expect(
      cleaningSettingsKey({
        ...DEFAULTS,
        salary: { ...DEFAULTS.salary, option: '暂不确定', currency: null, salaryUnit: null, comparable: false },
      }),
    ).not.toBe(key)
  })

  it('每个设置项都有口径说明：键必须真实存在，避免界面文案与规则脱节', () => {
    const settingKeys = new Set(Object.keys(DEFAULTS))
    const helpKeys = Object.keys(CLEANING_SETTING_HELP)
    expect(helpKeys.length).toBeGreaterThan(0)
    for (const key of helpKeys) {
      expect(settingKeys.has(key)).toBe(true)
    }
  })
})
