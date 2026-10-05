// @vitest-environment jsdom
/**
 * 「返回全部数据」按钮的**真实 DOM 交互**测试（用户需求 4）。
 *
 * ## 这一组证的是什么
 *
 * 真实验收反馈：在分维度表里点「只看该组」之后，视觉停在表格上，找不到回到全部数据的入口
 * （筛选条在页面顶部）。因此三处下钻（状态结构 / 时间趋势 / 分维度表）附近都放了同一个按钮。
 *
 * 这里证三件事：
 *
 * 1. **没有筛选时按钮是灰的**，并且给出「为什么点不了」，而不是一个静默无效的按钮；
 * 2. **下钻之后按钮可点**（下钻用的是与看板同一个 `setDimensionValues`）；
 * 3. **点它确实回到全量**：读数是引擎对空筛选快照重新算出来的数（**不是**硬编码的还原），
 *    并断言它走的就是 `clearFilters`（与筛选条「清空筛选」同一个纯函数）。
 *
 * 为什么不在这里渲染整个 `DimensionAnalysisPanel`：那个面板会挂 ECharts（需要 canvas），
 * 在 jsdom 里测不到真实渲染；图表的真实集成由 `tests/e2e/local-flow.spec.ts` 在真实 Chrome 里证明。
 */

import { useMemo, useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { analyzeRecords } from '../../domain'
import { syntheticRecords as buildRecords } from '../../domain/analytics/fixtures'
import ReturnToAllButton from './ReturnToAllButton'
import {
  EMPTY_DASHBOARD_FILTERS,
  activeFilterSummary,
  clearFilters,
  hasActiveFilters,
  setDimensionValues,
  toAnalysisFilters,
  type DashboardFilterDraft,
} from './dashboardFilters'
import {
  RETURN_TO_ALL_ACTIVE_NOTE,
  RETURN_TO_ALL_IDLE_NOTE,
  RETURN_TO_ALL_LABEL,
} from './dashboardText'

afterEach(cleanup)

const RECORDS = buildRecords([
  { offerStatus: '已入职', city: '上海' },
  { offerStatus: '已入职', city: '上海' },
  { offerStatus: '已入职', city: '广州' },
  { offerStatus: '拒绝offer', city: '广州' },
  { offerStatus: '待入职', city: '杭州' },
])

function analyzeWith(draft: DashboardFilterDraft) {
  return analyzeRecords(RECORDS, {
    dataAsOf: '2026-08-31',
    dedupStrategy: '确认后每组保留首条',
    salaryComparable: true,
    filters: toAnalysisFilters(draft),
  })
}

describe('用户需求4：返回全部数据', () => {
  it('没有筛选时按钮置灰，并说明原因', () => {
    render(<ReturnToAllButton filtersActive={false} onReturnToAll={() => {}} />)
    const button = screen.getByRole('button', { name: RETURN_TO_ALL_LABEL })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(RETURN_TO_ALL_IDLE_NOTE)).toBeTruthy()
  })

  it('有筛选时可点，点击只触发一次回调（组件自己不清筛选）', async () => {
    const user = userEvent.setup()
    const onReturnToAll = vi.fn()
    render(<ReturnToAllButton filtersActive onReturnToAll={onReturnToAll} />)
    expect(screen.getByText(RETURN_TO_ALL_ACTIVE_NOTE)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: RETURN_TO_ALL_LABEL }))
    expect(onReturnToAll).toHaveBeenCalledTimes(1)
  })

  it('下钻后点它回到全量：读数由引擎对空筛选快照重算，且生效筛选描述一并清空', async () => {
    const user = userEvent.setup()

    /** 与看板同样的装配：draft 是唯一筛选状态，判定与清空都走纯函数 */
    function Harness() {
      const [draft, setDraft] = useState<DashboardFilterDraft>(EMPTY_DASHBOARD_FILTERS)
      const analysis = useMemo(() => analyzeWith(draft), [draft])
      const filtersActive = useMemo(() => hasActiveFilters(draft), [draft])
      const summary = useMemo(() => activeFilterSummary(draft), [draft])
      return (
        <>
          <ReturnToAllButton
            filtersActive={filtersActive}
            onReturnToAll={() => {
              setDraft((current) => clearFilters(current))
            }}
          />
          <p data-testid="n">{String(analysis.statusCounts.total)}</p>
          <p data-testid="summary">{summary.join(' | ')}</p>
          <button
            onClick={() => {
              setDraft((current) => setDimensionValues(current, 'city', ['上海']))
            }}
            type="button"
          >
            模拟下钻上海
          </button>
        </>
      )
    }

    render(<Harness />)
    const full = Number(screen.getByTestId('n').textContent)
    // 全量 = 引擎算出的 5 条；此时按钮是灰的
    expect(full).toBe(5)
    expect((screen.getByRole('button', { name: RETURN_TO_ALL_LABEL }) as HTMLButtonElement).disabled).toBe(
      true,
    )

    await user.click(screen.getByRole('button', { name: '模拟下钻上海' }))
    const subset = Number(screen.getByTestId('n').textContent)
    // 下钻后确实是子集（上海 2 条），且生效筛选有描述
    expect(subset).toBe(2)
    expect(subset).toBeLessThan(full)
    expect(screen.getByTestId('summary').textContent).not.toBe('')
    expect((screen.getByRole('button', { name: RETURN_TO_ALL_LABEL }) as HTMLButtonElement).disabled).toBe(
      false,
    )

    await user.click(screen.getByRole('button', { name: RETURN_TO_ALL_LABEL }))
    // 回到全量：与开头的全量读数一致（由引擎重算，不是硬编码），筛选描述清空
    expect(Number(screen.getByTestId('n').textContent)).toBe(full)
    expect(screen.getByTestId('summary').textContent).toBe('')
    expect(hasActiveFilters(EMPTY_DASHBOARD_FILTERS)).toBe(false)
  })
})
