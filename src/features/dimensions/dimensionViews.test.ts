/**
 * 分维度分析的纯逻辑层单测（步骤9）。
 *
 * 重点覆盖三类「错了就会出事故」的规则：
 * 1. **合并行不能下钻**——`topNWithOther` 生成的「其他（N 个分组合并）」不是真实维度取值，
 *    把它写进筛选快照会让用户以为筛的是某个岗位 / 城市；
 * 2. **分母 0 与合并行都不进量率散点**——前者会画成「拒率 0%」的假点，后者会冒充一个取值，
 *    但两者都必须继续出现在数据表里（计数不能丢）；
 * 3. **样本门槛统一取引擎**——组件不自己比 10。
 *
 * 数据全部来自 `domain/analytics/fixtures.ts` 的合成夹具（AGENTS.md §2.6）。
 */

import { describe, expect, it } from 'vitest'

import { UNKNOWN, type GroupSummary, type MetricAvailability } from '../../domain'
import { aggregateByDimension, summarizeRecords, topNWithOther } from '../../domain/analytics/grouping'
import { syntheticRecords } from '../../domain/analytics/fixtures'

import {
  CHART_CATEGORY_MAX_LENGTH,
  DEFAULT_TOP_N,
  RANK_TABLE_MODES,
  RANK_TABLE_MODE_LABELS,
  SCHOOL_TOP_N,
  STRUCTURE_DIMENSIONS,
  drilldownValueOf,
  isMergedGroupKey,
  isModuleDisabled,
  metricValueOf,
  moduleUnavailableReason,
  sampleTagOf,
  scatterPointsOf,
  sortGroupsForChart,
  truncateCategoryLabel,
} from './dimensionViews'

/** 15 个不同岗位（每个 1 条记录），用来排出 Top8 + 合并行 */
function manyPositions(): readonly GroupSummary[] {
  return aggregateByDimension(
    syntheticRecords(
      Array.from({ length: 15 }, (_, index) => ({
        position: `岗位${String(index + 1).padStart(2, '0')}`,
        offerStatus: '已入职' as const,
      })),
    ),
    'position',
  )
}

describe('合并行识别与下钻取值', () => {
  it('识别 topNWithOther 生成的合并行，真实取值不误判', () => {
    expect(isMergedGroupKey('其他（3 个分组合并）')).toBe(true)
    expect(isMergedGroupKey('其他（12 个分组合并）')).toBe(true)
    // 真实取值不能被当成合并行
    expect(isMergedGroupKey('其他')).toBe(false)
    expect(isMergedGroupKey('其他城市')).toBe(false)
    expect(isMergedGroupKey('上海')).toBe(false)
    expect(isMergedGroupKey(UNKNOWN)).toBe(false)
  })

  it('合并行不可下钻（返回 null），真实取值返回自身', () => {
    const merged = summarizeRecords('其他（3 个分组合并）', [])
    const real = summarizeRecords('上海', [])
    expect(drilldownValueOf(merged)).toBeNull()
    expect(drilldownValueOf(real)).toBe('上海')
  })
})

describe('样本门槛', () => {
  it('分母 0 → none；0 < D < 10 → small；D ≥ 10 → sufficient', () => {
    const none = summarizeRecords('无', syntheticRecords([{ offerStatus: 'offer审批中' }]))
    expect(sampleTagOf(none)).toBe('none')

    const small = summarizeRecords(
      '小',
      syntheticRecords([
        { offerStatus: '已入职' },
        { offerStatus: '拒绝offer' },
        { offerStatus: 'offer审批中' },
      ]),
    )
    expect(small.counts.coreDenominator).toBe(2)
    expect(sampleTagOf(small)).toBe('small')

    const sufficient = summarizeRecords(
      '够',
      syntheticRecords(
        Array.from({ length: 10 }, () => ({ offerStatus: '已入职' as const })),
      ),
    )
    expect(sufficient.counts.coreDenominator).toBe(10)
    expect(sampleTagOf(sufficient)).toBe('sufficient')
  })

  it('门槛可由调用方覆盖（组件不写死 10）', () => {
    const group = summarizeRecords(
      '小',
      syntheticRecords([{ offerStatus: '已入职' }, { offerStatus: '拒绝offer' }]),
    )
    expect(sampleTagOf(group, 2)).toBe('sufficient')
    expect(sampleTagOf(group, 3)).toBe('small')
  })
})

