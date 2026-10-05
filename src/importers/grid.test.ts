import { describe, expect, it } from 'vitest'

import type { RawCellValue } from '../domain'
import {
  buildRawSheet,
  gridRowRangeLabel,
  resolveHeaderRowIndex,
  type RawGrid,
  type RawGridCell,
  type RawGridRow,
} from './grid'

function cell(value: RawCellValue, formulaWithoutCache = false): RawGridCell {
  return { value, formulaWithoutCache }
}

function row(values: readonly RawCellValue[], hidden = false): RawGridRow {
  return { cells: values.map((value) => cell(value)), hidden }
}

function grid(rows: readonly RawGridRow[], extra: Partial<RawGrid> = {}): RawGrid {
  return {
    rows,
    columnCount: Math.max(1, ...rows.map((item) => item.cells.length)),
    hiddenColumnIndexes: [],
    firstRowNumber: 1,
    ...extra,
  }
}

const OPTIONS = { sourceKind: 'csv', sourceSheet: '样例.csv' } as const

describe('网格 → RawSheet（三类输入唯一的转换点）', () => {
  it('默认第一行是表头，其余行按物理行号保留', () => {
    const sheet = buildRawSheet(grid([row(['需求ID', '姓名']), row(['REQ-001', '候选人甲'])]), OPTIONS)

    expect(sheet.header.headers).toEqual(['需求ID', '姓名'])
    expect(sheet.header.sourceRow).toBe(1)
    expect(sheet.rows.map((item) => item.sourceRow)).toEqual([2])
    expect(sheet.rows[0]?.cells).toEqual(['REQ-001', '候选人甲'])
    expect(sheet.physicalRowCount).toBe(2)
    expect(sheet.columnCount).toBe(2)
  })

  it('表头行可以改选：行号与数据区间一并跟着变', () => {
    const rows = [
      row(['说明：本表为合成数据']),
      row(['', '']),
      row(['需求ID', '姓名']),
      row(['REQ-001', '候选人甲']),
    ]
    const sheet = buildRawSheet(grid(rows), { ...OPTIONS, headerRowNumber: 3 })

    expect(sheet.header.sourceRow).toBe(3)
    expect(sheet.rows.map((item) => item.sourceRow)).toEqual([4])
    expect(sheet.emptyRowCount).toBe(0)
  })

  it('表头行超出范围时抛错，不做「静默改用第一行」', () => {
    const value = grid([row(['需求ID']), row(['REQ-001'])])
    expect(resolveHeaderRowIndex(value, 9)).toBeNull()
    expect(gridRowRangeLabel(value)).toBe('1–2')
    expect(() => buildRawSheet(value, { ...OPTIONS, headerRowNumber: 9 })).toThrow(/超出数据范围 1–2/)
  })

  it('空行保留并计数，单元格缺失是 null', () => {
    const rows = [row(['需求ID', '姓名']), row(['REQ-001', '候选人甲']), row(['', '']), row(['REQ-002', null])]
    const sheet = buildRawSheet(grid(rows), OPTIONS)

    expect(sheet.rows).toHaveLength(3)
    expect(sheet.emptyRowCount).toBe(1)
    expect(sheet.rows[1]?.emptyRow).toBe(true)
    expect(sheet.rows[2]?.cells).toEqual(['REQ-002', null])
  })

  it('短行补齐到列数，避免下游按列取值时错位', () => {
    const rows = [row(['需求ID', '姓名', '薪资']), row(['REQ-001'])]
    const sheet = buildRawSheet(grid(rows), OPTIONS)

    expect(sheet.rows[0]?.cells).toEqual(['REQ-001', null, null])
  })

  it('隐藏行默认包含在内（不默默排除），显式选择排除时才不进 rows', () => {
    const rows = [row(['需求ID']), row(['REQ-001'], true), row(['REQ-002'])]

    const included = buildRawSheet(grid(rows), OPTIONS)
    expect(included.rows.map((item) => item.sourceRow)).toEqual([2, 3])
    expect(included.hiddenRowCount).toBe(1)
    expect(included.rows[0]?.hidden).toBe(true)

    const excluded = buildRawSheet(grid(rows), { ...OPTIONS, excludeHiddenRows: true })
    expect(excluded.rows.map((item) => item.sourceRow)).toEqual([3])
    expect(excluded.hiddenRowCount).toBe(1)
  })

  it('隐藏列只提示下标，列数据照常保留', () => {
    const rows = [row(['需求ID', '姓名']), row(['REQ-001', '候选人甲'])]
    const sheet = buildRawSheet(grid(rows, { hiddenColumnIndexes: [1] }), OPTIONS)

    expect(sheet.hiddenColumnIndexes).toEqual([1])
    expect(sheet.header.headers).toEqual(['需求ID', '姓名'])
    expect(sheet.rows[0]?.cells).toEqual(['REQ-001', '候选人甲'])
  })

  it('公式无缓存的单元格给整行加提示，并单独计数', () => {
    const rows: RawGridRow[] = [
      { cells: [cell('需求ID'), cell('薪资')], hidden: false },
      { cells: [cell('REQ-001'), cell(null, true)], hidden: false },
      { cells: [cell('REQ-002'), cell('4500')], hidden: false },
    ]
    const sheet = buildRawSheet(grid(rows), OPTIONS)

    expect(sheet.formulaWithoutCacheCount).toBe(1)
    expect(sheet.rows[0]?.parseNotes).toEqual(['FORMULA_WITHOUT_CACHE'])
    expect(sheet.rows[1]?.parseNotes).toEqual([])
  })

  it('数据行里出现与表头相同的文本时标记表头残留（重复表头场景）', () => {
    const rows = [row(['需求ID', '姓名']), row(['需求ID', '姓名']), row(['REQ-001', '候选人甲'])]
    const sheet = buildRawSheet(grid(rows), OPTIONS)

    expect(sheet.rows[0]?.parseNotes).toEqual(['HEADER_ECHO_CELL'])
    expect(sheet.rows[1]?.parseNotes).toEqual([])
  })

  it('数据行全空时给出阻断级「没有可用数据行」', () => {
    const sheet = buildRawSheet(grid([row(['需求ID', '姓名']), row(['', null])]), OPTIONS)
    const issue = sheet.issues.find((item) => item.code === 'EMPTY_DATASET')
    expect(issue?.severity).toBe('阻断')
  })

  it('一行都没有时同样给阻断问题，且不抛异常', () => {
    const sheet = buildRawSheet(grid([]), OPTIONS)
    expect(sheet.rows).toEqual([])
    expect(sheet.header.headers).toEqual([])
    expect(sheet.issues.map((issue) => issue.code)).toEqual(['EMPTY_DATASET'])
  })

  it('表头行整行为空时提示改选表头行（不阻断，下一步映射会再要求 offer 状态列）', () => {
    const sheet = buildRawSheet(grid([row(['', '']), row(['REQ-001', '候选人甲'])]), OPTIONS)
    const issue = sheet.issues.find((item) => item.code === 'MISSING_REQUIRED_VALUE')
    expect(issue?.message).toContain('更换表头行')
    expect(issue?.severity).toBe('警告')
  })

  it('来源信息完整写入：种类、来源名、行号、编码与分隔符、跳过的空表', () => {
    const sheet = buildRawSheet(grid([row(['需求ID']), row(['REQ-001'])]), {
      sourceKind: 'tsv-paste',
      sourceSheet: '粘贴内容',
      sourceFileName: null,
      encoding: 'utf-8',
      delimiter: '\t',
      date1904: null,
      skippedSheets: [{ name: '空表', hidden: false, rowCount: 0, columnCount: 0 }],
    })

    expect(sheet.sourceKind).toBe('tsv-paste')
    expect(sheet.sourceSheet).toBe('粘贴内容')
    expect(sheet.sourceFileName).toBeNull()
    expect(sheet.header.sourceKind).toBe('tsv-paste')
    expect(sheet.encoding).toBe('utf-8')
    expect(sheet.delimiter).toBe('\t')
    expect(sheet.skippedSheets).toHaveLength(1)
  })
})
