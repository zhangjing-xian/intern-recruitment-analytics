/**
 * 脱敏层统一出口（`privacy/`，AGENTS.md §4）。
 *
 * 分层约定：本目录只放**纯函数**——不依赖 React / DOM / 网络 / 存储。
 * 展示层与导出层一律只从这里取「脱敏后的模型」，不得自己拼装报告字段
 * （AGENTS.md §2.5：先构造唯一 `SanitizedReport`，所有格式都从它生成）。
 */

export * from './aiPayload'
export * from './aiPreview'
export * from './aiSummary'
export * from './report'
export * from './sanitize'
