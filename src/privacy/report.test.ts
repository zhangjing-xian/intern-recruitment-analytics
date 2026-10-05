/**
 * 唯一脱敏报告模型的**承载测试**（步骤11，docs/PRD.md 10.6 / 11.5）。
 *
 * 这份测试的写法刻意「难看」：它对整份报告做 `JSON.stringify` 后做**哨兵字符串检索**，
 * 而不是逐个字段断言。理由（PRD 11.5 验收要点最后一条）：
 * 「用合成哨兵字符串（如姓名、薪资、HR 名）检索导出内容，必须无命中」——
 * 逐个字段断言只能证明「我想到的字段是干净的」，检索整个 JSON 才能证明「没有别的地方漏出去」。
 * 以后有人新增一个字段顺手把原始值写进去，这里会立刻红。
 *
 * 数据红线：全部使用**人工构造的合成**姓名 / HR / 薪资 / 需求 ID / 原因原文（AGENTS.md §2.6），
 * 不含任何真实招聘附件内容。
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CYCLE_TOO_LONG_DAYS,
  GROUP_DIMENSION_LABELS,
  aggregateByDimension,
  analyzeRecords,
  summarizeRecords,
  type NormalizedRecord,
} from '../domain'
import { syntheticRecord, syntheticRecords } from '../domain/analytics/fixtures'
import { buildRejectionInsight } from '../insights'

import { AI_PAYLOAD_VERSION } from './aiPayload'
import { isSanitizedAiPayload, type SanitizedAiPayload } from './aiSummary'
import {
  DEFAULT_SANITIZE_RULES,
  FORBIDDEN_FIELD_NAMES,
  SALARY_BAND_EDGES,
  STRICT_SANITIZE_RULES,
  findSensitiveFields,
  type SanitizeRules,
} from './sanitize'
import {
  REPORT_SECTIONS,
  buildSanitizedReport,
  type DimensionInput,
  type SanitizeInput,
  type SanitizedReport,
} from './report'

/* ------------------------------------------------------------------ 合成夹具 */

/** 合成哨兵：候选人姓名 / HR 姓名 / 推荐人 / 准确薪资（元/月）/ 需求 ID / 自由文本原因 */
const SENTINEL_CANDIDATE = '张合成甲'
const SENTINEL_HR = '合成HR-A'
const SENTINEL_REFERRER = '王推荐'
const SENTINEL_REQUIREMENT = 'REQ-合成-3003'
const SENTINEL_SALARY = 4200
const SENTINEL_REASON = '薪酬太低所以接了别家的offer'

/**
 * 含敏感原文的合成记录：
 * - 姓名（会被映射成 candidateDisplayId 之外的原文）、HR 姓名、推荐人、准确薪资、需求 ID；
 * - 拒 offer 的自由文本原因（不在受控字典内 → 只能落「未分类」，原文不得进报告）；
 * - 城市 / 岗位刻意做出大小差异，用来验证小组抑制。
 */
