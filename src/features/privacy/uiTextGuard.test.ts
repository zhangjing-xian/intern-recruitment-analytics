/**
 * 「界面文案里不许出现 Markdown 强调标记」的**机器可检查**形式（AI-6）。
 *
 * ## 为什么值得一个全仓扫描，而不是各页各写一条断言
 *
 * 这个 bug 在本项目里出现过**至少四次**（`AI_CORS_UNVERIFIED_NOTE`、user 提示词、
 * AI 结果面板的删除说明、拒 offer 与分维度页的表格说明）：把 `**重点**` 写进会**逐字渲染**
 * 的字符串里，界面上就显示成一对星号。逐页写断言只能覆盖「这一页当时写过的常量」，
 * 而新写的常量、引擎返回的 message、判断日志里的模板串都会漏掉——AI-6 收尾时
 * 就是这样一次扫描把另外四处抓出来的（四处的共同点是：都不在 AI 设置页里）。
 *
 * ## 判据是「字符串字面量」，不是「文件里的星号」
 *
 * 注释里当然可以写 `**`（本仓库的注释大量使用强调），Markdown 解析器与 Markdown 导出器
 * 也**必须**产出 `**粗体**`。因此这里解析成 AST，只看**会进入界面的字符串**：
 * 字符串字面量、无插值模板串、模板串的每一段、以及 JSX 文本节点。
 * 唯一豁免的文件在 `MARKDOWN_PRODUCERS` 里，每条都写明理由。
 *
 * 数据：扫描的是源码，不涉及任何数据内容；本文件自身不在扫描范围内（测试文件被排除）。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** `src/` 根目录 */
const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url))

/**
 * 允许在字符串里出现 `**` 的文件（相对 `src/`），每条都要有理由。
 *
 * 这份名单刻意很短：往里加文件等于承认「这个文件里的文本不是给用户看的」，
 * 加之前先确认它真的不渲染进界面。
 */
const MARKDOWN_PRODUCERS: readonly string[] = [
  // 安全 Markdown 解析器的**输出**侧：它把行内粗体重新序列化成 Markdown（净化后仍是 Markdown）
  'ai/aiMarkdown.ts',
]

function walkSourceFiles(root: string, prefix = ''): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...walkSourceFiles(root, relative))
      continue
    }
    if (!/\.tsx?$/.test(entry.name)) {
      continue
    }
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) {
      continue
    }
    found.push(relative)
  }
  return found
}

/** 会不会进入界面的文本节点：字符串字面量、模板串各段、JSX 文本 */
function collectRenderedText(source: string, fileName: string): readonly string[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const texts: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      texts.push(node.text)
    } else if (
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      texts.push(node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return texts
}

describe('界面文案纪律（全仓扫描字符串字面量与 JSX 文本）', () => {
  it('没有任何会渲染进界面的字符串带 Markdown 强调标记', () => {
    const files = walkSourceFiles(SRC_DIR)
    // 扫描必须真的覆盖到实现文件，否则这个测试会因「一个文件都没扫到」而空转通过
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain('features/ai/aiText.ts')
    expect(files).toContain('features/privacy/privacyText.ts')

    const offenders: string[] = []
    for (const relative of files) {
      if (MARKDOWN_PRODUCERS.includes(relative)) {
        continue
      }
      const source = readFileSync(join(SRC_DIR, relative), 'utf8')
      for (const text of collectRenderedText(source, relative)) {
        if (text.includes('**') || text.includes('__')) {
          offenders.push(`${relative}：${text.trim().slice(0, 60)}`)
        }
      }
    }

    expect(offenders).toEqual([])
  })

  it('豁免文件确实存在，且名单没有被悄悄扩大', () => {
    for (const relative of MARKDOWN_PRODUCERS) {
      // 读得到才算豁免生效（写错路径的豁免等于没有豁免，也会掩盖真正的违规）
      expect(readFileSync(join(SRC_DIR, relative), 'utf8').length).toBeGreaterThan(0)
    }
    expect(MARKDOWN_PRODUCERS).toHaveLength(1)
  })
})
