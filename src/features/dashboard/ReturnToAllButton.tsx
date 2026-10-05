import {
  RETURN_TO_ALL_ACTIVE_NOTE,
  RETURN_TO_ALL_HINT,
  RETURN_TO_ALL_IDLE_NOTE,
  RETURN_TO_ALL_LABEL,
} from './dashboardText'

type ReturnToAllButtonProps = {
  /** 当前是否有筛选生效（由 `hasActiveFilters(draft)` 判定，组件不自己判断） */
  readonly filtersActive: boolean
  /** 清空全部筛选；调用方传的必须是 `clearFilters`（与筛选条同一个纯函数） */
  readonly onReturnToAll: () => void
}

/**
 * 「返回全部数据」按钮（用户需求 4，2026-09-27 提出）。
 *
 * ## 为什么它必须是一个共享组件
 *
 * 看板上有**三处**会把全局筛选改掉的下钻：状态结构图（点某个状态）、时间趋势图（点某个月）、
 * 分维度分析表里的「只看该组」。三处都会让上方筛选条变化，而筛选条在页面顶部——
 * 用户下钻后视线留在图 / 表上，找不到回到全部数据的入口。三处各写一个按钮必然出现
 * 三种文案、三种禁用规则，因此这里只写一次，三处都用它。
 *
 * ## 纪律
 *
 * - 它**不**自己判断「有没有筛选」，也不自己清筛选：`filtersActive` 与 `onReturnToAll`
 *   都由看板传入（`hasActiveFilters` / `clearFilters` 都在 `dashboardFilters.ts` 里，
 *   是纯函数）。组件只负责显示，不复制口径。
 * - 按钮文案里**没有** Markdown 强调标记（会被逐字渲染），由 `uiTextGuard` 全仓扫描守卫。
 * - 置灰时给出「为什么点不了」，而不是一个静默无效的按钮。
 */
export default function ReturnToAllButton({
  filtersActive,
  onReturnToAll,
}: ReturnToAllButtonProps) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        className={[
          'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
          filtersActive
            ? 'bg-slate-900 text-white hover:bg-slate-700'
            : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400',
        ].join(' ')}
        disabled={!filtersActive}
        onClick={onReturnToAll}
        title={RETURN_TO_ALL_HINT}
        type="button"
      >
        {RETURN_TO_ALL_LABEL}
      </button>
      <span className="text-xs text-slate-500">
        {filtersActive ? RETURN_TO_ALL_ACTIVE_NOTE : RETURN_TO_ALL_IDLE_NOTE}
      </span>
    </span>
  )
}