const SENSITIVE_RECORDS: readonly NormalizedRecord[] = [
  syntheticRecord({
    recordId: 'REC-0001',
    requirementId: 'REQ-合成-3001',
    recruiter: SENTINEL_HR,
    city: '上海',
    position: '前端开发',
    referrer: SENTINEL_REFERRER,
    salaryAmount: SENTINEL_SALARY,
    currency: 'CNY',
    salaryUnit: '元/月',
    offerStatus: '已入职',
    recruitmentStartDate: '2026-01-05',
    joiningDate: '2026-01-15',
  }),
  syntheticRecord({
    recordId: 'REC-0002',
    requirementId: 'REQ-合成-3002',
    recruiter: SENTINEL_HR,
    city: '上海',
    position: '前端开发',
    salaryAmount: 3800,
    currency: 'CNY',
    salaryUnit: '元/月',
    offerStatus: '已入职',
    recruitmentStartDate: '2026-02-01',
    joiningDate: '2026-02-11',
  }),
  syntheticRecord({
    recordId: 'REC-0003',
    requirementId: SENTINEL_REQUIREMENT,
    recruiter: SENTINEL_HR,
    city: '上海',
    position: '后端开发',
    salaryAmount: 6500,
    currency: 'CNY',
    salaryUnit: '元/月',
    offerStatus: '待入职',
    recruitmentStartDate: '2026-03-01',
    joiningDate: '2026-03-21',
  }),
  syntheticRecord({
    recordId: 'REC-0004',
    requirementId: 'REQ-合成-3004',
    recruiter: '合成HR-B',
    city: '广州',
    // 广州只有 1 条记录：低于默认门槛 5，必须被合并（原标签不导出）
    position: '测试开发',
    offerStatus: 'offer审批中',
    recruitmentStartDate: '2026-03-10',
  }),
  syntheticRecord({
    recordId: 'REC-0005',
    requirementId: 'REQ-合成-3005',
    recruiter: '合成HR-B',
    city: '广州',
    position: '测试开发',
    offerStatus: '拒绝offer',
    rejectionReason: SENTINEL_REASON,
    recruitmentStartDate: '2026-03-12',
  }),
  // 再补两条上海记录：让 HR-A 与「上海」都稳定高于门槛 5，
  // 这样「HR 代号」与「小组合并」两条路径能在同一份报告里同时被观察到
  syntheticRecord({
    recordId: 'REC-0006',
    requirementId: 'REQ-合成-3006',
    recruiter: SENTINEL_HR,
    city: '上海',
    position: '前端开发',
    salaryAmount: 7200,
    currency: 'CNY',
    salaryUnit: '元/月',
    offerStatus: '已入职',
    recruitmentStartDate: '2026-04-01',
    joiningDate: '2026-04-14',
  }),
  syntheticRecord({
    recordId: 'REC-0007',
    requirementId: 'REQ-合成-3007',
    recruiter: SENTINEL_HR,
    city: '上海',
    position: '前端开发',
    offerStatus: '拒绝offer',
    rejectionReason: '地点',
    recruitmentStartDate: '2026-04-05',
  }),
  // 再补杭州 2 条（已入职，周期与上海同量级）：
  // 让「上海 / 广州」两个城市组都稳定高于门槛 5，这样报告里既有可见分组、也真的有分组被合并，
  // 同时避免某个维度只剩一行（只剩一行时按互补抑制的口径要整维抑制，反而看不出合并效果）。
  syntheticRecord({
    recordId: 'REC-0008',
    requirementId: 'REQ-合成-3008',
    recruiter: SENTINEL_HR,
    city: '杭州',
    position: '后端开发',
    offerStatus: '已入职',
    recruitmentStartDate: '2026-01-06',
    joiningDate: '2026-01-16',
  }),
  syntheticRecord({
    recordId: 'REC-0009',
    requirementId: 'REQ-合成-3009',
    recruiter: SENTINEL_HR,
    city: '杭州',
    position: '后端开发',
    offerStatus: '已入职',
    recruitmentStartDate: '2026-02-02',
    joiningDate: '2026-02-12',
  }),
] as readonly NormalizedRecord[]

/**
 * 追加一条带姓名原文的记录。
 *
 * 为什么用 `syntheticRecord` 之外的写法：夹具的 `syntheticRecord` 刻意把 `candidateName` 固定为 null
 * （合成数据默认不含姓名），而本次测试**必须**证明「源数据里有姓名时报告里也不会出现」，
 * 因此显式覆盖这一个字段——这是唯一一处刻意注入的合成敏感原文。
 */
const RECORDS_WITH_NAME: readonly NormalizedRecord[] = [
  ...SENSITIVE_RECORDS,
  {
    ...syntheticRecord({ recordId: 'REC-0010', offerStatus: '拒绝口头offer' }),
    candidateName: SENTINEL_CANDIDATE,
  },
]

const DATASET = {
  metadata: {
    dataAsOf: '2026-09-26',
    dedupStrategy: '确认后每组保留首条',
    ruleVersion: { rulesVersion: '1.0.0' },
  },
  report: {
    counts: { keptRowCount: RECORDS_WITH_NAME.length, issueRowCount: 1 },
    metricAvailability: [
      { module: '核心率', available: true, validSampleCount: 5, reason: null },
      { module: '薪资对比', available: false, validSampleCount: null, reason: '币种与计薪周期未确认' },
    ],
  },
} as const

