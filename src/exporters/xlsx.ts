/**
 * Excel（.xlsx）导出（步骤11，docs/PRD.md 11.2）。
 *
 * 三条硬规则：
 * 1. **SheetJS 必须动态 import**：`xlsx` 约 400 kB，静态引入会直接进首屏包，
 *    而首屏是导入页、根本用不到 Excel 导出（沿用 AGENTS.md §3 对 SheetJS / Dexie / ECharts 的既定做法）；
 * 2. **强制单元格类型，防公式注入**：任何以 `= + - @` 或制表符 / 回车开头的字符串都会被
 *    Excel / WPS 当公式执行。这里统一转成「安全的字符串或数字」——
 *    以危险字符开头的字符串前面加一个单引号前缀（Excel 的文本强制写法），绝不写 `f`（公式）字段；
 * 3. **不得有隐藏 sheet**：`!hidden` / `Hidden` 一律不设置，且**不写**原始数据工作表
 *    （PRD 11.2：不得隐藏原始数据 sheet；本实现干脆不存在原始数据表）。
 *
 * 明细行只在 `report.details.length > 0`（用户显式开启）时出现。
 */

import type { SanitizedReport } from '../privacy'

import { artifactOf, exportFailure, reportFileName, type ExportResult } from './artifact'
import { MISSING_TEXT, reportToSections, type ReportTableCell } from './sections'

/** 会被表格软件当作公式起手式的字符（含制表符与回车，它们也可能触发解析异常） */
const FORMULA_PREFIXES: readonly string[] = ['=', '+', '-', '@', '\t', '\r']

/**
 * 把一个单元格变成**安全值**。
 *
 * - 数字：原样写数字（数值型单元格，报告里的数都是计数 / 比率 / 天数）；
 * - 字符串：若以危险字符开头，则加 `'` 前缀强制为文本；其余原样。
 * 注意这里**不做** `String(cell)` 之外的类型猜测：报告里的 `—` 是文本，
 * 让它在 Excel 里也是文本，比「猜成一个数字」安全（0 与缺失在业务上完全不同）。
 */
export function safeCellValue(cell: ReportTableCell): string | number {
  if (typeof cell === 'number') {
    return Number.isFinite(cell) ? cell : MISSING_TEXT
  }
  const text = cell
  if (FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return `'${text}`
  }
  return text
}

/**
 * 工作表名：Excel 限制 31 字符，且不允许 `: \ / ? * [ ]`。
 *
 * 序号前缀只在标题自己没有序号时才加：章节标题本身就写成「1. 报告说明与口径快照」，
 * 再加一次序号会出现「1.1. …」这种读起来像版本号的表名。
 */
export function sheetNameOf(title: string, index: number): string {
  const cleaned = title.replace(/[:\\/?*[\]]/g, ' ').trim()
  const body = cleaned === '' ? '工作表' : cleaned
  const prefixed = /^\d+[.、]/.test(body) ? body : `${String(index + 1)}.${body}`
  return prefixed.slice(0, 31)
}

/**
 * 导出 XLSX。
 *
 * 为什么按「章节 → 工作表」而不是「一张大表」：PRD 11.2 要求多工作表，
 * 且一表一章节便于读者核对「同一筛选下三种格式数字一致」。
 * 工作表数量与顺序完全由 `reportToSections` 决定（与 Markdown / 打印版同源）。
 */
export async function exportXlsx(report: SanitizedReport): Promise<ExportResult> {
  try {
    // 动态 import：SheetJS 只在这条路径上被加载，不进入首屏 chunk
    const XLSX = await import('xlsx')
    const sections = reportToSections(report)
    const workbook = XLSX.utils.book_new()

    sections.forEach((section, sectionIndex) => {
      const rows: (string | number)[][] = []

      // 章节标题与说明放在表头之上（`aoa_to_sheet` 会把它当普通单元格，不会变成公式）
      rows.push([section.title])
      for (const note of section.notes) {
        rows.push([`说明：${note}`])
      }
      rows.push([])

      for (const table of section.tables) {
        rows.push([table.title])
        rows.push(table.header.map((header) => safeCellValue(header)))
        for (const row of table.rows) {
          rows.push(row.map((cell) => safeCellValue(cell)))
        }
        for (const note of table.notes) {
          rows.push([`备注：${note}`])
        }
        rows.push([])
      }

      const worksheet = XLSX.utils.aoa_to_sheet(rows)
      // 列宽按表头长度估一个可读值；不写 `!hidden`，也不写任何隐藏标记
      const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
      worksheet['!cols'] = Array.from({ length: columnCount }, () => ({ wch: 24 }))

      XLSX.utils.book_append_sheet(workbook, worksheet, sheetNameOf(section.title, sectionIndex))
    })

    const bytes = new Uint8Array(
      XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer,
    )

    return artifactOf({
      format: 'xlsx',
      fileName: reportFileName(report, 'xlsx'),
      bytes,
      previewLines: sections.flatMap((section) =>
        section.tables.map(
          (table) => `${section.title} / ${table.title}：${String(table.rows.length)} 行`,
        ),
      ),
    })
  } catch (error) {
    return exportFailure('生成 Excel', error)
  }
}
