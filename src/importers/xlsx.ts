/**
 * XLSX / XLS 解析（SheetJS 本地打包，docs/PRD.md 5.1、15.1）。
 *
 * 安全与口径约束：
 * - **只读值和已有缓存结果**：`cellFormula: true` 只是为了让「有公式但无缓存」可被识别并提示，
 *   本模块从不计算公式、不执行宏、不解析 HTML、不激活单元格链接、不联网更新；
 * - `cellHTML: false`：不生成 HTML 片段，避免把外部内容带进界面；
 * - `cellStyles: true`：隐藏行 / 列的标记来自样式信息（实测不加此项读不到 `!rows` / `!cols`），
 *   但本模块只读 `hidden` 标记，不读任何样式值；
 * - `cellDates: false`：**日期数字序列不转换**（1900/1904 与歧义日期的处理属于清洗步骤5）。
 */

import type { CellObject, ParsingOptions, WorkBook, WorkSheet } from 'xlsx'
import { read, utils } from 'xlsx'

import { createQualityIssue, type DataQualityIssue, type RawCellValue, type SkippedSheetInfo } from '../domain'
import { IMPORT_LIMITS, type ImportLimitKind, type LimitViolation } from './limits'
import { blankCell, type RawGrid, type RawGridCell, type RawGridRow } from './grid'

export const XLSX_READ_OPTIONS: ParsingOptions = {
  type: 'array',
  cellFormula: true,
  cellHTML: false,
  cellNF: false,
  cellStyles: true,
  cellText: true,
  cellDates: false,
  sheetStubs: false,
  dense: false,
  bookVBA: false,
  WTF: false,
}

/** 工作表元信息：供用户选择工作表（可见性 + 行列数 + 空表标记） */
export type XlsxSheetInfo = {
  readonly name: string
  readonly index: number
  /** 隐藏 / 深度隐藏都为 true（都需要用户显式选择） */
  readonly hidden: boolean
  readonly rowCount: number
  readonly columnCount: number
  readonly empty: boolean
  readonly hiddenRowCount: number
  readonly hiddenColumnCount: number
}

export type XlsxWorkbookContext = {
  readonly workbook: WorkBook
  readonly sheets: readonly XlsxSheetInfo[]
  readonly date1904: boolean
}

export type XlsxWorkbookInspection = {
  readonly sheets: readonly XlsxSheetInfo[]
  readonly date1904: boolean
}

export type XlsxSheetRequest = {
  readonly sheetName: string
  readonly isCancelled?: () => boolean
  /** 只读前 N 行（用于界面预览），不触发行数上限 */
  readonly rowLimit?: number
}

export type XlsxSheetResult = {
  readonly grid: RawGrid
  readonly sheet: XlsxSheetInfo
  /** 其他空表（跳过并提示） */
  readonly skippedSheets: readonly SkippedSheetInfo[]
  readonly issues: readonly DataQualityIssue[]
  readonly limitViolation: LimitViolation | null
  readonly cancelled: boolean
  readonly date1904: boolean
}

/** 错误单元格的可读文本（`cellText: true` 时通常已有 `w`，这里只是兜底） */
const EXCEL_ERROR_TEXT: Readonly<Record<number, string>> = {
  0x00: '#NULL!',
  0x07: '#DIV/0!',
  0x0f: '#VALUE!',
  0x17: '#REF!',
  0x1d: '#NAME?',
  0x24: '#NUM!',
  0x2a: '#N/A',
  0x2b: '#GETTING_DATA',
}

/** 一个单元格 → 网格单元格；只取值，不计算、不激活链接 */
function toGridCell(cell: CellObject | undefined): RawGridCell {
  if (cell === undefined) {
    return blankCell()
  }
  const formulaWithoutCache = cell.f !== undefined && cell.v === undefined
  return { value: cellValue(cell), formulaWithoutCache }
}

