/**
 * AI 工作区测试用的**合成夹具**（步骤14 抽出，唯一来源）。
 *
 * 为什么抽成独立模块：AI-1 的静态渲染测试与步骤14 的 jsdom 交互测试需要**同一份**输入。
 * 各写一份夹具的后果不是「多几行代码」，而是两个测试可能对着不同的数据断言同一句结论
 * ——那时它们谁也证明不了什么（本项目在 AI-2 就因为「两处各自编号」踩过一次，见 D-064）。
 *
 * 数据全部是人工构造的合成值（AGENTS.md §2.6）：城市是上海 / 广州，HR 是「合成HR-甲/乙」，
 * 不含任何真实姓名、薪资、学校或需求 ID。
 */

import {
  UNFILLED_REASON_LABEL,
  aggregateByDimension,
  rejectionReasonDistribution,
  sortGroupsByDenominator,
  summarizeRecords,
  type City,
  type GroupDimension,
  type NormalizedRecord,
} from '../../domain'
// `syntheticRecords` 刻意不在 domain 桶文件里（它是引擎旁边的测试夹具入口），
// 因此这里直接指向具体文件——与 `AiAnalysisWorkspace.test.tsx` 的取法一致。
import { syntheticRecords } from '../../domain/analytics/fixtures'
import { buildAiSourceCells, cycleBandGroupsOf } from './aiSourceCells'
import type { AiWorkspaceData } from './AiAnalysisWorkspace'

const SHA = '上海' as City
const GZ = '广州' as City

/** 12 条合成记录：覆盖入职 / 待入职 / 审批中 / 拒绝，以及缺失薪资与缺失学校 */
export const AI_FIXTURE_RECORDS: readonly NormalizedRecord[] = syntheticRecords([
  { offerStatus: '已入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 4200, isGptSchool: true },
  { offerStatus: '已入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 4500, isGptSchool: true },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: 3100, isGptSchool: false },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: 5200, isGptSchool: false },
  { offerStatus: '已入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 6100, isGptSchool: null },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: null, isGptSchool: null },
  { offerStatus: '待入职', city: SHA, recruiter: '合成HR-甲', salaryAmount: 3800, isGptSchool: true },
  { offerStatus: '拒绝offer', city: GZ, recruiter: '合成HR-乙', salaryAmount: 4400, isGptSchool: false },
  { offerStatus: '拒绝offer', city: SHA, recruiter: '合成HR-甲', salaryAmount: 4700, isGptSchool: null },
  { offerStatus: '拒绝口头offer', city: GZ, recruiter: '合成HR-乙', salaryAmount: 4900, isGptSchool: true },
  { offerStatus: 'offer审批中', city: SHA, recruiter: '合成HR-甲', salaryAmount: 5300, isGptSchool: false },
  { offerStatus: '已入职', city: GZ, recruiter: '合成HR-乙', salaryAmount: 3900, isGptSchool: null },
])

/** 载荷白名单里的维度（与 `DashboardWorkspace` 传给 `buildAiSourceCells` 的清单一致） */
export const AI_FIXTURE_DIMENSIONS: readonly (readonly [string, GroupDimension])[] = [
  ['city', 'city'],
  ['channel', 'channel'],
  ['referralType', 'referralType'],
  ['recruiter', 'recruiter'],
  ['position', 'position'],
  ['jobFamily', 'jobFamily'],
  ['department', 'department'],
  ['requirementType', 'requirementType'],
  ['school', 'isGptSchool'],
  ['graduationYear', 'graduationYear'],
  ['education', 'education'],
  ['salaryBand', 'salaryBand'],
  ['housingType', 'housingType'],
]

export const AI_FIXTURE_SALARY_EDGES: readonly number[] = [3000, 4000, 5000, 6000]

/** 与看板 `DashboardWorkspace` 相同的装配方式：分组 → 候选格 → 工作区输入 */
export function aiWorkspaceDataOf(
  records: readonly NormalizedRecord[] = AI_FIXTURE_RECORDS,
): AiWorkspaceData {
  const groupingOptions = { salaryBandEdges: AI_FIXTURE_SALARY_EDGES }
  const dimensions = AI_FIXTURE_DIMENSIONS.map(([dimension, groupDimension]) => {
    const groups = sortGroupsByDenominator(
      aggregateByDimension(records, groupDimension, groupingOptions),
    )
    return {
      dimension,
      label: dimension,
      groups,
      total: summarizeRecords('全部（当前筛选）', records),
    }
  })
  const counts = summarizeRecords('全部（当前筛选）', records).counts

  return {
    cells: buildAiSourceCells({
      dimensions,
      salaryBandEdges: AI_FIXTURE_SALARY_EDGES,
      cycleBandGroups: {
        groups: cycleBandGroupsOf(records),
        total: summarizeRecords('全部（当前筛选）', records),
      },
    }),
    kpi: {
      total: counts.total,
      joined: counts.joined,
      pending: counts.pending,
      approving: counts.approving,
      rejectedOffer: counts.rejectedOffer,
      rejectedVerbally: counts.rejectedVerbally,
      coreDenominator: counts.coreDenominator,
    },
    scope: {
      rowCount: records.length,
      dedupPolicy: '确认后每组保留首条',
      filters: ['城市：上海、广州'],
      ruleVersion: '1.0.0+3F2A19C4',
      dataAsOf: '2026-08-31',
    },
    reasons: rejectionReasonDistribution(records)
      .categories.filter((item) => item.category !== UNFILLED_REASON_LABEL)
      .map((item) => ({ category: item.category, count: item.count })),
    quality: { unknownStatus: counts.unknown, missingSalary: 0, unknownSchool: 0 },
    caliberNotes: ['D = 已入职 + 待入职 + 拒绝 offer；审批中不计入 D。'],
  }
}
