/**
 * AI-3 单测：AI 偏好的持久化（`src/ai/aiSettings.ts`）。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-3 的这几条：
 * - 「默认不进备份 / 报告」→ 偏好只存非敏感项，Key 不在其中（结构性断言）；
 * - 「AI 默认关闭」→ 默认设置里 `enabled === false`；
 * - 「读回的数据要严格校验」→ 形状不符 / 版本不符一律回落默认值，不硬转。
 *
 * 这里**不**碰真实 IndexedDB：`saveAiSettings` / `loadAiSettings` 走 `encryptedVault`
 * 懒门面，未建仓时会抛错，本测试正是断言「读失败回落默认值、写失败返回原因」这两条路径。
 * 加密仓本身的行为由 `storage/vault.test.ts` 覆盖（那里有 fake-indexeddb）。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import { AI_DEFAULT_PARAMS } from '../privacy/aiPreview'
import {
  AI_SETTINGS_OBJECT_ID,
  AI_SETTINGS_SCHEMA_VERSION,
  aiDestinationOf,
  clearAiSettingsSessionOverride,
  defaultAiSettings,
  loadAiSettings,
  parseAiSettings,
  removeAiSettings,
  saveAiSettings,
  type AiSettings,
} from './aiSettings'

/** 取出源码里**真正的代码**（丢掉注释与字符串内容）；理由见 `keySession.test.ts` 同名函数 */
function codeOnlyOf(source: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  )
  const parts: string[] = []
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue
    }
    if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail
    ) {
      parts.push('""')
      continue
    }
    parts.push(scanner.getTokenText())
  }
  return parts.join(' ')
}

describe('AI-3：默认偏好是「关闭 + 默认参数」', () => {
  it('默认关闭、Key 只在内存、参数用引擎默认值', () => {
    const settings = defaultAiSettings('2026-09-26T00:00:00.000Z')
    expect(settings.enabled).toBe(false)
    expect(settings.keyStorage).toBe('memory')
    expect(settings.params).toEqual(AI_DEFAULT_PARAMS)
    expect(settings.schemaVersion).toBe(AI_SETTINGS_SCHEMA_VERSION)
    expect(settings.updatedAt).toBe('2026-09-26T00:00:00.000Z')
  })

  it('偏好的键集合里没有任何能装 Key 的位置', () => {
    const keys = Object.keys(defaultAiSettings())
    for (const forbidden of ['apiKey', 'key', 'secret', 'authorization', 'token']) {
      expect(keys).not.toContain(forbidden)
    }
    // 参数子对象同样不能装
    for (const forbidden of ['apiKey', 'key', 'authorization']) {
      expect(Object.keys(defaultAiSettings().params)).not.toContain(forbidden)
    }
  })
})

describe('AI-3：读回内容严格校验，不认识就回落默认', () => {
  it('非对象 / null 一律回落默认值', () => {
    expect(parseAiSettings(null).enabled).toBe(false)
    expect(parseAiSettings('not-an-object').enabled).toBe(false)
    expect(parseAiSettings(42).enabled).toBe(false)
  })

  it('schema 版本不符时回落默认值（不硬猜旧形状）', () => {
    const stale = { ...defaultAiSettings(), schemaVersion: 'ai-settings/0', enabled: true }
    expect(parseAiSettings(stale).enabled).toBe(false)
  })

  it('缺字段 / 类型不对时逐项回落，而不是整份丢掉或产生 undefined', () => {
    const broken = {
      schemaVersion: AI_SETTINGS_SCHEMA_VERSION,
      enabled: 'yes',
      keyStorage: 'somewhere',
      params: { model: 42, thinking: 'maybe', maxTokens: 'many', timeoutMs: null },
      updatedAt: 123,
    }
    const parsed = parseAiSettings(broken)
    expect(parsed.enabled).toBe(false)
    expect(parsed.keyStorage).toBe('memory')
    expect(parsed.params.model).toBe(AI_DEFAULT_PARAMS.model)
    expect(parsed.params.thinking).toBe('auto')
    expect(parsed.params.maxTokens).toBe(AI_DEFAULT_PARAMS.maxTokens)
    expect(parsed.params.timeoutMs).toBe(AI_DEFAULT_PARAMS.timeoutMs)
    expect(typeof parsed.updatedAt).toBe('string')
  })

  it('可选项缺失时**不**补一个假值：temperature / topP / reasoningEffort 保持「不存在」', () => {
    const parsed = parseAiSettings({
      schemaVersion: AI_SETTINGS_SCHEMA_VERSION,
      enabled: true,
      keyStorage: 'encrypted',
      params: { model: 'deepseek-flash', thinking: 'auto', maxTokens: 2048, timeoutMs: 60000 },
      updatedAt: '2026-09-26T00:00:00.000Z',
    })
    expect(parsed.enabled).toBe(true)
    expect(parsed.keyStorage).toBe('encrypted')
    expect('temperature' in parsed.params).toBe(false)
    expect('topP' in parsed.params).toBe(false)
    expect('reasoningEffort' in parsed.params).toBe(false)
  })

  it('合法内容原样读回（含可选项）', () => {
    const source = {
      schemaVersion: AI_SETTINGS_SCHEMA_VERSION,
      enabled: true,
      keyStorage: 'memory',
      params: {
        model: 'deepseek-v4-pro',
        thinking: 'disabled',
        temperature: 0.4,
        maxTokens: 4096,
        timeoutMs: 120000,
      },
      updatedAt: '2026-09-26T01:00:00.000Z',
    }
    const parsed = parseAiSettings(source)
    expect(parsed.params).toEqual(source.params)
  })

  it('非法的推理强度档位被丢弃，而不是照原样带进请求', () => {
    const parsed = parseAiSettings({
      schemaVersion: AI_SETTINGS_SCHEMA_VERSION,
      enabled: false,
      keyStorage: 'memory',
      params: { model: 'deepseek-flash', thinking: 'enabled', reasoningEffort: 'ultra', maxTokens: 1, timeoutMs: 1 },
      updatedAt: 'x',
    })
    expect(parsed.params.reasoningEffort).toBeUndefined()
  })
})

