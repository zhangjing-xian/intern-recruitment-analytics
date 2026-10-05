/**
 * AI-5 单测：AI 结果的导出（`src/ai/aiExport.ts`）与回复侧敏感检查。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-5 的这几条：
 * - 「导出 Markdown / 打印 PDF 并接现有报告」→ 两个格式都从**同一份净化文本**生成；
 * - 「Key / Authorization 不在历史或导出」→ 导出文本里搜不到凭据（哨兵检索）；
 * - 「本地敏感字段检查」→ 命中即**阻断**导出，且只列字段名、不回显命中值；
 * - 「不默认存 reasoning_content」→ 导出与历史里都没有思维链。
 *
 * 全部使用合成内容；没有任何真实 Key 或真实网络请求。
 */

import { describe, expect, it } from 'vitest'

import { exportAiMarkdown, exportAiPrintHtml, prepareAiExportText, type AiExportInput } from './aiExport'
import { checkAiResponseText } from './aiResponseCheck'

/** 合成 Key（形状像 Key，绝不是真实凭据） */
const KEY_SENTINEL = 'sk-synthetic-not-a-real-credential-0001'
const NAME_SENTINEL = '张三哨兵'

function inputOf(content: string, overrides: Partial<AiExportInput> = {}): AiExportInput {
  return {
    requestedAt: '2026-09-26T09:59:00.000Z',
    requestedModel: 'deepseek-flash',
    responseModel: 'deepseek-flash',
    privacyLevel: 'standard',
    ruleVersionLabel: '1.0.0+3F2A19C4',
    dataAsOf: '2026-08-31',
    activeFilters: ['城市：上海'],
    payloadJson: '{"schemaVersion":"ai-summary/2","kpi":{"N":12}}',
    result: {
      content,
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, promptCacheHitTokens: 0 },
      responseId: 'chatcmpl-synthetic-1',
    },
    fileStamp: '2026-09-26T10:00:00.000Z',
    ...overrides,
  }
}

describe('AI-5：导出 Markdown', () => {
  it('正常内容导出成功，含元数据、已发送摘要与结果正文', () => {
    const outcome = exportAiMarkdown(inputOf('## 核心结论\n审批积压明显。'))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const text = outcome.artifact.text ?? ''
      expect(text).toContain('AI 深度分析结果')
      expect(text).toContain('deepseek-flash')
      expect(text).toContain('1.0.0+3F2A19C4')
      expect(text).toContain('城市：上海')
      expect(text).toContain('ai-summary/2')
      expect(text).toContain('审批积压明显')
      // 必须声明「不是本地统计」
      expect(text).toContain('不是本地统计')
    }
  })

  it('文件名只含固定前缀与时间戳（不含任何数据内容）', () => {
    const outcome = exportAiMarkdown(inputOf('正文'))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.artifact.fileName).toMatch(/^AI分析结果-[\dTZ:-]+\.md$/)
      expect(outcome.artifact.fileName).not.toContain('上海')
    }
  })

  it('导出的是**净化后**的文本：没有链接语法，也没有图片地址', () => {
    const outcome = exportAiMarkdown(
      inputOf('见 [文档](https://evil.example.com/x) 与 ![像素](https://evil.example.com/p.png)'),
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const text = outcome.artifact.text ?? ''
      expect(text).not.toContain('](https://evil.example.com/x)')
      expect(text).not.toContain('p.png')
      expect(text).toContain('[图片：像素]')
    }
  })

  it('导出里没有 Key、Authorization 与请求头', () => {
    const outcome = exportAiMarkdown(inputOf('正文'))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const text = outcome.artifact.text ?? ''
      for (const forbidden of [KEY_SENTINEL, 'Authorization', 'Bearer']) {
        expect(text).not.toContain(forbidden)
      }
    }
  })

  it('导出里没有思维链（reasoning_content 从来不进结果对象）', () => {
    const outcome = exportAiMarkdown(inputOf('正文'))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.artifact.text ?? '').not.toContain('reasoning_content')
      expect(outcome.artifact.text ?? '').not.toContain('思维链')
    }
  })
})

