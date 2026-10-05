/**
 * AI-3 单测：模型目录与能力表（`src/ai/catalog.ts`）。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-3 的这几条验收标准：
 * - 「不支持的参数禁用」→ `paramSupportOf` 逐条对应官方原文；
 * - 「旧 chat / reasoner 标兼容风险，不静默替换」→ 目录里旧模型仍在、风险文案在场、
 *   默认模型是当前在售的那个；
 * - 「模型目录随版本打包」→ 目录是常量（无网络），核实日期与来源可回溯；
 * - 「AI10 通过」→ 本文件与 catalog 源码里没有 Key 材料、没有网络调用。
 *
 * 只用合成数据（AGENTS.md §2.6）；不使用任何真实 Key。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

import {
  AI_CATALOG_SOURCES,
  AI_CATALOG_VERIFIED_AT,
  AI_CORS_UNVERIFIED_NOTE,
  AI_DEFAULT_MODEL_ID,
  AI_MODEL_CATALOG,
  AI_REASONING_EFFORTS,
  estimateCost,
  estimateInputTokens,
  findModelSpec,
  formatCostEstimate,
  modelSpecOf,
  paramSupportOf,
} from './catalog'

const AI_DIR = join(process.cwd(), 'src', 'ai')

/**
 * 取出源码里**真正的代码**（去掉注释与字符串字面量）。
 *
 * 为什么不能直接对整份源文件做 `includes`：这些模块的注释与界面文案里**必须**提到
 * 被禁止的东西——`keySession.ts` 的输入框占位符写着 `sk-…`、`catalog.ts` 的说明里写着
 * 「不查余额」。直接扫全文会把「如实描述边界」误判成「真的做了这件事」。
 *
 * 用 TypeScript 的 scanner 逐 token 过滤，比正则更可靠（正则处理不了嵌套与转义）：
 * 只保留标识符与标点，丢掉注释与字符串内容。这样 `fetch(` 仍会被抓到（那是真实调用），
 * 而文案里的 `sk-` 不会。
 */
function codeOnlyOf(source: string): string {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  const parts: string[] = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue
    }
    const text = scanner.getTokenText()
    if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail
    ) {
      // 字符串内容整体丢弃，但保留一个占位符以维持 `xxx(` 的相邻关系
      parts.push('""')
      continue
    }
    parts.push(text)
  }
  return parts.join(' ')
}

function sourceOf(file: string): { readonly raw: string; readonly code: string } {
  const raw = readFileSync(join(AI_DIR, file), 'utf8')
  return { raw, code: codeOnlyOf(raw) }
}

