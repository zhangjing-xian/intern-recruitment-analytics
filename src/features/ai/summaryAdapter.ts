/**
 * `AnalysisSummary` → AI 脱敏预览输入（AI-2，docs/PRD.md 16.2 / 17.1）。
 *
 * ## 为什么需要这一层
 *
 * `src/ai/summary.ts` 产出的是**候选聚合快照**（还带着 HR 真名、学校全名这类危险取值）；
 * `privacy/aiSummary.ts` 的 `buildSanitizedAiPayload` 消费的是**候选单元格**
 * （`AiSourceCell` / `AiSourceProfileCell`）。两者之间必须有一次翻译，而这次翻译是
 * **安全关键**的：如果把 HR 真名直接当 `key` 交上去、或者忘了给 `recruiterCode`，
 * 载荷要么泄漏、要么整维消失。
 *
 * 本层因此只做三件事，且都可以被单测钉住：
 * 1. 把摘要里已算好的分组行交给 `buildAiSourceCells`（**不重算任何指标**）；
 * 2. 用**同一套 HR 代号**再生成一遍组内构成格（`buildAiProfileCells`），
 *    这样引擎按「维度 + 原始取值」合并时才对得上；
 * 3. 把 `rejection` 的两个人群分母原样搬进载荷的组间比较块。
 *
 * ## 为什么这一层在 `features/` 而不是 `src/ai/`
 *
 * 它依赖 `features/ai/aiSourceCells.ts`（界面层的候选格构造）。放在 `src/ai/` 会让
 * 引擎层反过来依赖界面层（依赖方向倒置，AGENTS.md §4）；放在 `features/` 则是
 * 正常的「界面把引擎输出接到脱敏引擎上」。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，**不发起任何请求**。
 */

import type { AnalysisSummary, SummaryDimensionTable, SummaryProfileTable } from '../../ai/summary'
import type { GroupSummary } from '../../domain'

import type { AiWorkspaceData } from './AiAnalysisWorkspace'
import {
  buildAiProfileCells,
  buildAiSourceCells,
  buildRecruiterOrdinals,
  type AiDimensionGroupInput,
} from './aiSourceCells'

/**
 * 摘要表 → 候选格换算层的输入。
 *
 * 用 `table.summaries`（引擎原始 `GroupSummary`）而不是 `table.groups`（投影行）：
 * 换算层按 `GroupSummary` 的契约工作（读 `groupComposition` 与 `cycles`），
 * 直接给原始对象就不需要任何形状转换——**伪造形状是 bug 的温床**，
 * 而且会让「组内构成其实没有 D/R」这件事在类型上变得模糊。
 *
 * `total` 取**整份摘要的合计**（各维度共用同一批记录），由调用方传入。
 */
function dimensionInputOf(
  table: SummaryDimensionTable,
  total: GroupSummary,
): AiDimensionGroupInput {
  return { dimension: table.dim, label: table.dimLabel, groups: table.summaries, total }
}

/** 组内构成表 → 候选格换算层的输入（同样用引擎原始 `GroupSummary`） */
function profileInputOf(
  table: SummaryProfileTable,
  total: GroupSummary,
): AiDimensionGroupInput {
  return { dimension: table.dim, label: table.dimLabel, groups: table.summaries, total }
}

/**
 * 交给 AI 的维度顺序（即载荷里的表顺序）。
 *
 * 为什么不直接遍历 `summary.dimensions`：`cycleBand` 不是 `GroupDimension`
 * （它是按周期天数分出来的），必须单独接。用显式清单可以让「摘要新增一个维度
 * 却忘了接」在评审时一眼可见，而不是静默少发一张表。
 */
const DIMENSION_ORDER = [
  'city',
  'channel',
  'referralType',
  'recruiter',
  'position',
  'jobFamily',
  'department',
  'requirementType',
  'education',
  'school',
  'graduationYear',
  'housingType',
  'salaryBand',
] as const

/**
 * 唯一的构造入口：摘要 → AI 工作区输入。
 *
 * HR 代号**先定下来**，两次遍历（主表 + 组内构成表）共用同一份映射：
 * 各自就近编号会让同一个 HR 在两处拿到不同代号，组内构成于是在脱敏引擎里
 * 匹配不上并静默消失——界面看起来正常，只是那一列数字没了。
 */
export function toAiWorkspaceData(summary: AnalysisSummary): AiWorkspaceData {
  const dimensions = DIMENSION_ORDER.flatMap((dimension) => {
    const table = summary.dimensions.find((item) => item.dim === dimension)
    return table === undefined ? [] : [dimensionInputOf(table, summary.cycleBandGroups.total)]
  })

  const recruiterOrdinals = buildRecruiterOrdinals(dimensions)

  const cells = buildAiSourceCells({
    dimensions,
    salaryBandEdges: summary.salaryBandEdges,
    // 周期区间是唯一「不是 GroupDimension」的维度：它的中位数由摘要给出，本层不重算
    cycleBandGroups: {
      groups: summary.cycleBandGroups.groups,
      total: summary.cycleBandGroups.total,
    },
    recruiterOrdinals,
  })

  /*
   * 组内构成只对「能形成可比较人群」的维度生成（摘要侧已按
   * `REJECTION_COMPARISON_DIMENSIONS` 裁过：薪资与周期不进组间比较，
   * 因为拿结果变量解释结果变量是同义反复）。
   */
  const profileCells = buildAiProfileCells({
    dimensions: summary.rejection.profile.tables.map((table) =>
      profileInputOf(table, summary.cycleBandGroups.total),
    ),
    recruiterOrdinals,
  })

  return {
    cells,
    kpi: {
      total: summary.kpi.N,
      joined: summary.kpi.J,
      pending: summary.kpi.P,
      approving: summary.kpi.A,
      rejectedOffer: summary.kpi.R1,
      rejectedVerbally: summary.kpi.R2,
      coreDenominator: summary.kpi.D,
    },
    scope: {
      rowCount: summary.scope.rowCount,
      dedupPolicy: summary.scope.dedupPolicy,
      filters: summary.scope.filters,
      ruleVersion: summary.frozen.ruleVersionLabel,
      dataAsOf: summary.scope.dataAsOf,
    },
    reasons: summary.rejection.reasons.distribution
      // 「未填写」只是「这一列是空的」，不是一个拒绝原因；发出去会被读成一种原因
      .filter((item) => !item.unfilled)
      .map((item) => ({ category: item.category, count: item.count })),
    quality: {
      unknownStatus: summary.quality.unknownStatus,
      missingSalary: summary.quality.missingSalary,
      unknownSchool: summary.quality.unknownSchool,
    },
    caliberNotes: summary.caliberNotes,
    rejectionProfile: profileCells,
    rejectionTotals: {
      rejectedTotal: summary.rejection.profile.rejectedTotal,
      joinedTotal: summary.rejection.profile.joinedTotal,
      excludedFromComparison: summary.rejection.excludedFromComparison,
    },
  }
}
