import type { ReactNode } from 'react'

import { ReturnToAllScopeContext } from './returnToAllContext'

/**
 * 「返回全部数据」作用域的**提供者**（用户反馈 ②，2026-09-27 晚提出）。
 *
 * 用法：在装配点（`DashboardWorkspace` / `RejectionWorkspace`）把两个值提供一次，
 * 其下每个模块的标题栏（`SectionShell`）就会各自出现一个「返回全部数据」按钮。
 * 上下文与读取钩子在同目录的 `returnToAllScope.ts` —— 拆开是为了不破坏 React Fast Refresh
 * （oxlint 的 `react(only-export-components)`），理由写在那里。
 */
export function ReturnToAllScope({
  filtersActive,
  onReturnToAll,
  children,
}: {
  readonly filtersActive: boolean
  readonly onReturnToAll: () => void
  readonly children: ReactNode
}) {
  return (
    <ReturnToAllScopeContext.Provider value={{ filtersActive, onReturnToAll }}>
      {children}
    </ReturnToAllScopeContext.Provider>
  )
}
