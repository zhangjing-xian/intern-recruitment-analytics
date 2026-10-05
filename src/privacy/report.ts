/**
 * 唯一脱敏报告模型（步骤11，docs/PRD.md 10.6 / 11 章）。
 *
 * 铁律（AGENTS.md §2.5）：**所有导出格式只能消费本文件构造出来的 `SanitizedReport`**。
 * XLSX / Markdown / 打印 HTML / PNG 都不允许自己读会话、读记录或自己算一个数——
 * 否则同一次筛选会在四种格式里给出四个不同的数字，而且只要有一种漏了脱敏就泄漏了。
 *
 * 本文件是纯函数：不依赖 React / DOM / 网络 / 存储；派生指标一律来自传入的
 * `domain/analytics` 结果与 `src/insights` 结论层，本层**不重算任何指标**
 * （AGENTS.md §2.3：公式只在 `domain/analytics` 实现一次）。
 *
 * 三条隐私判断的落点：
 * 1. **HR 代号**：HR 分组标签一律替换为报告内稳定代号 `HR-1`、`HR-2`…（首次出现顺序分配），
 *    对照表**不导出**（PRD 10.6：同一文件内稳定，跨报告默认重建）；
 * 2. **薪资分桶**：任何准确金额（含分位）都转成 `SalaryBand`，`quantileMode: 'hide'`
 *    时改为隐藏；准确中位数不能因为「只是一个数字」就留下（PRD 10.6）；
 * 3. **互补抑制**：小组合并之外还要保证每个维度至少两个组被抑制，
 *    否则「总计 − 其余」就能还原被隐藏的那一组。
 */

import {
  EMPTY_STATUS_COUNTS,
  GROUP_DIMENSION_LABELS,
  buildCoreRates,
  type AnalysisResult,
  type CycleStats,
  type GroupSummary,
} from '../domain'
import type { RejectionInsight } from '../insights'

import {
  DEFAULT_SANITIZE_RULES,
  SANITIZE_KEYS,
  SALARY_BAND_EDGES,
  applyComplementarySuppression,
  collectAllowedKeys,
  rulesOfLevel,
  salaryBandOf,
  type PrivacyLevel,
  type SalaryBand,
  type SanitizeRules,
  type SuppressibleGroup,
  type SuppressionNote,
} from './sanitize'

/* ------------------------------------------------------------------ 报告模型 */

export type ReportKpi = {
  readonly id: string
  readonly label: string
  readonly value: number | null
  readonly numerator: number | null
  readonly denominator: number | null
  readonly note: string
}

export type ReportRate = {
  readonly id: string
  readonly label: string
  readonly numerator: number
  readonly denominator: number
  readonly value: number | null
  readonly suppressed: boolean
  readonly note: string
}

export type ReportCycle = {
  readonly label: string
  readonly n: number
  readonly p25: number | null
  readonly p25Band: SalaryBand | null
  readonly median: number | null
  readonly medianBand: SalaryBand | null
  readonly p75: number | null
  readonly p75Band: SalaryBand | null
  readonly meanDays: number | null
  readonly suppressed: boolean
  readonly note: string
}

export type SanitizedGroup = {
  readonly label: string
  readonly code: string | null
  readonly total: number
  readonly joined: number
  readonly pending: number
  readonly approving: number
  readonly rejected: number
  readonly coreDenominator: number
  readonly rejectedRate: ReportRate
  readonly cycle: ReportCycle | null
  readonly suppressed: boolean
}

export type SanitizedDimension = {
  readonly dimension: string
  readonly label: string
  readonly groups: readonly SanitizedGroup[]
  readonly total: number
  readonly mergedGroupCount: number
  readonly suppressedGroupCount: number
  readonly notes: readonly string[]
}

export type SanitizedReason = {
  readonly category: string
  readonly count: number
  readonly share: number | null
  readonly suppressed: boolean
}

export type SanitizedConclusion = {
  readonly level: 'insufficient' | 'description' | 'observed'
  readonly text: string
  readonly ruleId: string
  readonly ruleVersion: string
  readonly metConditions: readonly string[]
  readonly unknownConditions: readonly string[]
  readonly suggestedCheck: string
  readonly scopeNote: string
}

export type SanitizedAdvice = {
  readonly observation: string
  readonly advice: string
}

export type SanitizedRecordDetail = {
  readonly recordCode: string
  readonly status: string
  readonly city: string | null
  readonly channel: string | null
  readonly salaryBand: SalaryBand | null
  readonly cycleDays: number | null
  readonly cycleBand: string | null
}

export type SanitizedReportSection = {
  readonly id: string
  readonly title: string
  readonly notes: readonly string[]
}

