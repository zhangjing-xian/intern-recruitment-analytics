/**
 * AI-2 单测：`AnalysisSummary` 生成器 + 到脱敏引擎的适配层。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-2 的每条验收标准，逐条对应：
 * - 「N/J/P/A/R/D 和周期语义与看板一致」→ 直接与引擎的 `analyzeRecords` 对拍；
 * - 「抑制不填 0」→ 组内构成不足 k 时两个键**不存在**（不是 0），载荷里也没有 0 占位；
 * - 「组间比较不混分母」→ 组内构成分母是 R/J，特征内率分母是 D，两者在载荷里同时可见且语义分开；
 * - 「文件名 / 学校筛选值 / HR 名不从范围说明泄漏」→ 哨兵检索；
 * - 「空摘要不能发」→ `includedRecordCount === 0` 时载荷没有任何维度行；
 * - 「切筛选不自动调用」→ 生成器是纯函数，网络守护由 `aiNetworkGuard.test.ts` 负责。
 *
 * 只用合成数据（AGENTS.md §2.6）。
 */

import { describe, expect, it } from 'vitest'

import { cleanFixture, headerOf } from '../cleaning/testFixtures'
import { analyzeRecords, type NormalizedDataset } from '../domain'
import { AI_CELL_MIN_SAMPLE, checkSanitizedAiPayload, buildSanitizedAiPayload } from '../privacy/aiSummary'
import {
  AI_SUMMARY_BYTE_BUDGET,
  REJECTION_COMPARISON_DIMENSIONS,
  SUMMARY_DIMENSIONS,
  buildAnalysisSummary,
  caliberNotesOf,
  cycleBandGroupsOf,
  missingSalaryCount,
  predefinedTableLabel,
  summaryDimensionEnabled,
  type AnalysisSummary,
} from './summary'
import { toAiWorkspaceData } from '../features/ai/summaryAdapter'

/* ------------------------------------------------------------------ 合成夹具 */

const CITIES = ['上海', '广州', '杭州'] as const
const CHANNELS = ['Boss', '内推', '官网'] as const
const RECRUITERS = ['张一', '李二', '王三'] as const

type Row = Parameters<typeof cleanFixture>[0]['rows'][number]

/**
 * 造一份有足够样本的合成名单。
 *
 * 刻意让每个维度组都有 ≥ 5 条有效分母：AI-2 要验的是「口径一致」与「裁剪」，
 * 而不是「抑制」（抑制由 AI-1 的 AI06 覆盖）。不足门槛的场景另有专门用例。
 */
function rowsOf(count: number): readonly Row[] {
  const rows: Row[] = []
  for (let index = 0; index < count; index += 1) {
    const status = index % 4
    rows.push({
      requirementId: `REQ-合成-${String(9000 + index)}`,
      recruiter: RECRUITERS[index % RECRUITERS.length] ?? '张一',
      city: CITIES[index % CITIES.length] ?? '上海',
      department: '增长',
      position: index % 2 === 0 ? '运营实习生' : '算法实习生',
      jobFamily: index % 2 === 0 ? '运营' : '技术',
      requirementType: index % 3 === 0 ? '新增招聘' : '替补/替换',
      recruitmentStartDate: '2026-05-01',
      joiningDate: '2026-05-11',
      candidateName: `候选人${String(index)}`,
      graduationYear: index % 2 === 0 ? 2027 : 2028,
      education: index % 2 === 0 ? '本科' : '硕士',
      school: index % 2 === 0 ? '合成大学甲' : '合成大学乙',
      isGptSchool: index % 2 === 0 ? '是' : '否',
      referrer: index % 2 === 0 ? '内推' : '示例推',
      channel: CHANNELS[index % CHANNELS.length] ?? 'Boss',
      salaryAmount: 3000 + (index % 5) * 500,
      housingRaw: index % 2 === 0 ? '房补1500元/月' : '无',
      offerStatus:
        status === 0 ? '已入职' : status === 1 ? '已入职' : status === 2 ? '拒绝offer' : '已送审批',
      rejectionReason: status === 2 ? '薪酬' : null,
    })
  }
  return rows
}

function datasetOf(count = 48, settings = {}): NormalizedDataset {
  return cleanFixture({ rows: rowsOf(count), settings }).dataset
}

