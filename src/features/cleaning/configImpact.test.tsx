/**
 * 规则配置版本与变更影响预览的测试（步骤12，docs/PRD.md 4.2 / 10.5）。
 *
 * 核心要求（本步的验收点）：**改了 GPT 名单就必须在提交前看到变更清单**，
 * 并且必须看到「旧报告不会改变」这句话。
 *
 * 两条纪律：
 * 1. 期望值来自引擎（`buildConfigRevision` / `describeConfigChanges`），不写死摘要字符串——
 *    写死等于把测试绑在某一次哈希实现上，改摘要算法（比如从 FNV 换成 SHA）时测试会假失败；
 * 2. 用 `renderToStaticMarkup` 渲染（无 jsdom），断言的是「用户真的能看到」，
 *    而不是「我们调用过某个函数」。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  RULES_VERSION,
  buildConfigRevision,
  configRevisionLabel,
  describeConfigChanges,
  type CleaningSettings,
} from '../../domain'
import { createDefaultCleaningSettings } from '../../cleaning'
import CleaningSettingsPanel from './CleaningSettingsPanel'
import ConfigImpactPreview from './ConfigImpactPreview'
import {
  CONFIG_CHANGE_HEADING,
  CONFIG_CHANGE_NEW_VERSION_NOTICE,
  CONFIG_COMMITTED_VERSION_LABEL,
  CONFIG_OLD_REPORTS_NOTICE,
  CONFIG_UNCHANGED_NOTICE,
  CONFIG_VERSION_LABEL,
  CONFIG_VERSION_STALE_NOTICE,
  NO_COMMITTED_DATASET_NOTE,
  currentConfigVersion,
  formatChange,
} from './configImpact'

/** 合成设置：只改会进摘要的字段（GPT 名单），其余沿用最保守默认值 */
function settingsWithGptList(gptList: readonly string[]): CleaningSettings {
  return {
    ...createDefaultCleaningSettings({ dataAsOf: '2026-01-31' }),
    gptListMode: 'list-mode',
    gptListComplete: false,
    gptList: [...gptList],
  }
}

const BEFORE = settingsWithGptList(['上海交通大学'])
const AFTER = settingsWithGptList(['上海交通大学', '复旦大学', '浙江大学'])

describe('currentConfigVersion', () => {
  it('版本号来自引擎：语义基线 + 配置摘要，且同配置得到同版本', () => {
    const version = currentConfigVersion(AFTER)
    const revision = buildConfigRevision(AFTER)

    expect(version.revision).toBe(revision)
    expect(version.label).toBe(configRevisionLabel(RULES_VERSION, revision))
    expect(version.label).toContain(RULES_VERSION)

    // 同一份配置的**不同对象**必须得到同一版本（否则「同配置同结果」无法核对）
    const clone: CleaningSettings = { ...AFTER, gptList: [...AFTER.gptList] }
    expect(currentConfigVersion(clone).revision).toBe(revision)

    // 名单不同 → 版本不同
    expect(currentConfigVersion(BEFORE).revision).not.toBe(revision)
  })

  it('名单的录入顺序不影响版本（那只是录入差异，不是规则变化）', () => {
    const ordered = settingsWithGptList(['复旦大学', '浙江大学'])
    const reversed = settingsWithGptList(['浙江大学', '复旦大学'])

    expect(currentConfigVersion(ordered).revision).toBe(currentConfigVersion(reversed).revision)
  })

  it('只改截止日不换版本（截止日是展示口径，不进配置摘要）', () => {
    const other: CleaningSettings = { ...AFTER, dataAsOf: '2026-02-28' }

    expect(currentConfigVersion(other).revision).toBe(currentConfigVersion(AFTER).revision)
  })
})

describe('formatChange', () => {
  it('按引擎给的标签与前后值拼成一行，数量变化可见', () => {
    const changes = describeConfigChanges(BEFORE, AFTER)
    const gptChange = changes.find((change) => change.field === 'gptList')

    expect(gptChange).toBeDefined()
    if (gptChange === undefined) {
      return
    }
    const line = formatChange(gptChange)
    expect(line).toContain(gptChange.label)
    expect(line).toContain(gptChange.before)
    expect(line).toContain(gptChange.after)
    expect(line).toContain('→')
    // 名单变化只报数量，不回显具体学校名（描述会被写进数据集元信息与报告）
    expect(line).not.toContain('复旦大学')
  })
})

