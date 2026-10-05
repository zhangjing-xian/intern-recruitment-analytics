/**
 * 解析流水线：`inspect`（先看有什么）与 `parse`（变成 RawSheet）共用同一套加载逻辑。
 *
 * 这一层不碰 React、不发网络请求，只调用纯解析适配器；Worker 与「无 Worker 环境」都复用它，
 * 因此浏览器与 Node 测试跑的是同一份逻辑（docs/PRD.md 10.4、12.3 A01）。
 */

import { ISSUE_TITLES, createQualityIssue, type DataQualityIssue, type DataQualityIssueCode, type RawSheet } from '../domain'
import { detectInputKind } from './detect'
import { parseDelimitedGrid } from './delimited'
import { buildRawSheet, cellText, isBlankRow, type BuildRawSheetOptions, type RawGrid, type RawGridRow } from './grid'
import { checkFileSize, checkPasteLength } from './limits'
import {
  ImportTaskCancelled,
  ImportTaskError,
  type DelimitedInspection,
  type ImportInspection,
  type ImportPhase,
  type ImportSourcePayload,
  type ImportTaskContext,
  type ParsePayload,
  type XlsxInspection,
} from './protocol'
import {
  DEFAULT_ENCODING,
  buildTextPreview,
  countLineBreaks,
  decodeText,
  detectDelimiter,
  detectEncoding,
  type Delimiter,
  type DelimiterDetection,
  type EncodingDetection,
  type TextEncoding,
} from './text'
import { buildSheetGrid, parseWorkbookSheet, readWorkbookContext } from './xlsx'

/** 预览行数上限（仅界面展示用） */
const PREVIEW_ROW_LIMIT = 6

type LoadedTextSource = {
  readonly kind: 'delimited'
  readonly text: string
  readonly fileName: string | null
  /** 来源标识：文件名或「粘贴内容」 */
  readonly sourceSheet: string
  readonly encoding: TextEncoding
  readonly encodingSource: DelimitedInspection['encodingSource']
  readonly hasBom: boolean
  readonly replacementCount: number
  readonly encodingHint: string | null
  readonly delimiter: Delimiter
  readonly delimiterSource: DelimitedInspection['delimiterSource']
  readonly delimiterCounts: Readonly<Record<Delimiter, number>>
}

type LoadedWorkbookSource = {
  readonly kind: 'workbook'
  readonly bytes: Uint8Array
  readonly fileName: string
}

type LoadedSource = LoadedTextSource | LoadedWorkbookSource

export const PASTE_SHEET_NAME = '粘贴内容'

const PHASE_RANGES: Readonly<Record<ImportPhase, readonly [number, number]>> = {
  读取文件: [0, 0.1],
  解析表格: [0.1, 0.9],
  生成原始行: [0.9, 1],
}

/** 把「阶段内比例」映射到整体进度；进度只用于展示，不代表结果完整度 */
function progressReporter(ctx: ImportTaskContext): (phase: ImportPhase, fraction: number) => void {
  return (phase, fraction) => {
    const [start, end] = PHASE_RANGES[phase]
    const clamped = Math.max(0, Math.min(1, fraction))
    ctx.report(phase, start + (end - start) * clamped)
  }
}

function failIfCancelled(ctx: ImportTaskContext): void {
  if (ctx.isCancelled()) {
    throw new ImportTaskCancelled(ctx.taskId)
  }
}

