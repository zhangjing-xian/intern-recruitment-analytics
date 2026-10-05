/**
 * 拒 offer 专项结论层单测（步骤10）。
 *
 * 结论层与引擎层的分工：引擎出计数与率，本层把它们组合成**可解释的结论**。
 * 因此这里重点断言「结论有没有越界」：
 * - 两个人群必须分开（核心率分母含待入职，组间比较不含）；
 * - 原因全空时不许编造原因，且要给出「补充访谈」建议；
 * - 每条结论都能回溯到规则 ID / 版本，并列出未知条件；
 * - 不出现任何概率 / 因果表述，也不出现「不招某类学校」这类建议。
 *
 * 数据全部来自 `domain/analytics/fixtures.ts` 的合成夹具。
 */

import { describe, expect, it } from 'vitest'

import { syntheticRecords, type SyntheticRecordInput } from '../domain/analytics/fixtures'

import {
  COMPOSITION_NOTE,
  REJECTION_DIMENSIONS,
  REJECTION_DISCLAIMER,
  buildRejectionInsight,
  reasonsAdvice,
} from './rejection'

/** 6 条记录：2 拒（原因全空）+ 2 入职 + 1 待入职 + 1 审批中 */
const MIXED: readonly SyntheticRecordInput[] = [
  { offerStatus: '拒绝offer', rejectionReason: null, channel: 'Boss', city: '上海' },
  { offerStatus: '拒绝口头offer', rejectionReason: null, channel: '内推', city: '上海' },
  { offerStatus: '已入职', channel: 'Boss', city: '广州' },
  { offerStatus: '已入职', channel: '实习僧', city: '杭州' },
  { offerStatus: '待入职', channel: '内推', city: '杭州' },
  { offerStatus: 'offer审批中', channel: 'Boss', city: '上海' },
]

function insightOf(inputs: readonly SyntheticRecordInput[] = MIXED) {
  return buildRejectionInsight(syntheticRecords(inputs), {
    dataAsOf: '2026-09-26',
    salaryComparable: true,
  })
}

describe('两个人群必须分开', () => {
  it('核心率分母 D 含待入职、不含审批中；比较人群不含待入职与审批中', () => {
    const insight = insightOf()
    // 全部口径：J2 P1 R2 → D = J + P + R = 5，A = 1 被排除
    expect(insight.overall.counts.joined).toBe(2)
    expect(insight.overall.counts.pending).toBe(1)
    expect(insight.overall.counts.approving).toBe(1)
    expect(insight.overall.counts.rejected).toBe(2)
    expect(insight.overall.counts.coreDenominator).toBe(5)

    // 比较人群：只有 R2 + J2 = 4 条
    expect(insight.comparison.counts.total).toBe(4)
    expect(insight.comparison.counts.pending).toBe(0)
    expect(insight.comparison.counts.approving).toBe(0)
  })

  it('comparisonNote 同时说明 D 的构成与「待入职不进比较」', () => {
    const insight = insightOf()
    expect(insight.comparisonNote).toContain('D = 5')
    expect(insight.comparisonNote).toContain('待入职')
    expect(insight.comparisonNote).toContain('审批中')
    expect(insight.comparisonNote).toContain('不能混用')
  })

  it('组内构成按组分开计数，且与 counts 的差就是未进组记录', () => {
    const insight = insightOf()
    expect(insight.overall.groupComposition.rejectedGroupCount).toBe(2)
    expect(insight.overall.groupComposition.joinedGroupCount).toBe(2)
    expect(insight.overall.groupComposition.comparedCount).toBe(4)
    // 6 条里只有 4 条进组
    expect(insight.overall.counts.total - insight.overall.groupComposition.comparedCount).toBe(2)
  })
})

