/**
 * Markdown 导出（步骤11，docs/PRD.md 11.2「三种格式同一口径」）。
 *
 * 为什么先做 Markdown：它是纯字符串、不依赖任何运行时，最容易做「内容检索」测试
 * （PRD 11.5 要求用哨兵字符串检索导出内容）。Markdown 版本因此成为另外两种格式的对照基线。
 *
 * 两条硬规则：
 * 1. **只消费 `SanitizedReport`**：本文件不读会话、不读记录、不算任何指标；
 * 2. 表格里的 `|` 必须转义 / 替换，否则分组标签里带竖线会把表格列错位。
 */

import type { SanitizedReport } from '../privacy'

import { artifactOf, exportFailure, reportFileName, type ExportResult } from './artifact'
import { MISSING_TEXT, cellOfNumber, reportToSections } from './sections'

/** 单元格文本化：竖线 / 换行必须中和，否则会破坏 Markdown 表格结构 */
function markdownCell(value: string | number): string {
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/** 一行 Markdown 表格 */
function tableRow(cells: readonly (string | number)[]): string {
  return `| ${cells.map(markdownCell).join(' | ')} |`
}

/**
 * 生成 Markdown 文本。
 *
 * 刻意不使用 `**加粗**` 这类强调标记：本项目的用户会把内容直接贴进文档或聊天工具，
 * 而过去几步出现过「强调标记被原样显示」的问题——报告正文应当本身就是可读的纯文本。
 * 章节层级只靠标题层级（`#` / `##`）表达。
 */
export function exportMarkdown(report: SanitizedReport): ExportResult {
  try {
    const sections = reportToSections(report)
    const lines: string[] = []

    lines.push(`# ${report.meta.title}`)
    lines.push('')
    lines.push(
      `数据截至日 ${report.meta.dataAsOf} ｜ 生成时间 ${report.meta.generatedAt} ｜ 脱敏级别 ${report.meta.privacyLevel}`,
    )
    lines.push('')
    lines.push(
      '本文件由唯一的脱敏报告模型生成：只含聚合结果，不含候选人姓名、需求 ID、具体推荐人、准确薪资、自由文本原因与原始文件名。',
    )

    for (const section of sections) {
      lines.push('')
      lines.push(`## ${section.title}`)
      for (const note of section.notes) {
        lines.push('')
        lines.push(`说明：${note}`)
      }
      for (const table of section.tables) {
        lines.push('')
        lines.push(`### ${table.title}`)
        lines.push('')
        lines.push(tableRow(table.header))
        lines.push(tableRow(table.header.map(() => '---')))
        for (const row of table.rows) {
          lines.push(tableRow(row))
        }
        for (const note of table.notes) {
          lines.push('')
          lines.push(`备注：${note}`)
        }
      }
    }

    lines.push('')
    lines.push('## 使用限制')
    lines.push('')
    lines.push(report.meta.limitationNote)
    lines.push('')
    // 明细是否包含必须写清楚：读者不能靠「文件里没看到明细表」去猜是没开启还是被过滤掉了
    lines.push(
      report.details.length === 0
        ? '本次未开启记录级明细：只导出聚合结果。'
        : `本次包含 ${String(report.details.length)} 条记录级明细，仅使用报告内记录代号。`,
    )
    lines.push('')
    lines.push(
      `缺失值一律显示 ${MISSING_TEXT}；分母为 0 或按脱敏口径被抑制的数值也显示 ${MISSING_TEXT}，不代表 0。`,
    )
    lines.push('')

    const text = lines.join('\n')
    return artifactOf({
      format: 'markdown',
      fileName: reportFileName(report, 'markdown'),
      text,
      previewLines: text.split('\n').filter((line) => line !== ''),
    })
  } catch (error) {
    return exportFailure('生成 Markdown', error)
  }
}

/** 章节行数摘要（界面预览用；与文件内容同源，避免预览与文件不一致） */
export function markdownRowCountSummary(report: SanitizedReport): readonly string[] {
  return reportToSections(report).flatMap((section) =>
    section.tables.map(
      (table) => `${section.title} / ${table.title}：${cellOfNumber(table.rows.length)} 行`,
    ),
  )
}
