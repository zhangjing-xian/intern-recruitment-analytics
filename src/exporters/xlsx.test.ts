/**
 * Excel（.xlsx）导出测试（步骤11，docs/PRD.md 11.2 / 11.5）。
 *
 * 关键手法：把生成的工作簿**再读回内存**（`XLSX.read`）后断言，而不是只看生成代码。
 * 原因：公式注入、隐藏 sheet 这类问题恰好只在「文件真实内容」里能看出来——
 * 只看 `aoa_to_sheet` 的入参很容易漏（例如某个分支写进了 `f` 字段）。
 *
 * 数据红线：全部使用合成夹具（`testFixture.ts`）。
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { findSensitiveFields } from '../privacy'

import { reportFileName } from './artifact'
import { safeCellValue, sheetNameOf, exportXlsx } from './xlsx'
import { buildExportReport, buildExportReportWithDetails, exportSentinelTokens } from './testFixture'

/** 递归收集工作簿里的全部单元格文本与类型 */
function allCells(workbook: XLSX.WorkBook): readonly { readonly text: string; readonly type: string }[] {
  const cells: { text: string; type: string }[] = []
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) {
        continue
      }
      const cell = sheet[address] as XLSX.CellObject
      cells.push({ text: cell.w ?? String(cell.v ?? ''), type: cell.t })
    }
  }
  return cells
}

