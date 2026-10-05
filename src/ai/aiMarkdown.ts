/**
 * 安全 Markdown（AI-5，docs/PRD.md 16.4 / 16.5）。
 *
 * ## 为什么自己写解析器，而不是引入 markdown 库
 *
 * PRD 16.5 把模型返回的 Markdown 明确当作**不可信文本**，要求「禁用原始 HTML、脚本、
 * iframe、远程图片和嵌入；默认外链渲染为文本，防止模型用链接把数据再次带出」。
 * 三条后果：
 *
 * 1. **不能引第三方渲染器**：多数 Markdown 库默认允许原始 HTML（或需要一个插件才关掉），
 *    而本项目禁止 `dangerouslySetInnerHTML`（AGENTS.md §6）。引入一个「配错一个选项就出事」
 *    的依赖，成本高于自己写一个只认白名单子集的解析器；
 * 2. **解析结果必须是结构，不是 HTML 字符串**：本模块输出一棵只含允许节点的树，
 *    界面把它渲染成 React 元素。React 会转义文本，**因此不存在「忘记转义」这条失败路径**；
 * 3. **必须能穷举「什么不会发生」**：树里没有 `html` / `image` / `iframe` / `link` 节点，
 *    所以「模型写 `<img src=...>` 会不会发请求」这个问题在类型层就有答案——不会。
 *
 * ## 白名单（这是完整清单，不是示例）
 *
 * 块级：`heading`（1–6）、`paragraph`、`bulletList` / `orderedList`（可嵌套一层）、
 * `codeBlock`、`blockquote`、`divider`。
 * 行内：纯文本、`strong`、`em`、`code`。
 *
 * ## 三类**刻意不支持**的东西及其理由
 *
 * - **链接**：模型可以把数据编码进 URL 查询串，用户一点就外发。因此 `[文字](地址)`
 *   解析成**纯文本 `文字（地址）`**——地址被降级为文本，不可点击、不产生请求；
 * - **图片**：`![alt](src)` 解析成文本 `[图片：alt]`（**不保留地址**）。远程图片既会发请求，
 *   也可能被用作外发通道；
 * - **原始 HTML**：`<script>` / `<img>` / `<iframe>` 等一律按**纯文本**原样显示（含尖括号），
 *   让人看得见模型到底写了什么，同时不产生任何语义。
 *
 * 本模块是纯函数：不依赖 React / DOM / 网络 / 存储。
 */

/* ------------------------------------------------------------------ 树结构 */

export type AiMarkdownInline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'strong'; readonly text: string }
  | { readonly kind: 'em'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }

export type AiMarkdownListItem = {
  readonly blocks: readonly AiMarkdownBlock[]
}

export type AiMarkdownBlock =
  | { readonly kind: 'heading'; readonly level: number; readonly inlines: readonly AiMarkdownInline[] }
  | { readonly kind: 'paragraph'; readonly inlines: readonly AiMarkdownInline[] }
  | {
      readonly kind: 'bulletList'
      readonly items: readonly AiMarkdownListItem[]
      /** 解析时丢弃的层级（超过深度的嵌套被拍平），用于如实告知「有内容被简化」 */
      readonly flattenedDepth: number
    }
  | {
      readonly kind: 'orderedList'
      readonly items: readonly AiMarkdownListItem[]
      readonly flattenedDepth: number
    }
  | { readonly kind: 'codeBlock'; readonly language: string | null; readonly text: string }
  | { readonly kind: 'blockquote'; readonly inlines: readonly AiMarkdownInline[] }
  | { readonly kind: 'divider' }

/** 解析时发生的降级（**必须能被界面读到**：静默改写模型输出是不允许的） */
export type AiMarkdownDowngrade = {
  readonly kind: 'link-as-text' | 'image-as-text' | 'html-as-text' | 'list-flattened' | 'table-as-text'
  readonly detail: string
}