export type SanitizedReportMeta = {
  readonly title: string
  readonly generatedAt: string
  readonly dataAsOf: string
  readonly dedupStrategy: string
  readonly cleaningRuleVersion: string
  readonly analysisRuleVersion: string
  readonly privacyLevel: PrivacyLevel
  readonly activeFilters: readonly string[]
  readonly suppressionNote: string
  readonly limitationNote: string
}

export type SanitizedReport = {
  readonly meta: SanitizedReportMeta
  readonly sections: readonly SanitizedReportSection[]
  readonly kpis: readonly ReportKpi[]
  readonly contract: {
    readonly identityStatus: 'present' | 'absent' | 'unknown'
    readonly identityNote: string
    readonly hasCrossBatchIdentity: boolean
  }
  readonly dimensions: readonly SanitizedDimension[]
  readonly reasons: readonly SanitizedReason[]
  readonly conclusions: readonly SanitizedConclusion[]
  readonly advice: readonly SanitizedAdvice[]
  readonly details: readonly SanitizedRecordDetail[]
  readonly quality: {
    readonly keptRows: number
    readonly issueRows: number
    readonly unknownShareNote: string
    readonly effectiveSampleNotes: readonly string[]
  }
  readonly suppression: readonly SuppressionNote[]
  readonly allowedKeys: readonly string[]
}

/** 明细记录的代号前缀（PRD 10.6：没有可靠人员 ID 时说明这是**记录级**代号） */
export const RECORD_CODE_PREFIX = 'R-'

/** 合并组占位容器用的空周期统计（与引擎 `summarizeCycles` 的空样本口径一致） */
const EMPTY_CYCLE_STATS: CycleStats = {
  n: 0,
  meanDays: null,
  p25Days: null,
  medianDays: null,
  p75Days: null,
  excludedCount: 0,
  note: '合并组：不提供周期分位',
}

/* ------------------------------------------------------------------ 输入契约 */

/**
 * 维度输入：只带**已聚合**的分组与说明，**不带**任何原始记录列表。
 * 这是有意的接口约束——报告层拿不到逐条记录，就不可能「顺手」把明细写进导出文件。
 */
export type DimensionInput = {
  readonly dimension: string
  readonly label: string
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
  readonly notes: readonly string[]
}

/** 图表规格（PNG 离屏渲染的输入）；不含任何可识别字段 */
export type ChartSpecInput = {
  readonly id: string
  readonly title: string
  readonly kind: 'bar' | 'line'
  readonly categories: readonly string[]
  readonly series: readonly {
    readonly name: string
    readonly values: readonly number[]
  }[]
}

/**
 * 报告构造的完整输入。
 *
 * `dataset` 只使用元数据与质量计数：`metadata.sourceFileName` 之类敏感字段**不读取**，
 * 因此即使调用方把整个 `NormalizedDataset` 传进来，报告也不会把它带出去
 * （`removeSourceFileNames` 在结构上已经是恒真的，这里只是显式声明意图）。
 */
export type SanitizeInput = {
  readonly dataset: {
    readonly metadata: {
      readonly dataAsOf: string
      readonly dedupStrategy: string
      readonly ruleVersion: { readonly rulesVersion: string }
    }
    readonly report: {
      readonly counts: { readonly keptRowCount: number; readonly issueRowCount: number }
      readonly metricAvailability: readonly {
        readonly module: string
        readonly available: boolean
        readonly validSampleCount: number | null
        readonly reason: string | null
      }[]
    }
  }
  readonly filters: readonly string[]
  readonly analysis: AnalysisResult
  readonly dimensions: readonly DimensionInput[]
  readonly rejection: RejectionInsight
  readonly generatedAt: string
  /** 薪资分档边界；不传时用 PRD 10.6 的默认五个区间 */
  readonly salaryBandEdges?: readonly number[]
  /** GP 级（上游明确给出的密码校验位等）不在此处；这里只放可选图表规格以外的扩展点 */
  readonly sectionNotes?: Readonly<Record<string, string>>
  /**
   * 图表规格：**只用于 PNG 离屏渲染**（`renderChartPng` 的输入），本函数不把它写进报告模型。
   * 为什么不写进去：图表坐标轴里会出现分组标签，一旦落进 `SanitizedReport`，
   * 四种格式就会各自决定「要不要导图上的标签」；把它留在报告之外，图上的文字就只有一个来源
   * （由 PNG 渲染器直接从脱敏后的维度数据生成）。
   */
  readonly charts: readonly ChartSpecInput[]
}

/* ------------------------------------------------------------------ 章节 */

