/**
 * 仅测试使用：合成 XLSX / CSV / 粘贴样例（全部是明显占位内容，不含任何真实招聘数据）。
 *
 * 三份样例表达**同一张表**，用于验证 docs/PRD.md 12.3 A01「三种同内容输入 → 标准化输出一致」。
 * 注意：所有单元格都用文本，避免「XLSX 数字 vs CSV 文本」这种**有意保留**的类型差异干扰等价性断言；
 * 数字类型差异本身有单独用例说明（步骤3 不做隐式转换，统一在清洗阶段处理）。
 */

import { utils, write, type WorkBook } from 'xlsx'

import type { ImportFileLike } from './protocol'

export const FIXTURE_HEADERS: readonly string[] = ['需求ID', '姓名', 'offer状态', '薪资']

/** 同一张表的行（全部为文本，空字符串表示缺失） */
export const FIXTURE_ROWS: readonly (readonly string[])[] = [
  ['REQ-001', '候选人甲', '已入职', '4000'],
  ['REQ-002', '候选人乙', '待入职', '4500'],
  ['REQ-003', '候选人丙', '已送审批', ''],
]

export const FIXTURE_BLANK_ROW: readonly string[] = ['', '', '', '']

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

/** 与浏览器 `File` 形状一致的最小实现（Worker / 测试都不依赖 DOM 的 File 类） */
export function makeFile(bytes: Uint8Array, name: string, type: string, sizeOverride?: number): ImportFileLike {
  return {
    name,
    type,
    size: sizeOverride ?? bytes.byteLength,
    arrayBuffer: () => Promise.resolve(toArrayBuffer(bytes)),
  }
}

export function makeTextFile(text: string, name: string, type: string): ImportFileLike {
  return makeFile(new TextEncoder().encode(text), name, type)
}

/** CSV 文本（CRLF 行尾，与 Excel 导出习惯一致） */
export function buildFixtureCsv(): string {
  const lines = [FIXTURE_HEADERS, ...FIXTURE_ROWS].map((row) => row.join(','))
  return `${lines.join('\r\n')}\r\n`
}

/** TSV 文本（制表符 + CRLF，模拟从 Excel 直接粘贴） */
export function buildFixtureTsv(): string {
  const lines = [FIXTURE_HEADERS, ...FIXTURE_ROWS].map((row) => row.join('\t'))
  return `${lines.join('\r\n')}\r\n`
}

export type FixtureWorkbookOptions = {
  /** 追加一张完全没有内容的工作表 */
  readonly withEmptySheet?: boolean
  /** 追加一张隐藏的工作表 */
  readonly withHiddenSheet?: boolean
  /** 第二行设为隐藏行 */
  readonly withHiddenRow?: boolean
  /** 第二列设为隐藏列 */
  readonly withHiddenColumn?: boolean
  /** D2 放一个「有公式但没有缓存结果」的单元格 */
  readonly withFormulaWithoutCache?: boolean
  /** 工作簿使用 1904 日期系统 */
  readonly date1904?: boolean
}

export function buildFixtureWorkbookBytes(options: FixtureWorkbookOptions = {}): Uint8Array {
  const rows: string[][] = [[...FIXTURE_HEADERS], ...FIXTURE_ROWS.map((row) => [...row])]
  const sheet = utils.aoa_to_sheet(rows)
  if (options.withHiddenRow === true) {
    sheet['!rows'] = [{}, { hidden: true }, {}, {}]
  }
  if (options.withHiddenColumn === true) {
    sheet['!cols'] = [{}, { hidden: true }, {}, {}]
  }
  if (options.withFormulaWithoutCache === true) {
    sheet.D2 = { t: 'n', f: 'D2*12' }
  }

  const workbook: WorkBook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, '名单')
  if (options.withEmptySheet === true) {
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([]), '空表')
  }
  if (options.withHiddenSheet === true) {
    utils.book_append_sheet(workbook, utils.aoa_to_sheet([['隐藏表头'], ['x']]), '隐藏表')
    workbook.Workbook = {
      Sheets: workbook.SheetNames.map((name) => (name === '隐藏表' ? { Hidden: 1 } : {})),
    }
  }
  if (options.date1904 === true) {
    workbook.Workbook = { ...(workbook.Workbook ?? {}), WBProps: { date1904: true } }
  }

  return new Uint8Array(write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer)
}

/** 带公式且**有**缓存（错误）结果的单元格样例：`#DIV/0!` */
export function buildErrorCellWorkbookBytes(): Uint8Array {
  const sheet = utils.aoa_to_sheet([['需求ID', '结果'], ['REQ-001', null]])
  sheet.B2 = { t: 'e', v: 0x07, w: '#DIV/0!', f: '1/0' }
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, '错误')
  return new Uint8Array(write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer)
}

/** 日期序列样例：步骤3 只读值，**不转换**日期（转换属清洗步骤5） */
export function buildDateWorkbookBytes(): Uint8Array {
  const sheet = utils.aoa_to_sheet([['需求ID', '启动招聘时间'], ['REQ-001', new Date(Date.UTC(2026, 4, 8))]])
  const workbook = utils.book_new()
  utils.book_append_sheet(workbook, sheet, '日期')
  return new Uint8Array(write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer)
}