async function loadSource(
  payload: ImportSourcePayload,
  options: { readonly encoding?: TextEncoding; readonly delimiter?: Delimiter | 'auto' },
  report: (phase: ImportPhase, fraction: number) => void,
): Promise<LoadedSource> {
  if (payload.kind === 'paste') {
    const check = checkPasteLength(payload.text)
    if (!check.ok) {
      throw new ImportTaskError('LIMIT_EXCEEDED', check.violation.message, `上限 ${check.violation.limit}`)
    }
    // 粘贴进来的已经是 JS 字符串，不涉及字节解码
    const detection = detectDelimiter(payload.text)
    const delimiter = options.delimiter !== undefined && options.delimiter !== 'auto'
      ? options.delimiter
      : (detection.delimiter ?? '\t')
    return {
      kind: 'delimited',
      text: payload.text,
      fileName: null,
      sourceSheet: PASTE_SHEET_NAME,
      encoding: DEFAULT_ENCODING,
      encodingSource: 'paste',
      hasBom: false,
      replacementCount: 0,
      encodingHint: null,
      delimiter,
      delimiterSource: options.delimiter !== undefined && options.delimiter !== 'auto' ? 'user' : detection.delimiter === null ? 'fallback' : 'auto',
      delimiterCounts: detection.counts,
    }
  }

  const sizeCheck = checkFileSize(payload.file.size)
  if (!sizeCheck.ok) {
    throw new ImportTaskError('LIMIT_EXCEEDED', sizeCheck.violation.message, `上限 ${sizeCheck.violation.limit}`)
  }

  report('读取文件', 0)
  const bytes = new Uint8Array(await payload.file.arrayBuffer())
  const fileName = payload.file.name
  const detected = detectInputKind({
    fileName,
    mimeType: payload.file.type,
    firstBytes: bytes.subarray(0, 8),
  })
  if (detected.kind === 'unsupported') {
    throw new ImportTaskError('UNSUPPORTED_FILE_TYPE', detected.reason)
  }
  if (detected.kind === 'workbook') {
    return { kind: 'workbook', bytes, fileName }
  }

  const detection: EncodingDetection = detectEncoding(bytes)
  const encoding = options.encoding ?? detection.encoding
  const decoded = decodeText(bytes, encoding)
  if (!decoded.ok) {
    throw new ImportTaskError('ENCODING_FAILED', decoded.message)
  }
  const delimiterDetection: DelimiterDetection = detectDelimiter(decoded.text)
  const delimiter = options.delimiter !== undefined && options.delimiter !== 'auto'
    ? options.delimiter
    : (delimiterDetection.delimiter ?? detected.defaultDelimiter)
  const encodingHint =
    decoded.replacementCount > 0
      ? `按 ${encoding} 解码出现 ${decoded.replacementCount} 个无法识别的字符，若为乱码请改选编码`
      : detection.encoding === encoding
        ? detection.hint
        : null

  return {
    kind: 'delimited',
    text: decoded.text,
    fileName,
    sourceSheet: fileName,
    encoding,
    encodingSource: options.encoding === undefined ? detection.source : 'user',
    hasBom: decoded.hasBom,
    replacementCount: decoded.replacementCount,
    encodingHint,
    delimiter,
    delimiterSource:
      options.delimiter !== undefined && options.delimiter !== 'auto'
        ? 'user'
        : delimiterDetection.delimiter === null
          ? 'fallback'
          : 'auto',
    delimiterCounts: delimiterDetection.counts,
  }
}

/* ------------------------------------------------------------------ 检查（inspect） */

function countEmptyRows(rows: readonly RawGridRow[]): number {
  return rows.filter((row) => isBlankRow(row)).length
}

