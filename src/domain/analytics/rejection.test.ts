/**
 * 拒 offer 专项纯函数单测（步骤10，docs/PRD.md 9 章）。
 *
 * 重点钉住四条「错了就会出错误结论」的行为：
 * 1. **待入职 / 审批中不进任何一组**，但仍在核心分母 D 内；
 * 2. **原因不可推断**：自由文本必须落到「未分类」，不得猜成「薪酬」；原因全空时填写率是 0%（不是 null）；
 * 3. **未知条件不是不满足**：拒 offer 记录的等待时长恒为未知，不得当成「未超时」；
 * 4. **结论分级严格按阈值**：D ≥ 10、R ≥ 3、率差 ≥ 10 个百分点三条同时满足才算「观察到关联」。
 *
 * 数据全部来自 `domain/analytics/fixtures.ts` 的合成夹具（AGENTS.md §2.6）。
 */

import { describe, expect, it } from 'vitest'

import {
  syntheticRecords,
  type SyntheticRecordInput,
} from './fixtures'
import { summarizeRecords } from './grouping'
import {
  DEFAULT_REJECTION_RULES,
  DEFAULT_REJECTION_THRESHOLDS,
  REJECTION_CONDITIONS,
  REJECTION_REASON_CATEGORIES,
  REJECTION_RULE_VERSION,
  UNCLASSIFIED_REASON_LABEL,
  UNFILLED_REASON_LABEL,
  classifyRejectionReason,
  comparisonRecords,
  evaluateCondition,
  evaluateRejectionRules,
  rejectionGroupOf,
  rejectionReasonDistribution,
} from './rejection'
import { buildSalaryBenchmarks, indexBenchmarks } from './salary'

/** 一组固定的合成记录：2 拒 + 2 入职 + 1 待入职 + 1 审批中 */
const MIXED: readonly SyntheticRecordInput[] = [
  { offerStatus: '拒绝offer', rejectionReason: '薪酬', city: '上海' },
  { offerStatus: '拒绝口头offer', rejectionReason: null, city: '上海' },
  { offerStatus: '已入职', city: '上海' },
  { offerStatus: '已入职', city: '广州' },
  { offerStatus: '待入职', city: '广州' },
  { offerStatus: 'offer审批中', city: '杭州' },
]

describe('分析人群', () => {
  it('只有拒绝（含口头）进拒 offer 组、只有已入职进入职组', () => {
    const records = syntheticRecords(MIXED)
    expect(rejectionGroupOf(records[0])).toBe('rejected')
    expect(rejectionGroupOf(records[1])).toBe('rejected')
    expect(rejectionGroupOf(records[2])).toBe('joined')
    expect(rejectionGroupOf(records[3])).toBe('joined')
    // 待入职与审批中不进任何一组
    expect(rejectionGroupOf(records[4])).toBeNull()
    expect(rejectionGroupOf(records[5])).toBeNull()
  })

  it('其他 / 未知状态同样不进组', () => {
    const records = syntheticRecords([{ offerStatus: '其他' }, { offerStatus: '未知' }])
    expect(rejectionGroupOf(records[0])).toBeNull()
    expect(rejectionGroupOf(records[1])).toBeNull()
  })

  it('比较人群 = R ∪ J，待入职与审批中被排除（但调用方仍用全量算 D）', () => {
    const records = syntheticRecords(MIXED)
    const scope = comparisonRecords(records)
    expect(scope.length).toBe(4)
    expect(scope.some((record) => record.offerStatus === '待入职')).toBe(false)
    expect(scope.some((record) => record.offerStatus === 'offer审批中')).toBe(false)
  })

  it('组内构成与全部口径并存：分组汇总同时给出两组人数与 D', () => {
    const records = syntheticRecords(MIXED)
    const summary = summarizeRecords('全部', records)
    expect(summary.groupComposition.rejectedGroupCount).toBe(2)
    expect(summary.groupComposition.joinedGroupCount).toBe(2)
    expect(summary.groupComposition.comparedCount).toBe(4)
    // 全部口径：待入职仍在 D 内
    expect(summary.counts.pending).toBe(1)
    expect(summary.counts.coreDenominator).toBe(5)
  })
})