function cellValue(cell: CellObject): RawCellValue {
  switch (cell.t) {
    case 'n':
      return typeof cell.v === 'number' && Number.isFinite(cell.v) ? cell.v : null
    case 's':
      // 空字符串单元格与「没有单元格」等价：都表示缺失（null），避免与 CSV 口径不一致
      return typeof cell.v === 'string' && cell.v !== '' ? cell.v : null
    case 'b':
      return cell.v === true
    case 'e': {
      // 错误单元格：保留可读错误码（例如 #REF!），清洗阶段按「字段错误」处理
      if (typeof cell.w === 'string' && cell.w !== '') {
        return cell.w
      }
      return typeof cell.v === 'number' ? (EXCEL_ERROR_TEXT[cell.v] ?? '#ERROR') : null
    }
    default:
      // 'd'（日期对象）在 cellDates: false 下不会出现，'z'（占位）在 sheetStubs: false 下不会出现；
      // 真出现时按「未知」处理（null），绝不用 0 / 空字符串冒充
      return null
  }
}

/** 统计真实存在的单元格数量（空单元格不会被保存，因此这比遍历区域便宜） */
function countStoredCells(sheet: WorkSheet): number {
  let count = 0
  for (const key of Object.keys(sheet)) {
    if (!key.startsWith('!')) {
      count += 1
    }
  }
  return count
}

function sheetInfoOf(workbook: { Workbook?: { Sheets?: readonly { Hidden?: number }[] } }, sheet: WorkSheet, name: string, index: number): XlsxSheetInfo {
  const reference = sheet['!ref']
  const range = reference === undefined ? null : utils.decode_range(reference)
  const hiddenFlag = workbook.Workbook?.Sheets?.[index]?.Hidden ?? 0
  const hiddenRows = sheet['!rows']?.filter((row) => row?.hidden === true).length ?? 0
  const hiddenColumns = sheet['!cols']?.filter((column) => column?.hidden === true).length ?? 0
  return {
    name,
    index,
    hidden: hiddenFlag !== 0,
    rowCount: range === null ? 0 : range.e.r - range.s.r + 1,
    columnCount: range === null ? 0 : range.e.c - range.s.c + 1,
    empty: range === null || countStoredCells(sheet) === 0,
    hiddenRowCount: hiddenRows,
    hiddenColumnCount: hiddenColumns,
  }
}

/**
 * 读取工作簿结构：工作表清单、可见性、行列数、空表标记、日期系统。
 * 会解析全部工作表（SheetJS 不解析工作表就拿不到行列数），因此这是本模块最重的一步。
 */
export function readWorkbookContext(bytes: Uint8Array): XlsxWorkbookContext {
  const workbook = read(bytes, XLSX_READ_OPTIONS)
  const sheets = workbook.SheetNames.map((name, index) =>
    sheetInfoOf(workbook, workbook.Sheets[name] ?? {}, name, index),
  )
  return {
    workbook,
    sheets,
    date1904: workbook.Workbook?.WBProps?.date1904 === true,
  }
}

export function inspectWorkbook(bytes: Uint8Array): XlsxWorkbookInspection {
  const context = readWorkbookContext(bytes)
  return { sheets: context.sheets, date1904: context.date1904 }
}

/** 隐藏列下标（相对已用区域起点，0 起）；列数据**不排除**，仅提示 */
function hiddenColumnIndexesOf(sheet: WorkSheet, startColumn: number, columnCount: number): readonly number[] {
  const columns = sheet['!cols']
  if (columns === undefined) {
    return []
  }
  const indexes: number[] = []
  for (let index = 0; index < columns.length; index += 1) {
    if (columns[index]?.hidden === true) {
      const relative = index - startColumn
      if (relative >= 0 && relative < columnCount) {
        indexes.push(relative)
      }
    }
  }
  return indexes
}

type GridBuildResult = {
  readonly grid: RawGrid
  readonly limitViolation: LimitViolation | null
  readonly cancelled: boolean
}

function limitViolationOf(kind: ImportLimitKind, limit: number, actual: number): LimitViolation {
  const subject = kind === 'rows' ? '数据行数' : kind === 'columns' ? '列数' : '单元格总数'
  const action = kind === 'columns' ? '请先删除无关列后重试' : '请先拆分或裁剪文件后重试'
  return { kind, limit, actual, message: `${subject}超过上限 ${limit}；${action}` }
}

/**
 * 把一张工作表转成网格：按已用区域逐行读取，缺失单元格为 `null`。
 * 取消与超限在行循环内即时生效（返回已读到的部分与原因，绝不影响任何已有数据）；
 * 传入 `rowLimit` 时只读前若干行（界面预览用），此时不判定行数 / 单元格上限。
 */