/** PRD 11.1 的七个章节，顺序即报告顺序（四种格式共用同一份清单） */
export const REPORT_SECTIONS: readonly SanitizedReportSection[] = [
  {
    id: 'meta',
    title: '1. 报告说明与口径快照',
    notes: [
      '本报告只包含聚合结果：不含候选人姓名、需求 ID、具体推荐人、原始行数据与文件名。',
      '报告由唯一脱敏模型生成，XLSX / Markdown / 打印版 / PNG 四种格式的数字来自同一份模型。',
    ],
  },
  {
    id: 'kpi',
    title: '2. 核心 KPI',
    notes: [
      '分母为 0 或没有有效样本时显示「—」，不用 0 或 0% 代替。',
      '核心率分母 D = 已入职 J + 待入职 P + 拒 offer R（排除审批中、其他、未知）。',
    ],
  },
  {
    id: 'dimensions',
    title: '3. 分维度分析',
    notes: [
      '每个维度内至少两个分组合并或抑制：只隐藏一个组时，用总计减其余组即可还原它。',
      '被抑制的分组不显示人数与率（显示「—」），也不出现在图里。',
    ],
  },
  {
    id: 'rejection',
    title: '4. 拒 offer 专项',
    notes: [
      '原因只做受控字典查表：自由文本原因原文不导出，「未分类」与「未填写」分开计数。',
      '核心率分母 D 含待入职；两组比较人群只有拒 offer 组与入职组，两个人群不能混用。',
    ],
  },
  {
    id: 'conclusions',
    title: '5. 结论与行动建议',
    notes: [
      '结论由确定性规则生成，可回溯到规则 ID 与规则版本；未达样本门槛的只作描述。',
      '未知条件如实列出（未知不等于不满足）；结论不是因果结论，也不是个人拒 offer 概率。',
    ],
  },
  {
    id: 'quality',
    title: '6. 数据质量与限制',
    notes: [
      '小样本与未知比例必须在报告中标明；被禁用模块的指标不显示数字。',
      '脱敏是降低暴露，不承诺不可重新识别（PRD 10.6）。',
    ],
  },
  {
    id: 'details',
    title: '7. 记录级明细（默认不导出）',
    notes: [
      '默认不导出逐条明细；开启后只使用报告内记录代号，且没有跨批次身份含义。',
      '明细代号在同一文件内稳定，跨报告默认重建；对照表不导出。',
    ],
  },
]

/* ------------------------------------------------------------------ 构造实现 */

const SUPPRESSION_NOTE =
  '小组抑制（PRD 10.6）：人数低于门槛的分组合并为「其他」；每个维度再保证至少两个分组被抑制（互补抑制），避免用总计减其余组还原单个小组。被抑制的分组以「—」表示，不是 0。'

const LIMITATION_NOTE =
  '脱敏降低暴露风险，但不承诺不可重新识别；报告下载后由用户自行控制，本地加密不等于导出文件已加密。本报告不是全链路漏斗分析，也不是渠道 ROI 或完整人效分析（输入只有 offer 名单）。'

const DETAIL_OFF_NOTE = '本次未开启记录级明细：默认导出聚合报告（PRD 11.4）。'

/** 把比率保留 2 位小数：报告里的数字必须可复现，避免浮点尾数造成两次导出「看起来不一样」 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function rateOfMetric(
  id: string,
  label: string,
  numerator: number,
  denominator: number,
  note: string,
  suppressed: boolean,
): ReportRate {
  // 分母为 0 或该分组已被抑制时，value 恒为 null（显示「—」）。
  // 抑制状态必须能传到率上：一个率若还带着被抑制分母的分子/分母，读者反推一下就知道组有多小。
  const value = denominator === 0 || suppressed ? null : round2(numerator / denominator)
  return { id, label, numerator, denominator, value, suppressed, note }
}

/** 周期分位：`band` 模式填区间并清空精确实数；`hide` 模式两边都清空 */
function buildCycle(
  label: string,
  n: number,
  p25: number | null,
  median: number | null,
  p75: number | null,
  meanDays: number | null,
  suppressed: boolean,
  note: string,
  mode: SanitizeRules['quantileMode'],
  edges: readonly number[],
): ReportCycle {
  if (suppressed) {
    return {
      label,
      n,
      p25: null,
      p25Band: null,
      median: null,
      medianBand: null,
      p75: null,
      p75Band: null,
      meanDays: null,
      suppressed: true,
      note: '该分组已被抑制：人数与分位一律不显示（不是 0）。',
    }
  }
  const band = (value: number | null): SalaryBand | null =>
    value === null ? null : salaryBandOf(value, edges)
  if (mode === 'hide') {
    return {
      label,
      n,
      p25: null,
      p25Band: null,
      median: null,
      medianBand: null,
      p75: null,
      p75Band: null,
      meanDays,
      suppressed: false,
      note: `${note}；按当前脱敏级别隐藏精确分位（只保留均值与有效样本数，避免间接恢复原值）。`,
    }
  }
  return {
    label,
    n,
    p25: null,
    p25Band: band(p25),
    median: null,
    medianBand: band(median),
    p75: null,
    p75Band: band(p75),
    meanDays,
    suppressed: false,
    note: `${note}；准确分位已改为区间（PRD 10.6），精确实数不导出。`,
  }
}