describe('原因分类：只查表，不推断', () => {
  it('空值与纯空白都算「未填写」', () => {
    expect(classifyRejectionReason(null).category).toBe(UNFILLED_REASON_LABEL)
    expect(classifyRejectionReason('').category).toBe(UNFILLED_REASON_LABEL)
    expect(classifyRejectionReason('   ').category).toBe(UNFILLED_REASON_LABEL)
    expect(classifyRejectionReason('\u3000').category).toBe(UNFILLED_REASON_LABEL)
  })

  it('字典内的取值被归到对应类别（忽略空白与大小写）', () => {
    expect(classifyRejectionReason('薪酬').category).toBe('薪酬')
    expect(classifyRejectionReason(' 薪资 ').category).toBe('薪酬')
    expect(classifyRejectionReason('其他 offer').category).toBe('其他offer')
    expect(classifyRejectionReason('其他Offer').category).toBe('其他offer')
    expect(classifyRejectionReason('住房/住宿').category).toBe('住房/住宿')
    expect(classifyRejectionReason('通勤').category).toBe('地点')
    expect(classifyRejectionReason('课程冲突').category).toBe('学业安排')
  })

  it('自由文本一律落到「未分类」，绝不猜成「薪酬」', () => {
    // 这句同时含「薪酬」与「其他 offer」两个线索，任何子串匹配都会猜错
    const sentence = '薪酬太低所以去了别家'
    const result = classifyRejectionReason(sentence)
    expect(result.category).toBe(UNCLASSIFIED_REASON_LABEL)
    expect(result.matched).toBe(false)
  })

  it('字典是精确匹配：「其他」与「其他offer」不会互相碰撞', () => {
    expect(classifyRejectionReason('其他').category).toBe('其他')
    expect(classifyRejectionReason('其他offer').category).toBe('其他offer')
    expect(classifyRejectionReason('其他 offer').category).toBe('其他offer')
    expect(classifyRejectionReason('其他Offer').category).toBe('其他offer')
    // 更长的自由文本不得被前缀吃掉
    expect(classifyRejectionReason('其他 offer 机会').category).toBe(UNCLASSIFIED_REASON_LABEL)
    expect(classifyRejectionReason('其他原因说明').category).toBe(UNCLASSIFIED_REASON_LABEL)
  })

  it('字典里的每个类别都能被它自己的名字命中', () => {
    for (const category of REJECTION_REASON_CATEGORIES) {
      if (category === UNCLASSIFIED_REASON_LABEL || category === UNFILLED_REASON_LABEL) {
        continue
      }
      expect(classifyRejectionReason(category).category).toBe(category)
    }
  })
})