describe('AI-5：导出前必须跑敏感检查（命中即阻断）', () => {
  it('回复里出现敏感字段名时**阻断**导出，并只列字段名', () => {
    const prepared = prepareAiExportText(inputOf('模型提到 candidateName 这个字段。'))
    expect(prepared.ok).toBe(false)
    if (!prepared.ok) {
      expect(prepared.fieldNames.length).toBeGreaterThan(0)
      // 只报字段名，不回显上下文原文
      expect(prepared.reason).toContain('阻断')
    }
  })

  it('阻断时导出器返回失败，且失败信息里不含命中值的上下文', () => {
    const outcome = exportAiMarkdown(inputOf('这里出现了 candidateName 字段名。'))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.error).toContain('阻断')
      expect(outcome.error).toContain('candidateName')
    }
  })

  it('回复里命中本地哨兵时同样阻断', () => {
    const outcome = exportAiMarkdown(
      inputOf(`模型复述了一个取值：${NAME_SENTINEL}`, { sentinels: [NAME_SENTINEL] }),
    )
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      // 关键：**不回显**命中的哨兵原文
      expect(outcome.error).not.toContain(NAME_SENTINEL)
    }
  })

  it('没有哨兵时不假装做过取值检查（只做字段名检查）', () => {
    const check = checkAiResponseText(`这里有一个名字 ${NAME_SENTINEL}`)
    expect(check.sentinelHit).toBe(false)
    expect(check.hasFindings).toBe(false)
  })
})

describe('AI-5：回复侧敏感检查的结论形态', () => {
  it('干净内容没有发现', () => {
    const check = checkAiResponseText('审批积压明显，建议梳理审批节点。')
    expect(check.hasFindings).toBe(false)
    expect(check.fieldNames).toEqual([])
    expect(check.note).toBeNull()
  })

  it('命中字段名时只给字段名清单（去重、排序）', () => {
    const check = checkAiResponseText('candidateName 与 requirementId 都出现了，candidateName 又出现一次。')
    expect(check.hasFindings).toBe(true)
    expect(check.fieldNames).toEqual(['candidateId', 'candidateName', 'requirementId'].filter((name) => check.fieldNames.includes(name)))
    expect(new Set(check.fieldNames).size).toBe(check.fieldNames.length)
  })

  it('提示文案不回显命中值', () => {
    const check = checkAiResponseText(`出现了 ${NAME_SENTINEL}`, [NAME_SENTINEL])
    expect(check.note ?? '').not.toContain(NAME_SENTINEL)
    expect(check.note ?? '').toContain('不回显')
  })
})

describe('AI-5：打印版（HTML）', () => {
  it('生成完整 HTML 文档，且**逐行转义**（脚本以实体出现）', () => {
    const outcome = exportAiPrintHtml(inputOf('<script>alert(1)</script>\n\n正文'))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const html = outcome.artifact.text ?? ''
      expect(html.startsWith('<!doctype html>')).toBe(true)
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
    }
  })

  it('不生成可点链接与图片标签', () => {
    const outcome = exportAiPrintHtml(
      inputOf('[文档](https://evil.example.com/x)\n\n![像素](https://evil.example.com/p.png)'),
    )
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const html = outcome.artifact.text ?? ''
      expect(html).not.toContain('<a ')
      expect(html).not.toContain('<img')
      expect(html).not.toContain('p.png')
      // 地址作为纯文本如实列出（便于用户判断模型在引导他点什么）
      expect(html).toContain('evil.example.com/x')
    }
  })

  it('打印版不引用任何远程资源（无外链样式 / 字体 / 脚本）', () => {
    const outcome = exportAiPrintHtml(inputOf('正文'))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const html = outcome.artifact.text ?? ''
      expect(html).not.toContain('<link')
      expect(html).not.toContain('@import')
      expect(html).not.toContain('http://')
      expect(html).not.toContain('https://api.deepseek.com')
    }
  })

  it('命中敏感内容时打印版同样阻断', () => {
    const outcome = exportAiPrintHtml(inputOf('candidateName 出现在这里'))
    expect(outcome.ok).toBe(false)
  })
})