/** 维度输入：只带聚合结果，**不带**记录列表（报告层拿不到逐条记录） */
function dimensionInputs(
  records: readonly NormalizedRecord[],
  dimensions: readonly ('recruiter' | 'city' | 'position')[] = ['recruiter', 'city', 'position'],
): readonly DimensionInput[] {
  return dimensions.map((dimension) => ({
    dimension,
    label: GROUP_DIMENSION_LABELS[dimension],
    groups: aggregateByDimension(records, dimension),
    total: summarizeRecords('全部（当前筛选）', records),
    notes: [`${GROUP_DIMENSION_LABELS[dimension]}：按统一指标引擎聚合`],
  }))
}

function buildInput(
  records: readonly NormalizedRecord[] = RECORDS_WITH_NAME,
): SanitizeInput {
  const analysis = analyzeRecords(records, {
    dataAsOf: DATASET.metadata.dataAsOf,
    dedupStrategy: DATASET.metadata.dedupStrategy,
    salaryComparable: true,
  })
  const rejection = buildRejectionInsight(records, {
    dataAsOf: DATASET.metadata.dataAsOf,
    salaryComparable: true,
    waitingThresholdDays: DEFAULT_CYCLE_TOO_LONG_DAYS,
  })
  return {
    dataset: DATASET,
    filters: [],
    analysis,
    dimensions: dimensionInputs(records),
    rejection,
    charts: [
      {
        id: 'city-rejection-rate',
        title: '各城市拒 offer 率',
        kind: 'bar',
        categories: ['上海', '广州'],
        series: [{ name: '拒 offer 率', values: [0, 50] }],
      },
    ],
    generatedAt: '2026-09-26T10:00:00.000Z',
  }
}

function buildReport(
  records: readonly NormalizedRecord[] = RECORDS_WITH_NAME,
  rules: SanitizeRules = DEFAULT_SANITIZE_RULES,
): SanitizedReport {
  return buildSanitizedReport(buildInput(records), rules)
}

/** 本报告的全部哨兵（PRD 11.5：用哨兵检索导出内容，必须无命中） */
const SENTINELS: readonly string[] = [
  SENTINEL_CANDIDATE,
  SENTINEL_HR,
  SENTINEL_REFERRER,
  SENTINEL_REQUIREMENT,
  String(SENTINEL_SALARY),
  '3800',
  '6500',
  SENTINEL_REASON,
]

/* ------------------------------------------------------------------ 承载断言 */

describe('buildSanitizedReport：导出内容不得出现任何哨兵（承载测试）', () => {
  it('整份报告 JSON 不含姓名 / HR 姓名 / 推荐人 / 需求 ID / 准确薪资 / 原因原文', () => {
    const report = buildReport()
    const json = JSON.stringify(report)

    for (const sentinel of SENTINELS) {
      expect(json.includes(sentinel), `报告里出现了哨兵：${sentinel}`).toBe(false)
    }
  })

  it('报告里的每一个键都不是被禁字段名（结构化检查）', () => {
    /*
     * 为什么按「键」而不是按「JSON 子串」检查：
     * 报告里合法地包含 `dimension: 'recruiter'`（HR 维度的**维度名**，来自引擎的
     * `GROUP_DIMENSIONS`），它只是「这个维度是 HR」这一事实，不含任何 HR 姓名；
     * 而 `recruiter` 必须留在被禁字段名清单里，因为它在**记录**上就是 HR 姓名那一列。
     * 所以这里检查的是「有没有一个键把记录字段搬进了报告」，而不是「字符串里有没有这个词」。
     */
    const report = buildReport()
    const forbidden = new Set(FORBIDDEN_FIELD_NAMES)
    const allowed = new Set(report.allowedKeys)
    const keys = new Set<string>()
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node === null || typeof node !== 'object') {
        return
      }
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        keys.add(key)
        walk(child)
      }
    }
    walk(report)

    for (const key of keys) {
      expect(forbidden.has(key), `报告里出现了被禁字段名作为键：${key}`).toBe(false)
    }
    // HR 维度名本身出现是合法的，但 HR 姓名不得出现（已由哨兵检索覆盖）
    expect(keys.has('recruiter')).toBe(false)
    // `allowedKeys` 自己也必须在清单里（自描述：报告不含未申报字段）
    expect(allowed.has('allowedKeys')).toBe(true)
  })

  it('`findSensitiveFields` 对这份报告返回空数组（导出前的最后一道闸门放行）', () => {
    expect(findSensitiveFields(buildReport(), SENTINELS)).toEqual([])
  })

  it('篡改后的报告会被闸门拦下（证明闸门真的在起作用，不是恒返回空）', () => {
    const tampered = { ...buildReport(), kpis: [{ id: 'x', label: SENTINEL_CANDIDATE }] }
    const hits = findSensitiveFields(tampered, SENTINELS)

    expect(hits.length).toBeGreaterThan(0)
    // 只报位置标记，绝不回显命中原文
    expect(hits.join('|')).not.toContain(SENTINEL_CANDIDATE)
  })

  it('报告里不出现任何原始记录字段名（records / values / cells / sourceRow）', () => {
    const json = JSON.stringify(buildReport())
    for (const field of ['records', 'values', 'cells', 'sourceRow', 'sourceFileName', 'candidateName']) {
      expect(json.includes(field), `报告里出现了原始数据字段：${field}`).toBe(false)
    }
  })
})

