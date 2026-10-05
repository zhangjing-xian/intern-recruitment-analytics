/**
 * AI-1 端到端（渲染层面）集成测试：候选格 → 载荷 → 预览 → 一次性确认。
 *
 * 这一组是「各层拼起来还对不对」的验收，覆盖 docs/PRD.md 19 章的 AI01–AI03 / AI09：
 *
 * | 编号 | 验收项 | 本文件的断言 |
 * |---|---|---|
 * | AI01 | 未点击确认时零网络请求；确认后恰好 1 次 | 确认前 `consumeConfirmation` 返回「尚未确认」；成功消费恰好一次 |
 * | AI02 | 双击确认按钮不产生第二次付费请求 | 第二次消费被「已被使用」拒绝 |
 * | AI03 / AI09 | 改隐私级别后旧确认失效 | 换级别的预览 hash 不同，旧令牌被「已失效」拒绝 |
 *
 * 另外钉两件渲染层面的事实：
 * 1. 未生成预览时**没有**确认按钮（先确认后看内容是不允许的）；
 * 2. 生成预览后页面里出现完整 JSON、目的地与「本步不发请求」的声明。
 *
 * 数据全部是合成值（AGENTS.md §2.6）；本文件不涉及任何网络（AI-1 明确不接真实网络）。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

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
import { syntheticRecords } from '../../domain/analytics/fixtures'
import {
  AI_DEFAULT_PARAMS,
  buildAiPreview,
  confirmPreview,
  consumeConfirmation,
  type AiPreview,
} from '../../privacy/aiPreview'
import {
  AI_SUMMARY_SCHEMA_VERSION,
  buildSanitizedAiPayload,
  checkSanitizedAiPayload,
  type AiSourceCell,
} from '../../privacy/aiSummary'

import AiAnalysisWorkspace, { type AiWorkspaceData } from './AiAnalysisWorkspace'
import { buildAiSourceCells, cycleBandGroupsOf } from './aiSourceCells'
import {
  AI_CONFIRM_LABEL,
  AI_SUBJECT_RULES_BLOCK_NOTE,
  AI_SUBJECT_RULES_BLOCK_TITLE,
  AI_SUBJECT_RULES_FINGERPRINT_LABEL,
  AI_WORKSPACE_NO_DATA_TITLE,
} from './aiText'

/* ------------------------------------------------------------------ 合成数据 */

const SHA = '上海' as City
const GZ = '广州' as City