describe('原因分布：分母恒为 R', () => {
  it('原因全空时填写率是 0%（不是 null），且 100% 落在「未填写」', () => {
    const records = syntheticRecords([
      { offerStatus: '拒绝offer', rejectionReason: null },
      { offerStatus: '拒绝口头offer', rejectionReason: null },
      { offerStatus: '已入职' },
    ])
    const distribution = rejectionReasonDistribution(records)
    expect(distribution.denominator).toBe(2)
    expect(distribution.filledCount).toBe(0)
    expect(distribution.fillRate).toBe(0)
    const unfilled = distribution.categories.find((item) => item.category === UNFILLED_REASON_LABEL)
    expect(unfilled?.count).toBe(2)
    expect(unfilled?.share).toBe(1)
    // 不得据此造出任何原因
    const salary = distribution.categories.find((item) => item.category === '薪酬')
    expect(salary?.count).toBe(0)
  })

  it('非拒 offer 记录不进分母', () => {
    const distribution = rejectionReasonDistribution(syntheticRecords(MIXED))
    expect(distribution.denominator).toBe(2)
    expect(distribution.filledCount).toBe(1)
    expect(distribution.fillRate).toBe(0.5)
  })

  it('计数为 0 的类别也保留（顺序固定），占比按 R 计算', () => {
    const distribution = rejectionReasonDistribution(syntheticRecords(MIXED))
    expect(distribution.categories.map((item) => item.category)).toEqual([
      ...REJECTION_REASON_CATEGORIES,
    ])
    const salary = distribution.categories.find((item) => item.category === '薪酬')
    expect(salary?.count).toBe(1)
    expect(salary?.share).toBe(0.5)
  })

  it('未分类单列并给出原值样例（便于维护字典，而不是悄悄并入「其他」）', () => {
    const records = syntheticRecords([
      { offerStatus: '拒绝offer', rejectionReason: '薪酬太低所以去了别家' },
      { offerStatus: '拒绝offer', rejectionReason: '薪酬太低所以去了别家' },
      { offerStatus: '拒绝offer', rejectionReason: '完全没写清楚的一段很长的自由文本内容需要被截断处理' },
    ])
    const distribution = rejectionReasonDistribution(records)
    expect(distribution.unclassifiedCount).toBe(3)
    expect(distribution.matchedCount).toBe(0)
    // 去重后的样例，且过长原文被截断
    expect(distribution.unclassifiedSamples.length).toBe(2)
    expect(distribution.unclassifiedSamples[0]).toBe('薪酬太低所以去了别家')
    expect(distribution.unclassifiedSamples[1].endsWith('…')).toBe(true)
    // 未分类不等于「其他」
    const other = distribution.categories.find((item) => item.category === '其他')
    expect(other?.count).toBe(0)
  })

  it('未分类样例按**原文**去重：超长文本不会重复占满样例列表', () => {
    const longText = '因为要准备考研所以没有办法保证每周到岗四天以上的时间安排需要再考虑一下'
    const records = syntheticRecords([
      { offerStatus: '拒绝offer', rejectionReason: longText },
      { offerStatus: '拒绝offer', rejectionReason: longText },
      { offerStatus: '拒绝offer', rejectionReason: longText },
      { offerStatus: '拒绝offer', rejectionReason: '另一条短原因' },
    ])
    const distribution = rejectionReasonDistribution(records)
    expect(distribution.unclassifiedCount).toBe(4)
    // 同一条超长文本只出现一次；另一条短原因仍然能被看见
    expect(distribution.unclassifiedSamples.length).toBe(2)
    expect(distribution.unclassifiedSamples[0].endsWith('…')).toBe(true)
    expect(distribution.unclassifiedSamples[1]).toBe('另一条短原因')
  })

  it('R = 0 时占比一律 null（不显示 0%）', () => {
    const distribution = rejectionReasonDistribution(syntheticRecords([{ offerStatus: '已入职' }]))
    expect(distribution.denominator).toBe(0)
    expect(distribution.fillRate).toBeNull()
    expect(distribution.categories.every((item) => item.share === null)).toBe(true)
  })
})

