/**
 * 导出层测试夹具（步骤11，**仅供测试**，不进任何应用构建路径）。
 *
 * 为什么需要它：四个导出器的输入是 `SanitizedReport`，而手工拼一个完整报告对象有一百多个字段，
 * 每个测试各拼一遍必然漂移（漏字段 → 导出器读到 undefined → 测试通过但线上崩）。
 * 这里的做法是从**合成记录**走完全链路（`analyzeRecords` + `buildRejectionInsight` +
 * `buildSanitizedReport`），因此夹具永远与真实数据形状一致；同时也让「报告里没有敏感值」
 * 这条断言在导出层被再验证一次。
 *
 * 数据红线：全部是人工构造的合成姓名 / HR / 薪资 / 需求 ID / 原因（AGENTS.md §2.6）。
 */

import {
  GROUP_DIMENSION_LABELS,
  aggregateByDimension,
  analyzeRecords,
  summarizeRecords,
  type NormalizedRecord,
} from '../domain'
import { syntheticRecord } from '../domain/analytics/fixtures'
import { buildRejectionInsight } from '../insights'
import {
  DEFAULT_SANITIZE_RULES,
  buildSanitizedReport,
  type DimensionInput,
  type SanitizeInput,
  type SanitizedReport,
} from '../privacy'

/** 合成敏感值：导出内容里**一个都不能出现**（PRD 11.5 的哨兵检索） */
export const EXPORT_SENTINELS = {
  candidate: '张导出甲',
  hr: '合成HR-导出',
  referrer: '李推荐',
  requirement: 'REQ-导出-9001',
  salary: 4800,
  reason: '薪酬太低所以接了别家的offer',
} as const

/** 合成记录：含姓名之外的敏感原文（姓名单独注入，见 `buildExportRecords`） */
export function buildExportRecords(): readonly NormalizedRecord[] {
  const base = [
    syntheticRecord({
      recordId: 'EXP-0001',
      requirementId: 'REQ-导出-0001',
      recruiter: EXPORT_SENTINELS.hr,
      referrer: EXPORT_SENTINELS.referrer,
      city: '上海',
      position: '前端开发',
      salaryAmount: EXPORT_SENTINELS.salary,
      currency: 'CNY',
      salaryUnit: '元/月',
      offerStatus: '已入职',
      recruitmentStartDate: '2026-01-05',
      joiningDate: '2026-01-15',
    }),
    syntheticRecord({
      recordId: 'EXP-0002',
      requirementId: 'REQ-导出-0002',
      recruiter: EXPORT_SENTINELS.hr,
      city: '上海',
      position: '前端开发',
      salaryAmount: 3600,
      currency: 'CNY',
      salaryUnit: '元/月',
      offerStatus: '已入职',
      recruitmentStartDate: '2026-02-01',
      joiningDate: '2026-02-13',
    }),
    syntheticRecord({
      recordId: 'EXP-0003',
      requirementId: EXPORT_SENTINELS.requirement,
      recruiter: EXPORT_SENTINELS.hr,
      city: '上海',
      position: '后端开发',
      salaryAmount: 7200,
      currency: 'CNY',
      salaryUnit: '元/月',
      offerStatus: '待入职',
      recruitmentStartDate: '2026-03-01',
      joiningDate: '2026-03-21',
    }),
    syntheticRecord({
      recordId: 'EXP-0004',
      requirementId: 'REQ-导出-0004',
      recruiter: '合成HR-导出B',
      city: '广州',
      position: '测试开发',
      offerStatus: 'offer审批中',
      recruitmentStartDate: '2026-03-10',
    }),
    syntheticRecord({
      recordId: 'EXP-0005',
      requirementId: 'REQ-导出-0005',
      recruiter: '合成HR-导出B',
      city: '广州',
      position: '测试开发',
      offerStatus: '拒绝offer',
      rejectionReason: EXPORT_SENTINELS.reason,
      recruitmentStartDate: '2026-03-12',
    }),
    syntheticRecord({
      recordId: 'EXP-0006',
      requirementId: 'REQ-导出-0006',
      recruiter: EXPORT_SENTINELS.hr,
      city: '杭州',
      position: '后端开发',
      offerStatus: '已入职',
      recruitmentStartDate: '2026-01-08',
      joiningDate: '2026-01-18',
    }),
    syntheticRecord({
      recordId: 'EXP-0007',
      requirementId: 'REQ-导出-0007',
      recruiter: EXPORT_SENTINELS.hr,
      city: '杭州',
      position: '后端开发',
      offerStatus: '拒绝口头offer',
      rejectionReason: '地点',
      recruitmentStartDate: '2026-02-08',
    }),
    // 第 8 条显式注入姓名原文：夹具默认不含姓名，而导出测试必须证明姓名不会出现在文件里
    {
      ...syntheticRecord({ recordId: 'EXP-0008', offerStatus: '拒绝口头offer' }),
      candidateName: EXPORT_SENTINELS.candidate,
    },
  ]
  return base
}

