/**
 * 看板筛选纯逻辑单测（docs/PRD.md 6.3）。
 *
 * 覆盖：字段间 AND / 字段内 OR、「未知」是可选独立值、状态筛选要提示子集率、
 * 时间默认不筛选且非法输入不被采用、薪资分档边界解析、清空按钮的清理范围、
 * 选项清单排序（未知在最后）、趋势下钻换算成的月份区间。
 *
 * 数据来源是 `domain/analytics/fixtures.ts` 的**合成**记录（测试专用入口，
 * 刻意不在领域桶文件里导出，避免进入应用构建路径）。
 */

import { describe, expect, it } from 'vitest'

import { applyFilters, isStatusSubsetFilter, UNKNOWN } from '../../domain'
import { syntheticRecords } from '../../domain/analytics/fixtures'

import {
  EMPTY_DASHBOARD_FILTERS,
  activeFilterSummary,
  clearDimension,
  clearFilters,
  dimensionLabel,
  dimensionOptions,
  filterableDimensions,
  groupingOptionsOf,
  hasActiveFilters,
  parseSalaryBandEdges,
  setIncludeMissingDate,
  setSalaryBandEdgesText,
  setStatusValues,
  setTimeBasis,
  setTimeRange,
  timeInputIssues,
  timeRangeOfPeriod,
  toAnalysisFilters,
  toggleDimensionValue,
  toggleStatus,
} from './dashboardFilters'

const RECORDS = syntheticRecords([
  {
    offerStatus: '已入职',
    city: '上海',
    channel: '官网',
    recruitmentStartDate: '2026-01-05',
    joiningDate: '2026-01-15',
  },
  {
    offerStatus: '已入职',
    city: '广州',
    channel: 'Boss',
    recruitmentStartDate: '2026-02-05',
    joiningDate: '2026-02-20',
  },
  { offerStatus: '拒绝offer', city: '未知', channel: 'Boss', recruitmentStartDate: null },
  {
    offerStatus: '待入职',
    city: '上海',
    channel: '内推',
    recruitmentStartDate: '2026-03-01',
    joiningDate: '2026-03-21',
  },
])

describe('parseSalaryBandEdges', () => {
  it('解析中英文逗号分隔的边界并去重升序', () => {
    expect(parseSalaryBandEdges('4000，3000,5000,3000').edges).toEqual([3000, 4000, 5000])
  })

  it('非法片段单独报出，不静默丢弃', () => {
    const parsed = parseSalaryBandEdges('3000, 四千, 5000')

    expect(parsed.edges).toEqual([3000, 5000])
    expect(parsed.invalidTokens).toEqual(['四千'])
  })

  it('空输入得到空边界', () => {
    expect(parseSalaryBandEdges('   ').edges).toEqual([])
    expect(parseSalaryBandEdges('').invalidTokens).toEqual([])
  })
})

describe('维度筛选', () => {
  it('同一字段多选取并集（OR）', () => {
    const draft = toggleDimensionValue(
      toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'city', '上海'),
      'city',
      '广州',
    )

    expect(applyFilters(RECORDS, toAnalysisFilters(draft)).records.length).toBe(3)
  })

  it('不同字段之间取交集（AND）', () => {
    const draft = toggleDimensionValue(
      toggleDimensionValue(
        toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'city', '上海'),
        'city',
        '广州',
      ),
      'channel',
      'Boss',
    )
    const matched = applyFilters(RECORDS, toAnalysisFilters(draft)).records

    expect(matched.length).toBe(1)
    expect(matched[0].city).toBe('广州')
  })

  it('「未知」是可选的独立值，选它不会顺带排除其他值', () => {
    const draft = toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'city', UNKNOWN)
    const matched = applyFilters(RECORDS, toAnalysisFilters(draft)).records

    expect(matched.length).toBe(1)
    expect(matched[0].city).toBe(UNKNOWN)
  })

  it('取消最后一个值后该维度不再出现在筛选快照里（不留下空数组）', () => {
    const selected = toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'city', '上海')
    const cleared = toggleDimensionValue(selected, 'city', '上海')

    expect(toAnalysisFilters(cleared).dimensions.city).toBeUndefined()
    expect(hasActiveFilters(cleared)).toBe(false)
  })

  it('clearDimension 只影响指定维度', () => {
    const draft = toggleDimensionValue(
      toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'city', '上海'),
      'channel',
      'Boss',
    )
    const cleared = clearDimension(draft, 'city')

    expect(toAnalysisFilters(cleared).dimensions.city).toBeUndefined()
    expect(toAnalysisFilters(cleared).dimensions.channel).toEqual(['Boss'])
  })
})