describe('量率散点数据点', () => {
  it('排除合并行（不冒充取值），但合并行仍留在完整分组里', () => {
    const all = manyPositions()
    expect(all.length).toBe(15)

    const withOther = topNWithOther(all, DEFAULT_TOP_N)
    expect(withOther.length).toBe(DEFAULT_TOP_N + 1)
    const mergedKey = withOther[withOther.length - 1].key
    expect(isMergedGroupKey(mergedKey)).toBe(true)

    const points = scatterPointsOf(withOther)
    expect(points.length).toBe(DEFAULT_TOP_N)
    expect(points.some((point) => point.name === mergedKey)).toBe(false)
    // 数据表仍然能看到合并行与其计数
    expect(withOther.some((group) => group.key === mergedKey)).toBe(true)
  })

  it('排除分母 0 的分组（不画「拒率 0%」的假点）', () => {
    const noDenominator = summarizeRecords(
      '只有审批中',
      syntheticRecords([{ offerStatus: 'offer审批中' }]),
    )
    expect(noDenominator.counts.coreDenominator).toBe(0)
    expect(noDenominator.rates.rejectionRate.value).toBeNull()
    expect(scatterPointsOf([noDenominator])).toEqual([])
  })

  it('点大小按记录数缩放到 4–28 px，且率保持 0–1 比率（不预先 ×100）', () => {
    const two = syntheticRecords([
      { position: '多', offerStatus: '已入职' },
      { position: '多', offerStatus: '拒绝offer' },
      { position: '多', offerStatus: '已入职' },
      { position: '多', offerStatus: '待入职' },
      { position: '少', offerStatus: '拒绝offer' },
    ])
    const points = scatterPointsOf(aggregateByDimension(two, 'position'))

    const many = points.find((point) => point.name === '多')
    const few = points.find((point) => point.name === '少')
    expect(many).toBeDefined()
    expect(few).toBeDefined()

    // 「多」4 条是最大记录数 → 拉满 28px；「少」1 条 → 4 + 24*(1/4) = 10px
    expect(many?.symbolSize).toBe(28)
    expect(few?.symbolSize).toBe(10)
    expect(many?.total).toBe(4)
    // D = J + P + R = 2 + 1 + 1 = 4（审批中不进核心分母），拒 offer 率 = R / D = 1/4
    // 比率仍是 0–1（显示时才 ×100 作为刻度）
    expect(many?.denominator).toBe(4)
    expect(many?.rejectionRate).toBeCloseTo(0.25, 10)
  })

  it('自定义点大小时按边界生效', () => {
    const one = summarizeRecords('组', syntheticRecords([{ offerStatus: '已入职' }]))
    expect(scatterPointsOf([one], { minSymbolSize: 6, maxSymbolSize: 6 })[0].symbolSize).toBe(6)
  })

  it('每个点同时带 N / D / R，便于在图上直接核对「量大入职少、拒 offer 高」', () => {
    const three = syntheticRecords([
      { position: '甲', offerStatus: '已入职' },
      { position: '甲', offerStatus: '拒绝offer' },
      { position: '甲', offerStatus: 'offer审批中' },
      { position: '乙', offerStatus: '拒绝口头offer' },
    ])
    const points = scatterPointsOf(aggregateByDimension(three, 'position'))

    const jia = points.find((point) => point.name === '甲')
    expect(jia?.total).toBe(3) // N 含审批中
    expect(jia?.denominator).toBe(2) // D = J + R，排除审批中
    expect(jia?.rejected).toBe(1) // R1 + R2
    // 纵坐标与 R / D 自洽（显示层再 ×100 保留 1 位小数）
    expect(jia?.rejectionRate).toBeCloseTo((jia?.rejected ?? 0) / (jia?.denominator ?? 1), 10)

    const yi = points.find((point) => point.name === '乙')
    expect(yi?.total).toBe(1)
    expect(yi?.denominator).toBe(1)
    expect(yi?.rejected).toBe(1)
    expect(yi?.rejectionRate).toBe(1)
  })
})

describe('模块可用性', () => {
  const availability: readonly MetricAvailability[] = [
    { module: '薪资对比', available: false, validSampleCount: 3, reason: '币种未确认' },
    { module: '城市对比', available: true, validSampleCount: 83, reason: null },
  ]

  it('被禁用的模块返回原因；可用或未提及的模块返回 null', () => {
    expect(moduleUnavailableReason(availability, '薪资对比')).toBe('币种未确认')
    expect(moduleUnavailableReason(availability, '城市对比')).toBeNull()
    // 报告里没有该模块时不谎报「已禁用」
    expect(moduleUnavailableReason(availability, '渠道对比')).toBeNull()
  })

  it('禁用但没有给原因时也给出一句可读文案（不显示空白）', () => {
    const noReason: readonly MetricAvailability[] = [
      { module: '房补对比', available: false, validSampleCount: null, reason: null },
    ]
    const reason = moduleUnavailableReason(noReason, '房补对比')
    expect(reason).not.toBeNull()
    expect(reason).toContain('禁用')
  })

  it('isModuleDisabled 读数据集声明的禁用模块名', () => {
    expect(isModuleDisabled(['薪资对比', '房补对比'], '房补对比')).toBe(true)
    expect(isModuleDisabled(['薪资对比'], '城市对比')).toBe(false)
    expect(isModuleDisabled([], '城市对比')).toBe(false)
  })
})