/** 维度的 HR 代号分配表：同一份报告内首个出现的 HR 拿 HR-1，跨报告默认重建 */
function createHrCodeAllocator(): (rawLabel: string) => string {
  const assigned = new Map<string, string>()
  return (rawLabel: string) => {
    const existing = assigned.get(rawLabel)
    if (existing !== undefined) {
      return existing
    }
    const code = `HR-${String(assigned.size + 1)}`
    assigned.set(rawLabel, code)
    return code
  }
}

type DimensionBuild = {
  readonly dimension: SanitizedDimension
  readonly suppression: readonly SuppressionNote[]
  /** 被抑制（含互补抑制）的分组数，用于 meta 说明 */
  readonly suppressedCount: number
}

function buildDimension(
  input: DimensionInput,
  rules: SanitizeRules,
  edges: readonly number[],
  hrCode: (rawLabel: string) => string,
): DimensionBuild {
  const isRecruiter = input.dimension === 'recruiter'
  const totalRecords = input.total.counts.total
  // 主抑制口径：合并后的小组人数 < 门槛才抑制。门槛由规则给出，组件不得自定（AGENTS.md §4）。
  const threshold = rules.suppressBelow
  /**
   * 展示标签。
   *
   * 注意：HR 维度上**分组值本身就是 HR 姓名**（`dimensionValueOf` 直接取 `record.recruiter`），
   * 所以「移除 HR 姓名」在这里等价于把标签换成代号——绝不允许既给代号又留真名。
   * 合并组不分配代号：它代表多个分组，给一个 `HR-n` 反而暗示「这就是某个 HR」。
   */
  const labelOf = (group: GroupSummary): string =>
    isRecruiter && rules.removeHrNames ? hrCode(group.key) : group.key

  const codeOf = (group: GroupSummary): string | null =>
    isRecruiter && rules.removeHrNames ? hrCode(group.key) : null

  const models: SuppressibleGroup[] = input.groups.map((group) => ({
    key: group.key,
    total: group.counts.total,
    coreDenominator: group.counts.coreDenominator,
    suppressed: group.counts.total < threshold,
    mergedCount: 1,
  }))

  // 合并：低于门槛的分组**不出现真实标签**，计数求和后落进一个「其他（N 个分组合并）」组。
  // 为什么合并而不是逐个标记：5 个 1 人小组若各留一行，读者仍能看出「有 5 个岗位各 1 人」，
  // 在小数据集里这本身就是可识别信息（PRD 10.6「学校 / 岗位小组 n<5 合并或抑制」）。
  const kept: { model: SuppressibleGroup; summary: GroupSummary }[] = []
  const mergedSummaries: GroupSummary[] = []
  input.groups.forEach((group, index) => {
    const model = models[index]
    if (model.suppressed) {
      mergedSummaries.push(group)
      return
    }
    kept.push({ model, summary: group })
  })

  const mergedCount = mergedSummaries.length
  if (mergedCount > 0) {
    kept.push({
      model: {
        key: `其他（${String(mergedCount)} 个分组合并）`,
        total: mergedSummaries.reduce((sum, group) => sum + group.counts.total, 0),
        coreDenominator: mergedSummaries.reduce(
          (sum, group) => sum + group.counts.coreDenominator,
          0,
        ),
        // 合并组本身**不再**声明 suppressed：它的存在就是为了「不显示原标签」，
        // 若再抑制它的数字，读者连「合并后共 N 人」都看不到，报告会失去可用性。
        suppressed: false,
        mergedCount,
      },
      // 合并组没有单独的 GroupSummary：它只贡献计数与率（由上面的求和给出），
      // 因此这里放一个**records 为空**的占位容器——报告层不允许拿到任何逐条记录。
      summary: mergedSummaryPlaceholder(`其他（${String(mergedCount)} 个分组合并）`),
    })
  }

  // 互补抑制：在**合并后**的分组上做，并把「已被主抑制合并掉的分组数」传进去。
  // 合并行已经不给原标签、不给原分组数字，读者无法用减法点名还原它们，
  // 因此它们必须计入「已隐藏」——否则本函数会再抑制掉一个**可见**分组，
  // 让整个维度只剩被抑制的行：隐私没多保护，报告却不可读了。
  const afterComplement = applyComplementarySuppression(
    kept.map((item) => item.model),
    { minSuppressed: 2, suppressBelow: threshold, hiddenGroupCount: mergedCount },
  )

  // 只有一个分组时无法满足「至少两个被抑制」：这不是抑制失败，而是该维度整体不可拆分展示。
  // 直接整维抑制并写明原因，绝不放行一个「只有一行 + 总数」的维度（那样减法就能还原）。
  const singleGroup = input.groups.length <= 1 && totalRecords > 0
  const suppression: SuppressionNote[] = []
  if (mergedCount > 0) {
    suppression.push({
      path: `dimensions.${input.dimension}`,
      reason: `人数低于 ${String(threshold)} 的分组已合并为「其他（${String(mergedCount)} 个分组合并）」，原分组标签不导出`,
      suppressedCount: mergedCount,
    })
  }
  if (singleGroup) {
    suppression.push({
      path: `dimensions.${input.dimension}`,
      reason: '该维度只有一个分组：无法满足互补抑制（至少两个），因此整维抑制',
      suppressedCount: 1,
    })
  }

  // 只统计**互补抑制新增**的部分：主抑制已合并掉的组不在这里重复计数，
  // 否则抑制说明会夸大实际影响（数字要能对照 `suppressedGroupCount` 复核）。
  const complementaryCount = afterComplement.filter(
    (model, index) => model.suppressed && !kept[index].model.suppressed,
  ).length
  if (complementaryCount > 0) {
    suppression.push({
      path: `dimensions.${input.dimension}`,
      reason:
        '互补抑制：本维度原本只有不到两个分组被抑制，已额外抑制人数最少的分组，避免用总计减其余组还原隐藏组',
      suppressedCount: complementaryCount,
    })
  }

  const groups: SanitizedGroup[] = afterComplement.map((model, index) => {
    const item = kept[index]
    const summary = item.summary
    const suppressed = model.suppressed || singleGroup
    const rawLabel = model.mergedCount > 1 ? model.key : labelOf(summary)
    // `code` 只承载**稳定代号**，且只对「HR 维度 + 已开启移除 HR 姓名 + 非合并组」成立；
    // 其他维度（城市 / 岗位 / 学校…）的分组值本身不是身份，因此 code 一律 null。
    const code = model.mergedCount > 1 ? null : codeOf(summary)
    const label =
      rules.removeDimensionLabels && !isRecruiter
        ? `${input.label}分组 ${String(index + 1)}`
        : rawLabel

    if (suppressed) {
      return {
        label: `${label}（已抑制）`,
        code,
        total: 0,
        joined: 0,
        pending: 0,
        approving: 0,
        rejected: 0,
        coreDenominator: 0,
        // 抑制时分子/分母一并归零：不是「0 人」，而是「按抑制口径不提供该数值」
        rejectedRate: rateOfMetric(
          `${input.dimension}.rejectedRate`,
          '拒 offer 率（R ÷ D）',
          0,
          0,
          '该分组已被抑制：分子 / 分母 / 率一律显示「—」，不是 0%',
          true,
        ),
        cycle: null,
        suppressed: true,
      }
    }

    // 合并组只有合计计数：避免把「合并组里最大的那个子组」当成自己的数字泄露出去
    const counts =
      model.mergedCount > 1
        ? { total: model.total, joined: 0, pending: 0, approving: 0, rejected: 0, coreDenominator: model.coreDenominator }
        : {
            total: summary.counts.total,
            joined: summary.counts.joined,
            pending: summary.counts.pending,
            approving: summary.counts.approving,
            rejected: summary.counts.rejected,
            coreDenominator: summary.counts.coreDenominator,
          }

    const rateSuppressed = counts.coreDenominator < threshold
    if (rateSuppressed) {
      suppression.push({
        path: `dimensions.${input.dimension}.groups.${label}.rejectedRate`,
        reason: `该分组核心分母 ${String(counts.coreDenominator)} < ${String(threshold)}：只抑制率本身，分子分母仍可对照`,
        suppressedCount: 1,
      })
    }

    const cycleStats = summary.cycles.actual
    const cycle = buildCycle(
      '实际招聘周期',
      cycleStats.n,
      cycleStats.p25Days,
      cycleStats.medianDays,
      cycleStats.p75Days,
      cycleStats.meanDays,
      counts.total < threshold || item.model.suppressed,
      cycleStats.note,
      rules.quantileMode,
      edges,
    )

    return {
      label,
      code,
      ...counts,
      rejectedRate: rateOfMetric(
        `${input.dimension}.rejectedRate`,
        '拒 offer 率（R ÷ D）',
        counts.rejected,
        counts.coreDenominator,
        rateSuppressed
          ? `该分组核心分母 ${String(counts.coreDenominator)} < 门槛 ${String(threshold)}：率显示「—」，不是 0%`
          : (summary.rates.rejectionRate.note ?? '分母 D = 已入职 + 待入职 + 拒绝 offer'),
        rateSuppressed,
      ),
      cycle,
      suppressed: false,
    }
  })

  const suppressedGroupCount = groups.filter((group) => group.suppressed).length
  return {
    dimension: {
      // 维度名本身（例如岗位名 / 学校名）在 strict 下也必须消失，只留位置编号
      dimension: rules.removeDimensionLabels ? `dimension-${input.dimension}` : input.dimension,
      label: input.label,
      groups,
      // 合计仍是该维度的**全量**计数：合并行与抑制行都显示「—」，
      // 只有「其他（N 个分组合并）」给出合计人数（否则读者连「总共多少条进了这个维度」都不知道）。
      total: singleGroup ? 0 : input.total.counts.total,
      mergedGroupCount: mergedCount,
      suppressedGroupCount,
      notes: [
        ...input.notes,
        '合计为该维度在全量记录上的计数；被抑制的分组以「—」表示，不代表 0 人。',
        mergedCount > 0
          ? `已把 ${String(mergedCount)} 个低于门槛 ${String(threshold)} 的分组合并为一行，原分组标签不导出。`
          : `没有分组低于门槛 ${String(threshold)}，本维度未发生合并。`,
      ],
    },
    suppression,
    suppressedCount: suppressedGroupCount,
  }
}