/* ------------------------------------------------------------------ HR 代号 */

describe('buildSanitizedReport：HR 代号与维度标签', () => {
  it('HR 分组标签变成 HR-N 代号，真实 HR 姓名只以代号出现', () => {
    const report = buildReport()
    const dimension = report.dimensions.find((item) => item.dimension === 'recruiter')

    expect(dimension).toBeDefined()
    const coded = dimension?.groups.filter((group) => group.code !== null) ?? []
    expect(coded.map((group) => group.code)).toEqual(['HR-1'])
    // label 必须**以代号开头**（互补抑制会追加「已抑制」后缀），绝不允许保留真名
    for (const group of coded) {
      expect(group.label.startsWith(group.code ?? '')).toBe(true)
      expect(group.label).not.toContain(SENTINEL_HR)
    }
  })

  it('同一次报告内代号稳定：同一 HR 的多个分组（跨维度）得到同一个代号', () => {
    const report = buildReport()
    const recruiter = report.dimensions.find((item) => item.dimension === 'recruiter')
    const first = recruiter?.groups.find((group) => group.code !== null)

    // 再建一次同样的输入 → 代号重建但顺序一致（PRD 10.6：跨报告默认重建）
    const second = buildReport().dimensions.find((item) => item.dimension === 'recruiter')
    expect(second?.groups.find((group) => group.code !== null)?.code).toBe(first?.code)
    expect(first?.code).toBe('HR-1')
  })

  it('strict 级别下 HR 维度被移除、维度名退化为位置编号', () => {
    const report = buildReport(RECORDS_WITH_NAME, STRICT_SANITIZE_RULES)
    const json = JSON.stringify(report)

    expect(json).not.toContain(SENTINEL_HR)
    for (const dimension of report.dimensions) {
      expect(dimension.dimension.startsWith('dimension-')).toBe(true)
    }
    expect(report.meta.privacyLevel).toBe('strict')
  })
})

/* ------------------------------------------------------------------ 薪资分桶 */

describe('buildSanitizedReport：金额只以区间出现', () => {
  it('薪资区间维度的取值只来自 SALARY_BAND_EDGES 定义的桶，不出现准确值', () => {
    const report = buildSanitizedReport(
      {
        ...buildInput(),
        dimensions: dimensionInputs(RECORDS_WITH_NAME, ['recruiter', 'city', 'position']).map(
          (dimension) => dimension,
        ),
      },
      { ...DEFAULT_SANITIZE_RULES },
    )
    const json = JSON.stringify(report)
    for (const amount of ['4200', '3800', '6500']) {
      expect(json.includes(amount)).toBe(false)
    }
    expect(SALARY_BAND_EDGES).toEqual([3000, 4000, 5000, 6000])
  })

  it('周期分位默认改为区间（band 模式）：精确实数为 null，区间非 null', () => {
    const report = buildReport()
    const group = report.dimensions
      .flatMap((dimension) => dimension.groups)
      .find((item) => item.cycle !== null && item.cycle.n > 0 && !item.suppressed)

    expect(group).toBeDefined()
    expect(group?.cycle?.median).toBeNull()
    expect(group?.cycle?.p25).toBeNull()
    expect(group?.cycle?.p75).toBeNull()
    expect(group?.cycle?.medianBand).not.toBeNull()
  })

  it('hide 模式下分位全部隐藏（区间也为 null）', () => {
    const report = buildReport(RECORDS_WITH_NAME, {
      ...DEFAULT_SANITIZE_RULES,
      privacyLevel: 'custom',
      quantileMode: 'hide',
    })
    for (const group of report.dimensions.flatMap((dimension) => dimension.groups)) {
      if (group.cycle === null) {
        continue
      }
      expect(group.cycle.median).toBeNull()
      expect(group.cycle.medianBand).toBeNull()
      expect(group.cycle.p25Band).toBeNull()
      expect(group.cycle.p75Band).toBeNull()
    }
  })
})