function summaryOf(
  dataset: NormalizedDataset = datasetOf(),
  overrides: Partial<Parameters<typeof buildAnalysisSummary>[0]> = {},
): AnalysisSummary {
  return buildAnalysisSummary({
    records: dataset.records,
    metadata: dataset.metadata,
    report: dataset.report,
    filters: { dimensions: {}, statuses: [], time: null },
    timeBasis: 'recruitmentStartDate',
    groupingOptions: { salaryBandEdges: [3000, 4000, 5000] },
    filtersSummary: [],
    ...overrides,
  })
}

/** 仪表盘侧口径：直接用引擎算一遍，用来与摘要对拍 */
function dashboardCountsOf(dataset: NormalizedDataset) {
  return analyzeRecords(dataset.records, {
    dataAsOf: dataset.metadata.dataAsOf,
    dedupStrategy: dataset.metadata.dedupStrategy,
    salaryComparable: dataset.metadata.salary.comparable,
    salaryBandEdges: [3000, 4000, 5000],
  }).statusCounts
}

/** 剥掉本机专用字段（`summaries` 带着 `records`），得到「真正会外发」的形状 */
function outboundShapeOf(summary: AnalysisSummary): unknown {
  return {
    kpi: summary.kpi,
    scope: summary.scope,
    dimensions: summary.dimensions.map((table) => ({
      metricId: table.metricId,
      groups: table.groups,
    })),
    rejection: {
      profile: {
        rejectedTotal: summary.rejection.profile.rejectedTotal,
        joinedTotal: summary.rejection.profile.joinedTotal,
        note: summary.rejection.profile.note,
        tables: summary.rejection.profile.tables.map((table) => ({
          metricId: table.metricId,
          groups: table.groups,
        })),
      },
      featureRates: { note: summary.rejection.featureRates.note },
      reasons: summary.rejection.reasons,
      excludedFromComparison: summary.rejection.excludedFromComparison,
    },
    cycle: summary.cycle,
    quality: {
      unknownStatus: summary.quality.unknownStatus,
      missingSalary: summary.quality.missingSalary,
      unknownSchool: summary.quality.unknownSchool,
      cycleMissing: summary.quality.cycleMissing,
    },
    caliberNotes: summary.caliberNotes,
  }
}

/* ------------------------------------------------------------------ 口径与看板一致 */

describe('AI-2：N/J/P/A/R/D 与看板同源同口径', () => {
  it('摘要的 KPI 与引擎 `analyzeRecords` 完全一致（不是各算一遍）', () => {
    const dataset = datasetOf()
    const summary = summaryOf(dataset)
    const counts = dashboardCountsOf(dataset)

    expect(summary.kpi.N).toBe(counts.total)
    expect(summary.kpi.J).toBe(counts.joined)
    expect(summary.kpi.P).toBe(counts.pending)
    expect(summary.kpi.A).toBe(counts.approving)
    expect(summary.kpi.R1).toBe(counts.rejectedOffer)
    expect(summary.kpi.R2).toBe(counts.rejectedVerbally)
    expect(summary.kpi.D).toBe(counts.coreDenominator)
    // 恒等式必须成立：N = J + P + A + R1 + R2 + U
    expect(summary.kpi.N).toBe(
      summary.kpi.J +
        summary.kpi.P +
        summary.kpi.A +
        summary.kpi.R1 +
        summary.kpi.R2 +
        summary.kpi.U,
    )
  })

  it('D 是我们定义的 J + P + R，且排除审批中与未知', () => {
    const summary = summaryOf()
    expect(summary.kpi.D).toBe(summary.kpi.J + summary.kpi.P + summary.kpi.R)
    expect(summary.kpi.R).toBe(summary.kpi.R1 + summary.kpi.R2)
  })

  it('周期语义：实际周期只算已入职；计划周期单列且不混入', () => {
    const summary = summaryOf()
    expect(summary.cycle.note).toContain('待入职的计划周期单列')
    expect(summary.cycle.actualSampleCount).toBeGreaterThan(0)
    // 合成数据里已入职记录的周期恒为 10 天（05-01 → 05-11）
    expect(summary.cycle.actualMedianDays).toBe(10)
    expect(summary.cycle.actualMeanDays).toBe(10)
  })

  it('每个维度的分组计数来自引擎（与单独聚合的结果一致）', () => {
    const dataset = datasetOf()
    const summary = summaryOf(dataset)
    const counts = dashboardCountsOf(dataset)

    const city = summary.dimensions.find((table) => table.dim === 'city')
    expect(city).toBeDefined()
    // 三个城市的分组之和 = 全部记录数：说明没有任何一行在本层被悄悄丢掉
    // （早先的实现按 `slice(1)` 预裁，只剩一行 16 条——那是静默丢数据）
    const cityTotal = city?.groups.reduce((sum, row) => sum + row.N, 0) ?? 0
    expect(cityTotal).toBe(counts.total)
    expect(city?.groups).toHaveLength(CITIES.length)
  })

  it('本层不做 TopN 预裁：TopN 归脱敏引擎，预裁会让引擎拿不到被折叠的行', () => {
    const dataset = datasetOf()
    const summary = summaryOf(dataset)
    const channel = summary.dimensions.find((table) => table.dim === 'channel')
    // 三个渠道全部在场（引擎之后才按 D 排序取 Top10 并合并其余）
    expect(channel?.groups.map((row) => row.key).sort()).toEqual([...CHANNELS].sort())
  })

  it('各维度都带引擎原始 `GroupSummary`，供候选格换算层直接使用', () => {
    const summary = summaryOf()
    for (const table of summary.dimensions) {
      expect(table.summaries).toHaveLength(table.groups.length)
      expect(table.summaries[0]?.counts.total).toBe(table.groups[0]?.N)
    }
  })
})

