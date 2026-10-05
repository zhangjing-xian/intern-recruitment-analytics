/**
 * 「只有唯一网络适配器能发请求」的**机器可检查**形式（AI01 / AI11 / AI18）。
 *
 * ## 这个文件守护的是什么（AI-4 起语义变了）
 *
 * 步骤1 到 AI-3，全仓 `src` 内没有任何真实网络调用，本文件守的是「零调用」。
 * **AI-4 打破了这个状态**，但只在一个文件里打破：`src/ai/client.ts` 是唯一适配器。
 * 因此守卫的目标从「一个都没有」变成「**有且只有一个，且它在规定的位置**」：
 *
 * - `src/features/ai/**`（直接面对用户的代码）仍然**一个都不许有**——
 *   这样「顺手在组件里加个请求」依旧会让 CI 失败；
 * - 全仓范围内允许出现的调用只允许落在 `src/ai/client.ts`：
 *   那个文件的存在本身就是设计的一部分（PRD 18.3「请求由唯一 network adapter 发出」），
 *   而它也不能接收原始记录类型。
 *
 * ## 扫描为什么不能是「整行 includes 关键字」
 *
 * 说明文案里**必须**出现这些 API 名字（例如「本文件没有写任何 fetch 调用」）——那是对边界的
 * 如实描述，不是调用。若按关键字整行匹配，这段诚实的文案反而会让守卫失败，
 * 于是下一个人只能删掉文案或加豁免——两条路都比没有守卫更糟。
 * 因此判定的是**调用形状**：`fetch(`、`new XMLHttpRequest`、`sendBeacon(`、`new WebSocket(` 等。
 *
 * 数据全是合成值，不涉及任何真实端点或 Key。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** 本目录（`src/features/ai`）：用 import.meta.url 而不是 process.cwd()，避免跑测试时目录不同 */
const AI_DIR = fileURLToPath(new URL('.', import.meta.url))
/** `src/` 根：用于「全仓只允许一个适配器」的扫描 */
const SRC_DIR = fileURLToPath(new URL('../../', import.meta.url))
/** 唯一允许发请求的文件（相对 `src/`，用 `/` 分隔） */
const ALLOWED_NETWORK_FILE = 'ai/client.ts'

