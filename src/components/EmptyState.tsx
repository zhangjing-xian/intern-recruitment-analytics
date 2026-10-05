import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type EmptyStateProps = {
  /** 空态标题，直接说明“现在没有什么” */
  title: string
  /** 空态说明：为什么是空的、本页最终会做什么 */
  description: string
  /** 本页将要提供的内容清单（可选） */
  items?: readonly string[]
  /** 推荐下一步（可选） */
  nextStep?: { readonly label: string; readonly to: string }
  children?: ReactNode
}

/**
 * 统一空态组件。
 * 遵守 docs/PRD.md 第 7 章「通用状态」：没有数据时必须明确说明，
 * 不能用空白图表或 0 值掩盖「未导入 / 无符合筛选数据 / 样本不足」。
 */
export default function EmptyState({
  title,
  description,
  items,
  nextStep,
  children,
}: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{description}</p>

      {items !== undefined && items.length > 0 && (
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-slate-600">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      {nextStep !== undefined && (
        <Link
          className="mt-5 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
          to={nextStep.to}
        >
          {nextStep.label}
        </Link>
      )}

      {children}
    </div>
  )
}