describe('状态筛选', () => {
  it('单选状态后可识别为子集率（必须提示）', () => {
    const draft = toggleStatus(EMPTY_DASHBOARD_FILTERS, '已入职')
    const filters = toAnalysisFilters(draft)

    expect(isStatusSubsetFilter(filters)).toBe(true)
    expect(applyFilters(RECORDS, filters).records.length).toBe(2)
  })

  it('再次点击取消状态筛选', () => {
    const draft = toggleStatus(toggleStatus(EMPTY_DASHBOARD_FILTERS, '已入职'), '已入职')

    expect(isStatusSubsetFilter(toAnalysisFilters(draft))).toBe(false)
  })

  it('下钻「只看该状态」会替换（而不是叠加）状态筛选，且不动其他维度', () => {
    const draft = setStatusValues(
      toggleDimensionValue(toggleStatus(EMPTY_DASHBOARD_FILTERS, '待入职'), 'city', '上海'),
      ['拒绝offer'],
    )
    const filters = toAnalysisFilters(draft)

    expect(filters.statuses).toEqual(['拒绝offer'])
    expect(filters.dimensions.city).toEqual(['上海'])
  })
})

describe('时间筛选', () => {
  it('默认不生成时间筛选对象（time 为 null，不显示空条件）', () => {
    expect(toAnalysisFilters(EMPTY_DASHBOARD_FILTERS).time).toBeNull()
  })

  it('给定区间后按启动招聘日期过滤，日期缺失单独计数且默认不纳入', () => {
    const draft = setTimeRange(EMPTY_DASHBOARD_FILTERS, '2026-01-01', '2026-03-31')
    const outcome = applyFilters(RECORDS, toAnalysisFilters(draft))

    expect(outcome.matchedCount).toBe(3)
    expect(outcome.missingDateCount).toBe(1)
  })

  it('勾选「纳入日期缺失」后缺失记录进入结果，但缺失计数仍如实报出', () => {
    const draft = setIncludeMissingDate(
      setTimeRange(EMPTY_DASHBOARD_FILTERS, '2026-01-01', '2026-03-31'),
      true,
    )
    const outcome = applyFilters(RECORDS, toAnalysisFilters(draft))

    expect(outcome.matchedCount).toBe(4)
    expect(outcome.missingDateCount).toBe(1)
  })

  it('切换时间基准保留已填区间，只改变基准字段', () => {
    const draft = setTimeBasis(
      setTimeRange(EMPTY_DASHBOARD_FILTERS, '2026-01-01', '2026-03-31'),
      'joiningDate',
    )
    const time = toAnalysisFilters(draft).time

    expect(time?.basis).toBe('joiningDate')
    expect(time?.from).toBe('2026-01-01')
    expect(time?.to).toBe('2026-03-31')
  })

  it('非法日期不被采用（退回不限），并给出可读说明', () => {
    const draft = setTimeRange(EMPTY_DASHBOARD_FILTERS, '2026-13-01', '')

    expect(timeInputIssues(draft).length).toBe(1)
    expect(toAnalysisFilters(draft).time).toBeNull()
    expect(hasActiveFilters(draft)).toBe(false)
  })

  it('一端合法一端非法时只保留合法端', () => {
    const draft = setTimeRange(EMPTY_DASHBOARD_FILTERS, '2026-02-30', '2026-03-31')
    const time = toAnalysisFilters(draft).time

    expect(time?.from).toBeNull()
    expect(time?.to).toBe('2026-03-31')
    // 只有「结束日 ≤ 2026-03-31」生效，日期缺失的拒 offer 记录仍被排除
    expect(applyFilters(RECORDS, toAnalysisFilters(draft)).matchedCount).toBe(3)
  })
})