/** 12 条合成记录：覆盖入职 / 待入职 / 审批中 / 拒绝，以及缺失薪资与缺失学校 */
const RECORDS: readonly NormalizedRecord[] = syntheticRecords([
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
const AI_DIMENSIONS: readonly (readonly [string, GroupDimension])[] = [
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

const SALARY_EDGES = [3000, 4000, 5000, 6000]

/** 与看板 `DashboardWorkspace` 相同的装配方式：分组 → 候选格 → 工作区输入 */
function workspaceDataOf(records: readonly NormalizedRecord[] = RECORDS): AiWorkspaceData {
  const groupingOptions = { salaryBandEdges: SALARY_EDGES }
  const dimensions = AI_DIMENSIONS.map(([dimension, groupDimension]) => {
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
      salaryBandEdges: SALARY_EDGES,
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

/** 与工作区同一条构造链：候选格 → 载荷 → 预览 */
function previewOf(
  data: AiWorkspaceData,
  privacyLevel: 'strict' | 'standard' | 'custom' = 'standard',
  generatedAt = '2026-09-26T10:00:00.000Z',
): AiPreview {
  const payload = buildSanitizedAiPayload({
    privacyLevel,
    scope: {
      rowCount: data.scope.rowCount,
      dedupPolicy: data.scope.dedupPolicy,
      filters: data.scope.filters,
      ruleVersion: data.scope.ruleVersion,
      dataAsOf: data.scope.dataAsOf,
    },
    kpi: data.kpi,
    cells: data.cells,
    reasons: data.reasons.map((item) => ({ category: item.category, count: item.count })),
    quality: data.quality,
    caliberNotes: data.caliberNotes,
    generatedAt,
  })
  return buildAiPreview({
    payload,
    caliberNotes: data.caliberNotes,
    params: AI_DEFAULT_PARAMS,
    generatedAt,
  })
}

function renderWorkspace(
  data: AiWorkspaceData = workspaceDataOf(),
  initialParams?: Parameters<typeof AiAnalysisWorkspace>[0]['initialParams'],
): string {
  return renderToStaticMarkup(
    <AiAnalysisWorkspace
      data={data}
      {...(initialParams === undefined ? {} : { initialParams })}
      onCopy={() => Promise.resolve(true)}
    />,
  )
}

/* ------------------------------------------------------------------ 链路 */

describe('候选格 → 载荷 → 预览：链路自洽', () => {
  it('载荷通过引擎的白名单契约校验（没有未知键）', () => {
    const preview = previewOf(workspaceDataOf())

    expect(checkSanitizedAiPayload(preview.payload).ok).toBe(true)
    expect(preview.payload.schemaVersion).toBe(AI_SUMMARY_SCHEMA_VERSION)
  })

  it('总体 KPI 与引擎的核心计数一致（组件不另算）', () => {
    const data = workspaceDataOf()
    const preview = previewOf(data)

    expect(preview.payload.kpi.N).toBe(data.kpi.total)
    expect(preview.payload.kpi.D).toBe(data.kpi.coreDenominator)
    expect(preview.payload.kpi.R1 + preview.payload.kpi.R2).toBe(
      data.kpi.rejectedOffer + data.kpi.rejectedVerbally,
    )
  })

  it('候选格里没有任何真实姓名 / 学校名 / 准确薪资，只有代号与区间', () => {
    const data = workspaceDataOf()
    const serialized = JSON.stringify(data.cells)

    for (const forbidden of ['合成HR-甲', '合成HR-乙']) {
      expect(serialized).not.toContain(forbidden)
      expect(JSON.stringify(previewOf(data).payload)).not.toContain(forbidden)
    }
    // HR 维度只出代号
    expect(serialized).toContain('HR-1')
    expect(serialized).toContain('HR-2')
    // 薪资维度只出区间
    expect(serialized).toContain('4000–4999')
    expect(serialized).not.toContain('4200')
  })

  it('payloadJson 与 payload 逐字节对应，且预览与「将要发送的文本」共用同一份序列化', () => {
    const preview = previewOf(workspaceDataOf())

    expect(preview.payloadJson).toBe(JSON.stringify(preview.payload, null, 2))
    expect(preview.messages[1]?.content).toContain(preview.payloadJson)
  })
})

/* ------------------------------------------------------------------ 一次性确认 */

describe('一次性确认令牌（AI01 / AI02 / AI03 / AI09）', () => {
  it('未确认时不能消费，理由是引擎原文', () => {
    const preview = previewOf(workspaceDataOf())
    const result = consumeConfirmation({ token: null, consumed: false }, preview.hash)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('尚未确认')
    }
  })

  it('确认后恰好消费一次；第二次被拒绝（防双击重复计费）', () => {
    const preview = previewOf(workspaceDataOf())
    const confirmed = confirmPreview(preview.hash, '2026-09-26T10:01:00.000Z')

    const first = consumeConfirmation(confirmed, preview.hash)
    expect(first.ok).toBe(true)

    const second = consumeConfirmation(first.ok ? first.state : confirmed, preview.hash)
    expect(second.ok).toBe(false)
    if (!second.ok) {
      expect(second.reason).toContain('已被使用')
    }
  })

  it('换隐私级别 → hash 变化 → 旧确认被「已失效」拒绝', () => {
    const data = workspaceDataOf()
    const standard = previewOf(data, 'standard')
    const strict = previewOf(data, 'strict')

    expect(strict.hash).not.toBe(standard.hash)
    const confirmedOld = confirmPreview(standard.hash, '2026-09-26T10:01:00.000Z')
    const result = consumeConfirmation(confirmedOld, strict.hash)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('已失效')
    }
  })

  it('strict 级别真的少发维度（HR 代号与渠道不进载荷）', () => {
    const data = workspaceDataOf()
    const strict = previewOf(data, 'strict')
    const serialized = JSON.stringify(strict.payload)

    expect(serialized).not.toContain('HR-1')
    expect(strict.payload.dimensions.every((table) => table.dim === 'city')).toBe(true)
    expect(strict.payload.omitted.length).toBeGreaterThan(0)
    expect(strict.payload.omitted.every((entry) => entry.reason.length > 0)).toBe(true)
  })

  it('改模型参数 → hash 变化 → 旧确认被拒绝（参数也是「被批准内容」）', () => {
    const data = workspaceDataOf()
    const base = previewOf(data)
    const warmer = buildAiPreview({
      payload: base.payload,
      caliberNotes: data.caliberNotes,
      params: { ...AI_DEFAULT_PARAMS, temperature: 0.9 },
      generatedAt: base.generatedAt,
    })

    expect(warmer.hash).not.toBe(base.hash)
    const result = consumeConfirmation(confirmPreview(base.hash, '2026-09-26T10:01:00.000Z'), warmer.hash)
    expect(result.ok).toBe(false)
  })
})

/* ------------------------------------------------------------------ 渲染 */

describe('AiAnalysisWorkspace 渲染', () => {
  it('未生成预览时不出现确认按钮，也不出现完整 JSON（先确认后看内容是不允许的）', () => {
    const html = renderWorkspace()
    const preview = previewOf(workspaceDataOf())

    expect(html).toContain('AI 深度分析（本地脱敏预览）')
    expect(html).toContain('生成脱敏预览')
    expect(html).not.toContain(AI_CONFIRM_LABEL)
    expect(html).not.toContain('完整 JSON 载荷')
    expect(html).not.toContain(preview.hash)
  })

  it('工作区把三个隐私级别与模型参数摆出来（目的地只在预览里出现）', () => {
    const html = renderWorkspace()

    expect(html).toContain('严格（strict）')
    expect(html).toContain('标准（standard，默认）')
    expect(html).toContain('自定义（custom）')
    expect(html).toContain('deepseek-chat')
    expect(html).toContain('温度 temperature')
    // 目的地属于「将要发送的内容」，只随预览一起展示；未生成预览时不得出现
    expect(html).not.toContain('https://api.deepseek.com')
    expect(previewOf(workspaceDataOf()).destination.origin).toBe('https://api.deepseek.com')
  })

  /*
   * 用户第二次真实调用踩到的坑（2026-09-27 深夜）：模型思考模式默认开启，
   * 推理内容与正文共用 max_tokens，额度被推理吃光后正文为空。
   * 这里钉住「界面必须提前把这件事说出来」。
   */
  it('思考模式默认为开启的模型：参数区写明推理也计入 max_tokens；其它情况不出现这句', () => {
    // 默认生效模型就是 deepseek-flash（思考模式默认开启）——因此默认渲染里就该有这句
    const byDefault = renderWorkspace()
    expect(byDefault).toContain('思考模式默认为开启')
    expect(byDefault).toContain('max_tokens')

    // 换成思考模式默认关闭的模型（deepseek-chat，且这里也是「不指定」）：不该出现
    const plainModel = renderWorkspace(workspaceDataOf(), {
      ...AI_DEFAULT_PARAMS,
      model: 'deepseek-chat',
      thinking: 'auto',
    })
    expect(plainModel).not.toContain('思考模式默认为开启')

    // 同一个模型但用户已把思考模式设为「关闭」：也不该出现
    const thinkingOff = renderWorkspace(workspaceDataOf(), {
      ...AI_DEFAULT_PARAMS,
      model: 'deepseek-flash',
      thinking: 'disabled',
    })
    expect(thinkingOff).not.toContain('思考模式默认为开启')
  })

  /*
   * 用户反馈（2026-09-27 晚）：「把设置里 AI 相关的信息放到分析看板中来」。
   * 工作区接受一个「AI 设置」槽位：看板把设置页正在用的同一个面板塞进来，
   * 用户在看板里就能开开关、填 Key、确认规则，不必跳来跳去。
   */
  it('内联 AI 设置槽位：AI 未启用时默认展开并渲染槽位内容；不传槽位时一个字都不多', () => {
    const withSlot = renderToStaticMarkup(
      <AiAnalysisWorkspace
        data={workspaceDataOf()}
        enabled={false}
        onCopy={() => Promise.resolve(true)}
        settingsSlot={<p>这里是 AI 设置面板</p>}
      />,
    )
    expect(withSlot).toContain('AI 设置（开关 / API Key / 本地规则确认）')
    expect(withSlot).toContain('这里是 AI 设置面板')
    // AI 未启用 → 默认展开（用户正需要看到开关与 Key 输入框）
    expect(withSlot).toContain('open=""')

    const withoutSlot = renderWorkspace()
    expect(withoutSlot).not.toContain('AI 设置（开关 / API Key / 本地规则确认）')
    expect(withoutSlot).not.toContain('这里是 AI 设置面板')
  })

  it('零记录时给出专门空态，不生成空载荷也不显示 0 值占位', () => {    const html = renderWorkspace(workspaceDataOf([]))

    expect(html).toContain(AI_WORKSPACE_NO_DATA_TITLE)
    expect(html).not.toContain(AI_CONFIRM_LABEL)
  })

  it('工作区文案里没有 Markdown 加粗标记，也没有任何凭据材料', () => {
    const html = renderWorkspace()

    // 工作区自身的文案（引擎的 user 提示词不在初始渲染里，只有生成后才出现）
    expect(html).not.toContain('**')
    /*
     * 注意：这里刻意**不**禁用「Authorization」这个词——本步的说明文案必须说清
     * 「Authorization 头属于 AI-4」，那是对边界的如实描述，不是凭据。
     * 真正不允许出现的是凭据材料本身（Key 值、Bearer 头、apiKey 字段）。
     */
    for (const forbidden of ['Bearer', 'apiKey', 'api_key', 'sk-']) {
      expect(html.includes(forbidden), `工作区文案里出现了 ${forbidden}`).toBe(false)
    }
  })

  /* ---------------------------------------------------- AI-6：本地规则闸门 */

  it('AI-6：本机规则未确认时明确写出「不会发送」，且仍然可以生成预览', () => {
    const html = renderToStaticMarkup(
      <AiAnalysisWorkspace
        data={workspaceDataOf()}
        onCopy={() => Promise.resolve(true)}
        subjectRulesConfirmed={false}
        subjectRulesFingerprint="ABCD1234"
      />,
    )

    expect(html).toContain(AI_SUBJECT_RULES_BLOCK_TITLE)
    expect(html).toContain(AI_SUBJECT_RULES_BLOCK_NOTE)
    expect(html).toContain(AI_SUBJECT_RULES_FINGERPRINT_LABEL)
    expect(html).toContain('ABCD1234')
    // 「生成预览」不受影响：看预览本身不发任何东西
    expect(html).toContain('生成脱敏预览')
  })

  it('AI-6：规则已确认（默认）时不出现那道闸门文案', () => {
    const html = renderWorkspace()
    expect(html).not.toContain(AI_SUBJECT_RULES_BLOCK_TITLE)
    expect(html).not.toContain(AI_SUBJECT_RULES_BLOCK_NOTE)
  })
})

/* ------------------------------------------------------------------ 类型面 */

describe('候选格类型面', () => {
  it('工作区输入里的 cells 是引擎认可的 AiSourceCell[]', () => {
    const data = workspaceDataOf()
    const cells: readonly AiSourceCell[] = data.cells

    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every((cell) => cell.coreDenominator >= 0)).toBe(true)
  })
})
