import type { ReactNode } from 'react'

import { getNavItem } from '../lib/navigation'

type PageShellProps = {
  /** 必须与 src/lib/navigation.ts 中登记的路由路径一致 */
  path: string
  children: ReactNode
}

/**
 * 页面外壳：统一标题、页面职责说明与「计划实现」标记。
 * 标题与说明都取自 src/lib/navigation.ts，保证导航与页面文案只有一个来源。
 */
export default function PageShell({ path, children }: PageShellProps) {
  const item = getNavItem(path)

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{item.label}</h1>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
            计划实现：{item.plannedStep}
          </span>
        </div>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{item.summary}</p>
      </header>

      {children}
    </section>
  )
}