describe('基础条件：未知条件保持未知', () => {
  const base = {
    dataAsOf: '2026-09-26',
    waitingThresholdDays: 30,
    salaryComparable: true,
  }

  it('房补：明确无补贴 → 满足；提供住宿 → 不满足（不是「无房补待遇」）；未知 → 未知', () => {
    const noSubsidy = syntheticRecords([{ housingType: '无补贴' }])[0]
    expect(evaluateCondition(noSubsidy, 'noSubsidy', base).met).toBe(true)

    const accommodation = syntheticRecords([{ housingType: '提供住宿' }])[0]
    const evaluated = evaluateCondition(accommodation, 'noSubsidy', base)
    expect(evaluated.met).toBe(false)
    expect(evaluated.detail).toContain('不命中')

    const unknownHousing = syntheticRecords([{ housingType: '未知' }])[0]
    expect(evaluateCondition(unknownHousing, 'noSubsidy', base).met).toBeNull()
  })

  it('GPT：三值分开，缺失为未知（不当 false）', () => {
    expect(evaluateCondition(syntheticRecords([{ isGptSchool: true }])[0], 'gpt', base).met).toBe(true)
    expect(evaluateCondition(syntheticRecords([{ isGptSchool: false }])[0], 'gpt', base).met).toBe(
      false,
    )
    expect(evaluateCondition(syntheticRecords([{ isGptSchool: null }])[0], 'gpt', base).met).toBeNull()
  })

  it('GPT：字段为 undefined（旧结构）同样按未知处理，绝不当成不满足', () => {
    const record = syntheticRecords([{ isGptSchool: true }])[0]
    const broken = { ...record, isGptSchool: undefined } as unknown as typeof record
    const evaluated = evaluateCondition(broken, 'gpt', base)
    expect(evaluated.met).toBeNull()
    expect(evaluated.detail).toContain('缺失')
  })

  it('房补为「其他」时是未知，不是不满足', () => {
    const other = syntheticRecords([{ housingType: '其他' }])[0]
    expect(evaluateCondition(other, 'noSubsidy', base).met).toBeNull()
  })

  it('已入职但日期缺失时等待时长未知（不得当未超时）', () => {
    const joined = syntheticRecords([{ offerStatus: '已入职' }])[0]
    expect(evaluateCondition(joined, 'waitingTooLong', base).met).toBeNull()
  })

  it('同岗样本不足（n < 5）时低薪条件为未知', () => {
    const records = syntheticRecords(
      Array.from({ length: 4 }, () => ({ salaryAmount: 3000, ...SALARY_GROUP })),
    )
    const benchmarks = indexBenchmarks(buildSalaryBenchmarks(records, { comparable: true }))
    expect(evaluateCondition(records[0], 'belowBenchmarkMedian', { ...base, benchmarks }).met).toBeNull()
  })

  it('拒 offer 记录的等待时长恒为未知（缺拒绝日期，不得当未超时）', () => {
    const rejected = syntheticRecords([
      {
        offerStatus: '拒绝offer',
        recruitmentStartDate: '2026-01-01',
      },
    ])[0]
    const evaluated = evaluateCondition(rejected, 'waitingTooLong', base)
    expect(evaluated.met).toBeNull()
  })

  it('待入职的当前等待时长可以真正判定超时', () => {
    const waiting = syntheticRecords([
      { offerStatus: '待入职', recruitmentStartDate: '2026-01-01' },
    ])[0]
    expect(evaluateCondition(waiting, 'waitingTooLong', base).met).toBe(true)
    const recent = syntheticRecords([
      { offerStatus: '待入职', recruitmentStartDate: '2026-09-20' },
    ])[0]
    expect(evaluateCondition(recent, 'waitingTooLong', base).met).toBe(false)
  })

  it('薪资不可比时低薪条件为未知，不当不满足', () => {
    const record = syntheticRecords([{ salaryAmount: 3000, ...SALARY_GROUP }])[0]
    const notComparable = evaluateCondition(record, 'belowBenchmarkMedian', {
      ...base,
      salaryComparable: false,
    })
    expect(notComparable.met).toBeNull()
    expect(notComparable.detail).toContain('不可比')
  })

  it('基准不足时为未知，有了足够基准才判定（相等不算低）', () => {
    const inputs: SyntheticRecordInput[] = [
      { salaryAmount: 3500, ...SALARY_GROUP },
      { salaryAmount: 4000, ...SALARY_GROUP },
      { salaryAmount: 4000, ...SALARY_GROUP },
      { salaryAmount: 4500, ...SALARY_GROUP },
      { salaryAmount: 5000, ...SALARY_GROUP },
    ]
    const records = syntheticRecords(inputs)
    const benchmarks = indexBenchmarks(buildSalaryBenchmarks(records, { comparable: true }))

    const low = evaluateCondition(records[0], 'belowBenchmarkMedian', { ...base, benchmarks })
    expect(low.met).toBe(true)

    // 4000 等于 P50（4000）→ 不算低
    const equal = evaluateCondition(records[1], 'belowBenchmarkMedian', { ...base, benchmarks })
    expect(equal.met).toBe(false)

    // 不传基准索引 → 未知，而不是 false
    expect(evaluateCondition(records[0], 'belowBenchmarkMedian', base).met).toBeNull()
  })
})

