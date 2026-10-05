import { describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'

import type { RawSheet } from '../domain'
import { IMPORT_LIMITS } from './limits'
import { PASTE_SHEET_NAME, inspectSource, parseRawSheet } from './pipeline'
import {
  ImportTaskCancelled,
  isImportTaskError,
  type ImportPhase,
  type ImportSourcePayload,
  type ImportTaskContext,
  type ParsePayload,
} from './protocol'
import {
  buildFixtureCsv,
  buildFixtureTsv,
  buildFixtureWorkbookBytes,
  makeFile,
  makeTextFile,
} from './testFixtures'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type TestContext = ImportTaskContext & { readonly phases: readonly ImportPhase[]; readonly ratios: readonly number[] }

function createContext(isCancelled: () => boolean = () => false): TestContext {
  const phases: ImportPhase[] = []
  const ratios: number[] = []
  return {
    taskId: '任务-1',
    report: (phase, ratio) => {
      phases.push(phase)
      ratios.push(ratio)
    },
    isCancelled,
    phases,
    ratios,
  }
}

const xlsxPayload = (): ParsePayload['source'] => ({
  kind: 'file',
  file: makeFile(buildFixtureWorkbookBytes(), '名单.xlsx', XLSX_MIME),
})
const csvPayload = (): ParsePayload['source'] => ({
  kind: 'file',
  file: makeTextFile(buildFixtureCsv(), '名单.csv', 'text/csv'),
})
const pastePayload = (): ParsePayload['source'] => ({ kind: 'paste', text: buildFixtureTsv() })

/** 只比较「读到什么」的部分；来源字段本来就应当不同 */
const rowsOf = (sheet: RawSheet) =>
  sheet.rows.map((row) => ({
    sourceRow: row.sourceRow,
    cells: row.cells,
    emptyRow: row.emptyRow,
    hidden: row.hidden,
    parseNotes: row.parseNotes,
  }))

async function errorOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

describe('三种输入等价（docs/PRD.md 12.3 A01）', () => {
  it('XLSX / CSV / 粘贴同一张表 → 表头与原始行完全一致', async () => {
    const xlsxSheet = await parseRawSheet({ source: xlsxPayload() }, createContext())
    const csvSheet = await parseRawSheet({ source: csvPayload() }, createContext())
    const pasteSheet = await parseRawSheet({ source: pastePayload() }, createContext())

    expect(csvSheet.header.headers).toEqual(xlsxSheet.header.headers)
    expect(pasteSheet.header.headers).toEqual(xlsxSheet.header.headers)
    expect(rowsOf(csvSheet)).toEqual(rowsOf(xlsxSheet))
    expect(rowsOf(pasteSheet)).toEqual(rowsOf(xlsxSheet))
    expect(csvSheet.columnCount).toBe(xlsxSheet.columnCount)
    expect(csvSheet.physicalRowCount).toBe(xlsxSheet.physicalRowCount)
    expect(csvSheet.emptyRowCount).toBe(xlsxSheet.emptyRowCount)
  })

  it('来源信息可追溯，且三种输入的来源字段按设计不同', async () => {
    const xlsxSheet = await parseRawSheet({ source: xlsxPayload() }, createContext())
    const csvSheet = await parseRawSheet({ source: csvPayload() }, createContext())
    const pasteSheet = await parseRawSheet({ source: pastePayload() }, createContext())

    expect(xlsxSheet).toMatchObject({
      sourceKind: 'xlsx',
      sourceSheet: '名单',
      sourceFileName: '名单.xlsx',
      encoding: null,
      delimiter: null,
      date1904: false,
    })
    expect(csvSheet).toMatchObject({
      sourceKind: 'csv',
      sourceSheet: '名单.csv',
      encoding: 'utf-8',
      delimiter: ',',
      date1904: null,
    })
    expect(pasteSheet).toMatchObject({
      sourceKind: 'tsv-paste',
      sourceSheet: PASTE_SHEET_NAME,
      sourceFileName: null,
      delimiter: '\t',
    })
  })

  it('XLSX 数字单元格保持 number，CSV 保持文本：步骤3 不做隐式转换', async () => {
    const sheet = utils.aoa_to_sheet([
      ['需求ID', '薪资'],
      ['REQ-001', 4000],
    ])
    const workbook = utils.book_new()
    utils.book_append_sheet(workbook, sheet, '数字')
    const bytes = new Uint8Array(write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer)

    const xlsxSheet = await parseRawSheet(
      { source: { kind: 'file', file: makeFile(bytes, '数字.xlsx', XLSX_MIME) } },
      createContext(),
    )
    const csvSheet = await parseRawSheet(
      { source: { kind: 'file', file: makeTextFile('需求ID,薪资\r\nREQ-001,4000\r\n', '数字.csv', 'text/csv') } },
      createContext(),
    )

    expect(xlsxSheet.rows[0]?.cells[1]).toBe(4000)
    expect(csvSheet.rows[0]?.cells[1]).toBe('4000')
  })
})

describe('输入校验与拒绝', () => {
  it('不支持的文件类型被拒绝，说明支持的格式', async () => {
    const error = await errorOf(
      parseRawSheet({ source: { kind: 'file', file: makeTextFile('%PDF-1.4', '简历.pdf', 'application/pdf') } }, createContext()),
    )
    expect(isImportTaskError(error)).toBe(true)
    expect(isImportTaskError(error) && error.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(isImportTaskError(error) && error.message).toContain('.xlsx')
  })

  it('超过文件上限时在读取前就拒绝（不分配内存、不截断）', async () => {
    const oversized = makeFile(new Uint8Array(0), '名单.csv', 'text/csv', IMPORT_LIMITS.maxFileBytes + 1)
    const error = await errorOf(parseRawSheet({ source: { kind: 'file', file: oversized } }, createContext()))
    expect(isImportTaskError(error) && error.code).toBe('LIMIT_EXCEEDED')
    expect(isImportTaskError(error) && error.message).toContain('超过本机解析上限')
  })

  it('粘贴内容超长时拒绝并提示分批粘贴', async () => {
    const error = await errorOf(
      parseRawSheet({ source: { kind: 'paste', text: 'a'.repeat(IMPORT_LIMITS.maxPasteChars + 1) } }, createContext()),
    )
    expect(isImportTaskError(error) && error.code).toBe('LIMIT_EXCEEDED')
    expect(isImportTaskError(error) && error.message).toContain('请分批粘贴')
  })

  it('表头行超出范围时给可读失败（不改用第一行，消息只含行号）', async () => {
    const error = await errorOf(
      parseRawSheet({ source: csvPayload(), headerRowNumber: 99 }, createContext()),
    )
    expect(isImportTaskError(error) && error.code).toBe('PARSE_FAILED')
    expect(isImportTaskError(error) && error.message).toContain('超出数据范围')
    expect(isImportTaskError(error) && error.message).toContain('请改选表头行')
  })

  it('取消立即生效：抛出去任务取消，而不是返回半成品', async () => {
    const error = await errorOf(parseRawSheet({ source: pastePayload() }, createContext(() => true)))
    expect(error instanceof ImportTaskCancelled).toBe(true)

    const fileError = await errorOf(
      inspectSource(csvPayload() as ImportSourcePayload, createContext(() => true)),
    )
    expect(fileError instanceof ImportTaskCancelled).toBe(true)
  })
})

describe('CSV / 粘贴的选项与检查结果', () => {
  it('CSV 文件按扩展名与内容识别：分隔符、行数、空行数与原文预览', async () => {
    const inspection = await inspectSource(
      { kind: 'file', file: makeTextFile('需求ID,姓名\r\nREQ-001,候选人甲\r\n\r\n', '名单.csv', 'text/csv') },
      createContext(),
    )
    expect(inspection.kind).toBe('delimited')
    if (inspection.kind !== 'delimited') return

    expect(inspection.encoding).toBe('utf-8')
    expect(inspection.delimiter).toBe(',')
    expect(inspection.delimiterSource).toBe('auto')
    expect(inspection.rowCount).toBe(3)
    expect(inspection.columnCount).toBe(2)
    expect(inspection.droppedTrailingBlankRow).toBe(true)
    expect(inspection.preview.lines[0]).toBe('需求ID,姓名')
    expect(inspection.issues).toEqual([])
  })

  it('GB18030 文件按回退编码解码，并给出改编码的提示', async () => {
    // '你好' 的 GB18030 字节（C4 E3 BA C3）；整份文件不是合法 UTF-8
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('id,name\n1,'),
      0xc4,
      0xe3,
      0xba,
      0xc3,
      ...new TextEncoder().encode('\n'),
    ])
    const file = makeFile(bytes, '名单.csv', 'text/csv')

    const inspection = await inspectSource({ kind: 'file', file }, createContext())
    expect(inspection.kind === 'delimited' && inspection.encoding).toBe('gb18030')
    expect(inspection.kind === 'delimited' && inspection.encodingSource).toBe('fallback')
    expect(inspection.kind === 'delimited' && inspection.encodingHint).toContain('GB18030')

    const sheet = await parseRawSheet({ source: { kind: 'file', file } }, createContext())
    expect(sheet.rows[0]?.cells).toEqual(['1', '你好'])
  })

  it('用户显式选择的编码与分隔符优先于自动判断', async () => {
    const sheet = await parseRawSheet(
      { source: csvPayload(), delimiter: ';', encoding: 'utf-8' },
      createContext(),
    )
    // 用分号解析逗号文件：整行落在一列（说明用户选择真的生效，而不是被自动识别覆盖）
    expect(sheet.columnCount).toBe(1)
    expect(sheet.delimiter).toBe(';')
  })

  it('单列粘贴内容识别不出分隔符时按制表符处理并标记为回退', async () => {
    const inspection = await inspectSource({ kind: 'paste', text: '只有一列\r\nREQ-001\r\n' }, createContext())
    expect(inspection.kind === 'delimited' && inspection.delimiterSource).toBe('fallback')
    expect(inspection.kind === 'delimited' && inspection.delimiter).toBe('\t')
  })

  it('粘贴的引号内容按 TSV 解析，字段内换行不串行', async () => {
    const sheet = await parseRawSheet(
      { source: { kind: 'paste', text: 'a\tb\r\n"x\n1"\ty\r\n' } },
      createContext(),
    )
    expect(sheet.rows[0]?.cells).toEqual(['x\n1', 'y'])
    expect(sheet.rows[0]?.sourceRow).toBe(2)
  })
})