function dimensionsOf(records: readonly NormalizedRecord[]): readonly DimensionInput[] {
  return (['recruiter', 'city', 'position'] as const).map((dimension) => ({
    dimension,
    label: GROUP_DIMENSION_LABELS[dimension],
    groups: aggregateByDimension(records, dimension),
    total: summarizeRecords('全部（当前筛选）', records),
    notes: [`${GROUP_DIMENSION_LABELS[dimension]}：按统一指标引擎聚合`],
  }))
}

/** 构造报告输入（导出层测试与报告层测试共用同一套口径） */
export function buildExportInput(
  records: readonly NormalizedRecord[] = buildExportRecords(),
): SanitizeInput {
  return {
    dataset: {
      metadata: {
        dataAsOf: '2026-09-26',
        dedupStrategy: '确认后每组保留首条',
        ruleVersion: { rulesVersion: '1.0.0' },
      },
      report: {
        counts: { keptRowCount: records.length, issueRowCount: 0 },
        metricAvailability: [
          { module: '核心率', available: true, validSampleCount: records.length, reason: null },
        ],
      },
    },
    filters: [],
    analysis: analyzeRecords(records, {
      dataAsOf: '2026-09-26',
      dedupStrategy: '确认后每组保留首条',
      salaryComparable: true,
    }),
    dimensions: dimensionsOf(records),
    rejection: buildRejectionInsight(records, {
      dataAsOf: '2026-09-26',
      salaryComparable: true,
    }),
    // 图表规格只用于 PNG 离屏渲染，本夹具给一份最小的（类目取自脱敏后的城市分组）
    charts: [
      {
        id: 'chart.city',
        title: '各城市的记录数与核心分母（含合计）',
        kind: 'bar',
        categories: ['合计'],
        series: [{ name: 'N 记录数（含审批中）', values: [records.length] }],
      },
    ],
    generatedAt: '2026-09-26T10:00:00.000Z',
  }
}

/** 构造报告本体 */
export function buildExportReport(
  records: readonly NormalizedRecord[] = buildExportRecords(),
): SanitizedReport {
  return buildSanitizedReport(buildExportInput(records), DEFAULT_SANITIZE_RULES)
}

/**
 * 开启记录级明细的报告。
 *
 * 用 `privacyLevel: 'custom'` 而不是 `includeRecordDetail` 单独覆盖：
 * 传 `privacyLevel: 'standard'` 时报告层会按级别**重新取整套规则**（`rulesOfLevel`），
 * 把明细开关改回 false——这正是 PRD 18.5「切换级别后旧预览立即撤销」的实现方式。
 */
export function buildExportReportWithDetails(
  records: readonly NormalizedRecord[] = buildExportRecords(),
): SanitizedReport {
  return buildSanitizedReport(buildExportInput(records), {
    ...DEFAULT_SANITIZE_RULES,
    privacyLevel: 'custom',
    includeRecordDetail: true,
  })
}

/** 全部哨兵（字符串形式），供「导出内容检索」使用 */
export function exportSentinelTokens(): readonly string[] {
  return [
    EXPORT_SENTINELS.candidate,
    EXPORT_SENTINELS.hr,
    EXPORT_SENTINELS.referrer,
    EXPORT_SENTINELS.requirement,
    EXPORT_SENTINELS.reason,
    '合成HR-导出B',
    String(EXPORT_SENTINELS.salary),
    '3600',
    '7200',
  ]
}