describe('规则评估：阈值与结论分级', () => {
  /**
   * 构造记录：`rejectedCount` 条拒 offer 全部命中「无补贴」；
   * 入职组共 `joinedCount` 条，其中前 `joinedNoSubsidyCount` 条也命中「无补贴」。
   *
   * 这样命中组的 D 与 R 都可控：D = rejectedCount + joinedNoSubsidyCount、R = rejectedCount，
   * 而整体基准的 D = rejectedCount + joinedCount、R = rejectedCount。
   */
  function build(
    rejectedCount: number,
    joinedCount: number,
    joinedNoSubsidyCount = 0,
  ): readonly SyntheticRecordInput[] {
    const inputs: SyntheticRecordInput[] = []
    for (let index = 0; index < rejectedCount; index += 1) {
      inputs.push({
        offerStatus: '拒绝offer',
        housingType: '无补贴',
        isGptSchool: true,
        ...SALARY_GROUP,
        salaryAmount: 3000,
      })
    }
    for (let index = 0; index < joinedCount; index += 1) {
      const meetsCondition = index < joinedNoSubsidyCount
      inputs.push({
        offerStatus: '已入职',
        housingType: meetsCondition ? '无补贴' : '现金房补',
        isGptSchool: false,
        ...SALARY_GROUP,
        salaryAmount: 6000,
      })
    }
    return inputs
  }

  function evaluate(inputs: readonly SyntheticRecordInput[]) {
    const records = syntheticRecords(inputs)
    const benchmarks = indexBenchmarks(buildSalaryBenchmarks(records, { comparable: true }))
    return evaluateRejectionRules(records, {
      dataAsOf: '2026-09-26',
      waitingThresholdDays: 30,
      salaryComparable: true,
      benchmarks,
    })
  }

  it('默认规则集只含可观察特征，且带规则 ID 与版本', () => {
    for (const rule of DEFAULT_REJECTION_RULES) {
      expect(rule.id.length).toBeGreaterThan(0)
      expect(rule.version).toBe(REJECTION_RULE_VERSION)
      expect(rule.suggestedCheck.length).toBeGreaterThan(0)
    }
  })

  it('小样本（D < 10）只描述，不给「观察到关联」', () => {
    // 命中组 D = 3 拒 + 0 入职 = 3
    const [noSubsidy] = evaluate(build(3, 1)).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.coreDenominator).toBe(3)
    expect(noSubsidy.hitJoined).toBe(0)
    expect(noSubsidy.level).toBe('insufficient')
    expect(noSubsidy.conclusion).toContain('样本不足')
    expect(noSubsidy.conclusion).not.toContain('观察到')
  })

  it('R < 3 时同样不给结论（即使分母够）', () => {
    // 命中组 D = 2 拒 + 10 入职 = 12 ≥ 10，但 R = 2 < 3
    const [noSubsidy] = evaluate(build(2, 12, 10)).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.coreDenominator).toBe(12)
    expect(noSubsidy.rejected).toBe(2)
    expect(noSubsidy.level).toBe('insufficient')
  })

  it('三条门槛同时满足才输出「观察到…关联」，并明确否定因果与个人概率', () => {
    // 命中组 D = 12 拒 + 0 入职 = 12、R = 12 → 100%
    // 整体 D = 12 + 12 = 24、R = 12 → 50% → 差 50 个百分点 ≥ 10
    const [noSubsidy] = evaluate(build(12, 12)).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.coreDenominator).toBe(12)
    expect(noSubsidy.rejected).toBe(12)
    expect(noSubsidy.rateGapPoints).toBeCloseTo(50, 6)
    expect(noSubsidy.level).toBe('observed')
    expect(noSubsidy.conclusion).toContain('观察到')
    expect(noSubsidy.conclusion).toContain('不是因果结论')
    expect(noSubsidy.conclusion).toContain('不是个人拒 offer 概率')
  })

  it('率差不足 10 个百分点时只描述，不说「观察到关联」', () => {
    // 命中组 D = 32 拒 + 0 入职 = 32、R = 32 → 100%
    // 整体 D = 32 + 2 = 34、R = 32 → 94.12% → 差 5.88 个百分点 < 10
    const [noSubsidy] = evaluate(build(32, 2)).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.coreDenominator).toBe(32)
    expect(noSubsidy.rejected).toBe(32)
    expect(noSubsidy.rateGapPoints).toBeLessThan(10)
    expect(noSubsidy.level).toBe('description')
    expect(noSubsidy.conclusion).toContain('仅供描述')
    expect(noSubsidy.conclusion).not.toContain('观察到')
  })

  it('每条结论都带证据、基准与适用范围的钩子', () => {
    const [noSubsidy] = evaluate(build(12, 2, 1)).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.hitCount).toBe(13)
    expect(noSubsidy.hitRejected).toBe(12)
    expect(noSubsidy.hitJoined).toBe(1)
    expect(noSubsidy.baselineRate).not.toBeNull()
    expect(noSubsidy.scopeNote).toContain('待入职与审批中不参与命中统计')
    expect(noSubsidy.metConditions.length).toBeGreaterThan(0)
  })

  it('组合规则的未知条件会挡住结论，不产生虚假命中', () => {
    // R-LOWPAY-WAIT 需要「低于 P50 + 等待超时」；拒 offer 的等待恒为未知 → 永远 0 命中
    const [combo] = evaluate(build(12, 2)).filter((item) => item.rule.id === 'R-LOWPAY-WAIT')
    expect(combo.hitCount).toBe(0)
    expect(combo.level).toBe('insufficient')
    expect(combo.unknownConditions.some((item) => item.condition === 'waitingTooLong')).toBe(true)
  })

  it('阈值可配置：只有率差门槛改变结果时，结论等级随之改变', () => {
    // 上面那条「率差 5.88 个百分点」的构造：默认门槛下是描述，把门槛调到 5 就是结论
    const records = syntheticRecords(build(32, 2))
    const benchmarks = indexBenchmarks(buildSalaryBenchmarks(records, { comparable: true }))
    const base = {
      dataAsOf: '2026-09-26',
      waitingThresholdDays: 30,
      salaryComparable: true,
      benchmarks,
    }
    const strict = evaluateRejectionRules(records, base).find((item) => item.rule.id === 'R-NOSUB')
    const loose = evaluateRejectionRules(records, {
      ...base,
      thresholds: { ...DEFAULT_REJECTION_THRESHOLDS, minRateGapPoints: 5 },
    }).find((item) => item.rule.id === 'R-NOSUB')
    expect(strict?.level).toBe('description')
    expect(loose?.level).toBe('observed')
  })

  it('自定义规则集会被真正使用', () => {
    const records = syntheticRecords(build(12, 2, 1))
    const evaluation = evaluateRejectionRules(records, {
      dataAsOf: '2026-09-26',
      waitingThresholdDays: 30,
      salaryComparable: true,
      rules: [
        {
          id: 'CUSTOM',
          version: 'test/1',
          label: '只看 GPT',
          conditions: ['gpt'],
          suggestedCheck: '核查名单',
        },
      ],
    })
    expect(evaluation.length).toBe(1)
    expect(evaluation[0].rule.id).toBe('CUSTOM')
    expect(evaluation[0].hitRejected).toBe(12)
  })

  it('空条件规则立即报错，绝不把「[].every() === true」当成命中全部记录', () => {
    const records = syntheticRecords(build(10, 10))
    expect(() =>
      evaluateRejectionRules(records, {
        dataAsOf: '2026-09-26',
        waitingThresholdDays: 30,
        salaryComparable: true,
        rules: [
          { id: 'EMPTY', version: 'test/1', label: '空规则', conditions: [], suggestedCheck: '—' },
        ],
      }),
    ).toThrow(/没有条件/)
  })

  it('有效分母 D 含命中的待入职，与基准率同一口径（否则率差被高估）', () => {
    /*
     * 这是最危险的一类错误：命中组的分母若只算 R + J，而基准率的分母算 J + P + R，
     * 两个率就是**不同口径**相减，会把「仅供描述」误升成「观察到关联」。
     *
     * 构造：10 拒（无补贴）+ 20 待入职（无补贴）+ 12 入职（现金房补）
     * - 命中组：10 拒 + 20 待入职 → D = 30、R = 10 → 33.33%
     * - 整体：R = 10、D = 42 → 23.81% → 差 9.52 个百分点 < 10 → 只描述
     * 若分母漏掉待入职 → D = 10 → 100% → 差 76.19 → 会被误判成 observed。
     */
    const inputs: SyntheticRecordInput[] = [
      ...Array.from({ length: 10 }, () => ({
        offerStatus: '拒绝offer' as const,
        housingType: '无补贴' as const,
      })),
      ...Array.from({ length: 20 }, () => ({
        offerStatus: '待入职' as const,
        housingType: '无补贴' as const,
      })),
      ...Array.from({ length: 12 }, () => ({
        offerStatus: '已入职' as const,
        housingType: '现金房补' as const,
      })),
    ]
    const [noSubsidy] = evaluate(inputs).filter((item) => item.rule.id === 'R-NOSUB')

    expect(noSubsidy.coreDenominator).toBe(30)
    expect(noSubsidy.rejected).toBe(10)
    expect(noSubsidy.rejectionRate).toBeCloseTo(10 / 30, 10)
    expect(noSubsidy.baselineRate).toBeCloseTo(10 / 42, 10)
    expect(noSubsidy.rateGapPoints).toBeCloseTo(9.52, 2)
    // 差 9.52 < 10 → 只能是描述
    expect(noSubsidy.level).toBe('description')
  })

  it('恰好 10.00 个百分点算达标（浮点误差不得把它降级成描述）', () => {
    /*
     * (0.5 - 0.4) * 100 在 IEEE754 下等于 9.999999999999998，直接比较会误判未达标。
     * 构造：命中组 10 拒 + 10 入职 → D = 20、R = 10 → 50%
     * 整体再加 5 条计入 D 的待入职 → D = 25、R = 10 → 40% → 差恰好 10.00 个百分点。
     */
    const inputs: SyntheticRecordInput[] = [
      ...Array.from({ length: 10 }, () => ({
        offerStatus: '拒绝offer' as const,
        housingType: '无补贴' as const,
      })),
      ...Array.from({ length: 10 }, () => ({
        offerStatus: '已入职' as const,
        housingType: '无补贴' as const,
      })),
      ...Array.from({ length: 5 }, () => ({
        offerStatus: '待入职' as const,
        housingType: '现金房补' as const,
      })),
    ]
    const [noSubsidy] = evaluate(inputs).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.coreDenominator).toBe(20)
    expect(noSubsidy.baselineRate).toBeCloseTo(0.4, 10)
    expect(noSubsidy.rateGapPoints).toBe(10)
    expect(noSubsidy.level).toBe('observed')
  })

  it('样本门槛的边界是「达到即算」：D = 10 且 R = 3 时不再算样本不足', () => {
    const [noSubsidy] = evaluate(build(3, 7, 7)).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.coreDenominator).toBe(10)
    expect(noSubsidy.rejected).toBe(3)
    expect(noSubsidy.level).not.toBe('insufficient')
  })

  it('比较基准可以由调用方显式给定（报告需要固定基准时）', () => {
    const records = syntheticRecords(build(12, 12))
    const evaluation = evaluateRejectionRules(records, {
      dataAsOf: '2026-09-26',
      waitingThresholdDays: 30,
      salaryComparable: true,
      baseline: { rejected: 0, denominator: 100 },
    })
    const noSubsidy = evaluation.find((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy?.baselineRate).toBe(0)
    expect(noSubsidy?.rateGapPoints).toBeCloseTo(100, 6)
  })

  it('基准分母为 0 时率差为 null，且永远不会给出结论', () => {
    const records = syntheticRecords(build(12, 12))
    const evaluation = evaluateRejectionRules(records, {
      dataAsOf: '2026-09-26',
      waitingThresholdDays: 30,
      salaryComparable: true,
      baseline: { rejected: 0, denominator: 0 },
    })
    const noSubsidy = evaluation.find((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy?.baselineRate).toBeNull()
    expect(noSubsidy?.rateGapPoints).toBeNull()
    expect(noSubsidy?.level).toBe('description')
  })

  it('「提供住宿」不会进入「无补贴」规则的命中（组内也不许）', () => {
    const inputs: SyntheticRecordInput[] = [
      ...Array.from({ length: 12 }, () => ({
        offerStatus: '拒绝offer' as const,
        housingType: '提供住宿' as const,
      })),
      ...Array.from({ length: 12 }, () => ({
        offerStatus: '已入职' as const,
        housingType: '提供住宿' as const,
      })),
    ]
    const [noSubsidy] = evaluate(inputs).filter((item) => item.rule.id === 'R-NOSUB')
    expect(noSubsidy.hitCount).toBe(0)
    expect(noSubsidy.coreDenominator).toBe(0)
    expect(noSubsidy.level).toBe('insufficient')
  })

  it('默认规则集的条件都在已知条件集合内，且规则 ID 不重复', () => {
    for (const rule of DEFAULT_REJECTION_RULES) {
      expect(rule.conditions.length).toBeGreaterThan(0)
      for (const condition of rule.conditions) {
        expect(REJECTION_CONDITIONS).toContain(condition)
      }
      expect(DEFAULT_REJECTION_RULES.filter((item) => item.id === rule.id).length).toBe(1)
    }
  })

  it('命中 / 未知 / 不满足三类互斥，且 0 命中的规则不显示「命中条件」', () => {
    /*
     * 同一条条件在不同记录上可能一次满足、一次未知。若不撤掉重复，界面会同时把
     * 「招聘等待超阈值」列进「命中条件」与「未知条件」，读者无法判断到底哪个成立。
     * 构造：1 条拒 offer（无日期，等待未知）+ 若干已入职（有日期，等待已知）
     */
    const inputs: SyntheticRecordInput[] = [
      { offerStatus: '拒绝offer', recruitmentStartDate: '2026-01-01' },
      ...Array.from({ length: 12 }, () => ({
        offerStatus: '已入职' as const,
        recruitmentStartDate: '2026-01-01',
        joiningDate: '2026-01-05',
      })),
    ]
    for (const evaluation of evaluate(inputs)) {
      for (const condition of REJECTION_CONDITIONS) {
        const inMet = evaluation.metConditions.some((item) => item.condition === condition)
        const inUnknown = evaluation.unknownConditions.some((item) => item.condition === condition)
        const inUnmet = evaluation.unmetConditions.some((item) => item.condition === condition)
        // 至多出现在一类里
        expect([inMet, inUnknown, inUnmet].filter(Boolean).length).toBeLessThanOrEqual(1)
        // 规则的每个条件都必须在某一类里被解释（不能凭空消失）
        if (evaluation.rule.conditions.includes(condition)) {
          expect(inMet || inUnknown || inUnmet).toBe(true)
        }
      }
      // 完全没有命中的规则不得声称任何条件「已满足」
      if (evaluation.hitCount === 0) {
        expect(evaluation.metConditions).toEqual([])
        expect(evaluation.level).toBe('insufficient')
      }
    }
  })
})

/** 同岗基准的严格同组取值（与 fixtures 的薪资例一致） */
const SALARY_GROUP = {
  city: '上海',
  jobFamily: '技术',
  position: '前端开发',
  currency: 'CNY',
  salaryUnit: '元/月',
} as const
