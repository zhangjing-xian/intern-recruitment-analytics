/**
 * CSV / TSV / 粘贴解析（PapaParse 本地解析，docs/PRD.md 5.1）。
 *
 * 只把文本变成 `RawGrid`，不判断标准字段、不做类型转换：
 * - 默认 `skipEmptyLines: false`：空行**保留并计数**（PRD 要求「跳过并计数」，不能悄悄少行）；
 * - 行号用 `meta.cursor` 换算物理行，字段内的换行不会让行号错位；
 * - 单元格 `''` → `null`（缺失一律 null）；其余文本原样保留，不做 trim；
 * - 取消用 `parser.abort()`，超限也立即中止并返回可核实的上限说明。
 */

import type { ParseError, ParseStepResult, Parser } from 'papaparse'
import Papa from 'papaparse'

import { type DataQualityIssue, type DataQualityIssueCode } from '../domain'
import { IMPORT_LIMITS, type LimitViolation } from './limits'
import { isBlankRow, type RawGrid, type RawGridCell, type RawGridRow } from './grid'
import { LineCounter, type Delimiter } from './text'

export type DelimitedGridOptions = {
  readonly delimiter: Delimiter
  /** 取消检查：返回 true 立即中止（Parser.abort） */
  readonly isCancelled?: () => boolean
  /** 进度回调：每累计 `progressInterval` 行调用一次 */
  readonly onRowsParsed?: (rowCount: number) => void
  readonly progressInterval?: number
}

export type DelimitedGridResult = {
  readonly grid: RawGrid
  readonly issues: readonly DataQualityIssue[]
  readonly linebreak: string | null
  readonly cancelled: boolean
  readonly limitViolation: LimitViolation | null
  /** 丢弃了「文件末尾换行产生的那个空行」时为 true */
  readonly droppedTrailingBlankRow: boolean
}

const DEFAULT_PROGRESS_INTERVAL = 500

export function parseDelimitedGrid(text: string, options: DelimitedGridOptions): DelimitedGridResult {
  const rows: RawGridRow[] = []
  const notesByRowIndex = new Map<number, readonly DataQualityIssueCode[]>()
  const lineCounter = new LineCounter(text)
  const progressInterval = options.progressInterval ?? DEFAULT_PROGRESS_INTERVAL

  let columnCount = 0
  let cancelled = false
  let limitViolation: LimitViolation | null = null
  let linebreak: string | null = null
  let previousCursor = 0
  let fallbackRowNumber = 1

  const abortWith = (violation: LimitViolation, parser: Parser): void => {
    limitViolation = violation
    parser.abort()
  }

  Papa.parse<string[]>(text, {
    delimiter: options.delimiter,
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
    comments: false,
    step: (result: ParseStepResult<string[]>, parser: Parser): void => {
      const cursor = typeof result.meta.cursor === 'number' ? result.meta.cursor : null
      const sourceRow =
        cursor === null ? fallbackRowNumber : lineCounter.lineNumberAt(previousCursor)
      if (cursor === null) {
        fallbackRowNumber += 1
      } else {
        previousCursor = cursor
      }

      if (options.isCancelled?.() === true) {
        cancelled = true
        parser.abort()
        return
      }

      const cells = result.data
      const rowNumber = rows.length + 1
      if (cells.length > columnCount) {
        columnCount = cells.length
      }
      if (rowNumber > IMPORT_LIMITS.maxRows) {
        abortWith(
          {
            kind: 'rows',
            limit: IMPORT_LIMITS.maxRows,
            actual: rowNumber,
            message: `数据行数超过上限 ${IMPORT_LIMITS.maxRows} 行；请先拆分文件后重试`,
          },
          parser,
        )
        return
      }
      if (columnCount > IMPORT_LIMITS.maxColumns) {
        abortWith(
          {
            kind: 'columns',
            limit: IMPORT_LIMITS.maxColumns,
            actual: columnCount,
            message: `列数超过上限 ${IMPORT_LIMITS.maxColumns} 列；请先删除无关列后重试`,
          },
          parser,
        )
        return
      }
      if (rowNumber * columnCount > IMPORT_LIMITS.maxCells) {
        abortWith(
          {
            kind: 'cells',
            limit: IMPORT_LIMITS.maxCells,
            actual: rowNumber * columnCount,
            message: `单元格总数超过上限 ${IMPORT_LIMITS.maxCells}；请先拆分或裁剪文件后重试`,
          },
          parser,
        )
        return
      }

      const codes = collectErrorCodes(result.errors)
      if (codes.length > 0) {
        notesByRowIndex.set(rows.length, codes)
      }
      rows.push({ cells: cells.map(toGridCell), hidden: false, sourceRow })
      if (rows.length % progressInterval === 0) {
        options.onRowsParsed?.(rows.length)
      }
    },
    complete: (result): void => {
      linebreak = typeof result.meta.linebreak === 'string' ? result.meta.linebreak : null
    },
  })

  options.onRowsParsed?.(rows.length)
  const droppedTrailingBlankRow = dropTrailingBlankRow(text, rows, notesByRowIndex)
  if (droppedTrailingBlankRow) {
    // 丢弃末行后把最终行数再上报一次，进度与结果保持一致
    options.onRowsParsed?.(rows.length)
  }

  return {
    grid: {
      rows,
      columnCount,
      hiddenColumnIndexes: [],
      firstRowNumber: 1,
      notesByRowIndex,
    },
    issues: [],
    linebreak,
    cancelled,
    limitViolation,
    droppedTrailingBlankRow,
  }
}

/* ------------------------------------------------------------------ 辅助 */

/** 文本单元格：`''` → null（缺失一律 null）；其余原样保留，不做 trim */
function toGridCell(value: string): RawGridCell {
  return { value: value === '' ? null : value, formulaWithoutCache: false }
}

/**
 * PapaParse 的错误码 → 领域问题码。
 * 只映射「字段结构可能错位」这一类，并且**只记录行号**，不把行内容带进问题对象。
 */
function collectErrorCodes(errors: readonly ParseError[]): readonly DataQualityIssueCode[] {
  const codes: DataQualityIssueCode[] = []
  for (const error of errors) {
    if (error.code === 'MissingQuotes' || error.type === 'Quotes' || error.type === 'FieldMismatch') {
      if (!codes.includes('QUOTE_MISMATCH')) {
        codes.push('QUOTE_MISMATCH')
      }
    }
  }
  return codes
}

/**
 * 文件末尾的换行会让 PapaParse 多产出一个全空行。
 * 只有当文本确实以换行结尾、且最后一行全空时才丢弃它（中间的空行一律保留并计数）。
 */
function dropTrailingBlankRow(
  text: string,
  rows: RawGridRow[],
  notesByRowIndex: Map<number, readonly DataQualityIssueCode[]>,
): boolean {
  if (!(text.endsWith('\n') || text.endsWith('\r')) || rows.length === 0) {
    return false
  }
  const lastRow = rows[rows.length - 1]
  if (lastRow === undefined || !isBlankRow(lastRow)) {
    return false
  }
  rows.pop()
  notesByRowIndex.delete(rows.length)
  return true
}