/* ------------------------------------------------------------------ 组间比较不混分母 */

describe('AI-2：拒 offer 组间比较不混分母（PRD 9.1）', () => {
  it('两个视角同时在场，且各自写明分母来源', () => {
    const summary = summaryOf()
    expect(summary.rejection.profile.note).toContain('不是该特征的拒 offer 率')
    expect(summary.rejection.featureRates.note).toContain('核心分母 D')
    // 组内构成的分母是 R / J，与 D 不同——两个数字都必须给出
    expect(summary.rejection.profile.rejectedTotal).toBe(summary.kpi.R)
    expect(summary.rejection.profile.joinedTotal).toBe(summary.kpi.J)
  })

  it('待入职与审批中不进组间比较，但仍在 D 里', () => {
    const summary = summaryOf()
    expect(summary.rejection.excludedFromComparison).toBe(
      summary.kpi.P + summary.kpi.A + summary.kpi.U,
    )
    // 比较人群 + 未进组记录 = N：这正是「两个人群不是同一个」的量化表达
    expect(
      summary.rejection.profile.rejectedTotal +
        summary.rejection.profile.joinedTotal +
        summary.rejection.excludedFromComparison,
    ).toBe(summary.kpi.N)
  })

  it('薪资与周期**不进**组间比较（它们本身就是结果变量）', () => {
    expect(REJECTION_COMPARISON_DIMENSIONS).not.toContain('salaryBand')
    const summary = summaryOf()
    const dims = summary.rejection.profile.tables.map((table) => table.dim)
    expect(dims).not.toContain('salaryBand')
  })

  it('组内构成表只有两个计数，不带 D / R（避免被读成特征内率）', () => {
    const summary = summaryOf()
    for (const table of summary.rejection.profile.tables) {
      for (const row of table.groups) {
        expect(Object.keys(row).sort()).toEqual([
          'joinedGroupCount',
          'key',
          'rejectedGroupCount',
        ])
      }
    }
  })

  it('组内构成分子取自引擎的 `groupComposition`，不是本层重数', () => {
    const dataset = datasetOf()
    const summary = summaryOf(dataset)
    const channel = summary.rejection.profile.tables.find((table) => table.dim === 'channel')
    const total = channel?.groups.reduce((sum, row) => sum + row.rejectedGroupCount, 0) ?? -1
    // 各渠道的拒 offer 组内人数之和 = 全部拒 offer 记录数 R
    expect(total).toBe(summary.kpi.R)
  })
})

/* ------------------------------------------------------------------ 原因与抑制 */

