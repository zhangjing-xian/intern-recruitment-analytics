/**
 * 导出层统一出口（AGENTS.md §4）。
 *
 * 只导出本步骤定义的四个导出器与它们共用的契约；内部工具（`sections.ts` 的取值层）
 * 不在这里导出——外部只需要「给一份 `SanitizedReport`，拿一个 `ExportResult`」。
 *
 * 提醒（AGENTS.md §3）：`xlsx` 与 `echarts` 都只允许出现在**动态 import** 的另一侧。
 * 本桶文件因此**没有**任何顶层 `import 'xlsx'` / `import 'echarts'`，
 * `xlsx.ts` 里的 `await import('xlsx')` 只有真正点导出 Excel 时才会执行。
 */

export {
  EXPORT_FORMAT_INFO,
  artifactOf,
  exportFailure,
  fileNameIsSafe,
  reportFileName,
  type ExportArtifact,
  type ExportFormat,
  type ExportResult,
} from './artifact'
export { exportMarkdown, markdownRowCountSummary } from './markdown'
export { PRINT_STYLE, escapeHtml, exportPrintHtml } from './print'
export { exportXlsx, safeCellValue, sheetNameOf } from './xlsx'
/*
 * `png.ts` **刻意不从本桶文件导出**。
 *
 * 理由：PNG 那条路径最终要加载 ECharts（约 540 kB 的懒 chunk）。只要桶文件静态导出它，
 * 任何 `import ... from '../../exporters'` 的组件都会把它一起静态拉进首屏包，
 * 同时让 `ExportWorkspace` 里的 `await import('../../exporters/png')` 变成无效动态导入
 * （构建期会报 INEFFECTIVE_DYNAMIC_IMPORT）。需要 PNG 能力的调用方直接从
 * `'./png'`（测试）或动态 `import('../../exporters/png')`（界面）取。
 */