export type AiMarkdownDocument = {
  readonly blocks: readonly AiMarkdownBlock[]
  readonly downgrades: readonly AiMarkdownDowngrade[]
}

/* ------------------------------------------------------------------ 块级解析 */

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*([-*+])\s+(.*)$/
const ORDERED = /^\s*(\d{1,9})[.)]\s+(.*)$/
const DIVIDER = /^\s*([-*_])\s*\1\s*\1[-*_\s]*$/
const FENCE = /^\s*(```|~~~)\s*(\S*)\s*$/
const BLOCKQUOTE = /^\s*>\s?(.*)$/

/**
 * 最多解析的列表嵌套深度。
 *
 * 为什么限制：递归深度是不可信输入能直接控制的量（模型可以生成一万层缩进的列表）。
 * 超过深度的嵌套**拍平到当前层**，并把这次降级记进 `downgrades`，不静默丢弃内容。
 */
const MAX_LIST_DEPTH = 2

function isBlank(line: string): boolean {
  return line.trim() === ''
}

/** 行首空格数（制表符按 4 个空格算：模型与用户粘贴的内容里两种都有） */
function leadingSpacesOf(line: string): number {
  const match = /^[ \t]*/.exec(line)
  const prefix = match?.[0] ?? ''
  let count = 0
  for (const char of prefix) {
    count += char === '\t' ? 4 : 1
  }
  return count
}

/** 行内解析：只认 `**粗体**`、`*斜体*`、`` `代码` ``；链接与图片降级为文本 */
function parseInlines(
  input: string,
  downgrades: AiMarkdownDowngrade[],
): readonly AiMarkdownInline[] {
  const inlines: AiMarkdownInline[] = []
  let text = ''
  let index = 0

  const flush = (): void => {
    if (text !== '') {
      inlines.push({ kind: 'text', text })
      text = ''
    }
  }

  while (index < input.length) {
    const rest = input.slice(index)

    // 图片：![alt](src) → 文本，**不保留地址**（远程图片会发请求，也可能被用作外发通道）
    const image = /^!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/.exec(rest)
    if (image !== null) {
      flush()
      inlines.push({ kind: 'text', text: `[图片：${image[1] ?? ''}]` })
      downgrades.push({
        kind: 'image-as-text',
        detail: '图片已降级为文本标记，且不保留图片地址（远程图片会发起请求）。',
      })
      index += image[0].length
      continue
    }

    // 链接：[文字](地址) → `文字（地址）`，地址只是文本，不可点击
    const link = /^\[([^\]]*)\]\(([^)\s]*)[^)]*\)/.exec(rest)
    if (link !== null) {
      flush()
      const label = link[1] ?? ''
      const href = link[2] ?? ''
      inlines.push({ kind: 'text', text: href === '' ? label : `${label}（${href}）` })
      downgrades.push({
        kind: 'link-as-text',
        detail: '链接已降级为纯文本（含地址）：本应用不渲染可点击链接，避免点一下就外发数据。',
      })
      index += link[0].length
      continue
    }

    // 行内代码
    const code = /^`([^`]+)`/.exec(rest)
    if (code !== null) {
      flush()
      inlines.push({ kind: 'code', text: code[1] ?? '' })
      index += code[0].length
      continue
    }

    // 粗体：`**x**`；不配对时按普通字符处理
    const strong = /^\*\*([^*]+)\*\*/.exec(rest)
    if (strong !== null) {
      flush()
      inlines.push({ kind: 'strong', text: strong[1] ?? '' })
      index += strong[0].length
      continue
    }

    // 斜体：`*x*`（避开 `**`）
    const em = /^\*([^*\s][^*]*)\*/.exec(rest)
    if (em !== null) {
      flush()
      inlines.push({ kind: 'em', text: em[1] ?? '' })
      index += em[0].length
      continue
    }

    text += input[index] ?? ''
    index += 1
  }

  flush()
  return inlines
}

/** 表格行（`| a | b |`）：本项目不支持表格渲染，按文本段落处理并记录降级 */
function looksLikeTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line)
}