describe('XLSX 检查与选项', () => {
  it('检查结果包含工作表清单、日期系统与首张非空表的预览行', async () => {
    const inspection = await inspectSource(
      { kind: 'file', file: makeFile(buildFixtureWorkbookBytes({ withEmptySheet: true }), '名单.xlsx', XLSX_MIME) },
      createContext(),
    )
    expect(inspection.kind).toBe('xlsx')
    if (inspection.kind !== 'xlsx') return

    expect(inspection.sheets.map((sheet) => sheet.name)).toEqual(['名单', '空表'])
    expect(inspection.sheets[1]?.empty).toBe(true)
    expect(inspection.date1904).toBe(false)
    expect(inspection.previewSheetName).toBe('名单')
    expect(inspection.previewRows).toHaveLength(4)
    expect(inspection.previewRows[0]).toEqual(['需求ID', '姓名', 'offer状态', '薪资'])
    expect(inspection.issues.map((issue) => issue.code)).toContain('EMPTY_SHEET_SKIPPED')
  })

  it('默认解析第一张非空工作表，空表跳过并提示', async () => {
    const sheet = await parseRawSheet(
      { source: { kind: 'file', file: makeFile(buildFixtureWorkbookBytes({ withEmptySheet: true }), '名单.xlsx', XLSX_MIME) } },
      createContext(),
    )
    expect(sheet.sourceSheet).toBe('名单')
    expect(sheet.skippedSheets.map((item) => item.name)).toEqual(['空表'])
    expect(sheet.issues.map((issue) => issue.code)).toContain('EMPTY_SHEET_SKIPPED')
    expect(sheet.rows).toHaveLength(3)
  })

  it('可以指定工作表与表头行（表头行变化 → 数据区间随之下移）', async () => {
    const sheet = await parseRawSheet(
      {
        source: { kind: 'file', file: makeFile(buildFixtureWorkbookBytes(), '名单.xlsx', XLSX_MIME) },
        sheetName: '名单',
        headerRowNumber: 2,
      },
      createContext(),
    )
    expect(sheet.header.sourceRow).toBe(2)
    expect(sheet.header.headers).toEqual(['REQ-001', '候选人甲', '已入职', '4000'])
    expect(sheet.rows.map((row) => row.sourceRow)).toEqual([3, 4])
  })

  it('隐藏行默认包含，显式排除时 rows 少一行但计数保留', async () => {
    const bytes = buildFixtureWorkbookBytes({ withHiddenRow: true })
    const included = await parseRawSheet(
      { source: { kind: 'file', file: makeFile(bytes, '名单.xlsx', XLSX_MIME) } },
      createContext(),
    )
    const excluded = await parseRawSheet(
      {
        source: { kind: 'file', file: makeFile(bytes, '名单.xlsx', XLSX_MIME) },
        excludeHiddenRows: true,
      },
      createContext(),
    )

    expect(included.rows).toHaveLength(3)
    expect(included.hiddenRowCount).toBe(1)
    expect(excluded.rows).toHaveLength(2)
    expect(excluded.hiddenRowCount).toBe(1)
  })

  it('公式无缓存会同时进入行提示与计数（提示转值后重传的依据）', async () => {
    const sheet = await parseRawSheet(
      {
        source: {
          kind: 'file',
          file: makeFile(buildFixtureWorkbookBytes({ withFormulaWithoutCache: true }), '名单.xlsx', XLSX_MIME),
        },
      },
      createContext(),
    )
    expect(sheet.formulaWithoutCacheCount).toBe(1)
    expect(sheet.rows[0]?.parseNotes).toContain('FORMULA_WITHOUT_CACHE')
  })
})

describe('进度上报', () => {
  it('阶段顺序固定为「读取文件 → 解析表格 → 生成原始行」，比例落在 0–1', async () => {
    const context = createContext()
    await parseRawSheet({ source: csvPayload() }, context)

    expect(new Set(context.phases)).toEqual(new Set(['读取文件', '解析表格', '生成原始行']))
    for (const ratio of context.ratios) {
      expect(ratio).toBeGreaterThanOrEqual(0)
      expect(ratio).toBeLessThanOrEqual(1)
    }
    expect(context.ratios.at(-1)).toBe(1)
  })

  it('检查阶段也会上报进度', async () => {
    const context = createContext()
    await inspectSource(csvPayload() as ImportSourcePayload, context)
    expect(context.phases).toContain('解析表格')
    expect(context.phases).toContain('读取文件')
  })
})