describe('原因：不许编造', () => {
  it('原因全空 → 填写率 0%（不是 null），且「未填写」占满 R', () => {
    const { reasons } = insightOf()
    expect(reasons.denominator).toBe(2)
    expect(reasons.filledCount).toBe(0)
    expect(reasons.fillRate).toBe(0)
    const unfilled = reasons.categories.find((item) => item.category === '未填写')
    expect(unfilled?.count).toBe(2)
    expect(unfilled?.share).toBe(1)
    // 不得因此造出任何原因
    const salary = reasons.categories.find((item) => item.category === '薪酬')
    expect(salary?.count).toBe(0)
    expect(reasons.matchedCount).toBe(0)
  })

  it('原因全空时给出「补充拒绝访谈」的建议', () => {
    const advice = reasonsAdvice(insightOf().reasons)
    expect(advice.some((item) => item.id === 'reasonMissing')).toBe(true)
  })

  it('原因齐全时不硬塞「补充访谈」建议', () => {
    const insight = buildRejectionInsight(
      syntheticRecords([
        { offerStatus: '拒绝offer', rejectionReason: '薪酬' },
        { offerStatus: '拒绝offer', rejectionReason: '地点' },
        { offerStatus: '已入职' },
      ]),
      { dataAsOf: '2026-09-26', salaryComparable: true },
    )
    expect(reasonsAdvice(insight.reasons)).toEqual([])
  })

  it('填写率偏低（不是只有 0%）同样给出「补充拒绝访谈」建议', () => {
    // 1/10 填写 = 10% < 50% 阈值：这正是最需要补访谈的情况
    const inputs: SyntheticRecordInput[] = [
      { offerStatus: '拒绝offer', rejectionReason: '薪酬' },
      ...Array.from({ length: 9 }, () => ({
        offerStatus: '拒绝offer' as const,
        rejectionReason: null,
      })),
      { offerStatus: '已入职' },
    ]
    const insight = buildRejectionInsight(syntheticRecords(inputs), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
    })
    expect(insight.reasons.fillRate).toBeCloseTo(0.1, 10)
    expect(reasonsAdvice(insight.reasons).some((item) => item.id === 'reasonMissing')).toBe(true)
  })

  it('存在「未分类」时也要提示补字典（即使填写率很高）', () => {
    const inputs: SyntheticRecordInput[] = [
      { offerStatus: '拒绝offer', rejectionReason: '薪酬' },
      { offerStatus: '拒绝offer', rejectionReason: '地点' },
      { offerStatus: '拒绝offer', rejectionReason: '一段字典里没有的自由文本' },
      { offerStatus: '已入职' },
    ]
    const insight = buildRejectionInsight(syntheticRecords(inputs), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
    })
    expect(insight.reasons.fillRate).toBe(1)
    expect(insight.reasons.unclassifiedCount).toBe(1)
    expect(reasonsAdvice(insight.reasons).some((item) => item.id === 'reasonMissing')).toBe(true)
  })
})

describe('行动建议：PRD 9.4 的每一行都真的能出现', () => {
  it('审批记录较多时给出「梳理审批节点」建议', () => {
    // 审批中占全部记录的 40% ≥ 20% 阈值
    const inputs: SyntheticRecordInput[] = [
      { offerStatus: '拒绝offer' },
      ...Array.from({ length: 3 }, () => ({ offerStatus: 'offer审批中' as const })),
      { offerStatus: '已入职' },
    ]
    const insight = buildRejectionInsight(syntheticRecords(inputs), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
    })
    expect(insight.overall.counts.approving).toBe(3)
    expect(insight.advice.some((item) => item.id === 'approvalBacklog')).toBe(true)
  })

  it('审批很少时不提审批积压', () => {
    const inputs: SyntheticRecordInput[] = [
      ...Array.from({ length: 10 }, () => ({ offerStatus: '已入职' as const })),
      { offerStatus: 'offer审批中' },
    ]
    const insight = buildRejectionInsight(syntheticRecords(inputs), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
    })
    expect(insight.advice.some((item) => item.id === 'approvalBacklog')).toBe(false)
  })

  it('待入职当前等待超阈值时给出「跟进当前节点」建议（拒 offer 的等待永远算不出来）', () => {
    const inputs: SyntheticRecordInput[] = [
      { offerStatus: '待入职', recruitmentStartDate: '2026-01-01' },
      { offerStatus: '已入职' },
    ]
    const insight = buildRejectionInsight(syntheticRecords(inputs), {
      dataAsOf: '2026-09-26',
      waitingThresholdDays: 30,
      salaryComparable: true,
    })
    expect(insight.advice.some((item) => item.id === 'longWaiting')).toBe(true)
  })

  it('等待时长未知时不当成超时，也不给等待建议', () => {
    // 拒 offer 缺拒绝日期 → 未知；已入职无日期 → 未知
    const inputs: SyntheticRecordInput[] = [
      { offerStatus: '拒绝offer', recruitmentStartDate: '2026-01-01' },
      { offerStatus: '已入职' },
    ]
    const insight = buildRejectionInsight(syntheticRecords(inputs), {
      dataAsOf: '2026-09-26',
      waitingThresholdDays: 30,
      salaryComparable: true,
    })
    expect(insight.advice.some((item) => item.id === 'longWaiting')).toBe(false)
  })

  it('建议按 id 去重，且不含任何淘汰 / 歧视类表述', () => {
    const inputs: SyntheticRecordInput[] = [
      ...Array.from({ length: 12 }, () => ({
        offerStatus: '拒绝offer' as const,
        housingType: '无补贴' as const,
      })),
      ...Array.from({ length: 12 }, () => ({
        offerStatus: '已入职' as const,
        housingType: '无补贴' as const,
      })),
    ]
    const insight = buildRejectionInsight(syntheticRecords(inputs), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
    })
    const ids = insight.advice.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of insight.advice) {
      expect(item.observation.length).toBeGreaterThan(0)
      expect(item.advice.length).toBeGreaterThan(0)
      expect(item.advice).not.toContain('不招聘')
      expect(item.advice).not.toContain('淘汰')
    }
  })
})

