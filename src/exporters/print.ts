/**
 * 打印 / 另存为 PDF（步骤11，docs/PRD.md 11.2）。
 *
 * 实现方式：生成一份**专用打印版式**的 HTML 字符串，由界面用 `window.print()` 交给浏览器
 * 自带的「另存为 PDF」。之所以不在这里调 `window.print()`：
 * 1. 本文件要保持可单测（Node 里没有 `window`）；
 * 2. 打印是用户动作，必须由界面按钮触发（也便于提示「在打印对话框里选择另存为 PDF」）。
 *
 * 三条硬规则：
 * 1. **不截图原始看板**：内容与 XLSX / Markdown 同源，都来自 `reportToSections(SanitizedReport)`；
 * 2. **页眉页脚只放非敏感信息**：报告标题、数据截至日、页码；不含文件名、HR、城市、数据集名；
 * 3. **零外部资源**：字体只用系统本地中文字体栈（`@page` 里给出），不引用在线字体 / 图片 / CDN。
 */

import type { SanitizedReport } from '../privacy'

import { artifactOf, exportFailure, reportFileName, type ExportResult } from './artifact'
import { reportToSections } from './sections'

/** HTML 文本转义：报告里的标签可能含 `<` `&`（例如「其他（N 个分组合并）」不会，但分组值可能） */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * 专用打印版式的 CSS。
 *
 * 为什么把 CSS 内联进 HTML 字符串：打印窗口（`window.print()`）只打印当前文档，
 * 若样式放在应用主样式表里，会被 Tailwind 的 `@media print` 覆盖、也会把整站样式带进 PDF。
 * 内联后这份文档是自包含的，打印结果与屏幕内容一致。
 */
export const PRINT_STYLE = `
@page { size: A4; margin: 14mm 12mm 16mm 12mm; }
* { box-sizing: border-box; }
body {
  /* 只用系统本地中文字体栈：不加载任何在线字体（AGENTS.md §2.1 零远程资源） */
  font-family: "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC",
    "Noto Sans CJK SC", "WenQuanYi Micro Hei", SimSun, sans-serif;
  color: #0f172a; font-size: 10.5pt; line-height: 1.5; margin: 0;
}
h1 { font-size: 16pt; margin: 0 0 4pt; }
h2 { font-size: 12.5pt; margin: 14pt 0 4pt; border-bottom: 1px solid #cbd5f5; padding-bottom: 2pt; page-break-after: avoid; }
h3 { font-size: 11pt; margin: 10pt 0 3pt; page-break-after: avoid; }
p.note { color: #475569; font-size: 9pt; margin: 2pt 0; }
table { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: 9pt; }
th, td { border: 1px solid #cbd5e1; padding: 3pt 4pt; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-weight: 600; }
/* 表头在跨页时重复，长表格翻页后仍能读懂列含义 */
thead { display: table-header-group; }
tr { page-break-inside: avoid; }
footer.print-footer { margin-top: 10pt; border-top: 1px solid #cbd5e1; padding-top: 4pt; color: #64748b; font-size: 8.5pt; }
`
/**
 * 打印版里要嵌入的一张图（用户需求 ③，2026-09-27）。
 *
 * `dataUrl` 必须是以 `data:image/png;base64,` 开头的**本机生成**的图
 * （由 `exporters/png.ts` 从同一份脱敏报告离屏重绘得到）。
 * 为什么不引用文件路径或远程地址：打印文档必须自包含，
 * 引用外部图片等于把一份「本机报告」变成需要联网才能看的东西。
 */
export type PrintChartImage = {
  readonly title: string
  /** 图注（说明分母 / 口径，与界面上的图注同一份文案） */
  readonly note: string
  readonly dataUrl: string
}

/** 只接受本机生成的 PNG data URL：其它形状一律丢弃（不猜、不修） */
function isLocalPngDataUrl(value: string): boolean {
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value)
}

/**
 * 生成打印版 HTML。
 *
 * 页眉 / 页脚只使用报告标题、数据截至日与说明性文字：
 * 它们在脱敏规则里就是固定文案，不可能带出 HR 姓名或城市。
 *
 * `chartImages` 是**可选**的本机图表（用户需求 ③）：给了就插在正文之前，
 * 没给就与从前逐字节一致（步骤11 的既有断言因此仍然成立）。
 */
