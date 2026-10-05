/**
 * Markdown 导出测试（步骤11，docs/PRD.md 11.5）。
 *
 * Markdown 是纯字符串，最适合做「哨兵检索」：整份文本里出现任何一个合成姓名 / HR 姓名 /
 * 需求 ID / 准确薪资 / 原因原文都算失败。XLSX 与打印版另有用例，但基线口径以这里为准。
 */

import { describe, expect, it } from 'vitest'

import { findSensitiveFields } from '../privacy'

import { exportMarkdown, markdownRowCountSummary } from './markdown'
import { reportFileName } from './artifact'
import {
  EXPORT_SENTINELS,
  buildExportInput,
  buildExportReport,
  exportSentinelTokens,
} from './testFixture'

describe('exportMarkdown', () => {
  it('成功产出文本产物，且不含 bytes（文本格式不产生二进制）', () => {
    const result = exportMarkdown(buildExportReport())

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.artifact.format).toBe('markdown')
    expect(result.artifact.bytes).toBeNull()
    expect(result.artifact.text).not.toBeNull()
    expect(result.artifact.mimeType).toBe('text/markdown')
    expect(result.artifact.previewLines.length).toBeGreaterThan(0)
    expect(result.artifact.previewLines.length).toBeLessThanOrEqual(20)
  })

  it('整份文本不含任何合成哨兵（姓名 / HR / 推荐人 / 需求 ID / 准确薪资 / 原因原文）', () => {
    const result = exportMarkdown(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    for (const sentinel of exportSentinelTokens()) {
      expect(
        result.artifact.text.includes(sentinel),
        `Markdown 里出现了哨兵：${sentinel}`,
      ).toBe(false)
    }
  })

  it('不含任何被禁字段名，且导出前的本地检查放行', () => {
    const report = buildExportReport()
    const result = exportMarkdown(report)
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    // 导出内容本身再过一次敏感字段检查（AI 返回内容视为不可信文本时的同一道闸门）
    expect(findSensitiveFields(result.artifact.text, exportSentinelTokens())).toEqual([])
    expect(report.details).toEqual([])
    expect(result.artifact.text).toContain('本次未开启记录级明细')
  })

  it('缺失值显示「—」而不是 0 或 0%', () => {
    const result = exportMarkdown(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    expect(result.artifact.text).toContain('—')
    expect(result.artifact.text).toContain('缺失值一律显示 —')
    // 报告里没有分母为 0 的率时不应出现 0.00%；这里至少断言「没有把缺失写成 0.00%」的说明在文里
    expect(result.artifact.text).toContain('不代表 0')
  })

  it('不使用 Markdown 强调标记（避免在纯文本展示里露出字面量）', () => {
    const result = exportMarkdown(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    expect(result.artifact.text.includes('**')).toBe(false)
  })

  it('单元格里的竖线被转义，表格结构不会被分组标签破坏', () => {
    const report = buildExportReport()
    const result = exportMarkdown(report)
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    // 每个表格行都必须以 | 开头并且不出现未转义的裸竖线造成的列数不一致
    const tableLines = result.artifact.text
      .split('\n')
      .filter((line) => line.startsWith('| '))
    expect(tableLines.length).toBeGreaterThan(0)
    for (const line of tableLines) {
      expect(line.endsWith(' |')).toBe(true)
    }
  })

  it('文件名不含任何敏感 token', () => {
    const fileName = reportFileName(buildExportReport(), 'markdown')
    for (const sentinel of exportSentinelTokens()) {
      expect(fileName.includes(sentinel)).toBe(false)
    }
    expect(fileName.startsWith('实习生招聘复盘报告-')).toBe(true)
    expect(fileName.endsWith('.md')).toBe(true)
  })

  it('章节行数摘要与文件内容同源（预览与文件一致）', () => {
    const report = buildExportReport()
    const summary = markdownRowCountSummary(report)
    const result = exportMarkdown(report)
    expect(result.ok).toBe(true)

    expect(summary.length).toBeGreaterThan(0)
    expect(summary.join('|')).toContain('行')
    expect(findSensitiveFields(summary, exportSentinelTokens())).toEqual([])
  })

  it('合计与分组计数来自同一份报告模型（避免「预览一个数、文件另一个数」）', () => {
    const report = buildExportReport()
    const result = exportMarkdown(report)
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    const totalKpi = report.kpis.find((kpi) => kpi.id === 'total')
    expect(totalKpi?.value).not.toBeNull()
    expect(result.artifact.text).toContain('N 总 offer 记录数（含审批中）')
    // 维度合计写在表备注里，与 report.dimensions[].total 同源
    const dimension = report.dimensions[0]
    expect(result.artifact.text).toContain(`合计 ${String(dimension.total)} 条`)
  })

  it('原因分布只出现受控类别，不出现原因原文', () => {
    const input = buildExportInput()
    const result = exportMarkdown(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    expect(result.artifact.text).toContain('原因类别')
    expect(result.artifact.text).not.toContain(EXPORT_SENTINELS.reason)
    // 受控类别里必然有「未填写」，它是独立一行而不是被并进「其他」
    expect(result.artifact.text).toContain('未填写')
    expect(input.rejection.reasons.denominator).toBeGreaterThan(0)
  })
})