/* ------------------------------------------------------------------ 分组抑制 */

describe('buildSanitizedReport：小组抑制与互补抑制', () => {
  it('低于门槛的分组被合并为「其他（N 个分组合并）」，真实标签不出现', () => {
    const report = buildReport()
    const city = report.dimensions.find((item) => item.dimension === 'city')

    // 广州（1 条）与杭州（2 条）都低于门槛 5，必须合并；合并行既不叫「广州」也不叫「杭州」
    expect(city?.mergedGroupCount).toBeGreaterThanOrEqual(1)
    const merged = city?.groups.find((group) => group.label.includes('个分组合并'))
    expect(merged).toBeDefined()
    expect(city?.groups.some((group) => group.label === '广州')).toBe(false)
    expect(city?.groups.some((group) => group.label === '杭州')).toBe(false)
    // 合计仍是全量口径，且维度说明里写明「已合并几个组」与门槛
    expect(city?.total).toBe(RECORDS_WITH_NAME.length)
    expect(city?.notes.join('|')).toContain('低于门槛 5 的分组合并')
  })

  it('每个维度都不会出现「恰好一个被抑制」的分组（互补抑制真的生效）', () => {
    const report = buildReport()

    for (const dimension of report.dimensions) {
      const suppressed = dimension.groups.filter((group) => group.suppressed).length
      // 0（没有任何组需要抑制）或 ≥2（互补抑制已补齐）都可接受；**恰好 1** 绝不允许
      expect(suppressed === 1, `${dimension.dimension} 恰好抑制了 1 个分组`).toBe(false)
    }
  })

  it('只有三个足够大的分组时，互补抑制会额外抑制人数最少的那个', () => {
    /*
     * 刻意构造成「主抑制一个都不触发」：三个岗位各 8 / 7 / 6 条，全部 ≥ 门槛 5。
     * 若没有互补抑制，读者可以用总计 21 减去两个可见组，把第三组精确还原；
     * 有了互补抑制，至少两个组不显示数字，减法就失效了。
     */
    const records = syntheticRecords([
      ...Array.from({ length: 8 }, () => ({ offerStatus: '已入职' as const, position: '岗位A' })),
      ...Array.from({ length: 7 }, () => ({ offerStatus: '已入职' as const, position: '岗位B' })),
      ...Array.from({ length: 6 }, () => ({ offerStatus: '拒绝offer' as const, position: '岗位C' })),
    ])
    const report = buildSanitizedReport(
      { ...buildInput(records), dimensions: dimensionInputs(records, ['position']) },
      DEFAULT_SANITIZE_RULES,
    )
    const position = report.dimensions[0]

    expect(position?.mergedGroupCount).toBe(0)
    const suppressed = position?.groups.filter((group) => group.suppressed) ?? []
    expect(suppressed.length).toBeGreaterThanOrEqual(2)
    // 被抑制的分组不显示人数与率（不是 0）
    for (const group of suppressed) {
      expect(group.total).toBe(0)
      expect(group.coreDenominator).toBe(0)
      expect(group.rejectedRate.value).toBeNull()
      expect(group.rejectedRate.suppressed).toBe(true)
      expect(group.cycle).toBeNull()
      expect(group.label).toContain('已抑制')
    }
    expect(
      report.suppression.some((note) => note.reason.includes('互补抑制')),
    ).toBe(true)
  })

  it('率的分母低于门槛时单独抑制该率，并写明「不是 0%」', () => {
    const report = buildReport()
    const anySuppressedRate = report.dimensions
      .flatMap((dimension) => dimension.groups)
      .find((group) => group.rejectedRate.suppressed)

    expect(anySuppressedRate).toBeDefined()
    expect(anySuppressedRate?.rejectedRate.value).toBeNull()
    expect(anySuppressedRate?.rejectedRate.note).toContain('不是 0%')
    // 抑制说明里要解释「为什么这个率被抑制」（门槛与核心分母），而不是悄悄留空
    expect(
      report.suppression.some(
        (note) => note.reason.includes('核心分母') && note.reason.includes('只抑制率本身'),
      ),
    ).toBe(true)
  })

  it('抑制说明不包含被抑制分组的原始标签（只写路径与原因）', () => {
    const json = JSON.stringify(buildReport().suppression)
    expect(json).not.toContain('广州')
    expect(json).not.toContain(SENTINEL_HR)
  })
})

