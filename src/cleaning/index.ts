/**
 * 清洗与规范化层（步骤5）的公开入口。
 *
 * 外部（页面 / 组件 / 测试）只从这里引用，避免把 `normalize.ts` 的内部实现细节
 * （取值规则、行状态机）带出去。所有函数都是纯函数：输入 `RawSheet` + 已确认 `ImportMapping`
 * + `CleaningSettings`，输出 `NormalizedDataset`，**不**读写任何存储。
 *
 * 口径边界：
 * - 本层只做规范化、校验、重复判定与**计数**；率、分位、基准一律留给步骤7 指标引擎；
 * - 未确认映射 / 缺 offer 状态列直接拒绝清洗（`cleaningPreconditionError`）；
 * - 默认值只给最保守起点（`createDefaultCleaningSettings`），任何业务结论都要用户确认。
 */

export * from './dates'
export * from './duplicates'
export * from './normalize'
export * from './report'
export * from './settings'
// 人工修正（用户需求 ①）：表签名要让界面能取到，才能把修正与「哪一份表」绑在一起
export * from './sheetSignature'
export * from './text'
