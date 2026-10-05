/**
 * 把安全 Markdown **树**渲染成 React 元素（AI-5，docs/PRD.md 16.5）。
 *
 * ## 这个文件为什么存在（而不是渲染 HTML 字符串）
 *
 * 本项目的硬约束是**禁止 `dangerouslySetInnerHTML`**（AGENTS.md §6）。常见的做法是
 * 「把 Markdown 转成 HTML 字符串，再用它渲染」——那条路必然要放开 HTML 注入，
 * 于是「模型输出 `<img onerror=...>` 会不会执行」就变成了「我们的清洗够不够严」这种
 * 只能靠枚举的问题。这里换一种结构：
 *
 * **解析器产出树 → 这个组件把树映射成 React 元素**。React 会把所有文本转义，
 * 因此不存在「忘记转义」这条失败路径；树里也没有 `html` / `image` / `iframe` / `link`
 * 这类节点，所以「渲染会不会发请求」在**类型层**就有答案：不会。
 *
 * 三条由此自动成立的性质（AI12 的验收点）：
 * 1. 脚本不执行——没有地方能承载可执行内容；
 * 2. 远程图片不发请求——图片在解析阶段就降级成文本，且**不保留地址**；
 * 3. 外链不可点——链接降级成 `文字（地址）` 纯文本，界面里没有 `<a href>`。
 *
 * 本组件是纯展示层：不解析、不清洗、不判断（那些都在 `aiMarkdown.ts` 的纯函数里）。
 */

import type { AiMarkdownBlock, AiMarkdownDocument, AiMarkdownInline } from '../../ai/aiMarkdown'

/** 行内节点 → React 元素（**这是唯一的行内渲染点**，不允许别的写法） */
function Inline({ inlines }: { readonly inlines: readonly AiMarkdownInline[] }) {
  return (
    <>
      {inlines.map((inline, index) => {
        const key = `${inline.kind}-${String(index)}`
        switch (inline.kind) {
          case 'strong':
            return (
              <strong className="font-semibold text-slate-900" key={key}>
                {inline.text}
              </strong>
            )
          case 'em':
            return <em key={key}>{inline.text}</em>
          case 'code':
            return (
              <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs" key={key}>
                {inline.text}
              </code>
            )
          default:
            // 纯文本：React 自动转义，因此 `<script>` 这类内容只会显示成字面字符
            return <span key={key}>{inline.text}</span>
        }
      })}
    </>
  )
}

function Block({ block }: { readonly block: AiMarkdownBlock }) {
  switch (block.kind) {
    case 'heading': {
      // 层级收敛到 3–6：结果页已有页面标题（h1/h2），模型输出的 `#` 不该抢走文档层级
      const level = Math.min(6, Math.max(3, block.level + 2))
      const className =
        level === 3
          ? 'mt-4 text-sm font-semibold text-slate-900'
          : 'mt-3 text-xs font-semibold text-slate-800'
      const Tag = (`h${String(level)}`) as 'h3' | 'h4' | 'h5' | 'h6'
      return (
        <Tag className={className}>
          <Inline inlines={block.inlines} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p className="mt-2 text-xs leading-6 text-slate-700">
          <Inline inlines={block.inlines} />
        </p>
      )
    case 'blockquote':
      return (
        <blockquote className="mt-2 border-l-2 border-slate-300 pl-3 text-xs leading-6 text-slate-600">
          <Inline inlines={block.inlines} />
        </blockquote>
      )
    case 'divider':
      return <hr className="my-3 border-slate-200" />
    case 'codeBlock':
      return (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-800">
          {block.text}
        </pre>
      )
    case 'bulletList':
      return (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-6 text-slate-700">
          {block.items.map((item, index) => (
            <li key={`li-${String(index)}`}>
              {item.blocks.map((child, childIndex) => (
                <Block block={child} key={`li-${String(index)}-${String(childIndex)}`} />
              ))}
            </li>
          ))}
        </ul>
      )
    case 'orderedList':
      return (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-6 text-slate-700">
          {block.items.map((item, index) => (
            <li key={`oli-${String(index)}`}>
              {item.blocks.map((child, childIndex) => (
                <Block block={child} key={`oli-${String(index)}-${String(childIndex)}`} />
              ))}
            </li>
          ))}
        </ol>
      )
    default:
      return null
  }
}

/**
 * 渲染整棵安全 Markdown 树。
 *
 * 注意：这里**没有** `dangerouslySetInnerHTML`，也**没有**任何 `<a>` / `<img>` / `<iframe>`。
 * 守卫测试会检查这两件事（连注释里提到属性名都会被剥掉后再判定）。
 */
export default function AiMarkdownView({
  document,
}: {
  readonly document: AiMarkdownDocument
}) {
  if (document.blocks.length === 0) {
    return <p className="text-xs text-slate-500">结果正文为空。</p>
  }
  return (
    <div>
      {document.blocks.map((block, index) => (
        <Block block={block} key={`block-${String(index)}`} />
      ))}
    </div>
  )
}