/** 禁止出现的**调用形状**（只匹配调用，不匹配说明文案里的名字） */
const FORBIDDEN_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: 'fetch 调用', pattern: /\bfetch\s*\(/ },
  { label: 'XMLHttpRequest 实例', pattern: /\bnew\s+XMLHttpRequest\b/ },
  { label: 'sendBeacon 调用', pattern: /\bsendBeacon\s*\(/ },
  { label: 'WebSocket 实例', pattern: /\bnew\s+WebSocket\b/ },
  { label: 'EventSource 实例', pattern: /\bnew\s+EventSource\b/ },
  { label: 'navigator.connection 探测', pattern: /navigator\s*[.?]+\s*connection/ },
  { label: '静态 import 远程 URL', pattern: /\bfrom\s+['"]https?:/ },
  { label: '动态 import 远程 URL', pattern: /\bimport\s*\(\s*['"]https?:/ },
]

/**
 * 整行注释：`//` 开头，或块注释里的 `*` 开头（本仓库注释是中文说明，不是代码）。
 *
 * 为什么守卫要剥掉注释：组件文件头部的注释**必须**写清「本文件不写任何网络调用」，
 * 那是对纪律的说明；如果注释里的 API 名字也能让守卫失败，下一个人只能删掉说明文字——
 * 那比没有守卫更糟。
 */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

/**
 * 参与扫描的源文件：本目录下的 `.ts` / `.tsx`，**排除测试文件**。
 *
 * 为什么排除：这个守卫文件里必然写着这些模式本身（正则与标签），而其他测试文件也会
 * 写断言字符串。若把它们扫进来，只能靠一堆「跳过这一行」的特例过关，而那种特例
 * 迟早会顺手放过真正的调用。测试代码也不是发布产物，不进首屏包。
 */
function sourceFiles(): readonly string[] {
  return readdirSync(AI_DIR).filter(
    (name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'),
  )
}

/**
 * 递归遍历 `src/` 下的源文件（**排除测试文件**）。
 *
 * 为什么排除测试：测试里必然写着这些模式本身（正则与断言字符串），
 * 而且测试代码不进发布产物。真正的调用只可能出现在实现文件里。
 */
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

/**
 * 取出源码里**真正的代码**（丢掉注释与字符串内容）。
 *
 * 为什么需要它：本文件与 `client.ts` 的注释里**必须**提到被禁止的东西
 * （「不接收 NormalizedRecord[]」「不写 fetch」），直接对全文 `includes` 会把
 * 「如实描述边界」误判成「真的做了这件事」。用 TypeScript scanner 逐 token 过滤比正则可靠。
 */
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

describe('AI 支路的网络边界（读源码逐行扫描）', () => {
  it('src/features/ai 下的源文件里没有 fetch / XHR / sendBeacon / WebSocket 调用', () => {
    const files = sourceFiles()
    // 至少要有 AI 支路交付的那几个文件，否则这个扫描是空转
    expect(files).toContain('aiText.ts')
    expect(files).toContain('aiSourceCells.ts')
    expect(files).toContain('AiPreviewPanel.tsx')
    expect(files).toContain('AiAnalysisWorkspace.tsx')

    const offenders: string[] = []
    for (const name of files) {
      const lines = readFileSync(join(AI_DIR, name), 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (isCommentLine(line)) {
          return
        }
        for (const { label, pattern } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push(`${name}:${String(index + 1)} 命中 ${label}：${line.trim()}`)
          }
        }
      })
    }

    expect(offenders).toEqual([])
  })

  it('全仓只有一个文件发请求，且它就是 src/ai/client.ts（唯一适配器）', () => {
    const offenders: string[] = []
    for (const relative of walkSourceFiles(SRC_DIR)) {
      const lines = readFileSync(join(SRC_DIR, relative), 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (isCommentLine(line)) {
          return
        }
        for (const { label, pattern } of FORBIDDEN_PATTERNS) {
          if (pattern.test(line)) {
            offenders.push(`${relative}:${String(index + 1)} 命中 ${label}`)
          }
        }
      })
    }

    // 每一处调用都必须落在唯一适配器里
    const outsideAdapter = offenders.filter(
      (entry) => !entry.startsWith(`${ALLOWED_NETWORK_FILE}:`),
    )
    expect(outsideAdapter).toEqual([])
    // 并且适配器里**确实**有一次调用（否则这个断言会因「一个都没有」而空转通过）
    expect(offenders.some((entry) => entry.startsWith(`${ALLOWED_NETWORK_FILE}:`))).toBe(true)
  })

  it('唯一适配器不能接收原始记录类型（PRD 11 章：适配器只收脱敏载荷）', () => {
    /*
     * 只扫**代码**、不扫注释：适配器的文档注释里**必须**写明「它不接收 NormalizedRecord[]/
     * RawRow/SanitizedReport」，那是对边界的如实描述；直接对全文 includes 会把那句说明
     * 误判成真的用了它们。用 TypeScript scanner 丢掉注释与字符串内容后再判定。
     *
     * 这样断言的是：请求类型里出现不了原始数据类型名——以后有人想把 `records` 塞进来，
     * 这个测试会立刻失败（而不是靠人工审查签名）。
     */
    const code = codeOnlyOf(readFileSync(join(SRC_DIR, 'ai', 'client.ts'), 'utf8'))
    for (const forbidden of [
      'NormalizedRecord',
      'RawRow',
      'RawSheet',
      'SanitizedReport',
      'candidateName',
    ]) {
      expect(code.includes(forbidden), `client.ts 的代码里出现了原始数据类型 ${forbidden}`).toBe(
        false,
      )
    }
  })

  it('确认按钮的实现里只有确认令牌消费，没有请求头 / 凭据 / 取消控制器的痕迹', () => {
    const workspace = readFileSync(join(AI_DIR, 'AiAnalysisWorkspace.tsx'), 'utf8')

    // 有确认令牌的消费路径
    expect(workspace).toContain('consumeConfirmation')
    /*
     * 这里刻意**不**检查 "Authorization" 这个词本身：本步的说明文案必须写清
     * 「Authorization 头属于 AI-4」，那是对边界的如实描述。
     * 真正不允许出现的是构造请求的管道字段。
     */
    for (const forbidden of ['headers', 'credentials', 'AbortController', 'signal']) {
      const hit = workspace
        .split(/\r?\n/)
        .filter((line) => !isCommentLine(line))
        .some((line) => new RegExp(`\\b${forbidden}\\b`).test(line))
      expect(hit, `工作区里出现了网络管道字段：${forbidden}`).toBe(false)
    }
  })

  it('预览面板与工作区都不把载荷当 HTML 注入（必须当文本渲染）', () => {
    /*
     * 属性名刻意拆成两段拼接，且判定时先剥掉注释行：
     * - 本文件也在被扫描的目录里，写完整字面量会让守卫命中它自己；
     * - 组件文件头部的注释**必须**写清「不用它」这条纪律，注释里提到这个名字不算使用。
     */
    const propName = 'dangerouslySet' + 'InnerHTML'
    for (const name of ['AiPreviewPanel.tsx', 'AiAnalysisWorkspace.tsx']) {
      const used = readFileSync(join(AI_DIR, name), 'utf8')
        .split(/\r?\n/)
        .filter((line) => !isCommentLine(line))
        .some((line) => line.includes(propName))
      expect(used, `${name} 里出现了 HTML 注入属性`).toBe(false)
    }
  })
})
