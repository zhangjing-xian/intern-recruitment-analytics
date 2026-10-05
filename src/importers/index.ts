/**
 * 导入适配层统一出口（步骤3 建立）。
 *
 * 职责：把 XLSX / CSV / TSV / 粘贴在**浏览器本地**变成 `RawSheet`（`domain` 中的数据契约），
 * 不做字段识别、不做类型转换、不做去重（那些属于后续步骤）。
 *
 * 使用方式（界面层）：`createImportClient()` → `inspect()` 看有什么 → 用户选好工作表 / 表头行 /
 * 编码 / 分隔符 → `parse()` 拿 `RawSheet`；中途可 `cancel(taskId)`。
 *
 * **刻意不在本文件导出 `pipeline` / `delimited` / `xlsx` / `workerBridge`**：
 * 它们会连带打包 SheetJS（约 400 kB）与 PapaParse，只应由 Worker 入口（`src/workers/parse.worker.ts`）
 * 或「无 Worker 回退」的动态 import 加载；首屏包保持只有界面与轻量契约。
 * 需要直接使用时按文件路径 import（测试即如此）。
 */

export * from './detect'
export * from './grid'
export * from './importClient'
export * from './inProcessClient'
export * from './limits'
export * from './protocol'
export * from './syntheticDemo'
export * from './text'