describe('AI-6：三级脱敏 / 岗位类别映射 / 规则确认 / 代理登记', () => {
  it('默认偏好是「standard + 无映射 + 未确认 + 不配置代理」', () => {
    const settings = defaultAiSettings('2026-09-26T00:00:00.000Z')
    expect(settings.privacyLevel).toBe('standard')
    expect(settings.customDimensions.length).toBeGreaterThan(0)
    expect(settings.positionCategories).toEqual([])
    expect(settings.subjectRulesConfirmedAt).toBeNull()
    expect(settings.subjectRulesFingerprint).toBeNull()
    expect(settings.proxy).toEqual({ origin: null, acknowledgedAt: null })
    // 默认目的地是官方端点（没有登记代理时不允许发往别处）
    expect(aiDestinationOf(settings).origin).toBe('https://api.deepseek.com')
  })

  it('非法隐私级别回落 standard；custom 维度只能在 standard 白名单内', () => {
    const parsed = parseAiSettings({
      ...defaultAiSettings(),
      privacyLevel: 'ultra',
      customDimensions: ['city', 'unknownDimension', 42],
    })
    expect(parsed.privacyLevel).toBe('standard')
    expect(parsed.customDimensions).toEqual(['city'])
  })

  it('岗位类别映射读回时被规范化：超长类别 / 像编号的类别 / 重复写法一律丢掉', () => {
    const parsed = parseAiSettings({
      ...defaultAiSettings(),
      positionCategories: [
        { keyword: '前端开发', category: '研发' },
        { keyword: '前端开发', category: '另一个类别' },
        { keyword: '后端开发', category: '这是一段明显过长的类别名称' },
        { keyword: '数据', category: 'REQ-0001' },
        { keyword: '  ', category: '空写法' },
        'not-an-object',
      ],
    })
    expect(parsed.positionCategories).toEqual([{ keyword: '前端开发', category: '研发' }])
  })

  it('只存了地址没有确认时间的代理记录按「未登记」处理（不能悄悄发往未确认的地址）', () => {
    const parsed = parseAiSettings({
      ...defaultAiSettings(),
      proxy: { origin: 'https://proxy.example.com', acknowledgedAt: null },
    })
    expect(parsed.proxy).toEqual({ origin: null, acknowledgedAt: null })
    expect(aiDestinationOf(parsed).origin).toBe('https://api.deepseek.com')
  })

  it('登记了代理且已确认时，目的地是代理地址且路径固定', () => {
    const parsed = parseAiSettings({
      ...defaultAiSettings(),
      proxy: { origin: 'https://proxy.example.com', acknowledgedAt: '2026-09-26T00:00:00.000Z' },
    })
    expect(parsed.proxy.origin).toBe('https://proxy.example.com')
    expect(aiDestinationOf(parsed)).toEqual({
      origin: 'https://proxy.example.com',
      path: '/chat/completions',
    })
  })

  it('规则确认时间与指纹原样读回（判定由 subjectRules 负责，这里只负责不丢字段）', () => {
    const parsed = parseAiSettings({
      ...defaultAiSettings(),
      subjectRulesFingerprint: 'ABCD1234',
      subjectRulesConfirmedAt: '2026-09-26T01:00:00.000Z',
    })
    expect(parsed.subjectRulesFingerprint).toBe('ABCD1234')
    expect(parsed.subjectRulesConfirmedAt).toBe('2026-09-26T01:00:00.000Z')
  })

  it('新增字段仍然没有能装 Key 的位置', () => {
    const keys = Object.keys(defaultAiSettings())
    for (const forbidden of ['apiKey', 'apiKeyValue', 'secret', 'authorization', 'token', 'key']) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe('AI-3：读写路径的行为（没有仓时如实失败，不假装成功）', () => {
  it('没有仓 / 未解锁时读偏好回落默认值，且不抛错', async () => {
    const loaded = await loadAiSettings()
    // 测试环境没有建仓（fake-indexeddb 只在 vault.test 里装配），因此必然回落
    expect(loaded.schemaVersion).toBe(AI_SETTINGS_SCHEMA_VERSION)
    expect(typeof loaded.enabled).toBe('boolean')
  })

  it('保存失败时返回原因而不是抛错（界面要能提示用户）', async () => {
    const result = await saveAiSettings(defaultAiSettings())
    if (!result.ok) {
      expect(result.reason.trim()).not.toBe('')
    } else {
      // 若某个环境真的建了仓，保存成功也必须带回更新时间
      expect(result.settings.updatedAt).toBeTruthy()
    }
  })

  it('删除偏好在没有仓时返回 0，不抛错', async () => {
    await expect(removeAiSettings()).resolves.toBeTypeOf('number')
  })

  /*
   * 2026-09-27 晚的真实 bug：用户在设置页打开 AI 开关（临时模式，写不进仓），
   * 切到看板却仍显示「AI 是关闭的」、预览按钮点不动。原因是读偏好只去仓里找，
   * 找不到就回落默认值——提示语说「本次会话生效」，代码只做到「本页面生效」。
   */
  it('写不进仓时，本会话内读回来仍然是用户刚选的那一份（看板不会再显示「已关闭」）', async () => {
    clearAiSettingsSessionOverride()
    const before = await loadAiSettings()
    expect(before.enabled).toBe(false)

    const wanted: AiSettings = { ...defaultAiSettings(), enabled: true }
    const saved = await saveAiSettings(wanted)
    if (!saved.ok) {
      // 临时模式：写仓失败，但会话态必须记住选择
      // （失败结果里刻意不带 `settings`，因此这里只能断言「读回来的是刚选的那一份」）
      const after = await loadAiSettings()
      expect(after.enabled).toBe(true)
      expect(after.updatedAt.trim()).not.toBe('')
    }
  })

  it('「清空 AI 配置」会一并清掉会话态（否则清空后界面还拿内存副本当配置）', async () => {
    clearAiSettingsSessionOverride()
    const wanted: AiSettings = { ...defaultAiSettings(), enabled: true }
    const saved = await saveAiSettings(wanted)
    if (!saved.ok) {
      expect((await loadAiSettings()).enabled).toBe(true)
      await removeAiSettings()
      expect((await loadAiSettings()).enabled).toBe(false)
    }
  })
})

describe('AI-3：偏好层不接触 Key（结构性断言）', () => {
  it('代码里没有 saveSecret / loadSecret / deleteSecret', () => {
    const code = codeOnlyOf(readFileSync(join(process.cwd(), 'src', 'ai', 'aiSettings.ts'), 'utf8'))
    // 只允许 saveObject / loadObject / deleteObject（非敏感偏好）
    expect(code.includes('saveSecret')).toBe(false)
    expect(code.includes('loadSecret')).toBe(false)
    expect(code.includes('deleteSecret')).toBe(false)
  })

  it('代码里没有 localStorage / document.cookie / console', () => {
    const code = codeOnlyOf(readFileSync(join(process.cwd(), 'src', 'ai', 'aiSettings.ts'), 'utf8'))
    for (const pattern of ['localStorage', 'document . cookie', 'console .']) {
      expect(code.includes(pattern), `aiSettings.ts 的代码里出现了 ${pattern}`).toBe(false)
    }
  })

  it('偏好记录 ID 是固定常量（便于清除范围模型指向它）', () => {
    expect(AI_SETTINGS_OBJECT_ID).toBe('ai-analysis-settings')
  })
})