describe('维度对比', () => {
  it('覆盖 PRD 9.1 的比较维度，且每个维度带标签与合计行', () => {
    const insight = insightOf()
    expect(insight.dimensions.length).toBe(REJECTION_DIMENSIONS.length)
    for (const view of insight.dimensions) {
      expect(view.label.length).toBeGreaterThan(0)
      expect(view.total).toBe(insight.overall)
      expect(view.compositionNote).toBe(COMPOSITION_NOTE)
    }
  })

  it('特征内率用全部记录算（D 与核心率分母一致），组内构成按组给', () => {
    const insight = insightOf()
    const channel = insight.dimensions.find((view) => view.dimension === 'channel')
    expect(channel).toBeDefined()
    // Boss：1 拒 + 1 入职 + 1 审批中 → N=3、D=2（审批中不进 D）
    const boss = channel?.groups.find((group) => group.key === 'Boss')
    expect(boss?.counts.total).toBe(3)
    expect(boss?.counts.coreDenominator).toBe(2)
    expect(boss?.groupComposition.rejectedGroupCount).toBe(1)
    expect(boss?.groupComposition.joinedGroupCount).toBe(1)
    // 审批中那条不进任何一组
    expect(boss?.groupComposition.comparedCount).toBe(2)
  })

  it('维度可裁剪（调用方只关心一部分维度时）', () => {
    const insight = buildRejectionInsight(syntheticRecords(MIXED), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
      dimensions: ['channel'],
    })
    expect(insight.dimensions.length).toBe(1)
    expect(insight.dimensions[0].dimension).toBe('channel')
  })
})