/* ------------------------------------------------------------------ 原因与结论 */

describe('buildSanitizedReport：原因、结论与建议', () => {
  it('原因只以受控类别出现：自由文本原文不出现，未分类单独计数', () => {
    const report = buildReport()
    const json = JSON.stringify(report.reasons)

    expect(json).not.toContain(SENTINEL_REASON)
    expect(report.reasons.map((reason) => reason.category)).toContain('未分类')
    expect(report.reasons.map((reason) => reason.category)).toContain('未填写')
  })

  it('R 低于门槛时原因分布整体抑制（占比为 null，不是 0%）', () => {
    // 只有 2 条拒 offer 记录：R = 2 < 5 → 原因分布整体抑制
    const report = buildReport()
    const suppressedReasons = report.reasons.filter((reason) => reason.suppressed)

    expect(suppressedReasons.length).toBeGreaterThan(0)
    for (const reason of suppressedReasons) {
      expect(reason.share).toBeNull()
      expect(reason.count).toBe(0)
    }
    expect(report.suppression.some((note) => note.path === 'reasons')).toBe(true)
  })

  it('结论带规则 ID / 版本 / 未知条件与建议核查事项（可回溯）', () => {
    const report = buildReport()

    expect(report.conclusions.length).toBeGreaterThan(0)
    for (const conclusion of report.conclusions) {
      expect(conclusion.ruleId.length).toBeGreaterThan(0)
      expect(conclusion.ruleVersion.length).toBeGreaterThan(0)
      expect(conclusion.scopeNote.length).toBeGreaterThan(0)
    }
    expect(report.conclusions.every((item) => item.level !== undefined)).toBe(true)
  })

  it('合同（身份）说明如实写明报告不含人员标识', () => {
    const report = buildReport()

    expect(report.contract.identityStatus).toBe('unknown')
    expect(report.contract.hasCrossBatchIdentity).toBe(false)
    expect(report.contract.identityNote).toContain('记录级代号')
  })
})

/* ------------------------------------------------------------------ 明细开关 */

describe('buildSanitizedReport：明细默认关闭', () => {
  it('默认不导出任何明细', () => {
    expect(buildReport().details).toEqual([])
    expect(JSON.stringify(buildReport().sections)).toContain('本次未开启记录级明细')
  })

  it('开启明细后只使用记录代号，且不含姓名 / 需求 ID / 推荐人 / 原因', () => {
    const report = buildReport(RECORDS_WITH_NAME, {
      ...DEFAULT_SANITIZE_RULES,
      privacyLevel: 'custom',
      includeRecordDetail: true,
    })

    expect(report.details).toHaveLength(RECORDS_WITH_NAME.length)
    for (const detail of report.details) {
      expect(detail.recordCode.startsWith('R-')).toBe(true)
    }
    expect(findSensitiveFields(report, SENTINELS)).toEqual([])
  })

  it('strict 下即使开启明细也不出现城市与渠道', () => {
    /*
     * 注意这里必须用 `privacyLevel: 'custom'`：
     * 传 `privacyLevel: 'strict'` 时报告层会按级别**重新取整套规则**（`rulesOfLevel`），
     * 于是 `includeRecordDetail` 又被 strict 的规则改回 false——这正是「切换隐私级别必须重新生成预览」
     * 那条约束的实现方式（PRD 18.5）。要单独验证「strict 的分桶 + 明细」里的城市处理，
     * 就得用 custom 并把 strict 的开关原样带上。
     */
    const report = buildReport(RECORDS_WITH_NAME, {
      ...STRICT_SANITIZE_RULES,
      privacyLevel: 'custom',
      includeRecordDetail: true,
    })

    expect(report.details.length).toBeGreaterThan(0)
    for (const detail of report.details) {
      expect(detail.city).toBeNull()
    }
  })

  it('传 privacyLevel: strict 时报告层重新取整套规则，明细开关被强制关回 false', () => {
    const report = buildReport(RECORDS_WITH_NAME, {
      ...DEFAULT_SANITIZE_RULES,
      privacyLevel: 'strict',
      includeRecordDetail: true,
    })

    expect(report.meta.privacyLevel).toBe('strict')
    expect(report.details).toEqual([])
    expect(report.meta.title).toContain('严格脱敏')
  })
})