describe('ConfigImpactPreview 渲染', () => {
  it('没有已提交数据集时只说「还没有已提交的数据集」，不显示变更清单', () => {
    const html = renderToStaticMarkup(
      <ConfigImpactPreview committedSettings={null} settings={AFTER} />,
    )

    expect(html).toContain(CONFIG_VERSION_LABEL)
    expect(html).toContain(currentConfigVersion(AFTER).label)
    expect(html).toContain(NO_COMMITTED_DATASET_NOTE)
    expect(html).not.toContain(CONFIG_CHANGE_HEADING)
    expect(html).not.toContain(CONFIG_OLD_REPORTS_NOTICE)
  })

  it('配置一致时说明提交不会产生新版本', () => {
    const html = renderToStaticMarkup(
      <ConfigImpactPreview committedSettings={AFTER} settings={AFTER} />,
    )

    expect(html).toContain(CONFIG_UNCHANGED_NOTICE)
    expect(html).not.toContain(CONFIG_CHANGE_HEADING)
    expect(html).not.toContain(CONFIG_VERSION_STALE_NOTICE)
  })

  it('改了 GPT 名单 → 出现变更清单 + 新版本说明 + 「旧报告不会改变」', () => {
    const html = renderToStaticMarkup(
      <ConfigImpactPreview committedSettings={BEFORE} settings={AFTER} />,
    )

    expect(html).toContain(CONFIG_CHANGE_HEADING)
    expect(html).toContain(CONFIG_VERSION_STALE_NOTICE)
    // 两份摘要并排显示：只写「不同」看不出换的是哪一份配置
    expect(html).toContain(CONFIG_COMMITTED_VERSION_LABEL)
    expect(html).toContain(currentConfigVersion(BEFORE).label)
    // 变更清单来自引擎：逐字段的标签必须真的渲染出来，而不是只渲染了一句「配置已变更」
    for (const change of describeConfigChanges(BEFORE, AFTER)) {
      expect(html).toContain(`${change.label}：${change.before} → ${change.after}`)
    }
    expect(html).toContain(CONFIG_CHANGE_NEW_VERSION_NOTICE)
    expect(html).toContain(CONFIG_OLD_REPORTS_NOTICE)
    expect(html).toContain('旧报告不会改变')
    expect(html).toContain('当时那份配置摘要')
    // 草稿版本号必须显示的是**新**摘要
    expect(html).toContain(currentConfigVersion(AFTER).label)
  })

  it('删除名单里的学校同样被识别为变更（不是只对「新增」敏感）', () => {
    const html = renderToStaticMarkup(
      <ConfigImpactPreview committedSettings={AFTER} settings={BEFORE} />,
    )

    expect(html).toContain(CONFIG_CHANGE_HEADING)
    for (const change of describeConfigChanges(AFTER, BEFORE)) {
      expect(html).toContain(formatChange(change))
    }
    expect(html).toContain(CONFIG_OLD_REPORTS_NOTICE)
  })
})

describe('CleaningSettingsPanel 上的版本与影响', () => {
  it('未提交数据集时也显示规则配置版本，且提示后续会出现影响预览', () => {
    const html = renderToStaticMarkup(
      <CleaningSettingsPanel onChange={() => {}} onReset={() => {}} settings={AFTER} />,
    )

    expect(html).toContain('清洗口径确认')
    expect(html).toContain(CONFIG_VERSION_LABEL)
    expect(html).toContain(currentConfigVersion(AFTER).label)
    expect(html).toContain(NO_COMMITTED_DATASET_NOTE)
  })

  it('传入已提交设置后，改名单就在设置面板里出现影响预览与「旧报告不变」', () => {
    const html = renderToStaticMarkup(
      <CleaningSettingsPanel
        committedSettings={BEFORE}
        onChange={() => {}}
        onReset={() => {}}
        settings={AFTER}
      />,
    )

    expect(html).toContain(CONFIG_CHANGE_HEADING)
    expect(html).toContain(CONFIG_OLD_REPORTS_NOTICE)
    expect(html).toContain(currentConfigVersion(AFTER).label)
    expect(html).toContain(currentConfigVersion(BEFORE).label)
  })
})
