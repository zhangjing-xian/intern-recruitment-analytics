/**
 * AI 结果的 Markdown / 打印版导出（AI-5，docs/PRD.md 16.5）。
 *
 * ## 与 `exportMarkdown` 的关系（为什么是两个导出器，而不是给老的那个加参数）
 *
 * `exportMarkdown` 消费的 `SanitizedReport` 是**本地统计的脱敏报告**，它的每一行都由
 * 统一指标引擎算出（步骤11）。AI 结果不是统计结果，而是**不可信文本**：它必须
 * 1. 先经过本地敏感检查（命中即阻断），2. 只输出**已净化**的 Markdown（链接降级、图片去地址）。
 * 把它混进 `SanitizedReport` 会让「报告里的数字都来自引擎」这条不变量失效。
 *
 * 因此本文件是**第二个入口**，但复用同一套 `ExportResult` / 文件名安全规则：
 * 两种导出产物在「文件名不含敏感字段」「缺失不写 0」这些纪律上完全一致。
 *
 * ## 三条纪律
 *
 * 1. **导出前必须跑敏感检查**：命中字段名或哨兵即**阻断**（不是提示）。
 *    与步骤11 的导出闸门同一条口径：只列字段名与位置，**绝不回显命中的值**；
 * 2. **只导出净化后的文本**：`sanitizeMarkdownText(parseAiMarkdown(content))`，
 *    因此导出文件里不会有链接语法，也不会有图片地址；
 * 3. **绝不导出 Key / Authorization / reasoning_content**：
 *    `AiExportInput` 里没有这些字段的位置——它们连类型都不存在。
 */

import {
  findExternalReferences,
  parseAiMarkdown,
  sanitizeMarkdownText,
  type AiMarkdownDowngrade,
} from './aiMarkdown'
import { checkAiResponseText } from './aiResponseCheck'
import type { AiChatResult } from './aiResult'
import type { AiHistoryEntry } from './aiHistory'
import { artifactOf, exportFailure, type ExportResult } from '../exporters/artifact'
import { escapeHtml } from '../exporters/print'

/** 导出 AI 结果所需的全部输入（**没有** Key / 请求头 / 思维链的位置） */
export type AiExportInput = {
  readonly requestedAt: string
  readonly requestedModel: string
  readonly responseModel: string | null
  readonly privacyLevel: string
  readonly ruleVersionLabel: string
  readonly dataAsOf: string
  readonly activeFilters: readonly string[]
  readonly payloadJson: string
  readonly result: Pick<AiChatResult, 'content' | 'finishReason' | 'usage' | 'responseId'>
  /** 本地哨兵（姓名 / 学校 / HR 名等），用于导出前的取值检索 */
  readonly sentinels?: readonly string[]
  /** 文件名后缀（时间戳），由调用方给出以保证可测 */
  readonly fileStamp: string
}

/** 文件名：只含固定前缀与时间戳，**不含**任何数据内容（PRD 11.3） */
function aiFileName(stamp: string, extension: string): string {
  return `AI分析结果-${stamp.replace(/[^\dTZ:-]/g, '')}.${extension}`
}

/** 降级说明（导出文件里要写清「有内容被降级」，不能静默改写） */
function downgradeNotes(downgrades: readonly AiMarkdownDowngrade[]): readonly string[] {
  const grouped = new Map<string, number>()
  for (const item of downgrades) {
    grouped.set(item.detail, (grouped.get(item.detail) ?? 0) + 1)
  }
  return [...grouped.entries()].map(([detail, count]) =>
    count > 1 ? `${detail}（出现 ${String(count)} 次）` : detail,
  )
}

