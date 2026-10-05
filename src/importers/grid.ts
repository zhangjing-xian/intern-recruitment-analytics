/**
 * 原始网格 → `RawSheet`（三种输入共用的唯一转换点，docs/PRD.md 12.3 A01）。
 *
 * 设计要点：
 * - XLSX / CSV / 粘贴先各自变成同形的 `RawGrid`（值 + 行可见性 + 读取提示），再走这一条路径，
 *   所以「同内容的三种输入」必然得到相同的 RawRow（除记录来源的字段外）；
 * - 不做类型转换、不改写单元格文本、不排除隐藏行 / 列（隐藏行只在用户显式选择时排除）；
 * - 空行只计数不删除；单元格缺失一律 `null`（**绝不**用 0 / 空字符串冒充）。
 */

import {
  ISSUE_TITLES,
  createQualityIssue,
  type DataQualityIssue,
  type DataQualityIssueCode,
  type ImportSourceKind,
  type RawCellValue,
  type RawHeaderRow,
  type RawRow,
  type RawSheet,
  type SkippedSheetInfo,
} from '../domain'

/** 网格单元格：值 + 读取阶段发现的问题（不改变值本身） */
export type RawGridCell = {
  readonly value: RawCellValue
  /** 存在公式但工作簿没有保存缓存结果（XLSX 专有） */
  readonly formulaWithoutCache: boolean
}

export type RawGridRow = {
  readonly cells: readonly RawGridCell[]
  readonly hidden: boolean
  /** 该行在源文件中的物理行号（1 起）；缺省时按网格顺序推算（XLSX 用） */
  readonly sourceRow?: number
}

export type RawGrid = {
  readonly rows: readonly RawGridRow[]
  readonly columnCount: number
  /** 隐藏列下标（0 起）；列数据保留，仅提示 */
  readonly hiddenColumnIndexes: readonly number[]
  /** 第 0 行在源文件中的物理行号（1 起）：CSV / 粘贴为 1，XLSX 为已用区域起始行 */
  readonly firstRowNumber: number
  /** 按 0 起行索引挂读取阶段提示（如引号不配对） */
  readonly notesByRowIndex?: ReadonlyMap<number, readonly DataQualityIssueCode[]>
}

export type BuildRawSheetOptions = {
  readonly sourceKind: ImportSourceKind
  readonly sourceSheet: string
  /** 源文件名仅用于本机展示，禁止写入日志 / 报告 / AI 摘要 */
  readonly sourceFileName?: string | null
  /** 表头所在物理行号（1 起），默认第一行（docs/PRD.md 5.1） */
  readonly headerRowNumber?: number
  readonly sheetHidden?: boolean
  /** 用户显式选择「排除隐藏行」时为 true；默认 false（不默默排除） */
  readonly excludeHiddenRows?: boolean
  readonly skippedSheets?: readonly SkippedSheetInfo[]
  readonly issues?: readonly DataQualityIssue[]
  readonly date1904?: boolean | null
  readonly encoding?: string | null
  readonly delimiter?: string | null
}

export function blankCell(): RawGridCell {
  return { value: null, formulaWithoutCache: false }
}

/** 单元格的可读文本：null → 空字符串（仅用于表头比对与展示，不写回数据） */
export function cellText(value: RawCellValue): string {
  if (value === null) {
    return ''
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE'
  }
  return String(value)
}

export function isBlankCell(cell: RawGridCell): boolean {
  return cell.value === null || (typeof cell.value === 'string' && cell.value.trim() === '')
}

export function isBlankRow(row: RawGridRow): boolean {
  return row.cells.every(isBlankCell)
}

function padCells(cells: readonly RawGridCell[], columnCount: number): readonly RawGridCell[] {
  if (cells.length >= columnCount) {
    return cells
  }
  const padded = [...cells]
  while (padded.length < columnCount) {
    padded.push(blankCell())
  }
  return padded
}

/** 网格内第 `rowIndex` 行的物理行号 */
export function rowNumberAt(grid: RawGrid, rowIndex: number): number {
  return grid.firstRowNumber + rowIndex
}

/** 物理行号 → 行索引；超出范围返回 null（调用方据此提示，而不是静默改用第一行） */
export function resolveHeaderRowIndex(grid: RawGrid, headerRowNumber: number): number | null {
  const index = headerRowNumber - grid.firstRowNumber
  if (!Number.isInteger(index) || index < 0 || index >= grid.rows.length) {
    return null
  }
  return index
}

/** 物理行号范围的可读描述，用于「表头行超出范围」等提示（不含任何单元格内容） */
export function gridRowRangeLabel(grid: RawGrid): string {
  if (grid.rows.length === 0) {
    return '（无数据行）'
  }
  const first = grid.rows[0]?.sourceRow ?? grid.firstRowNumber
  const last = grid.rows[grid.rows.length - 1]?.sourceRow ?? rowNumberAt(grid, grid.rows.length - 1)
  return `${first}–${last}`
}