describe('AI-2：拒绝原因只出受控类别，缺失不造原因', () => {
  it('「未填写」被标为缺失统计而不是一个原因', () => {
    // 造一份拒绝原因全空的名单
    const rows = rowsOf(24).map((row) =>
      typeof row === 'object' && row !== null ? { ...row, rejectionReason: null } : row,
    )
    const dataset = cleanFixture({ rows }).dataset
    const summary = summaryOf(dataset)
    const unfilled = summary.rejection.reasons.distribution.filter((item) => item.unfilled)
    for (const item of unfilled) {
      expect(item.category).toBe('未填写')
    }
    // 原因全空 → 已填写为 0，且不产生任何「薪酬」之类的原因
    expect(summary.rejection.reasons.filledCount).toBe(0)
    expect(summary.rejection.reasons.note).toContain('不是一个原因')
  })

  it('载荷里的原因分布过滤掉「未填写」（它不是原因）', () => {
    const summary = summaryOf()
    const workspace = toAiWorkspaceData(summary)
    expect(workspace.reasons.every((item) => item.category !== '未填写')).toBe(true)
  })
})

/* ------------------------------------------------------------------ 抑制不填 0 */

describe('AI-2：抑制一律不填 0', () => {
  it('组间比较人群不足 k 时组内构成整对省略，且载荷里没有 0 占位', () => {
    // 只有 3 条记录 → 组间比较人群 3 < 5
    const dataset = datasetOf(3)
    const summary = summaryOf(dataset)
    const workspace = toAiWorkspaceData(summary)
    const payload = buildSanitizedAiPayload({
      privacyLevel: 'standard',
      scope: {
        rowCount: workspace.scope.rowCount,
        dedupPolicy: workspace.scope.dedupPolicy,
        filters: workspace.scope.filters,
        ruleVersion: workspace.scope.ruleVersion,
        dataAsOf: workspace.scope.dataAsOf,
      },
      kpi: workspace.kpi,
      cells: workspace.cells,
      reasons: workspace.reasons,
      quality: workspace.quality,
      caliberNotes: workspace.caliberNotes,
      generatedAt: '2026-05-08T00:00:00.000Z',
      rejectionProfile: workspace.rejectionProfile,
      rejectionTotals: workspace.rejectionTotals,
    })
    for (const table of payload.dimensions) {
      for (const row of table.rows) {
        // 不是 0，而是**根本没有这两个键**
        expect(row.rejectedGroupCount ?? null).toBeNull()
        expect(row.joinedGroupCount ?? null).toBeNull()
      }
    }
    expect(checkSanitizedAiPayload(payload).ok).toBe(true)
  })

  it('缺失薪资用「总数 − 有效样本」而不是 0，且 null 不当作 0', () => {
    expect(missingSalaryCount(10, 4)).toBe(6)
    // 模块不可用（null）= 全部记录的薪资都不可用，而不是「一条都不缺」
    expect(missingSalaryCount(10, null)).toBe(10)
    // 引擎给出的有效样本数大于总数时不产生负数
    expect(missingSalaryCount(3, 5)).toBe(0)
  })

  it('没有任何记录时摘要为空，且不发任何维度行', () => {
    const dataset = cleanFixture({ rows: [] }).dataset
    const summary = summaryOf(dataset)
    expect(summary.includedRecordCount).toBe(0)
    expect(summary.kpi.N).toBe(0)
    const workspace = toAiWorkspaceData(summary)
    expect(workspace.cells).toHaveLength(0)
    expect(workspace.rejectionProfile ?? []).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ 只发预定义表 */

describe('AI-2：只用预定义表，禁用模块整维不发', () => {
  it('维度清单里没有身份类字段，且每项都登记了模块归属', () => {
    for (const dimension of SUMMARY_DIMENSIONS) {
      expect(['candidateName', 'candidateId', 'requirementId', 'recordId']).not.toContain(dimension)
      expect(typeof summaryDimensionEnabled(dimension, [])).toBe('boolean')
    }
  })

  it('模块被禁用时该维度整维不发，并写进 adjustments', () => {
    // 薪资计薪单位选「暂不确定」→ 薪资对比模块被禁用（PRD 5.3）
    const dataset = cleanFixture({
      rows: rowsOf(24),
      settings: {
        salary: {
          option: '暂不确定',
          currency: null,
          salaryUnit: null,
          comparable: false,
          confirmedAt: null,
        },
      },
    }).dataset
    expect(dataset.metadata.disabledModules).toContain('薪资对比')
    const summary = summaryOf(dataset)
    const dims = summary.dimensions.map((table) => table.dim)
    expect(dims).not.toContain('salaryBand')
    expect(summary.adjustments.some((item) => item.tableId === 'dimension.salaryBand')).toBe(true)
    // 无论禁用与否，禁用清单都要如实带出（载荷的 limits 靠它说明）
    expect(summary.quality.disabledModules).toEqual(dataset.metadata.disabledModules)
    // 单位未确认 → 口径说明里必须写明「薪资相关维度没有发送」
    expect(summary.caliberNotes.join('\n')).toContain('薪资')
  })

  it('预定义表标签可查（界面不得再抄一份中文）', () => {
    expect(predefinedTableLabel('dimension.city')).toBe('按城市')
    expect(predefinedTableLabel('不存在的表')).toBe('不存在的表')
  })

  it('周期区间分组不含「未知」桶（未知不是一个周期区间）', () => {
    const dataset = datasetOf()
    const groups = cycleBandGroupsOf(dataset.records)
    expect(groups.every((group) => group.key !== '未知')).toBe(true)
  })
})

/* ------------------------------------------------------------------ 预算与裁剪 */

describe('AI-2：128 KiB 预算在本地调整，不静默截断', () => {
  it('默认摘要远小于预算，且没有因预算而发生任何裁剪', () => {
    const summary = summaryOf(datasetOf(200))
    expect(summary.byteBudget).toBe(AI_SUMMARY_BYTE_BUDGET)
    expect(summary.totalBytes).toBeLessThanOrEqual(AI_SUMMARY_BYTE_BUDGET)
    // 只允许「模块被禁用」这类 adjustments；不允许出现体积裁剪的记录
    expect(summary.adjustments.filter((item) => item.reason.includes('体积预算'))).toHaveLength(0)
  })

  it('预算被人为压小时按顺序丢表，并在 adjustments 里如实记录', () => {
    const full = summaryOf(datasetOf(200))
    // 取一个「比完整摘要小、但比只留总体大」的预算：这样必然发生裁剪且仍能成功
    const tight = Math.floor(full.totalBytes * 0.6)
    const summary = summaryOf(datasetOf(200), { byteBudget: tight })

    expect(summary.adjustments.length).toBeGreaterThan(0)
    // 丢表必须给出原因，不能静默少发。adjustments 里也可能混有「模块被禁用」的记录，
    // 因此这里按原因筛选后再断言——两类调整都必须如实说明理由，但只有一类是体积裁剪。
    const budgetAdjustments = summary.adjustments.filter((item) => item.reason.includes('体积预算'))
    expect(budgetAdjustments.length).toBeGreaterThan(0)
    for (const item of summary.adjustments) {
      expect(item.reason.length).toBeGreaterThan(0)
      expect(item.tableId.length).toBeGreaterThan(0)
    }
    // 最细的表先丢：薪资区间应比城市先消失
    const dims = summary.dimensions.map((table) => table.dim)
    expect(dims).not.toContain('salaryBand')
    expect(dims).toContain('city')
    // 裁剪后确实变小了
    expect(summary.totalBytes).toBeLessThan(full.totalBytes)
  })

  it('预算小到连「只剩总体」都装不下时也不抛异常、不截断（如实保留现状）', () => {
    // 1 字节是不可能的预算：此时不应无限丢表或截断行，而是把能丢的丢掉后如实返回
    const summary = summaryOf(datasetOf(48), { byteBudget: 1 })
    expect(summary.totalBytes).toBeGreaterThan(1)
    expect(summary.dimensions).toHaveLength(0)
    // 只剩总体时仍如实报告「丢过什么」，而不是假装摘要本来是空的
    expect(summary.adjustments.some((item) => item.reason.includes('体积预算'))).toBe(true)
  })

  it('裁剪不降低 k、不截断行：留下的表行数与原来一致或整表消失', () => {
    const full = summaryOf(datasetOf(200))
    const trimmed = summaryOf(datasetOf(200), { byteBudget: Math.floor(full.totalBytes * 0.6) })
    const kept = new Set(trimmed.dimensions.map((table) => table.dim))
    for (const table of full.dimensions) {
      if (kept.has(table.dim)) {
        const after = trimmed.dimensions.find((item) => item.dim === table.dim)
        expect(after?.groups).toHaveLength(table.groups.length)
      }
    }
  })

  it('体积统计只量真正会发送的部分（口径与引擎对齐）', () => {
    const summary = summaryOf(datasetOf(48))
    const workspace = toAiWorkspaceData(summary)
    const payload = buildSanitizedAiPayload({
      privacyLevel: 'standard',
      scope: {
        rowCount: workspace.scope.rowCount,
        dedupPolicy: workspace.scope.dedupPolicy,
        filters: workspace.scope.filters,
        ruleVersion: workspace.scope.ruleVersion,
        dataAsOf: workspace.scope.dataAsOf,
      },
      kpi: workspace.kpi,
      cells: workspace.cells,
      reasons: workspace.reasons,
      quality: workspace.quality,
      caliberNotes: workspace.caliberNotes,
      generatedAt: '2026-05-08T00:00:00.000Z',
      rejectionProfile: workspace.rejectionProfile,
      rejectionTotals: workspace.rejectionTotals,
    })
    // 载荷（脱敏后只会更小）不应超过摘要的本地体积估算
    expect(payload.contentBytes).toBeLessThanOrEqual(summary.totalBytes)
  })
})

/* ------------------------------------------------------------------ 元数据脱敏 */

describe('AI-2：范围说明与元数据不泄漏敏感值', () => {
  it('caliberNotes 里不含文件名、学校全名、HR 真名', () => {
    const dataset = cleanFixture({
      rows: rowsOf(24),
      sourceFileName: '真实招聘名单-哨兵.xlsx',
    }).dataset
    const notes = caliberNotesOf({
      records: dataset.records,
      metadata: dataset.metadata,
      report: dataset.report,
      filters: { dimensions: {}, statuses: [], time: null },
      timeBasis: 'recruitmentStartDate',
      groupingOptions: {},
      filtersSummary: [],
    }).join('\n')

    expect(notes).not.toContain('哨兵')
    expect(notes).not.toContain('真实招聘名单')
    expect(notes).not.toContain('合成大学甲')
    for (const recruiter of RECRUITERS) {
      expect(notes).not.toContain(recruiter)
    }
  })

  it('caliberNotes 不含 Markdown 强调标记（会逐字渲染进预览）', () => {
    const notes = summaryOf().caliberNotes.join('\n')
    expect(notes).not.toContain('**')
    expect(notes).not.toContain('__')
  })

  it('口径说明必须写明 D 与审批中的分母差异', () => {
    const notes = summaryOf().caliberNotes.join('\n')
    expect(notes).toContain('J ÷ D')
    expect(notes).toContain('A ÷ N')
  })

  it('外发部分里没有姓名与需求 ID（`summaries` 是本机专用，绝不外发）', () => {
    const dataset = datasetOf()
    const summary = summaryOf(dataset)
    /*
     * 只序列化**会外发**的部分：`kpi` / `dimensions.groups` / `rejection` / `quality` 的计数。
     *
     * 刻意**不**把 `summary.dimensions[].summaries` 算进来：那是引擎原始的 `GroupSummary`，
     * 按类型定义带着 `records`（候选格换算层需要它读 `groupComposition` 与 `cycles`）。
     * 它属于**本机专用**字段，既不进载荷、也不进历史；真正的外发边界由
     * `privacy/aiSummary.ts` 的白名单重建负责（那份载荷另有一组 AI05 哨兵测试）。
     */
    const outbound = JSON.stringify(outboundShapeOf(summary))
    expect(outbound).not.toContain('候选人0')
    expect(outbound).not.toContain('REQ-合成')
    expect(outbound).not.toContain('candidateName')
    expect(outbound).not.toContain('recordId')
  })

  it('候选格（外发路径上的中间产物）里没有姓名与需求 ID', () => {
    const workspace = toAiWorkspaceData(summaryOf(datasetOf(48)))
    const serialized = JSON.stringify(workspace)
    expect(serialized).not.toContain('候选人0')
    expect(serialized).not.toContain('REQ-合成')
  })
})

/* ------------------------------------------------------------------ 适配层 */

describe('AI-2：摘要 → 候选格的适配层', () => {
  it('HR 在两个视角里拿到**同一个代号**（否则组内构成会静默消失）', () => {
    const summary = summaryOf(datasetOf(120))
    const workspace = toAiWorkspaceData(summary)
    const payload = buildSanitizedAiPayload({
      privacyLevel: 'standard',
      scope: {
        rowCount: workspace.scope.rowCount,
        dedupPolicy: workspace.scope.dedupPolicy,
        filters: workspace.scope.filters,
        ruleVersion: workspace.scope.ruleVersion,
        dataAsOf: workspace.scope.dataAsOf,
      },
      kpi: workspace.kpi,
      cells: workspace.cells,
      reasons: workspace.reasons,
      quality: workspace.quality,
      caliberNotes: workspace.caliberNotes,
      generatedAt: '2026-05-08T00:00:00.000Z',
      rejectionProfile: workspace.rejectionProfile,
      rejectionTotals: workspace.rejectionTotals,
    })
    const recruiterTable = payload.dimensions.find((table) => table.dim === 'recruiter')
    expect(recruiterTable).toBeDefined()
    // 代号是中性标签，绝不是真名
    for (const row of recruiterTable?.rows ?? []) {
      expect(row.key).toMatch(/^HR-\d+$/)
      for (const recruiter of RECRUITERS) {
        expect(row.key).not.toContain(recruiter)
      }
    }
    // 关键：主表的 HR 行里**带着**组内构成（说明两次遍历的代号对上了）
    const withProfile = (recruiterTable?.rows ?? []).filter(
      (row) => row.rejectedGroupCount !== undefined || row.joinedGroupCount !== undefined,
    )
    const enoughSample = (recruiterTable?.rows ?? []).filter(
      (row) => row.D >= AI_CELL_MIN_SAMPLE,
    )
    if (enoughSample.length > 0) {
      expect(withProfile.length).toBeGreaterThan(0)
    }
  })

  it('同一份摘要两次适配得到逐字节相同的结果（钉住「同输入同产物」）', () => {
    const summary = summaryOf(datasetOf(120))
    const first = toAiWorkspaceData(summary)
    const second = toAiWorkspaceData(summary)
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })

  it('范围说明原样搬运，不在这里重新生成', () => {
    const dataset = datasetOf()
    const summary = summaryOf(dataset, { filtersSummary: ['城市：上海'] })
    const workspace = toAiWorkspaceData(summary)
    expect(workspace.scope.filters).toEqual(['城市：上海'])
  })

  it('规则版本带配置摘要（步骤12 的 `x.y.z+摘要` 形式）', () => {
    const summary = summaryOf()
    const workspace = toAiWorkspaceData(summary)
    expect(workspace.scope.ruleVersion).toBe(summary.frozen.ruleVersionLabel)
  })
})

/* ------------------------------------------------------------------ 字段名闸门 */

describe('AI-2：字段名闸门在导出/发送前仍然生效', () => {
  it('候选格与载荷的键没有一个撞上敏感字段名', () => {
    const workspace = toAiWorkspaceData(summaryOf(datasetOf(48)))
    const payload = buildSanitizedAiPayload({
      privacyLevel: 'standard',
      scope: {
        rowCount: workspace.scope.rowCount,
        dedupPolicy: workspace.scope.dedupPolicy,
        filters: workspace.scope.filters,
        ruleVersion: workspace.scope.ruleVersion,
        dataAsOf: workspace.scope.dataAsOf,
      },
      kpi: workspace.kpi,
      cells: workspace.cells,
      reasons: workspace.reasons,
      quality: workspace.quality,
      caliberNotes: workspace.caliberNotes,
      generatedAt: '2026-05-08T00:00:00.000Z',
      rejectionProfile: workspace.rejectionProfile,
      rejectionTotals: workspace.rejectionTotals,
    })
    const serialized = JSON.stringify({ workspace, payload })
    for (const forbidden of ['candidateName', 'sourceFileName', 'requirementId', 'recordId']) {
      expect(serialized).not.toContain(`"${forbidden}"`)
    }
  })

  it('表头常量在夹具里确实存在（防止夹具与领域层脱节）', () => {
    expect(headerOf('candidateName')).toBeTruthy()
    expect(headerOf('offerStatus')).toBeTruthy()
  })
})
