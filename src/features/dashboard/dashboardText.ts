/**
 * 看板固定文案（唯一来源：同一句话不要在多个组件里各写一遍）。
 *
 * 这些文案承担 PRD 的「口径必须写清楚」要求：总记录数含审批中、不伪造全链路漏斗、
 * 基准不足不给结论。改动口径文案时只改这里。
 *
 * 注意：AI 入口的文案不在这里——它归 `features/ai/aiText.ts`（AI-1 起该支路的全部
 * 界面文案集中在那一个文件，含入口按钮与预览面板）。同一句话写两处必然走岔，
 * 因此本文件刻意**不再**导出 AI 相关文案。
 */

import {
  AWAITING_APPROVAL_STATUS,
  JOINED_STATUS,
  OTHER,
  PENDING_JOINING_STATUS,
  REJECTED_OFFER_STATUS,
  REJECTED_VERBALLY_STATUS,
  UNKNOWN,
  type OfferStatus,
} from '../../domain'

/** 各状态在分母口径里的位置（状态结构表与明细表图例共用） */
export const STATUS_NOTES: Readonly<Record<OfferStatus, string>> = {
  [JOINED_STATUS]: '计入核心分母 D（J）',
  [PENDING_JOINING_STATUS]: '计入核心分母 D（P）；已接受未到岗',
  [AWAITING_APPROVAL_STATUS]: '不计入 D；占比按 N 计算（审批积压看这里）',
  [REJECTED_OFFER_STATUS]: '计入核心分母 D（R1）',
  [REJECTED_VERBALLY_STATUS]: '计入核心分母 D（R2）',
  [OTHER]: '已识别但不进核心口径，不计入 D',
  [UNKNOWN]: '缺失或无法识别，不计入 D，且必须保留可见',
}

/** 总览的能力边界：附件只有 offer 名单，没有完整招聘链路 */
export const NOT_FULL_FUNNEL_NOTE =
  '数据边界：附件是 offer 名单，没有投递 / 面试等前置环节，因此这里不呈现全链路漏斗，也不计算渠道 ROI。'

/** 同岗基准不足时的统一说法（不得给结论、不得打低薪标签） */
export const BENCHMARK_INSUFFICIENT_NOTE =
  '同岗样本不足：按城市 + 序列 + 岗位 + 币种 + 计薪周期严格同组，有效样本 n < 5 时不出分位，也不打「低于中位数」标签。'

/** 「未知」作为筛选项的说明 */
export const UNKNOWN_OPTION_NOTE =
  '「未知」是可选的独立值：不选它表示不过滤，而不是把未知记录排除掉。'

/* ------------------------------------------------- 回到全部数据（用户需求 4） */

/**
 * 「返回全部数据」按钮（分维度表、状态结构、时间趋势三处共用同一份文案与同一条逻辑）。
 *
 * 为什么需要它：表里的「只看该组」会把全局筛选设为该取值，而筛选条在页面**上方**——
 * 用户点了下钻之后，视线停在表格上，往往找不到怎么回到全部数据（真实验收反馈）。
 * 因此在下钻按钮附近也放一个同等显眼的出口。
 *
 * 两条纪律：
 * 1. 它调用的**就是**筛选条那个 `clearFilters`（同一个纯函数），不另写一份「清空」规则；
 * 2. 没有生效筛选时按钮置灰并说明原因，而不是让用户点了一个什么都不做的按钮。
 */
export const RETURN_TO_ALL_LABEL = '返回全部数据'
export const RETURN_TO_ALL_HINT =
  '一键清掉当前所有筛选（含「只看该组」下钻与状态 / 时间下钻），回到全部记录；筛选条上的「清空筛选」是同一个动作。'
export const RETURN_TO_ALL_IDLE_NOTE = '当前没有筛选，已经在看全部数据。'
export const RETURN_TO_ALL_ACTIVE_NOTE = '当前有筛选生效：点这里可以一键回到全部数据。'