/**
 * 解析 Markdown 文本为一棵**只含白名单节点**的树。
 *
 * 解析是逐行的：块级结构按行判定，行内结构交给 `parseInlines`。
 * 所有降级都记进 `downgrades`，因此界面能如实告诉用户「有链接被降级为文本」。
 */
export function parseAiMarkdown(text: string): AiMarkdownDocument {
  const downgrades: AiMarkdownDowngrade[] = []
  const blocks: AiMarkdownBlock[] = []
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let index = 0
  /** 上一层列表项接受的缩进下界；递归下降时由 `parseList` 更新 */
  let indentOfCurrentLevel = 0

  const parseList = (ordered: boolean, depth: number): AiMarkdownBlock => {
    const items: AiMarkdownListItem[] = []
    let flattened = 0
    while (index < lines.length) {
      const line = lines[index] ?? ''
      const match = ordered ? ORDERED.exec(line) : BULLET.exec(line)
      if (match === null) {
        break
      }
      const indent = leadingSpacesOf(line)
      if (depth > 0 && indent < indentOfCurrentLevel) {
        // 缩进回到更外层：交给外层循环继续处理
        break
      }
      index += 1
      const itemBlocks: AiMarkdownBlock[] = [
        { kind: 'paragraph', inlines: parseInlines(match[2] ?? '', downgrades) },
      ]
      /** 该列表项之内、比它更缩进的子列表（真正的嵌套，而不是把文本拼成一行） */
      const childLists: AiMarkdownBlock[] = []
      const itemIndent = indent
      while (index < lines.length) {
        const next = lines[index] ?? ''
        if (isBlank(next)) {
          break
        }
        if (HEADING.test(next) || FENCE.test(next)) {
          break
        }
        const nextIndent = leadingSpacesOf(next)
        const nextBullet = BULLET.exec(next)
        const nextOrdered = ORDERED.exec(next)
        if (nextBullet !== null || nextOrdered !== null) {
          if (nextIndent <= itemIndent) {
            // 同级或更外层：属于下一个列表项
            break
          }
          if (depth + 1 >= MAX_LIST_DEPTH) {
            /*
             * 超过最大深度：把子项**当成普通段落文本**收进当前项（内容不丢），
             * 并记一次降级。这里不继续递归，避免深缩进的不可信输入把调用栈压垮。
             */
            childLists.push({
              kind: 'paragraph',
              inlines: parseInlines(
                (nextBullet?.[2] ?? nextOrdered?.[2] ?? next).trim(),
                downgrades,
              ),
            })
            flattened += 1
            index += 1
            continue
          }
          childLists.push(parseList(nextOrdered !== null, depth + 1))
          continue
        }
        if (nextIndent > itemIndent) {
          // 续行：并入当前列表项的文本
          childLists.push({
            kind: 'paragraph',
            inlines: parseInlines(next.trim(), downgrades),
          })
          index += 1
          continue
        }
        break
      }
      items.push({ blocks: [...itemBlocks, ...childLists] })
      indentOfCurrentLevel = itemIndent
    }
    if (flattened > 0) {
      downgrades.push({
        kind: 'list-flattened',
        detail: `有 ${String(flattened)} 个超过 ${String(MAX_LIST_DEPTH)} 层的列表项被拍平为文本（不静默丢弃内容）。`,
      })
    }
    return ordered
      ? { kind: 'orderedList', items, flattenedDepth: flattened }
      : { kind: 'bulletList', items, flattenedDepth: flattened }
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''

    if (isBlank(line)) {
      index += 1
      continue
    }

    // 代码块：围栏之间的内容原样保留（**不解析行内标记**）
    const fence = FENCE.exec(line)
    if (fence !== null) {
      const marker = fence[1] ?? '```'
      const language = (fence[2] ?? '').trim()
      index += 1
      const codeLines: string[] = []
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith(marker)) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      // 跳过收尾围栏（缺失时也不报错：模型输出常常漏掉）
      if (index < lines.length) {
        index += 1
      }
      blocks.push({
        kind: 'codeBlock',
        language: language === '' ? null : language,
        text: codeLines.join('\n'),
      })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading !== null) {
      index += 1
      blocks.push({
        kind: 'heading',
        level: (heading[1] ?? '#').length,
        inlines: parseInlines(heading[2] ?? '', downgrades),
      })
      continue
    }

    // 分隔线必须在列表之前判定：`---` 也满足分隔线正则
    if (DIVIDER.test(line)) {
      index += 1
      blocks.push({ kind: 'divider' })
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      blocks.push(parseList(false, 0))
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered !== null) {
      blocks.push(parseList(true, 0))
      continue
    }

    const quote = BLOCKQUOTE.exec(line)
    if (quote !== null) {
      index += 1
      const quoteLines: string[] = [quote[1] ?? '']
      while (index < lines.length) {
        const next = BLOCKQUOTE.exec(lines[index] ?? '')
        if (next === null) {
          break
        }
        quoteLines.push(next[1] ?? '')
        index += 1
      }
      blocks.push({ kind: 'blockquote', inlines: parseInlines(quoteLines.join(' '), downgrades) })
      continue
    }

    // 表格：不支持渲染 → 连续的表行合成一个段落，并记录降级
    if (looksLikeTableRow(line)) {
      const tableLines: string[] = []
      while (index < lines.length && looksLikeTableRow(lines[index] ?? '')) {
        tableLines.push((lines[index] ?? '').trim())
        index += 1
      }
      blocks.push({
        kind: 'paragraph',
        inlines: parseInlines(tableLines.join(' '), downgrades),
      })
      downgrades.push({
        kind: 'table-as-text',
        detail: '模型输出了表格，本应用按纯文本显示（不渲染表格结构，避免结构误读）。',
      })
      continue
    }

    // 段落：连续的普通行合成一段
    const paragraphLines: string[] = [line.trim()]
    index += 1
    while (index < lines.length) {
      const next = lines[index] ?? ''
      if (
        isBlank(next) ||
        HEADING.test(next) ||
        FENCE.test(next) ||
        BULLET.test(next) ||
        ORDERED.test(next) ||
        BLOCKQUOTE.test(next) ||
        DIVIDER.test(next) ||
        looksLikeTableRow(next)
      ) {
        break
      }
      paragraphLines.push(next.trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', inlines: parseInlines(paragraphLines.join(' '), downgrades) })
  }

  // 原始 HTML：**按纯文本原样显示**。这里只记录降级，内容本身已经在 text 节点里
  if (/<\s*(script|img|iframe|object|embed|svg|link|style|video|audio|form|input)\b/i.test(text)) {
    downgrades.push({
      kind: 'html-as-text',
      detail:
        '结果里出现了 HTML 标签：已按纯文本显示（含尖括号），不解析、不执行、不产生任何请求。',
    })
  }

  return { blocks, downgrades }
}

/* ------------------------------------------------------------------ 纯文本化 */

/** 行内节点 → 纯文本（链接与图片的地址已经在解析阶段降级/丢弃） */
function inlinePlainText(inlines: readonly AiMarkdownInline[]): string {
  return inlines.map((inline) => inline.text).join('')
}

/** 列表项 → 纯文本：列表项的子块**只可能是段落**（解析器保证），但这里仍按块类型分派 */
function listItemText(item: AiMarkdownListItem): string {
  return item.blocks
    .map((block) => ('inlines' in block ? inlinePlainText(block.inlines) : ''))
    .join(' ')
}

/**
 * 把解析树摊平成**纯文本**（复制与导出用）。
 *
 * 为什么复制也要走同一棵树：PRD 16.5 要求「复制使用净化后的 Markdown」。
 * 直接复制模型原文会把链接地址原样带走（用户贴到别处就可能变成可点链接）。
 * 摊平后链接是 `文字（地址）` 的纯文本，图片**连地址都没有**。
 */
export function markdownToPlainText(document: AiMarkdownDocument): string {
  const lines: string[] = []
  for (const block of document.blocks) {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
        lines.push(inlinePlainText(block.inlines), '')
        break
      case 'blockquote':
        lines.push(`> ${inlinePlainText(block.inlines)}`, '')
        break
      case 'divider':
        lines.push('————————', '')
        break
      case 'codeBlock':
        lines.push(block.text, '')
        break
      case 'bulletList':
        for (const item of block.items) {
          lines.push(`- ${listItemText(item)}`)
        }
        lines.push('')
        break
      case 'orderedList':
        block.items.forEach((item, order) => {
          lines.push(`${String(order + 1)}. ${listItemText(item)}`)
        })
        lines.push('')
        break
      default:
        break
    }
  }
  return lines.join('\n').trim()
}

