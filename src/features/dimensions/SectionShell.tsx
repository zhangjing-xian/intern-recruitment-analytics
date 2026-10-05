import type { ReactNode } from 'react'

import ReturnToAllButton from '../dashboard/ReturnToAllButton'
import { useReturnToAllScope } from '../dashboard/returnToAllContext'

/** 章节外壳（标题 + 口径提示 + 右上角操作），让各 section 的版式一致 */
export default function SectionShell({
  title,
  notes = [],
  actions,
  children,
}: {
  readonly title: string
  /** 口径提示（来自引擎的 note / 规则文案，界面不改写） */
  readonly notes?: readonly string[]
  readonly actions?: ReactNode
  readonly children: ReactNode
}) {
  /*
   * 用户反馈 ②（2026-09-27 晚）：每个模块上都要有「返回全部数据」。
   * 按钮由作用域统一提供（见 `dashboard/ReturnToAllScope.tsx`），因此**每个模块自动都有**，
   * 不需要每个 section 各接一次 props；没提供作用域时（例如单独渲染某个 section 的测试）
   * 不渲染按钮，避免出现「点了没反应」的空按钮。
   */
  const returnToAllScope = useReturnToAllScope()
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {returnToAllScope === null ? null : (
            <ReturnToAllButton
              filtersActive={returnToAllScope.filtersActive}
              onReturnToAll={returnToAllScope.onReturnToAll}
            />
          )}
        </div>
      </div>
      {notes.map((note) => (
        <p className="text-xs leading-5 text-slate-600" key={note}>
          {note}
        </p>
      ))}
      {children}
    </section>
  )
}
