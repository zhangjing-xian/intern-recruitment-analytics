/**
 * 分维度分析的界面文案（步骤9，唯一来源）。
 *
 * 分工：**业务口径**（能不能排名、住宿不算无补贴、不能称 ROI…）由 `domain/analytics` 的
 * `dimensionNotes.ts` / `compensation.ts` / `crossTab.ts` 提供，这里只放界面措辞
 * （章节标题、列表头、按钮、空态），避免同一句话说两遍。
 */

import type { SampleSufficiencyTag } from '../../domain'

/** 章节标题（顺序与 PRD 8 章的分析模块一致） */
export const SECTION_TITLES = {
  city: '城市对比',
  channel: '渠道与推荐人',
  recruiter: 'HR 效能',
  position: '岗位 / 序列 / 部门',
  requirementType: '需求类型',
  profile: '候选人画像',
  compensation: '薪酬与房补',
  efficiency: '时间效率',
} as const

/** 表格列名（多个分组表共用，保证同一列在各模块叫同一个名字） */
export const COLUMN_LABELS = {
  group: '分组',
  total: 'N',
  joined: 'J',
  pending: 'P',
  approving: 'A',
  rejected: 'R',
  coreDenominator: 'D',
  // 组内构成两列（步骤10 拒 offer 专项按需开启；默认不出现在任何表里）：
  // 括号里的分母是拒 offer 组总数 R 与入职组总数 J，与同行的「拒 offer 率（分母 D）」不是一个分母。
  rejectedGroupCount: '拒 offer 组（/R）',
  joinedGroupCount: '入职组（/J）',
  joinedRate: '入职率',
  rejectionRate: '拒 offer 率',
  cycle: '实际周期（n / 均值 / 中位数）',
  plannedCycle: '待入职计划周期（n / 均值）',
  coverage: '覆盖需求数',
  sample: '样本门槛',
  drilldown: '操作',
} as const

/**
 * 「组内构成」两列的说明（只由 `GroupSummaryTable` 在开启该列时渲染）。
 *
 * 为什么必须写这句：组内构成与特征内的率**分子相同、分母不同**
 * （前者除以 R 或 J，后者除以该取值的 D），不说明就会被读成「该特征的拒 offer 率」，
 * 而 PRD 9.1 明确禁止这种读法。
 */
export const GROUP_COMPOSITION_HINT =
  '「拒 offer 组（/R）」「入职组（/J）」两列是组内构成：某取值在拒 offer 组的记录数（占拒 offer 组 R）与在入职组的记录数（占入职组 J），这是画像构成，不是该取值的拒 offer 率；特征内的率看同一行的「拒 offer 率（分子 ÷ 分母，分母为该取值的 D）」。待入职与审批中既不进拒 offer 组，也不进入职组。'

/** 样本门槛在表格里的短标签（判定来自引擎的 `sampleSufficiencyOf`） */
export const SAMPLE_TAG_LABELS: Readonly<Record<SampleSufficiencyTag, string>> = {
  none: '无有效样本（不显示百分比）',
  small: '小样本（只显示率，不参与自动排名）',
  sufficient: '可参与自动排名（不代表统计显著）',
}

/** 下钻按钮文案 */
export const DRILLDOWN_LABEL = '只看该组'
export const CLEAR_DRILLDOWN_HINT = '下钻会把全局筛选设为该分组的取值（顶部筛选条会同步显示）。'

/** 当前筛选下没有记录时的空态（不用空白图表或 0% 掩盖） */
export const NO_RECORDS_NOTE =
  '当前筛选下没有记录：本页不画任何图表，也不显示 0%，请放宽筛选后再看。'

/** 被数据集禁用某模块时的说法前缀 */
export const MODULE_DISABLED_PREFIX = '该模块在导入阶段已被标记为不可用'

/** 排行表切换说明 */
export const RANK_MODE_NOTE =
  '排行默认取 Top 8 并把其余分组合并为一行「其他（N 个分组合并）」；合并行由引擎按合计分子分母重算，不能下钻，完整分组见「完整表」。'

/** 图表旁的统一说明（图表可点击下钻，且下方永远有同数数据表） */
export const CHART_HINT = '图表与下方数据表同源：图表点击等于选择该取值，数据表永远可见。'
