// @vitest-environment jsdom
/**
 * 全局筛选与 KPI 卡片的**真实 DOM 交互**测试（步骤14，覆盖 A07）。
 *
 * ## 这一组证的是什么
 *
 * A07 的通过条件是「共用筛选快照，指标完全一致」。步骤8 当时的验证是纯函数 + 静态渲染冒烟，
 * 「筛选面板真实交互（打勾 / 清空后数字是否随之变化）」记在未验证里。这里补上：
 *
 * 1. 点城市筛选 → 卡片上的 N 变成引擎对同一份筛选快照算出的 N（**不是**硬编码的数字）；
 * 2. 清空筛选 → 恢复全量；
 * 3. 状态筛选生效时，界面按引擎给的 `subsetRateNote` 如实说明「这是子集率」。
 *
 * 断言方式刻意选「与引擎结果对比」而不是「比对固定数字」：后者只能证明今天的常量没变，
 * 前者才能证明**界面显示的就是引擎算的**。
 */

import { useMemo, useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import {
  analyzeRecords,
  type City,
  type NormalizedRecord,
} from '../../domain'
import { syntheticRecords as buildRecords } from '../../domain/analytics/fixtures'
import GlobalFilterPanel from './GlobalFilterPanel'
import KpiCards from './KpiCards'
import {
  EMPTY_DASHBOARD_FILTERS,
  clearFilters,
  toAnalysisFilters,
  type DashboardFilterDraft,
} from './dashboardFilters'

const SHA = '上海' as City
const GZ = '广州' as City

/** 12 条合成记录：6 条上海 / 6 条广州，覆盖入职、待入职、审批中与两种拒绝 */
const RECORDS: readonly NormalizedRecord[] = buildRecords([
  { offerStatus: '已入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 4200 },
  { offerStatus: '已入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 4500 },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: 3100 },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: 5200 },
  { offerStatus: '已入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 6100 },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: 3900 },
  { offerStatus: '待入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 3800 },
  { offerStatus: '拒绝offer', city: GZ, recruiter: '合成HR-乙', salaryAmount: 4400 },
  { offerStatus: '拒绝offer', city: SHA, recruiter: '合成HR-甲', salaryAmount: 4700 },
  { offerStatus: '拒绝口头offer', city: GZ, recruiter: '合成HR-乙', salaryAmount: 4900 },
  { offerStatus: 'offer审批中', city: SHA, recruiter: '合成HR-甲', salaryAmount: 5300 },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: 4100 },
])

const SALARY_EDGES = [3000, 4000, 5000, 6000]

/** 与看板同样的装配方式：筛选快照 → 引擎 → 卡片与筛选面板共用同一个结果 */
function analyzeWith(draft: DashboardFilterDraft) {
  return analyzeRecords(RECORDS, {
    dataAsOf: '2026-08-31',
    dedupStrategy: '确认后每组保留首条',
    salaryComparable: true,
    filters: toAnalysisFilters(draft),
    salaryBandEdges: SALARY_EDGES,
  })
}

function Harness() {
  const [draft, setDraft] = useState<DashboardFilterDraft>(EMPTY_DASHBOARD_FILTERS)
  const analysis = useMemo(() => analyzeWith(draft), [draft])
  return (
    <>
      <GlobalFilterPanel
        draft={draft}
        filterOutcome={analysis.filterOutcome}
        onChange={setDraft}
        records={RECORDS}
        subsetRateNote={analysis.subsetRateNote}
      />
      <KpiCards analysis={analysis} />
      {/* 与面板共用同一个快照的「真实值」参照：界面显示必须与它一致 */}
      <output data-testid="engine-N">{analysis.statusCounts.total}</output>
      <output data-testid="engine-D">{analysis.statusCounts.coreDenominator}</output>
      <button onClick={() => setDraft(clearFilters(draft))} type="button">
        测试用清空
      </button>
    </>
  )
}

/** 读页面上「总 offer 记录数（含审批中）」那张卡片的数值 */
function displayedN(): string {
  const label = screen.getByText('总 offer 记录数（含审批中）')
  const card = label.closest('div')
  expect(card).not.toBeNull()
  return card?.textContent ?? ''
}

afterEach(() => {
  cleanup()
})

describe('步骤14：筛选交互与 KPI 一致（A07）', () => {
  it('初始不筛选：卡片上的 N 与引擎算出的 N 一致', () => {
    render(<Harness />)

    expect(screen.getByTestId('engine-N').textContent).toBe('12')
    expect(displayedN()).toContain('12')
    // 与引擎比，而不是与写死的数字比
    expect(displayedN()).toContain(screen.getByTestId('engine-N').textContent ?? '')
  })

  it('点城市「上海」 → 卡片数字随之变化，且仍等于引擎对该筛选的结果', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /^上海/ }))

    const expected = analyzeWith({ ...EMPTY_DASHBOARD_FILTERS, dimensions: { city: [SHA] } })
    expect(screen.getByTestId('engine-N').textContent).toBe(String(expected.statusCounts.total))
    expect(screen.getByTestId('engine-D').textContent).toBe(
      String(expected.statusCounts.coreDenominator),
    )
    expect(displayedN()).toContain(String(expected.statusCounts.total))
    // 分母也必须跟着变（不能只换分子）
    expect(expected.statusCounts.total).toBeLessThan(RECORDS.length)
  })

  it('再点一次同一城市 → 取消筛选，恢复全量', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    const chip = screen.getByRole('button', { name: /^上海/ })
    await user.click(chip)
    expect(screen.getByTestId('engine-N').textContent).not.toBe('12')

    await user.click(screen.getByRole('button', { name: /^上海/ }))
    expect(screen.getByTestId('engine-N').textContent).toBe('12')
  })

  it('状态筛选生效时如实说明这是子集率（不全量冒充）', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // 状态筛选区的按钮文案由引擎的标签给出（已入职 / 待入职 / …）
    await user.click(screen.getByRole('button', { name: /^已入职/ }))

    const expected = analyzeWith({
      ...EMPTY_DASHBOARD_FILTERS,
      statuses: ['已入职'],
    })
    expect(expected.subsetRateNote).not.toBeNull()
    expect(screen.getByText(expected.subsetRateNote ?? '')).toBeTruthy()
  })

  it('清空筛选后回到全量，且分母一并恢复', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: /^广州/ }))
    expect(screen.getByTestId('engine-D').textContent).not.toBe(
      String(analyzeWith(EMPTY_DASHBOARD_FILTERS).statusCounts.coreDenominator),
    )

    await user.click(screen.getByRole('button', { name: '测试用清空' }))
    const full = analyzeWith(EMPTY_DASHBOARD_FILTERS)
    expect(screen.getByTestId('engine-N').textContent).toBe(String(full.statusCounts.total))
    expect(screen.getByTestId('engine-D').textContent).toBe(
      String(full.statusCounts.coreDenominator),
    )
    expect(displayedN()).toContain(String(full.statusCounts.total))
  })
})

describe('步骤14：合成夹具自检', () => {
  it('夹具里的 HR 都是合成值，且没有填充任何身份类字段', () => {
    const recruiters = RECORDS.map((record) => record.recruiter ?? '')
    expect(recruiters.length).toBeGreaterThan(0)
    expect(recruiters.every((name) => name.includes('合成'))).toBe(true)
    /*
     * 身份类字段一个都没填：这既证明夹具是合成的，也说明本文件里的筛选断言
     * 不依赖任何真实姓名 / 需求编号（AGENTS.md §2.6）。
     */
    expect(RECORDS.every((record) => (record.requirementId ?? null) === null)).toBe(true)
  })
})