export function buildRawSheet(grid: RawGrid, options: BuildRawSheetOptions): RawSheet {
  const issues: DataQualityIssue[] = [...(options.issues ?? [])]

  // 来源里一行都没有（空文件 / 空工作表）：不抛异常，交给 EMPTY_DATASET 统一阻断
  if (grid.rows.length === 0) {
    issues.push(createQualityIssue({ code: 'EMPTY_DATASET', sourceSheet: options.sourceSheet }))
    return {
      sourceKind: options.sourceKind,
      sourceSheet: options.sourceSheet,
      sourceFileName: options.sourceFileName ?? null,
      header: {
        sourceKind: options.sourceKind,
        sourceSheet: options.sourceSheet,
        sourceRow: options.headerRowNumber ?? grid.firstRowNumber,
        headers: [],
        hidden: false,
      },
      rows: [],
      physicalRowCount: 0,
      columnCount: 0,
      emptyRowCount: 0,
      hiddenRowCount: 0,
      hiddenColumnIndexes: [],
      sheetHidden: options.sheetHidden ?? false,
      formulaWithoutCacheCount: 0,
      skippedSheets: options.skippedSheets ?? [],
      issues,
      date1904: options.date1904 ?? null,
      encoding: options.encoding ?? null,
      delimiter: options.delimiter ?? null,
    }
  }

  const headerRowNumber = options.headerRowNumber ?? grid.firstRowNumber
  const headerIndex = resolveHeaderRowIndex(grid, headerRowNumber)
  if (headerIndex === null) {
    throw new Error(`表头行 ${headerRowNumber} 超出数据范围 ${gridRowRangeLabel(grid)}`)
  }
  const headerGridRow = grid.rows[headerIndex]
  const headerCells = padCells(headerGridRow.cells, grid.columnCount)
  const headers = headerCells.map((cell) => cellText(cell.value))

  // 表头行自身的读取提示（例如引号异常）单独成问题，行号指向表头行
  for (const code of grid.notesByRowIndex?.get(headerIndex) ?? []) {
    issues.push(
      createQualityIssue({
        code,
        sourceSheet: options.sourceSheet,
        sourceRow: headerGridRow.sourceRow ?? headerRowNumber,
        message: `${ISSUE_TITLES[code]}（表头行）`,
      }),
    )
  }

  const header: RawHeaderRow = {
    sourceKind: options.sourceKind,
    sourceSheet: options.sourceSheet,
    sourceRow: headerGridRow.sourceRow ?? headerRowNumber,
    headers,
    hidden: headerGridRow.hidden,
  }

  const trimmedHeaders = headers.map((value) => value.trim())
  const rows: RawRow[] = []
  let emptyRowCount = 0
  let hiddenRowCount = 0
  let formulaWithoutCacheCount = 0

  for (let index = headerIndex + 1; index < grid.rows.length; index += 1) {
    const gridRow = grid.rows[index]
    const cells = padCells(gridRow.cells, grid.columnCount)
    const emptyRow = cells.every(isBlankCell)
    if (gridRow.hidden) {
      hiddenRowCount += 1
    }
    if (emptyRow) {
      emptyRowCount += 1
    }
    for (const cell of cells) {
      if (cell.formulaWithoutCache) {
        formulaWithoutCacheCount += 1
      }
    }

    // 排除隐藏行是用户的显式选择；此时该行不再出现在 rows 中，但计数与提示都保留
    if (options.excludeHiddenRows === true && gridRow.hidden) {
      continue
    }

    rows.push({
      sourceKind: options.sourceKind,
      sourceSheet: options.sourceSheet,
      sourceRow: gridRow.sourceRow ?? rowNumberAt(grid, index),
      cells: cells.map((cell) => cell.value),
      emptyRow,
      hidden: gridRow.hidden,
      parseNotes: collectRowNotes(grid, index, cells, trimmedHeaders, emptyRow),
    })
  }

  if (!rows.some((row) => !row.emptyRow)) {
    issues.push(createQualityIssue({ code: 'EMPTY_DATASET', sourceSheet: options.sourceSheet }))
  }
  if (headers.every((value) => value.trim() === '')) {
    issues.push(
      createQualityIssue({
        code: 'MISSING_REQUIRED_VALUE',
        sourceSheet: options.sourceSheet,
        sourceRow: headerRowNumber,
        message: '表头行没有任何文本，请更换表头行，否则下一步无法映射标准字段',
      }),
    )
  }

  return {
    sourceKind: options.sourceKind,
    sourceSheet: options.sourceSheet,
    sourceFileName: options.sourceFileName ?? null,
    header,
    rows,
    physicalRowCount: grid.rows.length,
    columnCount: grid.columnCount,
    emptyRowCount,
    hiddenRowCount,
    hiddenColumnIndexes: grid.hiddenColumnIndexes,
    sheetHidden: options.sheetHidden ?? false,
    formulaWithoutCacheCount,
    skippedSheets: options.skippedSheets ?? [],
    issues,
    date1904: options.date1904 ?? null,
    encoding: options.encoding ?? null,
    delimiter: options.delimiter ?? null,
  }
}

/** 行级读取提示：来源提示 → 空行 → 公式无缓存 → 表头文本残留（顺序固定，便于界面稳定展示） */
function collectRowNotes(
  grid: RawGrid,
  rowIndex: number,
  cells: readonly RawGridCell[],
  trimmedHeaders: readonly string[],
  emptyRow: boolean,
): readonly DataQualityIssueCode[] {
  const notes: DataQualityIssueCode[] = []
  const push = (code: DataQualityIssueCode): void => {
    if (!notes.includes(code)) {
      notes.push(code)
    }
  }

  for (const code of grid.notesByRowIndex?.get(rowIndex) ?? []) {
    push(code)
  }
  if (emptyRow) {
    return notes
  }
  if (cells.some((cell) => cell.formulaWithoutCache)) {
    push('FORMULA_WITHOUT_CACHE')
  }
  const echoesHeader = cells.some((cell, columnIndex) => {
    const headerText = trimmedHeaders[columnIndex] ?? ''
    if (headerText === '' || isBlankCell(cell)) {
      return false
    }
    return cellText(cell.value).trim() === headerText
  })
  if (echoesHeader) {
    push('HEADER_ECHO_CELL')
  }

  return notes
}