export function exportPrintHtml(
  report: SanitizedReport,
  chartImages: readonly PrintChartImage[] = [],
): ExportResult {
  try {
    const sections = reportToSections(report)
    const parts: string[] = []

    parts.push('<!doctype html>')
    parts.push('<html lang="zh-CN"><head><meta charset="utf-8">')
    // 标题只作为浏览器标签名：与文件名同源、不含敏感信息
    parts.push(`<title>${escapeHtml(report.meta.title)}</title>`)
    parts.push(`<style>${PRINT_STYLE}</style>`)
    parts.push('</head><body>')

    parts.push(`<h1>${escapeHtml(report.meta.title)}</h1>`)
    parts.push(
      `<p class="note">数据截至日 ${escapeHtml(report.meta.dataAsOf)} ｜ 生成时间 ${escapeHtml(
        report.meta.generatedAt,
      )} ｜ 脱敏级别 ${escapeHtml(report.meta.privacyLevel)}</p>`,
    )
    parts.push(
      '<p class="note">打印或另存为 PDF 时请在打印对话框中选择「另存为 PDF」；本文件只含聚合结果，不含候选人姓名、需求 ID、推荐人、准确薪资与原因原文。</p>',
    )

    /*
     * 图表区（用户需求 ③）：图由本机从**同一份脱敏报告**离屏重绘，不截图看板、不带原始明细。
     * 形状不对的 dataUrl 直接跳过——宁可少一张图，也不把来路不明的串写进报告。
     */
    const usableCharts = chartImages.filter((chart) => isLocalPngDataUrl(chart.dataUrl))
    if (usableCharts.length > 0) {
      parts.push('<h2>图表</h2>')
      parts.push(
        '<p class="note">下列图表由本机根据同一份脱敏报告重新绘制（不是对看板界面截图）：图中只有聚合结果，被抑制的分组不会出现。</p>',
      )
      for (const chart of usableCharts) {
        parts.push(`<h3>${escapeHtml(chart.title)}</h3>`)
        parts.push(`<p class="note">${escapeHtml(chart.note)}</p>`)
        parts.push(
          `<img alt="${escapeHtml(chart.title)}" src="${chart.dataUrl}" style="width:100%;max-width:170mm;border:1px solid #cbd5e1;" />`,
        )
      }
    }

    for (const section of sections) {
      parts.push(`<h2>${escapeHtml(section.title)}</h2>`)
      for (const note of section.notes) {
        parts.push(`<p class="note">${escapeHtml(note)}</p>`)
      }
      for (const table of section.tables) {
        parts.push(`<h3>${escapeHtml(table.title)}</h3>`)
        parts.push('<table>')
        parts.push('<thead><tr>')
        for (const header of table.header) {
          parts.push(`<th>${escapeHtml(header)}</th>`)
        }
        parts.push('</tr></thead><tbody>')
        for (const row of table.rows) {
          parts.push('<tr>')
          for (const cell of row) {
            parts.push(`<td>${escapeHtml(String(cell))}</td>`)
          }
          parts.push('</tr>')
        }
        parts.push('</tbody></table>')
        for (const note of table.notes) {
          parts.push(`<p class="note">${escapeHtml(note)}</p>`)
        }
      }
    }

    parts.push(
      `<footer class="print-footer">${escapeHtml(report.meta.title)} ｜ 数据截至日 ${escapeHtml(
        report.meta.dataAsOf,
      )} ｜ ${escapeHtml(report.meta.limitationNote)}</footer>`,
    )
    parts.push('</body></html>')

    const text = parts.join('\n')
    return artifactOf({
      format: 'pdf',
      fileName: reportFileName(report, 'pdf'),
      text,
      previewLines: sections.flatMap((section) =>
        section.tables.map(
          (table) => `${section.title} / ${table.title}：${String(table.rows.length)} 行`,
        ),
      ),
    })
  } catch (error) {
    return exportFailure('生成打印版', error)
  }
}
