import { createContext, useContext } from 'react'

/**
 * 「返回全部数据」作用域的上下文与读取钩子（用户反馈 ②，2026-09-27 晚提出）。
 *
 * 与提供者 `ReturnToAllScope.tsx` **分成两个文件**是刻意的：oxlint 的
 * `react(only-export-components)` 要求一个文件要么只导出组件、要么只导出非组件，
 * 混在一起会让 React Fast Refresh 失效（开发时改一个文件就整页刷）。
 * 因此这里只放「上下文 + 钩子」这种非组件导出，组件单独一个文件。
 *
 * 文件名叫 `returnToAllContext.ts`（而不是 `returnToAllScope.ts`）还有一个现实原因：
 * Windows 文件系统**不区分大小写**，`returnToAllScope.ts` 与 `ReturnToAllScope.tsx`
 * 会被解析成同一个文件——于是 `import { ReturnToAllScope } from './ReturnToAllScope'`
 * 会跑去那个文件里找组件并以「没有该导出」失败（这一步真的踩到了，typecheck 与 26 个用例一起红）。
 * 两个文件名必须**不只差大小写**。
 *
 * ## 为什么用作用域，而不是给 12 个模块逐个传 props
 *
 * 用户的原话是「每个模块上都要有一个」：看板的分维度分析有 8 个模块、拒 offer 专项有 4 个，
 * 这些模块都由 `SectionShell` 渲染标题栏。如果把 `filtersActive` / `onReturnToAll`
 * 一路显式传下去，需要改 12 个组件的 props 并在装配点写 24 处传参——
 * 任何一个模块忘了接，就会出现「这一块没有返回按钮」，而且**编译不会报错**。
 *
 * 用作用域后：装配点（`DashboardWorkspace` / `RejectionWorkspace`）提供一次，
 * `SectionShell` 统一读取一次，**每个模块自动都有**，行为与按钮文案只有一份实现。
 *
 * ## 纪律
 *
 * - 这里**不**判断「有没有筛选」、也**不**清筛选：两个值都由页面传入，
 *   它们来自 `dashboardFilters.ts` 的 `hasActiveFilters` / `clearFilters`（纯函数，
 *   与筛选条的「清空筛选」是**同一个动作**）。
 * - 作用域为 `null`（没提供）时 `SectionShell` 什么也不渲染：这样把某个模块单独拿出来用时，
 *   不会出现一个「点了没反应」的按钮。
 */
export type ReturnToAllScopeValue = {
  readonly filtersActive: boolean
  readonly onReturnToAll: () => void
}

export const ReturnToAllScopeContext = createContext<ReturnToAllScopeValue | null>(null)

/** 读取当前作用域；没提供时返回 `null`（调用方据此不渲染按钮） */
export function useReturnToAllScope(): ReturnToAllScopeValue | null {
  return useContext(ReturnToAllScopeContext)
}