describe('界面常量与 PRD 口径一致', () => {
  it('结构维度是岗位 / 序列 / 部门三选一', () => {
    expect(STRUCTURE_DIMENSIONS).toEqual(['position', 'jobFamily', 'department'])
  })

  it('排行表只有两种模式且都有中文标签', () => {
    expect(RANK_TABLE_MODES).toEqual(['topN', 'all'])
    for (const mode of RANK_TABLE_MODES) {
      expect(RANK_TABLE_MODE_LABELS[mode].length).toBeGreaterThan(0)
    }
    expect(RANK_TABLE_MODE_LABELS.topN).toContain(String(DEFAULT_TOP_N))
    expect(SCHOOL_TOP_N).toBe(10)
  })
})

/* ---------------------------------------- 图表通用：排序与类目标签（2026-09-27 用户反馈） */

describe('图表排序：按柱高从高到低，无有效样本排最后', () => {
  /** 三个岗位：周期中位数分别是 10 / 50 / 30 天，故意让传入顺序与大小顺序不一致 */
  const groups: readonly GroupSummary[] = aggregateByDimension(
    [
      ...Array.from({ length: 3 }, () => ({
        position: '甲岗位',
        offerStatus: '已入职' as const,
        recruitmentStartDate: '2026-01-01',
        joiningDate: '2026-01-11',
      })),
      ...Array.from({ length: 3 }, () => ({
        position: '乙岗位',
        offerStatus: '已入职' as const,
        recruitmentStartDate: '2026-01-01',
        joiningDate: '2026-03-01',
      })),
      ...Array.from({ length: 3 }, () => ({
        position: '丙岗位',
        offerStatus: '已入职' as const,
        recruitmentStartDate: '2026-01-01',
        joiningDate: '2026-02-01',
      })),
    ].map((input) => syntheticRecords([input])[0] ?? input),
    'position',
  )

  it('时间效率这类图按周期中位数降序：最高的排第一（用户的原始诉求）', () => {
    const sorted = sortGroupsForChart(groups, 'cycleMedianDays')
    const medians = sorted.map((group) => group.cycles.actual.medianDays)
    expect(medians).toEqual([...medians].sort((left, right) => (right ?? 0) - (left ?? 0)))
    expect(sorted[0]?.key).toBe('乙岗位')
  })

  it('值相同的分组保持传入顺序（稳定排序：同一份数据两次渲染顺序一致）', () => {
    const ties: readonly GroupSummary[] = aggregateByDimension(
      (['甲', '乙', '丙'] as const).flatMap((position) =>
        Array.from({ length: 2 }, () =>
          syntheticRecords([{ position, offerStatus: '已入职' as const }])[0],
        ),
      ).filter((record): record is NonNullable<typeof record> => record !== undefined),
      'position',
    )
    const sorted = sortGroupsForChart(ties, 'total')
    expect(sorted.map((group) => group.key)).toEqual(ties.map((group) => group.key))
  })

  it('无有效样本（null）排最后，不混进低位里当成 0', () => {
    const withEmpty: readonly GroupSummary[] = [
      ...groups,
      {
        ...(groups[0] as GroupSummary),
        key: '没有周期的岗位',
        cycles: {
          ...(groups[0] as GroupSummary).cycles,
          actual: {
            ...(groups[0] as GroupSummary).cycles.actual,
            n: 0,
            medianDays: null,
          },
        },
      },
    ]
    const sorted = sortGroupsForChart(withEmpty, 'cycleMedianDays')
    expect(sorted.at(-1)?.key).toBe('没有周期的岗位')
  })

  it('按计数排序时同样降序（渠道 / HR / 需求类型图共用这条规则）', () => {
    const counts = sortGroupsForChart(groups, 'total').map((group) => group.counts.total)
    expect(counts).toEqual([...counts].sort((left, right) => right - left))
  })

  it('metricValueOf 与图例一一对应：D 与 N 取的是不同字段', () => {
    const group = {
      ...(groups[0] as GroupSummary),
      counts: { ...(groups[0] as GroupSummary).counts, total: 9, coreDenominator: 4 },
    }
    expect(metricValueOf(group, 'total')).toBe(9)
    expect(metricValueOf(group, 'coreDenominator')).toBe(4)
  })
})

describe('图表类目名截断：长中文名不再被整条丢掉', () => {
  it('不超长时原样返回', () => {
    expect(truncateCategoryLabel('上海')).toBe('上海')
    expect(truncateCategoryLabel('新增招聘')).toBe('新增招聘')
  })

  it('超长时截断并加省略号（默认 12 字），完整名仍能从数据表与提示框看到', () => {
    const long = '全球渠道发行实习生(七日世界)'
    const truncated = truncateCategoryLabel(long)
    expect(truncated.endsWith('…')).toBe(true)
    expect(truncated.length).toBe(CHART_CATEGORY_MAX_LENGTH + 1)
    expect(long.startsWith(truncated.slice(0, -1))).toBe(true)
  })

  it('长度阈值可覆盖（横向图想留更多字时用得上）', () => {
    expect(truncateCategoryLabel('一二三四五六', 4)).toBe('一二三四…')
  })
})
