import { describe, expect, it } from 'vitest'

import { parseDelimitedGrid } from './delimited'
import { IMPORT_LIMITS } from './limits'

describe('CSV / TSV / 粘贴解析', () => {
  it('带引号的字段、字段内逗号与字段内换行都被正确还原', () => {
    const text = '需求ID,姓名,备注\r\nREQ-001,"候选人, 甲","第一行\n第二行"\r\n'
    const result = parseDelimitedGrid(text, { delimiter: ',' })

    expect(result.cancelled).toBe(false)
    expect(result.limitViolation).toBeNull()
    expect(result.grid.columnCount).toBe(3)
    expect(result.grid.rows.map((row) => row.cells.map((cell) => cell.value))).toEqual([
      ['需求ID', '姓名', '备注'],
      ['REQ-001', '候选人, 甲', '第一行\n第二行'],
    ])
  })

  it('物理行号跟着字段内换行走：第 3 行内容实际出现在源文件第 4 行', () => {
    const text = 'a,b\r\n"x\n1",y\r\nz,w\r\n'
    const result = parseDelimitedGrid(text, { delimiter: ',' })

    expect(result.grid.rows.map((row) => row.sourceRow)).toEqual([1, 2, 4])
  })

  it('末行换行产生的空行被丢弃，中间的空行保留并标记', () => {
    const text = 'a,b\r\n1,2\r\n\r\n3,4\r\n'
    const result = parseDelimitedGrid(text, { delimiter: ',' })

    expect(result.droppedTrailingBlankRow).toBe(true)
    expect(result.grid.rows).toHaveLength(4)
    const values = result.grid.rows.map((row) => row.cells.map((cell) => cell.value))
    expect(values).toEqual([['a', 'b'], ['1', '2'], [null], ['3', '4']])
    expect(result.grid.rows[2]?.cells.map((cell) => cell.value)).toEqual([null])
  })

  it('空字符串单元格一律是 null（缺失 ≠ 空字符串 ≠ 0）', () => {
    const result = parseDelimitedGrid('a,b,c\r\n1,,3\r\n', { delimiter: ',' })
    expect(result.grid.rows[1]?.cells.map((cell) => cell.value)).toEqual(['1', null, '3'])
  })

  it('引号不配对时只记行级提示，不带任何单元格原文', () => {
    const text = 'a,b\r\n"未闭合,c\r\n'
    const result = parseDelimitedGrid(text, { delimiter: ',' })

    const notes = result.grid.notesByRowIndex?.get(1)
    expect(notes).toEqual(['QUOTE_MISMATCH'])
    expect(JSON.stringify(result.grid.notesByRowIndex)).not.toContain('未闭合')
  })

  it('取消后立即中止：返回已解析的部分并置 cancelled，由调用方丢弃', () => {
    let parsed = 0
    const result = parseDelimitedGrid('a\n1\n2\n3\n4\n5\n', {
      delimiter: ',',
      progressInterval: 1,
      onRowsParsed: () => {
        parsed += 1
      },
      isCancelled: () => parsed >= 2,
    })

    expect(result.cancelled).toBe(true)
    expect(result.grid.rows.length).toBeLessThan(6)
    expect(result.limitViolation).toBeNull()
  })

  it('行数超限时立即中止并给出上限说明（不静默截断）', () => {
    const text = `a,b\n${'1,2\n'.repeat(IMPORT_LIMITS.maxRows + 1)}`
    const result = parseDelimitedGrid(text, { delimiter: ',' })

    expect(result.cancelled).toBe(false)
    expect(result.limitViolation).not.toBeNull()
    expect(result.limitViolation?.kind).toBe('rows')
    expect(result.limitViolation?.limit).toBe(IMPORT_LIMITS.maxRows)
  })

  it('进度回调按累计行数触发', () => {
    const counts: number[] = []
    parseDelimitedGrid('a\n1\n2\n3\n', {
      delimiter: ',',
      progressInterval: 2,
      onRowsParsed: (rowCount) => counts.push(rowCount),
    })
    expect(counts.at(-1)).toBe(4)
    expect(counts.length).toBeGreaterThan(1)
  })
})