/**
 * 合并组的占位汇总。
 *
 * 为什么需要它、又为什么可以「空着」：
 * 合并组没有自己的 `GroupSummary`——它的计数由被合并的若干组求和得出（见上面的 `models`），
 * 因此这里只借用一个**合法形状**的容器，计数一律从求和结果取。
 * **关键**：`records` 必须留空。若偷懒直接复用 `input.total`（它带着全部原始记录），
 * 报告层就凭空多了一条能读到逐条记录的路径——那正是 `SanitizeInput` 刻意不传记录列表的原因。
 * 本层从不读这个字段，单测会断言报告 JSON 里不含任何原始值。
 */
function mergedSummaryPlaceholder(label: string): GroupSummary {
  return {
    key: label,
    records: [],
    counts: EMPTY_STATUS_COUNTS,
    rates: buildCoreRates(EMPTY_STATUS_COUNTS),
    cycles: { actual: EMPTY_CYCLE_STATS, planned: EMPTY_CYCLE_STATS },
    coverage: {
      distinctRequirementCount: 0,
      missingRequirementIdCount: 0,
      recordCount: 0,
      note: '合并组：不提供覆盖需求数（需求 ID 一律不导出）',
    },
    groupComposition: { rejectedGroupCount: 0, joinedGroupCount: 0, comparedCount: 0 },
  }
}