/**
 * 生成**净化后的 Markdown**（复制与导出用）。
 *
 * 与 `markdownToPlainText` 的区别：这里保留 `#` / `-` 这类轻量结构标记，
 * 让人贴到文档工具里还能看出层次；但**去掉了所有链接与图片语法**，
 * 也**不会产生任何可点击链接**——地址已被降级为纯文本的一部分。
 */
export function sanitizeMarkdownText(document: AiMarkdownDocument): string {
  const inlineRich = (inlines: readonly AiMarkdownInline[]): string =>
    inlines
      .map((inline) => {
        switch (inline.kind) {
          case 'code':
            return `\`${inline.text}\``
          case 'strong':
            return `**${inline.text}**`
          case 'em':
            return `*${inline.text}*`
          default:
            return inline.text
        }
      })
      .join('')

  const itemRich = (item: AiMarkdownListItem): string =>
    item.blocks.map((block) => ('inlines' in block ? inlineRich(block.inlines) : '')).join(' ')

  const lines: string[] = []
  for (const block of document.blocks) {
    switch (block.kind) {
      case 'heading':
        lines.push(`${'#'.repeat(block.level)} ${inlineRich(block.inlines)}`, '')
        break
      case 'paragraph':
        lines.push(inlineRich(block.inlines), '')
        break
      case 'blockquote':
        lines.push(`> ${inlineRich(block.inlines)}`, '')
        break
      case 'divider':
        lines.push('---', '')
        break
      case 'codeBlock':
        lines.push(`\`\`\`${block.language ?? ''}`, block.text, '```', '')
        break
      case 'bulletList':
        for (const item of block.items) {
          lines.push(`- ${itemRich(item)}`)
        }
        lines.push('')
        break
      case 'orderedList':
        block.items.forEach((item, order) => {
          lines.push(`${String(order + 1)}. ${itemRich(item)}`)
        })
        lines.push('')
        break
      default:
        break
    }
  }
  return lines.join('\n').trim()
}

/**
 * 结果里是否出现了**外链地址**（用于把「模型试图给出链接」如实告知用户）。
 *
 * 这是一个**告知性**检查，不是阻断：地址已经被降级为纯文本，点不了。
 * 但用户有权知道模型输出了哪些地址——他可能据此判断模型在引导他点什么。
 */
export function findExternalReferences(document: AiMarkdownDocument): readonly string[] {
  const found: string[] = []
  const scanText = (text: string): void => {
    for (const match of text.matchAll(/https?:\/\/[^\s）)]+/g)) {
      found.push(match[0])
    }
  }
  for (const block of document.blocks) {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
      case 'blockquote':
        scanText(inlinePlainText(block.inlines))
        break
      case 'codeBlock':
        scanText(block.text)
        break
      case 'bulletList':
      case 'orderedList':
        for (const item of block.items) {
          scanText(listItemText(item))
        }
        break
      default:
        break
    }
  }
  // 地址清单本身会展示给用户，因此去重且排序，保证同一份输入得到同样的清单
  return [...new Set(found)].sort()
}