/** 读取阶段的行级提示按代码归并（只统计条数，绝不带行内容） */
function summarizeRowNotes(grid: RawGrid): readonly DataQualityIssue[] {
  const counts = new Map<DataQualityIssueCode, number>()
  for (const codes of grid.notesByRowIndex?.values() ?? []) {
    for (const code of codes) {
      counts.set(code, (counts.get(code) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([code, count]) => createQualityIssue({ code, message: `${ISSUE_TITLES[code]}（共 ${count} 行）` }))
}

function inspectDelimitedSource(source: LoadedTextSource, ctx: ImportTaskContext, report: ReturnType<typeof progressReporter>): DelimitedInspection {
  const estimatedRows = Math.max(1, countLineBreaks(source.text))
  const parsed = parseDelimitedGrid(source.text, {
    delimiter: source.delimiter,
    isCancelled: () => ctx.isCancelled(),
    onRowsParsed: (rowCount) => {
      report('解析表格', Math.min(1, rowCount / estimatedRows))
    },
  })
  if (parsed.cancelled) {
    throw new ImportTaskCancelled(ctx.taskId)
  }
  if (parsed.limitViolation !== null) {
    throw new ImportTaskError('LIMIT_EXCEEDED', parsed.limitViolation.message, `实际 ${parsed.limitViolation.actual}`)
  }

  const issues = [...summarizeRowNotes(parsed.grid)]
  if (parsed.grid.rows.length === 0) {
    issues.push(createQualityIssue({ code: 'EMPTY_DATASET', sourceSheet: source.sourceSheet }))
  }

  return {
    kind: 'delimited',
    encoding: source.encoding,
    encodingSource: source.encodingSource,
    hasBom: source.hasBom,
    replacementCount: source.replacementCount,
    encodingHint: source.encodingHint,
    delimiter: source.delimiter,
    delimiterSource: source.delimiterSource,
    delimiterCounts: source.delimiterCounts,
    linebreak: parsed.linebreak,
    rowCount: parsed.grid.rows.length,
    columnCount: parsed.grid.columnCount,
    emptyRowCount: countEmptyRows(parsed.grid.rows),
    droppedTrailingBlankRow: parsed.droppedTrailingBlankRow,
    preview: buildTextPreview(source.text),
    issues,
  }
}

function inspectWorkbookSource(bytes: Uint8Array): XlsxInspection {
  const context = readWorkbookContext(bytes)
  const issues: DataQualityIssue[] = []
  for (const sheet of context.sheets) {
    if (sheet.empty) {
      issues.push(
        createQualityIssue({
          code: 'EMPTY_SHEET_SKIPPED',
          sourceSheet: sheet.name,
          message: `工作表「${sheet.name}」没有任何内容，已跳过`,
        }),
      )
    }
  }
  const previewSheet = context.sheets.find((sheet) => !sheet.empty) ?? null
  const previewRows =
    previewSheet === null
      ? []
      : buildSheetGrid(context.workbook.Sheets[previewSheet.name] ?? {}, {
          sheetName: previewSheet.name,
          rowLimit: PREVIEW_ROW_LIMIT,
        }).grid.rows.map((row) => row.cells.map((cell) => cellText(cell.value)))

  return {
    kind: 'xlsx',
    sheets: context.sheets,
    date1904: context.date1904,
    previewSheetName: previewSheet?.name ?? null,
    previewRows,
    issues,
  }
}

export async function inspectSource(
  payload: ImportSourcePayload,
  ctx: ImportTaskContext,
): Promise<ImportInspection> {
  const report = progressReporter(ctx)
  const source = await loadSource(payload, {}, report)
  failIfCancelled(ctx)
  report('解析表格', 0)
  const inspection =
    source.kind === 'workbook'
      ? inspectWorkbookSource(source.bytes)
      : inspectDelimitedSource(source, ctx, report)
  report('解析表格', 1)
  return inspection
}

/* ------------------------------------------------------------------ 解析（parse） */

/**
 * `buildRawSheet` 只在「表头行超出范围」时抛错；这里把它翻译成可读的解析失败，
 * 消息只含行号与范围，不含任何单元格内容。
 */
function buildRawSheetOrFail(grid: RawGrid, options: BuildRawSheetOptions): RawSheet {
  try {
    return buildRawSheet(grid, options)
  } catch (error) {
    throw new ImportTaskError(
      'PARSE_FAILED',
      `${error instanceof Error ? error.message : '无法确定表头行'}，请改选表头行后重试`,
    )
  }
}

function parseDelimitedSource(
  source: LoadedTextSource,
  payload: ParsePayload,
  ctx: ImportTaskContext,
  report: ReturnType<typeof progressReporter>,
): RawSheet {
  const estimatedRows = Math.max(1, countLineBreaks(source.text))
  const parsed = parseDelimitedGrid(source.text, {
    delimiter: source.delimiter,
    isCancelled: () => ctx.isCancelled(),
    onRowsParsed: (rowCount) => {
      report('解析表格', Math.min(1, rowCount / estimatedRows))
    },
  })
  if (parsed.cancelled) {
    throw new ImportTaskCancelled(ctx.taskId)
  }
  if (parsed.limitViolation !== null) {
    throw new ImportTaskError('LIMIT_EXCEEDED', parsed.limitViolation.message, `实际 ${parsed.limitViolation.actual}`)
  }

  report('生成原始行', 0)
  const rawSheet = buildRawSheetOrFail(parsed.grid, {
    sourceKind: payload.source.kind === 'paste' ? 'tsv-paste' : 'csv',
    sourceSheet: source.sourceSheet,
    sourceFileName: source.fileName,
    headerRowNumber: payload.headerRowNumber,
    excludeHiddenRows: payload.excludeHiddenRows,
    encoding: source.encoding,
    delimiter: source.delimiter,
  })
  report('生成原始行', 1)
  return rawSheet
}

function parseWorkbookSource(
  source: LoadedWorkbookSource,
  payload: ParsePayload,
  ctx: ImportTaskContext,
  report: ReturnType<typeof progressReporter>,
): RawSheet {
  const context = readWorkbookContext(source.bytes)
  const requestedName = payload.sheetName ?? context.sheets.find((sheet) => !sheet.empty)?.name
  if (requestedName === undefined) {
    throw new ImportTaskError(
      'EMPTY_DATASET',
      '工作簿里所有工作表都是空的，没有可导入的数据',
    )
  }

  report('解析表格', 0.2)
  const parsed = parseWorkbookSheet(context, {
    sheetName: requestedName,
    isCancelled: () => ctx.isCancelled(),
  })
  if (parsed.cancelled) {
    throw new ImportTaskCancelled(ctx.taskId)
  }
  if (parsed.limitViolation !== null) {
    throw new ImportTaskError('LIMIT_EXCEEDED', parsed.limitViolation.message, `实际 ${parsed.limitViolation.actual}`)
  }

  report('生成原始行', 0)
  const rawSheet = buildRawSheetOrFail(parsed.grid, {
    sourceKind: 'xlsx',
    sourceSheet: parsed.sheet.name,
    sourceFileName: source.fileName,
    headerRowNumber: payload.headerRowNumber,
    sheetHidden: parsed.sheet.hidden,
    excludeHiddenRows: payload.excludeHiddenRows,
    skippedSheets: parsed.skippedSheets,
    issues: parsed.issues,
    date1904: parsed.date1904,
  })
  report('生成原始行', 1)
  return rawSheet
}

export async function parseRawSheet(payload: ParsePayload, ctx: ImportTaskContext): Promise<RawSheet> {
  const report = progressReporter(ctx)
  const source = await loadSource(
    payload.source,
    { encoding: payload.encoding, delimiter: payload.delimiter },
    report,
  )
  failIfCancelled(ctx)
  return source.kind === 'workbook'
    ? parseWorkbookSource(source, payload, ctx, report)
    : parseDelimitedSource(source, payload, ctx, report)
}