describe('规则结论可回溯且不越界', () => {
  it('每条评估都带规则 ID / 版本 / 适用范围 / 建议核查事项', () => {
    const { evaluations } = insightOf()
    expect(evaluations.length).toBeGreaterThan(0)
    for (const evaluation of evaluations) {
      expect(evaluation.rule.id.length).toBeGreaterThan(0)
      expect(evaluation.rule.version).toBe(insightOf().ruleVersion)
      expect(evaluation.scopeNote).toContain('待入职与审批中不参与命中统计')
      expect(evaluation.suggestedCheck.length).toBeGreaterThan(0)
      expect(['insufficient', 'description', 'observed']).toContain(evaluation.level)
    }
  })

  it('小样本一律 insufficient，且结论里不出现「观察到」', () => {
    const { evaluations } = insightOf()
    for (const evaluation of evaluations) {
      if (evaluation.level === 'insufficient') {
        expect(evaluation.conclusion).not.toContain('观察到')
      }
    }
  })

  it('任何结论里都不出现概率 / 因果断言', () => {
    const insight = insightOf()
    const allText = [
      insight.disclaimer,
      insight.comparisonNote,
      ...insight.evaluations.map((item) => item.conclusion),
      ...insight.evaluations.map((item) => item.suggestedCheck),
      ...insight.advice.map((item) => item.advice),
    ].join('\n')
    expect(allText).not.toMatch(/概率\s*\d/)
    expect(allText).not.toContain('一定')
    expect(allText).not.toContain('导致')
    expect(allText).not.toContain('不招聘')
  })

  it('时间条件在拒 offer 记录上恒为未知，必须如实列出', () => {
    const { evaluations } = insightOf()
    const combo = evaluations.find((item) => item.rule.id === 'R-LOWPAY-WAIT')
    expect(combo).toBeDefined()
    expect(combo?.unknownConditions.some((item) => item.condition === 'waitingTooLong')).toBe(true)
  })

  it('阈值与规则版本随结论一起返回（供报告记录）', () => {
    const insight = insightOf()
    expect(insight.thresholds.minDenominator).toBe(10)
    expect(insight.thresholds.minRejected).toBe(3)
    expect(insight.thresholds.minRateGapPoints).toBe(10)
    expect(insight.waitingThresholdDays).toBe(30)
    expect(insight.ruleVersion.length).toBeGreaterThan(0)
    expect(insight.dataAsOf).toBe('2026-09-26')
  })

  it('阈值可由调用方覆盖', () => {
    const insight = buildRejectionInsight(syntheticRecords(MIXED), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
      waitingThresholdDays: 60,
      thresholds: { minDenominator: 5, minRejected: 2, minRateGapPoints: 5 },
    })
    expect(insight.waitingThresholdDays).toBe(60)
    expect(insight.thresholds.minDenominator).toBe(5)
  })

  it('规则集可由调用方覆盖（PRD 9.3「可配置组合」的入口真的接通）', () => {
    const insight = buildRejectionInsight(syntheticRecords(MIXED), {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
      rules: [
        {
          id: 'CUSTOM-ONLY',
          version: 'custom/1',
          label: '自定义组合',
          conditions: ['noSubsidy'],
          suggestedCheck: '核查补贴资格',
        },
      ],
    })
    expect(insight.evaluations.length).toBe(1)
    expect(insight.evaluations[0].rule.id).toBe('CUSTOM-ONLY')
  })

  it('免责声明明确「规则筛查、不是因果、不是个人概率」', () => {
    const insight = insightOf()
    expect(insight.disclaimer).toBe(REJECTION_DISCLAIMER)
    expect(insight.disclaimer).toContain('规则筛查')
    expect(insight.disclaimer).toContain('不是因果结论')
    expect(insight.disclaimer).toContain('个人拒 offer 概率')
    expect(insight.disclaimer).toContain('自动淘汰')
  })
})

describe('边界：空数据', () => {
  it('没有记录时所有分母为 0、比率为 null，不抛错也不显示 0%', () => {
    const insight = buildRejectionInsight([], {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
    })
    expect(insight.overall.counts.total).toBe(0)
    expect(insight.overall.counts.coreDenominator).toBe(0)
    expect(insight.overall.rates.rejectionRate.value).toBeNull()
    expect(insight.reasons.denominator).toBe(0)
    expect(insight.reasons.fillRate).toBeNull()
    expect(insight.comparison.counts.total).toBe(0)
    // 维度仍然给出（分组为空），不抛错
    expect(insight.dimensions.length).toBe(REJECTION_DIMENSIONS.length)
  })

  it('薪资不可比时不抛错，低薪条件为未知', () => {
    const insight = buildRejectionInsight(syntheticRecords(MIXED), {
      dataAsOf: '2026-09-26',
      salaryComparable: false,
    })
    const lowPay = insight.evaluations.find((item) => item.rule.id === 'R-LOWPAY')
    expect(lowPay).toBeDefined()
    expect(lowPay?.hitCount).toBe(0)
    expect(lowPay?.unknownConditions.some((item) => item.condition === 'belowBenchmarkMedian')).toBe(
      true,
    )
  })
})