/** 元数据段落：两个导出格式共用，避免两处写法不一致 */
function metaLines(input: AiExportInput): readonly string[] {
  const usage =
    input.result.usage === null
      ? '服务端未返回用量'
      : `输入 ${String(input.result.usage.promptTokens)} / 输出 ${String(input.result.usage.completionTokens)} / 合计 ${String(input.result.usage.totalTokens)} tokens`
  return [
    `请求时间：${input.requestedAt}`,
    `请求模型：${input.requestedModel}${input.responseModel === null ? '' : `（服务端返回：${input.responseModel}）`}`,
    `脱敏级别：${input.privacyLevel}`,
    `规则版本：${input.ruleVersionLabel}｜数据截至日：${input.dataAsOf}`,
    `生效筛选：${input.activeFilters.length === 0 ? '未启用筛选' : input.activeFilters.join('；')}`,
    `结束原因 finish_reason：${input.result.finishReason ?? '未返回'}`,
    `用量：${usage}`,
    '说明：以下内容是模型生成的结果，需人工核验；它不覆盖、也不改写本地统计。',
  ]
}

export type AiExportCheckResult =
  | { readonly ok: true; readonly markdown: string; readonly notes: readonly string[] }
  | { readonly ok: false; readonly reason: string; readonly fieldNames: readonly string[] }

/**
 * 导出前的**唯一闸门**：解析 → 净化 → 敏感检查。
 *
 * 三个导出格式都先过这里，因此「有没有跑检查」不可能被漏掉。
 * 检查命中的是模型的**回复文本**（发送前的载荷已经过白名单重建，两者防的是不同的事故）。
 */
export function prepareAiExportText(input: AiExportInput): AiExportCheckResult {
  const document = parseAiMarkdown(input.result.content)
  const markdown = sanitizeMarkdownText(document)
  const check = checkAiResponseText(markdown, input.sentinels ?? [])

  if (check.hasFindings) {
    /*
     * 命中即**阻断**（不是提示）：这是导出闸门，与步骤11 的 `findSensitiveFields` 同一条口径。
     * 只列字段名，绝不回显命中的值——否则检查结果自己就成了泄漏渠道。
     */
    return {
      ok: false,
      reason:
        '导出已在本地阻断：结果文本里出现了敏感字段名或命中本地哨兵。请回到结果页查看提示并人工核验后再决定是否导出。',
      fieldNames: check.fieldNames,
    }
  }

  return { ok: true, markdown, notes: downgradeNotes(document.downgrades) }
}

/**
 * 导出**净化后的 Markdown**。
 *
 * 输出结构：标题 → 元数据 → 已发送摘要（可折叠的 JSON，方便复核）→ 结果正文 → 降级说明 → 限制。
 */
export function exportAiMarkdown(input: AiExportInput): ExportResult {
  try {
    const prepared = prepareAiExportText(input)
    if (!prepared.ok) {
      return { ok: false, error: `${prepared.reason}${prepared.fieldNames.length === 0 ? '' : `（命中字段：${prepared.fieldNames.join('、')}）`}` }
    }

    const lines: string[] = []
    lines.push('# AI 深度分析结果（模型生成，需人工核验）')
    lines.push('')
    for (const line of metaLines(input)) {
      lines.push(line)
    }
    lines.push('')
    lines.push('## 本次发送的脱敏摘要（已由用户确认）')
    lines.push('')
    lines.push('```json')
    lines.push(input.payloadJson)
    lines.push('```')
    lines.push('')
    lines.push('## 结果正文')
    lines.push('')
    lines.push(prepared.markdown)
    if (prepared.notes.length > 0) {
      lines.push('')
      lines.push('## 内容降级说明')
      lines.push('')
      for (const note of prepared.notes) {
        lines.push(`- ${note}`)
      }
    }
    lines.push('')
    lines.push('## 使用限制')
    lines.push('')
    lines.push(
      '本文件里的结果正文由模型生成，不是本地统计。所有数字以本地看板与脱敏报告为准；模型结论需人工核验。',
    )
    lines.push('文件不包含 API Key、请求头或模型内部推理文本。')

    const text = lines.join('\n')
    const artifact = artifactOf({
      format: 'markdown',
      fileName: aiFileName(input.fileStamp, 'md'),
      text,
      previewLines: text.split('\n').filter((line) => line !== '').slice(0, 200),
    })
    return artifact.ok
      ? { ok: true, artifact: { ...artifact.artifact, mimeType: 'text/markdown' } }
      : artifact
  } catch (error) {
    return exportFailure('生成 AI 结果 Markdown', error)
  }
}