describe('薪资分档与分组选项', () => {
  it('合法分档边界传给引擎', () => {
    const draft = setSalaryBandEdgesText(EMPTY_DASHBOARD_FILTERS, '3000,4000')

    expect(groupingOptionsOf(draft)).toEqual({ salaryBandEdges: [3000, 4000] })
  })

  it('未配置分档时不给引擎编造边界（薪资区间维度全部归未知）', () => {
    expect(groupingOptionsOf(EMPTY_DASHBOARD_FILTERS)).toEqual({})
  })

  it('存在非法片段时整份分档视为未配置，避免半套分档', () => {
    const draft = setSalaryBandEdgesText(EMPTY_DASHBOARD_FILTERS, '3000,四千')

    expect(groupingOptionsOf(draft)).toEqual({})
  })
})

describe('清空按钮', () => {
  it('清掉维度、状态、时间与缺失纳入，保留分档口径与时间基准', () => {
    const busy = setIncludeMissingDate(
      setSalaryBandEdgesText(
        setTimeBasis(
          setTimeRange(
            toggleStatus(toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'city', '上海'), '待入职'),
            '2026-01-01',
            '2026-03-31',
          ),
          'joiningDate',
        ),
        '3000,4000',
      ),
      true,
    )
    const cleared = clearFilters(busy)

    expect(hasActiveFilters(busy)).toBe(true)
    expect(hasActiveFilters(cleared)).toBe(false)
    expect(cleared.timeBasis).toBe('joiningDate')
    expect(cleared.salaryBandEdgesText).toBe('3000,4000')
  })
})

describe('选项清单', () => {
  it('按出现次数降序，「未知」固定排在最后', () => {
    const options = dimensionOptions(RECORDS, 'city', EMPTY_DASHBOARD_FILTERS)

    expect(options.map((option) => option.value)).toEqual(['上海', '广州', UNKNOWN])
    expect(options[0]).toEqual({ value: '上海', count: 2, selected: false })
    expect(options[2]).toEqual({ value: UNKNOWN, count: 1, selected: false })
  })

  it('已选中的值带 selected 标记', () => {
    const draft = toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'channel', 'Boss')
    const options = dimensionOptions(RECORDS, 'channel', draft)

    expect(options.find((option) => option.value === 'Boss')?.selected).toBe(true)
    expect(options.find((option) => option.value === '官网')?.selected).toBe(false)
  })

  it('没有任何取值的维度返回空清单（不显示假选项）', () => {
    expect(dimensionOptions([], 'city', EMPTY_DASHBOARD_FILTERS)).toEqual([])
  })

  it('可筛选维度与引擎维度同源，且带中文标签', () => {
    const dimensions = filterableDimensions()

    expect(dimensions).toContain('city')
    expect(dimensions).toContain('salaryBand')
    expect(dimensions.length).toBeGreaterThanOrEqual(14)
    expect(dimensionLabel('city')).toBe('城市')
  })
})

describe('生效筛选描述', () => {
  it('无筛选时不产生任何描述', () => {
    expect(activeFilterSummary(EMPTY_DASHBOARD_FILTERS)).toEqual([])
  })

  it('描述包含维度取值、子集率提示与分档边界', () => {
    const draft = setSalaryBandEdgesText(
      toggleStatus(toggleDimensionValue(EMPTY_DASHBOARD_FILTERS, 'city', UNKNOWN), '拒绝offer'),
      '3000,4000',
    )
    const summary = activeFilterSummary(draft).join('｜')

    expect(summary).toContain(UNKNOWN)
    expect(summary).toContain('当前为子集率')
    expect(summary).toContain('薪资分档边界：3000 / 4000')
  })
})

describe('趋势下钻', () => {
  it('月份键换算成该月闭区间', () => {
    expect(timeRangeOfPeriod('2026-03')).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(timeRangeOfPeriod('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(timeRangeOfPeriod('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
  })

  it('非法月份键返回 null（不猜一个区间）', () => {
    expect(timeRangeOfPeriod('2026-13')).toBeNull()
    expect(timeRangeOfPeriod('2026-3')).toBeNull()
    expect(timeRangeOfPeriod('2026-03-01')).toBeNull()
  })
})
