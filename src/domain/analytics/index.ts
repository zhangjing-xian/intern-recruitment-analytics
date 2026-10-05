/**
 * 统一指标引擎（步骤7 建立，步骤9 扩充）的公开入口：N/J/P/A/R1/R2/U/D、全部率、周期与等待时长、
 * 分位与并列中位秩、同岗薪酬基准、通用分组聚合、二维交叉表、按计薪单位的薪资分布与房补对比、
 * 筛选快照与过滤规则、分维度分析的口径与文案。
 *
 * 约定：
 * - 领域层唯一入口仍是 `src/domain/index.ts`，页面 / 数据层只 `import ... from '../domain'`；
 * - 本文件**不导出** `fixtures.ts`（只用合成数据的测试夹具），避免测试代码进入应用构建路径；
 * - 组件内**禁止**重复实现这里的任何公式（AGENTS.md §2.3、§6 禁止清单）。
 */

export * from './analyze'
export * from './calendar'
export * from './compensation'
export * from './crossTab'
export * from './dimensionNotes'
export * from './durations'
export * from './filters'
export * from './grouping'
export * from './quantile'
export * from './rates'
export * from './rejection'
export * from './salary'
export * from './statusCounts'
export * from './timeline'