describe('AI-3：模型目录是随版本打包的常量，不联网获取', () => {
  it('目录非空，且每个模型都带齐能力字段与价格', () => {
    expect(AI_MODEL_CATALOG.length).toBeGreaterThan(0)
    for (const spec of AI_MODEL_CATALOG) {
      expect(spec.id.trim()).not.toBe('')
      expect(spec.displayName.trim()).not.toBe('')
      expect(spec.contextWindowTokens).toBeGreaterThan(0)
      expect(spec.maxOutputTokens).toBeGreaterThan(0)
      expect(spec.pricing.inputCacheMissPerMillion.peak).toBeGreaterThan(0)
      expect(spec.pricing.outputPerMillion.peak).toBeGreaterThan(0)
      // 低峰价必须低于高峰价（官方：低峰为高峰的一半）；写反会让费用估算误导人
      expect(spec.pricing.outputPerMillion.offPeak).toBeLessThan(
        spec.pricing.outputPerMillion.peak,
      )
    }
  })

  it('核实日期与来源可回溯（这是「不硬编码最新版本」的替代做法）', () => {
    expect(AI_CATALOG_VERIFIED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(AI_CATALOG_SOURCES.length).toBeGreaterThan(0)
    for (const url of AI_CATALOG_SOURCES) {
      expect(url.startsWith('https://api-docs.deepseek.com/')).toBe(true)
    }
  })

  it('默认模型是**当前在售**的那个，不是已停用的旧模型', () => {
    const spec = findModelSpec(AI_DEFAULT_MODEL_ID)
    expect(spec).toBeDefined()
    expect(spec?.status).toBe('current')
    expect(spec?.compatibilityRisk).toBeNull()
  })

  it('已停用 / 已下线的模型仍在目录里，且带明确的兼容风险文案', () => {
    const legacy = AI_MODEL_CATALOG.filter((spec) => spec.status === 'legacy')
    // 官方公告停用的两个 + 两个仍可调用但模型已下线的旧名
    expect(legacy.length).toBeGreaterThanOrEqual(4)
    for (const spec of legacy) {
      const risk = spec.compatibilityRisk
      expect(risk).not.toBeNull()
      // 风险文案要说清「这个模型现在是什么状态」与「建议改用哪个」，
      // 不能只给一句「不推荐」（那样用户无法判断后果）
      expect((risk ?? '').length).toBeGreaterThan(20)
      expect(risk ?? '').toContain('deepseek-flash')
    }
    // 「不静默替换」这条承诺在**已停用**的那两个模型上必须逐字写明
    for (const id of ['deepseek-chat', 'deepseek-reasoner']) {
      expect(modelSpecOf(id).compatibilityRisk ?? '').toContain('不静默替换')
    }
  })

  it('目录里同时保留 deepseek-chat 与 deepseek-reasoner（PRD 18.3 明确要求）', () => {
    for (const id of ['deepseek-chat', 'deepseek-reasoner']) {
      const spec = findModelSpec(id)
      expect(spec).toBeDefined()
      expect(spec?.status).toBe('legacy')
    }
  })

  it('所有当前在售模型的 ID 都不与任何旧 ID 重名（「不静默替换」的结构前提）', () => {
    const currentIds = new Set(
      AI_MODEL_CATALOG.filter((spec) => spec.status === 'current').map((spec) => spec.id),
    )
    const legacyIds = new Set(
      AI_MODEL_CATALOG.filter((spec) => spec.status === 'legacy').map((spec) => spec.id),
    )
    for (const id of legacyIds) {
      expect(currentIds.has(id), `旧 ID ${id} 同时被标为在售`).toBe(false)
    }
    // 默认模型与「推荐改用」的那个必须是同一个在售模型，否则用户会被指到一个旧名字上
    expect(currentIds.has(AI_DEFAULT_MODEL_ID)).toBe(true)
    expect(currentIds.has('deepseek-flash')).toBe(true)
  })

  it('未登记的模型 ID 按最保守能力处理，并标为「未核实」而不是假装认识它', () => {
    const spec = modelSpecOf('some-model-not-in-catalog')
    expect(spec.status).toBe('userProvided')
    expect(spec.compatibilityRisk).not.toBeNull()
    // 保守：输出上限不高于目录里最小的那个
    const minKnown = Math.min(...AI_MODEL_CATALOG.map((item) => item.maxOutputTokens))
    expect(spec.maxOutputTokens).toBeLessThanOrEqual(minKnown)
  })
})

describe('AI-3：不支持的参数必须在界面禁用（PRD 18.3）', () => {
  const flash = modelSpecOf('deepseek-flash')

  it('思考模式下 temperature 被禁用，且原因写明「不报错也不生效」', () => {
    const support = paramSupportOf(flash, 'temperature', true)
    expect(support.supported).toBe(false)
    expect(support.reason ?? '').toContain('不会报错')
    expect(support.reason ?? '').toContain('不会生效')
  })

  it('非思考模式下 temperature 可用（官方限制只针对思考模式）', () => {
    expect(paramSupportOf(flash, 'temperature', false).supported).toBe(true)
  })

  it('top_p 只在思考模式生效：非思考模式下禁用并说明会被忽略', () => {
    expect(paramSupportOf(flash, 'topP', true).supported).toBe(true)
    const off = paramSupportOf(flash, 'topP', false)
    expect(off.supported).toBe(false)
    expect(off.reason ?? '').toContain('1.0')
  })

  it('推理强度只在思考模式生效', () => {
    expect(paramSupportOf(flash, 'reasoningEffort', true).supported).toBe(true)
    expect(paramSupportOf(flash, 'reasoningEffort', false).supported).toBe(false)
  })

  it('不支持思考模式的旧模型：思考开关与推理强度都被禁用', () => {
    const chat = modelSpecOf('deepseek-chat')
    expect(chat.supportsThinking).toBe(false)
    expect(paramSupportOf(chat, 'thinking', false).supported).toBe(false)
    expect(paramSupportOf(chat, 'reasoningEffort', true).supported).toBe(false)
  })

  it('每一个被禁用的参数都必须给出可读原因（不允许只灰掉不说）', () => {
    for (const spec of AI_MODEL_CATALOG) {
      for (const thinking of [true, false]) {
        for (const param of ['temperature', 'topP', 'reasoningEffort', 'thinking'] as const) {
          const support = paramSupportOf(spec, param, thinking)
          if (!support.supported) {
            expect(support.reason).not.toBeNull()
            expect((support.reason ?? '').length).toBeGreaterThan(0)
          }
        }
      }
    }
  })

  it('推理强度档位与目录声明一致（low / high / max）', () => {
    expect([...AI_REASONING_EFFORTS]).toEqual(['low', 'high', 'max'])
    for (const spec of AI_MODEL_CATALOG) {
      for (const effort of spec.supportedReasoningEfforts) {
        expect(AI_REASONING_EFFORTS).toContain(effort)
      }
    }
  })
})

describe('AI-3：费用只给上限估算，并写明假设', () => {
  it('输入 token 粗估按字符数算：中文不会被按字节高估', () => {
    // 用字节数会把中文高估约 3 倍，所以 estimateInputTokens 收的是**字符数**
    expect(estimateInputTokens(0)).toBe(0)
    expect(estimateInputTokens(-5)).toBe(0)
    expect(estimateInputTokens(15)).toBe(10)
    expect(estimateInputTokens(1)).toBe(1)
  })

  it('估算取「缓存未命中 + 高峰」两条最贵分支，因此是上限', () => {
    const spec = modelSpecOf('deepseek-flash')
    const estimate = estimateCost({ spec, inputCharCount: 150_000, maxOutputTokens: 2048 })
    // 输入 100k tokens × 2 元/百万 = 0.2 元；输出 2048 tokens × 8 元/百万 ≈ 0.016384 元
    expect(estimate.inputTokens).toBe(100_000)
    expect(estimate.maxCostYuan).toBeCloseTo(0.2 + 0.016384, 6)
  })

  it('假设清单在场：粗估口径、取最贵分支、不查余额、价格可能变动', () => {
    const estimate = estimateCost({
      spec: modelSpecOf('deepseek-v4-pro'),
      inputCharCount: 100,
      maxOutputTokens: 100,
    })
    const text = estimate.assumptions.join('\n')
    expect(text).toContain('粗估')
    expect(text).toContain('上限估算')
    expect(text).toContain('不查询余额')
    expect(text).toContain(AI_CATALOG_VERIFIED_AT)
  })

  it('费用文案：极小金额不显示成 0.00（那是假精度）', () => {
    const tiny = estimateCost({
      spec: modelSpecOf('deepseek-flash'),
      inputCharCount: 0,
      maxOutputTokens: 1,
    })
    expect(formatCostEstimate(tiny)).toContain('< 0.0001 元')
  })

  it('费用文案：正常金额保留 4 位小数并附 token 估算', () => {
    const estimate = estimateCost({
      spec: modelSpecOf('deepseek-flash'),
      inputCharCount: 150_000,
      maxOutputTokens: 2048,
    })
    const text = formatCostEstimate(estimate)
    expect(text).toContain('元')
    expect(text).toContain('上限估算')
    expect(text).toContain('2048 tokens')
  })
})

describe('AI-3：文案纪律与零网络', () => {
  it('CORS 说明不承诺可用，也不含 Markdown 强调标记', () => {
    expect(AI_CORS_UNVERIFIED_NOTE).toContain('未验证')
    expect(AI_CORS_UNVERIFIED_NOTE).not.toContain('**')
    expect(AI_CORS_UNVERIFIED_NOTE).not.toContain('__')
    // 不能出现「可以直连」这类承诺
    expect(AI_CORS_UNVERIFIED_NOTE).not.toContain('可以直连')
  })

  it('目录与配置层的**代码**里没有任何网络调用（文案里提到不算）', () => {
    const files = ['catalog.ts', 'aiConfig.ts', 'keySession.ts', 'aiSettings.ts']
    for (const file of files) {
      const { code } = sourceOf(file)
      for (const pattern of ['fetch (', 'new XMLHttpRequest', 'sendBeacon (', 'new WebSocket (']) {
        expect(code.includes(pattern), `${file} 的代码里出现了网络调用 ${pattern}`).toBe(false)
      }
      // 代码里不允许出现 Key 形状的字面量（文案里的占位符不算，它已被 codeOnlyOf 丢弃）
      expect(/(^|[\s'"`(])(sk|api)[-_]?[A-Za-z0-9]{12,}/i.test(code), `${file} 里出现了凭据形状的字面量`).toBe(
        false,
      )
    }
  })

  it('目录与配置层的**代码**不做探活 / 余额 / 模型列表查询', () => {
    for (const file of ['catalog.ts', 'aiConfig.ts']) {
      const { code } = sourceOf(file)
      expect(code.includes('/models')).toBe(false)
      expect(code.toLowerCase().includes('balance')).toBe(false)
    }
  })
})