/**
 * 导出**打印版（HTML）**：结构与 Markdown 版一一对应，供「打印 → 另存为 PDF」使用。
 *
 * 为什么走打印而不是引 PDF 库：与步骤11 的打印版同一理由——中文字体与分页只有浏览器
 * 自己能做对，本地库要么体积巨大、要么中文缺字（口径见 D-052）。
 */
export function exportAiPrintHtml(input: AiExportInput): ExportResult {
  try {
    const prepared = prepareAiExportText(input)
    if (!prepared.ok) {
      return { ok: false, error: prepared.reason }
    }
    const document = parseAiMarkdown(input.result.content)
    const references = findExternalReferences(document)

    const parts: string[] = []
    parts.push('<!doctype html>')
    parts.push('<html lang="zh-CN"><head><meta charset="utf-8">')
    parts.push(`<title>${escapeHtml('AI 深度分析结果（模型生成，需人工核验）')}</title>`)
    parts.push(`<style>${PRINT_MINIMAL_STYLE}</style>`)
    parts.push('</head><body>')
    parts.push('<h1>AI 深度分析结果（模型生成，需人工核验）</h1>')
    parts.push('<table class="meta">')
    for (const line of metaLines(input)) {
      const [label, ...rest] = line.split('：')
      parts.push(
        `<tr><th>${escapeHtml(label ?? '')}</th><td>${escapeHtml(rest.join('：'))}</td></tr>`,
      )
    }
    parts.push('</table>')
    parts.push('<h2>本次发送的脱敏摘要（已由用户确认）</h2>')
    parts.push(`<pre class="json">${escapeHtml(input.payloadJson)}</pre>`)
    parts.push('<h2>结果正文</h2>')
    // **先净化成 Markdown，再转成极简 HTML**：不走「模型原文 → HTML」这条路
    parts.push(markdownToMinimalHtml(prepared.markdown))
    if (references.length > 0) {
      parts.push('<h2>结果里出现的外部地址（已降级为文本，不生成可点击链接）</h2>')
      parts.push('<ul>')
      for (const reference of references) {
        parts.push(`<li>${escapeHtml(reference)}</li>`)
      }
      parts.push('</ul>')
    }
    if (prepared.notes.length > 0) {
      parts.push('<h2>内容降级说明</h2><ul>')
      for (const note of prepared.notes) {
        parts.push(`<li>${escapeHtml(note)}</li>`)
      }
      parts.push('</ul>')
    }
    parts.push('<h2>使用限制</h2>')
    parts.push(
      `<p>${escapeHtml('结果正文由模型生成，不是本地统计；所有数字以本地看板与脱敏报告为准。文件不包含 API Key、请求头或模型内部推理文本。')}</p>`,
    )
    parts.push('</body></html>')

    const html = parts.join('\n')
    return artifactOf({
      format: 'pdf',
      fileName: aiFileName(input.fileStamp, 'html'),
      text: html,
      previewLines: html.split('\n').filter((line) => line !== '').slice(0, 200),
    })
  } catch (error) {
    return exportFailure('生成 AI 结果打印版', error)
  }
}

