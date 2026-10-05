/**
 * AI-6 渲染冒烟与文案纪律（设置页的 AI 面板）。
 *
 * 为什么用 `react-dom/server`：与项目内其余组件测试同一套理由——
 * 组件测试依赖（Testing Library + jsdom）属于步骤14，但「这一页到底写了什么」必须被验证。
 * `renderToStaticMarkup` 只跑**渲染**、不跑 effect，因此既不会读加密仓，也不可能发请求。
 *
 * 三个重点：
 * 1. **初始关闭**（AI-6 验收项第一条）：不读偏好时界面上写的是「已关闭（默认）」；
 * 2. **每个动作都在场且互不代替**：清空 AI 历史、删除 Key、清空整个本地仓各自出现，
 *    并且都要求逐字确认短语（短语互不相同）；
 * 3. **文案纪律**：AI 设置的全部导出字符串（含三个新面板引用的常量）都没有 Markdown
 *    强调标记——星号会被原样渲染，这是本项目反复踩过的坑。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import * as aiProxy from '../../ai/aiProxy'
import * as subjectRules from '../../ai/subjectRules'
import AiSettingsPanel, { type AiLocalRuleInput } from './AiSettingsPanel'
import * as settingsText from './aiSettingsText'
import { CLEAR_AI_HISTORY_PHRASE, CLEAR_OBJECTS_PHRASE, CLEAR_VAULT_PHRASE, DELETE_SECRET_PHRASE } from './vaultText'

const LOCAL_RULES: AiLocalRuleInput = {
  ruleVersion: '1.0.0+3F2A19C4',
  gptListCount: 12,
  gptListMode: 'list-mode',
  gptListComplete: true,
  schoolAliasCount: 2,
}

function renderPanel(localRules: AiLocalRuleInput = LOCAL_RULES): string {
  return renderToStaticMarkup(<AiSettingsPanel localRules={localRules} vaultUnlocked={false} />)
}

/** 递归收集一个模块里导出的全部字符串（含对象 / 数组里的），供文案纪律断言遍历 */
function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value)
    return into
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, into)
    }
    return into
  }
  if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectStrings(item, into)
    }
  }
  return into
}

describe('AI-6：设置页 AI 面板的渲染冒烟', () => {
  it('初始状态是「已关闭（默认）」，并写明打开不是永久授权、关闭不删东西', () => {
    const html = renderPanel()

    expect(html).toContain(settingsText.AI_SETTINGS_TITLE)
    expect(html).toContain('已关闭（默认）')
    expect(html).toContain(settingsText.AI_ENABLED_NOTE)
    expect(html).toContain(settingsText.AI_DISABLED_KEEPS_NOTE)
    // 开关不是永久授权、关闭不删 Key 与历史：两句都必须在场
    expect(settingsText.AI_ENABLED_NOTE).toContain('不是')
    expect(settingsText.AI_DISABLED_KEEPS_NOTE).toContain('不会删除 AI 历史')
  })

  it('三级脱敏、目的地、费用、代理边界、删除动作都在页面上', () => {
    const html = renderPanel()

    expect(html).toContain(settingsText.AI_PRIVACY_SECTION_TITLE)
    expect(html).toContain('严格（strict）')
    expect(html).toContain('标准（standard，默认）')
    expect(html).toContain('自定义（custom）')
    expect(html).toContain(settingsText.AI_DESTINATION_TITLE)
    expect(html).toContain('https://api.deepseek.com/chat/completions')
    expect(html).toContain(settingsText.AI_COST_TITLE)
    expect(html).toContain(settingsText.AI_PROXY_TITLE)
    for (const item of aiProxy.AI_PROXY_BOUNDARY_ITEMS) {
      expect(html).toContain(item)
    }
    expect(html).toContain(settingsText.AI_RETENTION_TITLE)
    expect(html).toContain(settingsText.AI_RETENTION_HISTORY_LABEL)
  })

  it('本地规则未确认时如实显示「未确认」，并把三类规则与「永远不会发出」摆出来', () => {
    const html = renderPanel()

    expect(html).toContain(settingsText.AI_SUBJECT_TITLE)
    expect(html).toContain(settingsText.AI_SUBJECT_UNCONFIRMED_NOTE)
    for (const rule of subjectRules.buildAiSubjectRules({
      ...LOCAL_RULES,
      positionCategories: [],
    })) {
      expect(html).toContain(rule.label)
      expect(html).toContain(rule.neverSends[0] ?? '')
    }
    // 姓名 / 原文这类词必须出现在「永远不会发出」里，而不是只写「已脱敏」
    expect(html).toContain('岗位名称原文')
    expect(html).toContain('学校全名')
    expect(html).toContain('逐条拒绝原因的原文')
  })

  it('读不到本地规则时如实说读不到，而不是编造一份空名单', () => {
    const html = renderPanel({
      ruleVersion: null,
      gptListCount: null,
      gptListMode: null,
      gptListComplete: null,
      schoolAliasCount: null,
    })

    expect(html).toContain('读不到当前生效的本地名单')
  })

  it('三个删除动作的确认短语互不相同（共用短语会让人在同一个框里做两件事）', () => {
    const phrases = [
      CLEAR_OBJECTS_PHRASE,
      DELETE_SECRET_PHRASE,
      CLEAR_VAULT_PHRASE,
      CLEAR_AI_HISTORY_PHRASE,
    ]
    expect(new Set(phrases).size).toBe(phrases.length)
    expect(CLEAR_AI_HISTORY_PHRASE).toBe('清空 AI 历史')
    const html = renderPanel()
    // 清空历史这一节自带短语输入；删 Key 的短语也在场（两者不共用）
    expect(html).toContain(CLEAR_AI_HISTORY_PHRASE)
    expect(html).toContain(DELETE_SECRET_PHRASE)
  })

  it('未解锁时清空历史按钮是禁用的（临时模式下没有历史可删，且如实说明原因）', () => {
    const html = renderPanel()
    expect(html).toContain(settingsText.AI_RETENTION_LOCKED_NOTE)
    expect(html).toContain('disabled')
  })

  it('两个指向别处的说明在场：删 Key 的位置与清全部的位置', () => {
    const html = renderPanel()
    expect(html).toContain(settingsText.AI_RETENTION_KEY_POINTER)
    expect(html).toContain(settingsText.AI_RETENTION_ALL_POINTER)
  })
})