export function buildSheetGrid(sheet: WorkSheet, request: XlsxSheetRequest): GridBuildResult {
  const reference = sheet['!ref']
  if (reference === undefined) {
    return {
      grid: { rows: [], columnCount: 0, hiddenColumnIndexes: [], firstRowNumber: 1 },
      limitViolation: null,
      cancelled: false,
    }
  }

  const range = utils.decode_range(reference)
  const firstRowNumber = range.s.r + 1
  const columnCount = range.e.c - range.s.c + 1
  const hiddenColumnIndexes = hiddenColumnIndexesOf(sheet, range.s.c, columnCount)
  const emptyGrid: RawGrid = { rows: [], columnCount, hiddenColumnIndexes, firstRowNumber }
  const previewOnly = request.rowLimit !== undefined

  if (!previewOnly && columnCount > IMPORT_LIMITS.maxColumns) {
    return {
      grid: emptyGrid,
      limitViolation: limitViolationOf('columns', IMPORT_LIMITS.maxColumns, columnCount),
      cancelled: false,
    }
  }

  const rows: RawGridRow[] = []
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    if (request.isCancelled?.() === true) {
      return { grid: { ...emptyGrid, rows }, limitViolation: null, cancelled: true }
    }
    if (previewOnly && rows.length >= (request.rowLimit ?? 0)) {
      break
    }
    const rowNumber = rowIndex - range.s.r + 1
    if (!previewOnly && rowNumber > IMPORT_LIMITS.maxRows) {
      return {
        grid: { ...emptyGrid, rows },
        limitViolation: limitViolationOf('rows', IMPORT_LIMITS.maxRows, rowNumber),
        cancelled: false,
      }
    }
    if (!previewOnly && rowNumber * columnCount > IMPORT_LIMITS.maxCells) {
      return {
        grid: { ...emptyGrid, rows },
        limitViolation: limitViolationOf('cells', IMPORT_LIMITS.maxCells, rowNumber * columnCount),
        cancelled: false,
      }
    }

    const cells: RawGridCell[] = []
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      cells.push(toGridCell(sheet[utils.encode_cell({ r: rowIndex, c: columnIndex })]))
    }
    rows.push({
      cells,
      hidden: sheet['!rows']?.[rowIndex]?.hidden === true,
      sourceRow: rowIndex + 1,
    })
  }

  return { grid: { ...emptyGrid, rows }, limitViolation: null, cancelled: false }
}

/**
 * 读取指定工作表并生成网格，同时给出「其他空工作表已跳过」的提示。
 * 接收已经读好的工作簿上下文，避免同一文件被解析两次。
 * 工作表名不存在时抛出可读错误（消息只含工作表名，不含任何单元格内容）。
 */
export function parseWorkbookSheet(context: XlsxWorkbookContext, request: XlsxSheetRequest): XlsxSheetResult {
  const sheetInfo = context.sheets.find((info) => info.name === request.sheetName)
  if (sheetInfo === undefined) {
    throw new Error(`工作簿中没有名为「${request.sheetName}」的工作表`)
  }

  const skippedSheets: readonly SkippedSheetInfo[] = context.sheets
    .filter((info) => info.empty && info.name !== sheetInfo.name)
    .map((info) => ({
      name: info.name,
      hidden: info.hidden,
      rowCount: info.rowCount,
      columnCount: info.columnCount,
    }))

  const issues: DataQualityIssue[] = []
  if (sheetInfo.empty) {
    issues.push(
      createQualityIssue({
        code: 'EMPTY_SHEET_SKIPPED',
        sourceSheet: sheetInfo.name,
        message: `所选工作表「${sheetInfo.name}」没有任何内容`,
      }),
    )
  }
  for (const skipped of skippedSheets) {
    issues.push(
      createQualityIssue({
        code: 'EMPTY_SHEET_SKIPPED',
        sourceSheet: skipped.name,
        message: `工作表「${skipped.name}」没有任何内容，已跳过`,
      }),
    )
  }

  const build = buildSheetGrid(context.workbook.Sheets[sheetInfo.name] ?? {}, request)
  return {
    grid: build.grid,
    sheet: sheetInfo,
    skippedSheets,
    issues,
    limitViolation: build.limitViolation,
    cancelled: build.cancelled,
    date1904: context.date1904,
  }
}