/** 打印版样式：与步骤11 的打印版同源风格（纸面白底、无外链字体、无远程资源） */
const PRINT_MINIMAL_STYLE = `
  body { font-family: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
         margin: 24px; color: #0f172a; line-height: 1.7; font-size: 13px; }
  h1 { font-size: 18px; }
  h2 { font-size: 15px; margin-top: 18px; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
  h3 { font-size: 14px; }
  table.meta { border-collapse: collapse; width: 100%; margin: 8px 0; }
  table.meta th { text-align: left; width: 160px; color: #475569; font-weight: 500; padding: 3px 8px 3px 0; vertical-align: top; }
  table.meta td { padding: 3px 0; }
  pre.json { background: #f8fafc; border: 1px solid #e2e8f0; padding: 8px; white-space: pre-wrap;
             word-break: break-word; font-size: 11px; }
  blockquote { border-left: 3px solid #cbd5e1; margin: 8px 0; padding-left: 10px; color: #475569; }
  code { background: #f1f5f9; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  ul, ol { padding-left: 20px; }
  @media print { body { margin: 12mm; } }
`

/**
 * 已净化的 Markdown → 极简 HTML。
 *
 * 只认本应用自己生成的标记（`#` / `-` / `1.` / `>` / 围栏），且**逐行转义后拼接**：
 * 输入已经过 `sanitizeMarkdownText`，其中不含链接与图片语法；
 * 这里再做一次 `escapeHtml`，因此即便上游将来出问题，也不会产生可执行标记。
 */
function markdownToMinimalHtml(markdown: string): string {
  const lines = markdown.split('\n')
  const html: string[] = []
  let inCode = false
  let listKind: 'ul' | 'ol' | null = null

  const closeList = (): void => {
    if (listKind !== null) {
      html.push(`</${listKind}>`)
      listKind = null
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        html.push('</pre>')
        inCode = false
      } else {
        closeList()
        html.push('<pre>')
        inCode = true
      }
      continue
    }
    if (inCode) {
      html.push(escapeHtml(line))
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading !== null) {
      closeList()
      const level = Math.min(6, (heading[1] ?? '#').length + 1)
      html.push(`<h${String(level)}>${escapeHtml(heading[2] ?? '')}</h${String(level)}>`)
      continue
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      if (listKind !== 'ul') {
        closeList()
        html.push('<ul>')
        listKind = 'ul'
      }
      html.push(`<li>${escapeHtml(line.replace(/^\s*[-*+]\s+/, ''))}</li>`)
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (listKind !== 'ol') {
        closeList()
        html.push('<ol>')
        listKind = 'ol'
      }
      html.push(`<li>${escapeHtml(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`)
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote !== null) {
      closeList()
      html.push(`<blockquote>${escapeHtml(quote[1] ?? '')}</blockquote>`)
      continue
    }
    if (line.trim() === '') {
      closeList()
      continue
    }
    closeList()
    html.push(`<p>${escapeHtml(line)}</p>`)
  }
  closeList()
  if (inCode) {
    html.push('</pre>')
  }
  return html.join('\n')
}

/**
 * `exportPrintHtml` 需要一个 `SanitizedReport` 才能算出文件名；
 * AI 结果导出**不复用**它的文件名（那是统计报告的名字），因此不调用它。
 * 这里保留这条注释是为了说明「为什么这个文件里没有 import 打印版的导出函数」。
 */

/** 从历史条目构造导出输入（历史里存的字段与导出输入一一对应） */
export function exportInputOfHistoryEntry(
  entry: AiHistoryEntry,
  fileStamp: string,
  sentinels: readonly string[] = [],
): AiExportInput {
  return {
    requestedAt: entry.requestedAt,
    requestedModel: entry.requestedModel,
    responseModel: entry.responseModel,
    privacyLevel: entry.privacyLevel,
    ruleVersionLabel: entry.ruleVersionLabel,
    dataAsOf: entry.dataAsOf,
    activeFilters: entry.activeFilters,
    payloadJson: entry.payloadJson,
    result: {
      content: entry.content,
      finishReason: entry.finishReason,
      usage: entry.usage,
      responseId: entry.responseId,
    },
    sentinels,
    fileStamp,
  }
}
