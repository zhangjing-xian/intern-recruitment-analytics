import { describe, expect, it } from 'vitest'

import {
  FIXTURE_HEADERS,
  buildDateWorkbookBytes,
  buildErrorCellWorkbookBytes,
  buildFixtureWorkbookBytes,
} from './testFixtures'
import { buildSheetGrid, inspectWorkbook, parseWorkbookSheet, readWorkbookContext } from './xlsx'

describe('XLSX 工作簿结构', () => {
  it('列出工作表名、可见性、行列数并标记空表', () => {
    const bytes = buildFixtureWorkbookBytes({ withEmptySheet: true, withHiddenSheet: true })
    const inspection = inspectWorkbook(bytes)

    expect(inspection.sheets.map((sheet) => sheet.name)).toEqual(['名单', '空表', '隐藏表'])
    expect(inspection.sheets[0]).toMatchObject({
      rowCount: 4,
      columnCount: 4,
      empty: false,
      hidden: false,
    })
    expect(inspection.sheets[1]).toMatchObject({ empty: true, rowCount: 0, columnCount: 0 })
    expect(inspection.sheets[2]?.hidden).toBe(true)
    expect(inspection.date1904).toBe(false)
  })

  it('隐藏行 / 隐藏列被读到并计数（数据不排除，只标记）', () => {
    const context = readWorkbookContext(
      buildFixtureWorkbookBytes({ withHiddenRow: true, withHiddenColumn: true }),
    )
    expect(context.sheets[0]?.hiddenRowCount).toBe(1)
    expect(context.sheets[0]?.hiddenColumnCount).toBe(1)
  })

  it('网格按工作表行号取值，行号与 Excel 显示一致', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes())
    const build = buildSheetGrid(context.workbook.Sheets['名单'] ?? {}, { sheetName: '名单' })

    expect(build.grid.firstRowNumber).toBe(1)
    expect(build.grid.rows[0]?.cells.map((cell) => cell.value)).toEqual(FIXTURE_HEADERS)
    expect(build.grid.rows.map((row) => row.sourceRow)).toEqual([1, 2, 3, 4])
    expect(build.grid.columnCount).toBe(4)
  })

  it('隐藏行标记跟着行数据返回', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes({ withHiddenRow: true }))
    const build = buildSheetGrid(context.workbook.Sheets['名单'] ?? {}, { sheetName: '名单' })
    expect(build.grid.rows.map((row) => row.hidden)).toEqual([false, true, false, false])
  })

  it('公式没有缓存结果时标记该单元格，值为 null', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes({ withFormulaWithoutCache: true }))
    const build = buildSheetGrid(context.workbook.Sheets['名单'] ?? {}, { sheetName: '名单' })
    expect(build.grid.rows[1]?.cells[3]).toEqual({ value: null, formulaWithoutCache: true })
  })

  it('公式有缓存（错误结果）时保留可读错误码，不算「无缓存」', () => {
    const context = readWorkbookContext(buildErrorCellWorkbookBytes())
    const build = buildSheetGrid(context.workbook.Sheets['错误'] ?? {}, { sheetName: '错误' })
    expect(build.grid.rows[1]?.cells[1]).toEqual({ value: '#DIV/0!', formulaWithoutCache: false })
  })

  it('日期单元格保持数字序列（步骤3 不转换日期，转换属清洗步骤5）', () => {
    const context = readWorkbookContext(buildDateWorkbookBytes())
    const build = buildSheetGrid(context.workbook.Sheets['日期'] ?? {}, { sheetName: '日期' })
    const value = build.grid.rows[1]?.cells[1]?.value
    expect(typeof value).toBe('number')
    expect(value as number).toBeGreaterThan(40_000)
  })

  it('1904 日期系统被记录，供清洗阶段换算', () => {
    expect(inspectWorkbook(buildFixtureWorkbookBytes({ date1904: true })).date1904).toBe(true)
  })

  it('空工作表没有 !ref：网格为空，解析结果把它列为已跳过并给提示', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes({ withEmptySheet: true }))
    expect(buildSheetGrid(context.workbook.Sheets['空表'] ?? {}, { sheetName: '空表' }).grid.rows).toEqual([])

    const result = parseWorkbookSheet(context, { sheetName: '名单' })
    expect(result.skippedSheets.map((sheet) => sheet.name)).toEqual(['空表'])
    const issue = result.issues.find((item) => item.code === 'EMPTY_SHEET_SKIPPED')
    expect(issue?.message).toContain('空表')
    expect(issue?.severity).toBe('警告')
  })

  it('所选工作表本身为空时也提示「没有任何内容」', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes({ withEmptySheet: true }))
    const result = parseWorkbookSheet(context, { sheetName: '空表' })
    expect(result.sheet.empty).toBe(true)
    expect(result.issues[0]?.message).toContain('所选工作表')
  })

  it('工作表名不存在时抛出可读错误，消息只含工作表名', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes())
    expect(() => parseWorkbookSheet(context, { sheetName: '不存在的表' })).toThrow(/不存在的表/)
  })

  it('rowLimit 只读前若干行（界面预览用），不触发行数上限', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes())
    const build = buildSheetGrid(context.workbook.Sheets['名单'] ?? {}, {
      sheetName: '名单',
      rowLimit: 2,
    })
    expect(build.grid.rows).toHaveLength(2)
    expect(build.grid.columnCount).toBe(4)
  })

  it('取消时立刻返回 cancelled 与已读到的部分（调用方会丢弃）', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes())
    const grid = buildSheetGrid(context.workbook.Sheets['名单'] ?? {}, {
      sheetName: '名单',
      isCancelled: () => true,
    })
    expect(grid.cancelled).toBe(true)
    expect(grid.grid.rows).toEqual([])
    expect(grid.limitViolation).toBeNull()
  })

  it('工作表名与日期系统一起写入解析结果', () => {
    const context = readWorkbookContext(buildFixtureWorkbookBytes({ date1904: true }))
    const result = parseWorkbookSheet(context, { sheetName: '名单' })
    expect(result.sheet.name).toBe('名单')
    expect(result.date1904).toBe(true)
    expect(result.grid.columnCount).toBe(4)
  })
})