describe('AI-6：AI 设置文案纪律', () => {
  it('设置文案、代理边界与规则视图里都没有 Markdown 强调标记', () => {
    const texts = [
      ...collectStrings(settingsText),
      ...collectStrings(aiProxy),
      ...collectStrings(subjectRules.buildAiSubjectRules({ ...LOCAL_RULES, positionCategories: [] })),
    ]
    expect(texts.length).toBeGreaterThan(50)
    for (const text of texts) {
      expect(text).not.toContain('**')
      expect(text).not.toContain('__')
    }
  })

  it('渲染结果里也没有星号（含拼接进来的引擎文案）', () => {
    const html = renderPanel()
    expect(html).not.toContain('**')
    expect(html).not.toContain('__')
  })

  it('不提供「记住本次同意」这类承诺，也没有把 Key 显示出来的地方', () => {
    const joined = collectStrings(settingsText).join('\n')
    // 反面承诺不许出现（「不会记住同意」是允许的写法，因此查的是肯定式说法）
    expect(joined).not.toContain('会记住本次同意')
    expect(joined).not.toContain('下次自动发送')
    expect(joined).not.toContain('自动重发')
    // 掩码是唯一显示入口：页面里不该出现任何形如真实 Key 的长串（占位符 `sk-…` 不算）
    expect(renderPanel()).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/)
  })

  it('AI-6：设置面板自身没有「清空」能力，删 Key 也必须逐字确认', () => {
    /*
     * 结构性断言，而不是「点一下看看」：
     * - 面板里**没有**清历史 / 清业务数据 / 清空整仓的能力（那些在 `AiRetentionPanel`
     *   与清除范围一节里，各自需要逐字短语），因此「关闭 AI 顺手删历史」写不出来；
     * - 唯一保留的删除动作是「删除本地仓中的 Key」（AI-3 交付的独立动作），
     *   它必须落在带短语确认的那个处理函数里。
     */
    const source = readFileSync(
      join(process.cwd(), 'src', 'features', 'settings', 'AiSettingsPanel.tsx'),
      'utf8',
    )
    for (const forbidden of ['clearAiHistory', 'clearObjects', 'clearAll']) {
      expect(source.includes(forbidden), `设置面板里出现了清空能力：${forbidden}`).toBe(false)
    }
    // 开关只写偏好：这个断言保证「关开关」不会走到任何删除路径
    expect(source).toContain('handleToggleEnabled')
    expect(source).toContain('saveAiSettings')

    // deleteSecret 只允许出现在那个处理函数体内，且该函数使用了短语确认
    const handlerStart = source.indexOf('function handleDeleteFromVault')
    expect(handlerStart).toBeGreaterThan(0)
    const handlerEnd = source.indexOf('\n  function ', handlerStart + 1)
    const handler = source.slice(handlerStart, handlerEnd === -1 ? undefined : handlerEnd)
    expect(handler).toContain('deleteSecret')
    expect(source.split('deleteSecret').length - 1).toBe(1)
    expect(source).toContain('canDeleteFromVault')
    expect(source).toContain('isPhraseConfirmed(deletePhrase, DELETE_SECRET_PHRASE)')
  })

  it('岗位类别映射的文本解析与格式化可逆，非法行被如实列出', () => {
    expect(settingsText.parsePositionCategoryLines('前端开发=研发\n算法=算法\n')).toEqual({
      rules: [
        { keyword: '前端开发', category: '研发' },
        { keyword: '算法', category: '算法' },
      ],
      invalidLines: [],
    })

    const broken = settingsText.parsePositionCategoryLines('没有等号的一行\n后端=超长超长超长超长超长的类别\n前端=研发\n前端=研发2')
    expect(broken.rules).toEqual([{ keyword: '前端', category: '研发' }])
    expect(broken.invalidLines).toContain('没有等号的一行')
    expect(broken.invalidLines.length).toBe(3)

    expect(
      settingsText.formatPositionCategoryLines([
        { keyword: '前端', category: '研发' },
        { keyword: '算法', category: '算法' },
      ]),
    ).toBe('前端=研发\n算法=算法')
  })
})