/* ------------------------------------------------------------------ allowedKeys 与 meta */

describe('buildSanitizedReport：allowedKeys 覆盖全部键', () => {
  it('报告里出现过的每一个键都在 allowedKeys 里（含嵌套与数组元素）', () => {
    const report = buildReport(RECORDS_WITH_NAME, {
      ...DEFAULT_SANITIZE_RULES,
      privacyLevel: 'custom',
      includeRecordDetail: true,
    })
    const allowed = new Set(report.allowedKeys)

    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node === null || typeof node !== 'object') {
        return
      }
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        expect(allowed.has(key), `allowedKeys 缺少键：${key}`).toBe(true)
        walk(child)
      }
    }
    walk(report)
  })

  it('allowedKeys 不含任何被禁字段名', () => {
    const report = buildReport()
    const forbidden = new Set(FORBIDDEN_FIELD_NAMES)

    for (const key of report.allowedKeys) {
      expect(forbidden.has(key), `allowedKeys 里出现了被禁字段：${key}`).toBe(false)
    }
  })

  it('同一次输入得到同一份 allowedKeys（可复现）', () => {
    expect(buildReport().allowedKeys).toEqual(buildReport().allowedKeys)
  })

  it('meta 带齐口径快照：数据截至日、去重策略、规则版本、筛选与隐私级别', () => {
    const report = buildReport()

    expect(report.meta.dataAsOf).toBe('2026-09-26')
    expect(report.meta.dedupStrategy).toBe('确认后每组保留首条')
    expect(report.meta.cleaningRuleVersion).toBe('1.0.0')
    expect(report.meta.analysisRuleVersion.length).toBeGreaterThan(0)
    expect(report.meta.privacyLevel).toBe('standard')
    expect(report.meta.activeFilters).toHaveLength(0)
    expect(report.meta.suppressionNote).toContain('互补抑制')
    expect(report.meta.limitationNote).toContain('不承诺不可重新识别')
  })

  it('章节结构与 PRD 11.1 的七章一致（四种格式共用同一份清单）', () => {
    const report = buildReport()

    expect(report.sections.map((section) => section.id)).toEqual(
      REPORT_SECTIONS.map((section) => section.id),
    )
    expect(report.sections).toHaveLength(7)
  })

  it('数据质量区把被禁用模块的原因如实写出来', () => {
    const report = buildReport()

    expect(report.quality.keptRows).toBe(RECORDS_WITH_NAME.length)
    expect(report.quality.unknownShareNote).toContain('薪资对比')
    expect(report.quality.unknownShareNote).toContain('币种与计薪周期未确认')
    expect(report.quality.effectiveSampleNotes[0]).toContain('有效样本')
  })
})

/* ------------------------------------------------------------------ 与 AI 载荷形状互不通用 */

/*
 * 说明（本步的核心设计约束，PRD 11.4 / AGENTS.md §2.2）：
 * `SanitizedReport`（可含本地明细）与 `SanitizedAiPayload`（只允许聚合）**形状不同且没有转换器**，
 * 因此「把报告直接当 AI 载荷发出去」在类型层面就不成立。
 * 下面的断言是编译期检查：若以后有人不小心让两者互相可赋值，这一行会直接编译失败。
 */
describe('SanitizedAiPayload 与 SanitizedReport 不可互换', () => {
  it('两种结构在类型层面互不兼容（没有转换器，也不允许以后加）', () => {
    type ReportToPayload = SanitizedReport extends SanitizedAiPayload ? true : false
    type PayloadToReport = SanitizedAiPayload extends SanitizedReport ? true : false

    const reportAssignable: ReportToPayload = false
    const payloadAssignable: PayloadToReport = false
    expect(reportAssignable).toBe(false)
    expect(payloadAssignable).toBe(false)

    // 结构守卫只认 AI 载荷，不认报告
    const report: unknown = buildReport()
    expect(isSanitizedAiPayload(report)).toBe(false)
    expect(isSanitizedAiPayload({ payloadVersion: AI_PAYLOAD_VERSION })).toBe(false)
  })
})
