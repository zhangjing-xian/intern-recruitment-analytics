import { describe, expect, it } from 'vitest'

import {
  IMPORT_LIMITS,
  checkFileSize,
  checkGridSize,
  checkPasteLength,
  formatByteSize,
} from './limits'

describe('导入上限', () => {
  it('上限值是保守常量，且文件上限大于粘贴上限（文件按字节、粘贴按字符）', () => {
    expect(IMPORT_LIMITS.maxFileBytes).toBe(20 * 1024 * 1024)
    expect(IMPORT_LIMITS.maxRows).toBe(50_000)
    expect(IMPORT_LIMITS.maxColumns).toBe(512)
    expect(IMPORT_LIMITS.maxCells).toBe(2_000_000)
    expect(IMPORT_LIMITS.maxPasteChars).toBe(2_000_000)
  })

  it('恰好等于上限时通过，超过 1 个字节就拒绝并说明上限（不截断）', () => {
    expect(checkFileSize(IMPORT_LIMITS.maxFileBytes).ok).toBe(true)
    const over = checkFileSize(IMPORT_LIMITS.maxFileBytes + 1)
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.violation.kind).toBe('fileBytes')
      expect(over.violation.limit).toBe(IMPORT_LIMITS.maxFileBytes)
      expect(over.violation.actual).toBe(IMPORT_LIMITS.maxFileBytes + 1)
      expect(over.violation.message).toContain('超过本机解析上限')
    }
  })

  it('粘贴长度按字符数判断', () => {
    expect(checkPasteLength('a'.repeat(IMPORT_LIMITS.maxPasteChars)).ok).toBe(true)
    const over = checkPasteLength('a'.repeat(IMPORT_LIMITS.maxPasteChars + 1))
    expect(over.ok).toBe(false)
    if (!over.ok) {
      expect(over.violation.kind).toBe('pasteChars')
      expect(over.violation.message).toContain('请分批粘贴')
    }
  })

  it('行 / 列 / 单元格三重检查各自给出对应说明', () => {
    expect(checkGridSize(IMPORT_LIMITS.maxRows, 21).ok).toBe(true)

    const rows = checkGridSize(IMPORT_LIMITS.maxRows + 1, 21)
    expect(rows.ok).toBe(false)
    if (!rows.ok) {
      expect(rows.violation.kind).toBe('rows')
      expect(rows.violation.message).toContain('数据行数超过上限')
    }

    const columns = checkGridSize(10, IMPORT_LIMITS.maxColumns + 1)
    expect(columns.ok).toBe(false)
    if (!columns.ok) {
      expect(columns.violation.kind).toBe('columns')
      expect(columns.violation.message).toContain('列数超过上限')
    }

    // 行、列都合规但乘积超限：按单元格总数拒绝
    const cells = checkGridSize(40_000, 60)
    expect(cells.ok).toBe(false)
    if (!cells.ok) {
      expect(cells.violation.kind).toBe('cells')
      expect(cells.violation.limit).toBe(IMPORT_LIMITS.maxCells)
      expect(cells.violation.actual).toBe(2_400_000)
    }
  })

  it('字节数格式化使用中文可读单位', () => {
    expect(formatByteSize(512)).toBe('512 B')
    expect(formatByteSize(2048)).toBe('2.0 KB')
    expect(formatByteSize(20 * 1024 * 1024)).toBe('20.0 MB')
  })
})