describe('safeCellValue 防公式注入', () => {
  it('数字保持数字类型（报告里的计数 / 比率 / 天数）', () => {
    expect(safeCellValue(42)).toBe(42)
    expect(safeCellValue(0)).toBe(0)
    // 非有限数值（NaN / Infinity）不能写进表格，退回「—」
    expect(safeCellValue(Number.NaN)).toBe('—')
    expect(safeCellValue(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('以公式起手式开头的字符串被强制为文本', () => {
    for (const dangerous of ['=SUM(A1:A2)', '+1', '-1', '@x', '\tx', '\rx']) {
      const value = safeCellValue(dangerous)
      expect(typeof value).toBe('string')
      expect(String(value).startsWith("'")).toBe(true)
    }
  })

  it('普通文本与「—」原样保留', () => {
    expect(safeCellValue('—')).toBe('—')
    expect(safeCellValue('上海')).toBe('上海')
    expect(safeCellValue('其他（3 个分组合并）')).toBe('其他（3 个分组合并）')
  })
})

describe('sheetNameOf', () => {
  it('去掉 Excel 不允许的字符并限制在 31 字符内', () => {
    expect(sheetNameOf('1. 报告说明：口径/快照?*[]', 0)).toBe('1. 报告说明：口径 快照')
    expect(sheetNameOf('很长的标题'.repeat(20), 0).length).toBeLessThanOrEqual(31)
    expect(sheetNameOf('', 2)).toBe('3.工作表')
    // 标题自带序号时不再叠加，避免出现「1.1. …」这种像版本号的表名
    expect(sheetNameOf('核心 KPI', 1)).toBe('2.核心 KPI')
  })
})

describe('exportXlsx', () => {
  it('产出 xlsx 二进制，MIME 与扩展名正确', async () => {
    const result = await exportXlsx(buildExportReport())

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.artifact.format).toBe('xlsx')
    expect(result.artifact.bytes).not.toBeNull()
    expect(result.artifact.text).toBeNull()
    expect(result.artifact.fileName.endsWith('.xlsx')).toBe(true)
    expect(result.artifact.mimeType).toContain('spreadsheetml')
    // 真正的 xlsx 是 zip 容器，头两个字节是 PK
    expect(result.artifact.bytes?.[0]).toBe(0x50)
    expect(result.artifact.bytes?.[1]).toBe(0x4b)
  })

  it('读回来的工作簿：没有隐藏 sheet，且 sheet 数与章节数一致', async () => {
    const report = buildExportReport()
    const result = await exportXlsx(report)
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.bytes === null) {
      return
    }

    const workbook = XLSX.read(result.artifact.bytes, { type: 'array' })
    expect(workbook.SheetNames.length).toBeGreaterThan(0)
    // 章节数 + 末章的「导出说明」（报告本身只有 7 个章节，明细章节在未开启时不出现）
    expect(workbook.SheetNames.length).toBe(
      report.sections.filter((section) => section.id !== 'details').length + 1,
    )
    expect(workbook.SheetNames.some((name) => name.includes('明细'))).toBe(false)

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      // SheetJS 用 `!hidden` 标记隐藏工作表（写侧不会产生它）
      expect(sheet['!hidden']).toBeUndefined()
      expect(sheetName.length).toBeLessThanOrEqual(31)
    }
    // 工作簿级也没有隐藏 sheet 列表
    expect(workbook.Workbook?.Sheets?.every((sheet) => sheet.Hidden !== 1)).toBe(true)
  })

  it('读回来的每一个单元格都不含哨兵，也没有公式单元格', async () => {
    const result = await exportXlsx(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.bytes === null) {
      return
    }

    const workbook = XLSX.read(result.artifact.bytes, { type: 'array' })
    const cells = allCells(workbook)
    expect(cells.length).toBeGreaterThan(0)

    const tokens = exportSentinelTokens()
    for (const cell of cells) {
      for (const token of tokens) {
        expect(cell.text.includes(token), `单元格里出现了哨兵：${token}`).toBe(false)
      }
      // t === 'n' 是数字；任何公式都会体现为带 `f` 字段的单元格，下面单独检查
    }

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      for (const address of Object.keys(sheet)) {
        if (address.startsWith('!')) {
          continue
        }
        expect((sheet[address] as XLSX.CellObject).f).toBeUndefined()
      }
    }
    expect(findSensitiveFields(cells.map((cell) => cell.text), tokens)).toEqual([])
  })

  it('开启明细后出现明细 sheet，且明细行只含记录代号', async () => {
    const report = buildExportReportWithDetails()
    expect(report.details.length).toBeGreaterThan(0)

    const result = await exportXlsx(report)
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.bytes === null) {
      return
    }
    const workbook = XLSX.read(result.artifact.bytes, { type: 'array' })
    // 明细章节存在 → 章节数 + 末章「导出说明」
    expect(workbook.SheetNames.length).toBe(report.sections.length + 1)
    expect(workbook.SheetNames.some((name) => name.includes('记录级明细'))).toBe(true)

    const detailSheet = workbook.Sheets[
      workbook.SheetNames.find((name) => name.includes('记录级明细')) ?? ''
    ]
    const tokens = exportSentinelTokens()
    for (const address of Object.keys(detailSheet)) {
      if (address.startsWith('!')) {
        continue
      }
      const text = (detailSheet[address] as XLSX.CellObject).w ?? ''
      for (const token of tokens) {
        expect(text.includes(token), `明细 sheet 里出现了哨兵：${token}`).toBe(false)
      }
      expect((detailSheet[address] as XLSX.CellObject).f).toBeUndefined()
    }
  })

  it('文件名不含任何敏感 token', async () => {
    const fileName = reportFileName(buildExportReport(), 'xlsx')
    for (const token of exportSentinelTokens()) {
      expect(fileName.includes(token)).toBe(false)
    }
    expect(fileName).toBe('实习生招聘复盘报告-20260926.xlsx')
  })

  it('导出失败时返回安全文案（不回显底层异常 message）', async () => {
    // 传入一个形状被破坏的报告：导出器必须捕获异常并给出固定文案
    const broken = { ...buildExportReport(), kpis: null } as unknown as ReturnType<
      typeof buildExportReport
    >
    const result = await exportXlsx(broken)

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toContain('失败')
    expect(result.error).toContain('没有发起任何网络请求')
  })
})