export function buildSanitizedReport(
  input: SanitizeInput,
  rules: SanitizeRules = DEFAULT_SANITIZE_RULES,
): SanitizedReport {
  const effective = rules.privacyLevel === 'custom' ? rules : rulesOfLevel(rules.privacyLevel)
  const edges =
    input.salaryBandEdges ?? effective.salaryBandEdges ?? SALARY_BAND_EDGES
  const hrCode = createHrCodeAllocator()
  const suppression: SuppressionNote[] = []
  const threshold = effective.suppressBelow

  const counts = input.analysis.statusCounts
  const rates = input.analysis.rates

  /* ---------------- KPI ---------------- */

  const kpiNote = (note: string | null, denominator: number): string =>
    denominator === 0 ? `${note ?? ''}；分母为 0：显示「—」，不显示 0%`.trim() : (note ?? '')

  const kpis: ReportKpi[] = [
    {
      id: 'total',
      label: 'N 总 offer 记录数（含审批中）',
      value: counts.total,
      numerator: null,
      denominator: null,
      note: '所有保留记录，含审批中、其他与未知',
    },
    {
      id: 'joined',
      label: 'J 已入职',
      value: counts.joined,
      numerator: null,
      denominator: null,
      note: '状态为「已入职」的记录数（不是接受数）',
    },
    {
      id: 'pending',
      label: 'P 待入职',
      value: counts.pending,
      numerator: null,
      denominator: null,
      note: '状态为「待入职」；计划入职日期不作为实际周期',
    },
    {
      id: 'approving',
      label: 'A offer 审批中',
      value: counts.approving,
      numerator: null,
      denominator: null,
      note: '审批中占比的分母是 N，与核心率分母 D 不同',
    },
    {
      id: 'rejected',
      label: 'R 拒 offer（拒绝 offer + 拒绝口头 offer）',
      value: counts.rejected,
      numerator: null,
      denominator: null,
      note: 'R = R1 + R2',
    },
    {
      id: 'coreDenominator',
      label: 'D 核心分母（J + P + R）',
      value: counts.coreDenominator,
      numerator: null,
      denominator: null,
      note: '排除审批中、其他、未知',
    },
    {
      id: 'acceptanceRate',
      label: '接受率（(J + P) ÷ D）',
      value: rates.acceptanceRate.value === null ? null : round2(rates.acceptanceRate.value),
      numerator: rates.acceptanceRate.numerator,
      denominator: rates.acceptanceRate.denominator,
      note: kpiNote(rates.acceptanceRate.note, rates.acceptanceRate.denominator),
    },
    {
      id: 'joinedRate',
      label: '入职率（J ÷ D，不得用 J ÷ N 冒充）',
      value: rates.joinedRate.value === null ? null : round2(rates.joinedRate.value),
      numerator: rates.joinedRate.numerator,
      denominator: rates.joinedRate.denominator,
      note: kpiNote(rates.joinedRate.note, rates.joinedRate.denominator),
    },
    {
      id: 'rejectionRate',
      label: '拒 offer 率（R ÷ D）',
      value: rates.rejectionRate.value === null ? null : round2(rates.rejectionRate.value),
      numerator: rates.rejectionRate.numerator,
      denominator: rates.rejectionRate.denominator,
      note: kpiNote(rates.rejectionRate.note, rates.rejectionRate.denominator),
    },
    {
      id: 'approvingShare',
      label: '审批中占比（A ÷ N，分母与核心率不同）',
      value: rates.approvingShareRate.value === null ? null : round2(rates.approvingShareRate.value),
      numerator: rates.approvingShareRate.numerator,
      denominator: rates.approvingShareRate.denominator,
      note: kpiNote(rates.approvingShareRate.note, rates.approvingShareRate.denominator),
    },
    {
      id: 'actualCycleMean',
      label: '平均实际招聘周期（天，仅已入职）',
      value:
        input.analysis.cycles.actual.meanDays === null
          ? null
          : round2(input.analysis.cycles.actual.meanDays),
      numerator: null,
      denominator: input.analysis.cycles.actual.n,
      note: input.analysis.cycles.actual.note,
    },
    {
      id: 'actualCycleMedianBand',
      label: '实际招聘周期中位数区间',
      value: null,
      numerator: null,
      denominator: input.analysis.cycles.actual.n,
      note: '准确中位数不出现在报告里（PRD 10.6），只在维度表的周期列以区间给出',
    },
    {
      id: 'rejectionReasonFillRate',
      label: '原因填写率（已填写 ÷ R）',
      value:
        input.analysis.rejectionReasonFillRate.value === null
          ? null
          : round2(input.analysis.rejectionReasonFillRate.value),
      numerator: input.analysis.rejectionReasonFillRate.numerator,
      denominator: input.analysis.rejectionReasonFillRate.denominator,
      note: kpiNote(
        input.analysis.rejectionReasonFillRate.note,
        input.analysis.rejectionReasonFillRate.denominator,
      ),
    },
    {
      id: 'requirementCoverage',
      label: '名单覆盖需求数',
      value: input.analysis.coverage.distinctRequirementCount,
      numerator: null,
      denominator: null,
      note: 'countDistinct(非空需求ID)：HR 内去重，跨 HR 相加可能超过全局；只给总数，不给需求 ID 列表',
    },
  ]

  /* ---------------- 维度 ---------------- */

  const dimensionBuilds = input.dimensions.map((dimension) =>
    buildDimension(dimension, effective, edges, hrCode),
  )
  for (const build of dimensionBuilds) {
    suppression.push(...build.suppression)
  }
  const suppressedGroupTotal = dimensionBuilds.reduce(
    (sum, build) => sum + build.suppressedCount,
    0,
  )
  if (suppressedGroupTotal === 0) {
    suppression.push({
      path: 'dimensions',
      reason: '当前筛选下没有任何分组人数低于门槛：本次没有发生小组抑制',
      suppressedCount: 0,
    })
  }

  /* ---------------- 原因 ---------------- */

  const reasonDenominator = input.rejection.reasons.denominator
  const reasonSuppressed = reasonDenominator > 0 && reasonDenominator < threshold
  if (reasonSuppressed) {
    suppression.push({
      path: 'reasons',
      reason: `拒 offer 记录 R = ${String(reasonDenominator)} < ${String(threshold)}：原因分布整体抑制（占比与计数不显示）`,
      suppressedCount: input.rejection.reasons.categories.length,
    })
  }
  const reasons: SanitizedReason[] = input.rejection.reasons.categories.map((entry) => ({
    category: entry.category,
    count: reasonSuppressed ? 0 : entry.count,
    // 自由文本原因原文一律不出现在任何字段里（PRD 10.6）：这里只给受控类别与计数。
    share: reasonSuppressed ? null : entry.share,
    suppressed: reasonSuppressed,
  }))

  /* ---------------- 结论与建议 ---------------- */

  const conclusions: SanitizedConclusion[] = input.rejection.evaluations.map((evaluation) => ({
    level: evaluation.level,
    text: evaluation.conclusion,
    ruleId: evaluation.rule.id,
    ruleVersion: evaluation.rule.version,
    metConditions: evaluation.metConditions.map((condition) => condition.label),
    unknownConditions: evaluation.unknownConditions.map((condition) => condition.label),
    suggestedCheck: evaluation.suggestedCheck,
    scopeNote: evaluation.scopeNote,
  }))

  const advice: SanitizedAdvice[] = input.rejection.advice.map((item) => ({
    observation: item.observation,
    advice: item.advice,
  }))

  /* ---------------- 明细（默认关闭） ---------------- */

  const details: SanitizedRecordDetail[] = effective.includeRecordDetail
    ? input.analysis.filterOutcome.records.map((record, index) => {
        const cycleDays =
          record.offerStatus === '已入职' ? (record.derived?.recruitmentCycleDays ?? null) : null
        return {
          // 记录级代号：不是候选人 ID，也不承诺跨批次是同一人（PRD 10.6）
          recordCode: `${RECORD_CODE_PREFIX}${String(index + 1).padStart(4, '0')}`,
          status: record.offerStatus,
          // strict 级别连城市都不出现；standard 下城市是 PRD 18.5 允许项
          city: effective.removeCityNames ? null : record.city,
          channel: record.channel,
          salaryBand: salaryBandOf(record.salaryAmount, edges),
          cycleDays,
          cycleBand: cycleDays === null ? null : String(Math.floor(cycleDays / 10) * 10),
        }
      })
    : []

  const detailNote = effective.includeRecordDetail
    ? `已开启记录级明细：共 ${String(details.length)} 条，只含报告内记录代号与分桶值，不含姓名 / 需求 ID / 推荐人 / 准确薪资 / 原因原文。`
    : DETAIL_OFF_NOTE

  /* ---------------- 数据质量 ---------------- */

  const unavailable = input.dataset.report.metricAvailability.filter((item) => !item.available)
  const unknownShareNote =
    unavailable.length === 0
      ? '没有模块因为口径未确认而被禁用。'
      : `以下模块因口径未确认被禁用，相关指标不显示数字：${unavailable
          .map((item) => `${item.module}（${item.reason ?? '原因未说明'}）`)
          .join('；')}`

  /* ---------------- meta ---------------- */

  const meta: SanitizedReportMeta = {
    title: effective.title,
    generatedAt: input.generatedAt,
    dataAsOf: input.dataset.metadata.dataAsOf,
    dedupStrategy: input.dataset.metadata.dedupStrategy,
    cleaningRuleVersion: input.dataset.metadata.ruleVersion.rulesVersion,
    analysisRuleVersion: input.rejection.ruleVersion,
    privacyLevel: effective.privacyLevel,
    activeFilters: [...input.filters],
    suppressionNote: SUPPRESSION_NOTE,
    limitationNote: LIMITATION_NOTE,
  }

  const contract: SanitizedReport['contract'] = {
    // 报告里从不包含 `candidateName`：identityStatus 描述的是**源数据侧**是否有可靠人员 ID，
    // 由调用方通过 `sectionNotes` 之外的字段无法推断，因此这里如实标为 unknown 并说明。
    identityStatus: 'unknown',
    identityNote:
      '报告不含任何人员标识：明细若开启也只使用记录级代号（同一文件内稳定、跨报告重建、无跨批次身份含义）。',
    hasCrossBatchIdentity: false,
  }

  const report: Omit<SanitizedReport, 'allowedKeys'> = {
    meta,
    sections: REPORT_SECTIONS.map((section) =>
      section.id === 'details'
        ? { ...section, notes: [...section.notes, detailNote] }
        : section,
    ),
    kpis,
    contract,
    dimensions: dimensionBuilds.map((build) => build.dimension),
    reasons,
    conclusions,
    advice,
    details,
    quality: {
      keptRows: input.dataset.report.counts.keptRowCount,
      issueRows: input.dataset.report.counts.issueRowCount,
      unknownShareNote,
      effectiveSampleNotes: input.dataset.report.metricAvailability
        .filter((item) => !item.available)
        .map(
          (item) =>
            `${item.module}：有效样本 ${item.validSampleCount === null ? '—' : String(item.validSampleCount)}；${item.reason ?? '原因未说明'}`,
        ),
    },
    suppression,
  }

  return {
    ...report,
    // allowedKeys = 显式冻结的结构清单 ∪ 实际出现过的键 ∪ 它自己。
    // 取并集的理由：前者让人能直接评审「报告允许有哪些字段」，
    // 后者保证清单永不落后于实现（字段漂移时测试会立刻失败）。
    // 把 `allowedKeys` 自己也列进去，是为了让清单**自描述**：
    // 读者不需要知道「清单不声明自己」这条隐含约定。
    allowedKeys: [
      ...new Set([
        ...collectAllowedKeys(SANITIZE_KEYS),
        ...collectAllowedKeys(report),
        'allowedKeys',
      ]),
    ].sort(),
  }
}

/** 维度标签的唯一来源仍是引擎的映射表，本层不另起一份（AGENTS.md §2.3） */
export function dimensionLabelOf(dimension: string): string {
  return dimension in GROUP_DIMENSION_LABELS
    ? GROUP_DIMENSION_LABELS[dimension as keyof typeof GROUP_DIMENSION_LABELS]
    : dimension
}
