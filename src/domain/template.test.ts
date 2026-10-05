import { describe, expect, it } from 'vitest'

import { STANDARD_FIELDS, STANDARD_HEADERS } from './fields'
import {
  TEMPLATE_COLUMNS,
  TEMPLATE_FILE_EXTENSION,
  TEMPLATE_FILE_NAME,
  TEMPLATE_LINE_ENDING,
  TEMPLATE_SAMPLE_ROW,
  TEMPLATE_SEPARATOR,
  buildTemplateHeaderLine,
  buildTemplateText,
  checkStandardHeaderRow,
} from './template'
import { TEMPLATE_VERSION } from './version'

describe('标准模板（21 列纯文本）', () => {
  it('列定义与标准字段一一对应，顺序严格一致', () => {
    expect(TEMPLATE_COLUMNS).toHaveLength(STANDARD_FIELDS.length)
    expect(TEMPLATE_COLUMNS.map((column) => column.header)).toEqual(STANDARD_HEADERS)
    expect(TEMPLATE_COLUMNS.map((column) => column.key)).toEqual(
      STANDARD_FIELDS.map((field) => field.key),
    )
    expect(TEMPLATE_COLUMNS[0].order).toBe(1)
    expect(TEMPLATE_COLUMNS[20].order).toBe(21)
  })

  it('表头行用制表符分隔，行尾为 CRLF（避免粘贴串行）', () => {
    expect(TEMPLATE_SEPARATOR).toBe('\t')
    expect(buildTemplateHeaderLine()).toBe(STANDARD_HEADERS.join('\t'))
    expect(buildTemplateText()).toBe(`${STANDARD_HEADERS.join('\t')}${TEMPLATE_LINE_ENDING}`)
  })

  it('示例行是合成占位数据且列数与模板一致', () => {
    expect(TEMPLATE_SAMPLE_ROW).toHaveLength(TEMPLATE_COLUMNS.length)
    const lines = buildTemplateText(true).split(TEMPLATE_LINE_ENDING)
    expect(lines[0]).toBe(buildTemplateHeaderLine())
    expect(lines[1]?.split(TEMPLATE_SEPARATOR)).toHaveLength(TEMPLATE_COLUMNS.length)
  })
})

describe('模板元信息与校验', () => {
  it('文件名带模板版本，避免模板漂移', () => {
    expect(TEMPLATE_FILE_NAME).toContain(TEMPLATE_VERSION)
    expect(TEMPLATE_FILE_NAME.endsWith(TEMPLATE_FILE_EXTENSION)).toBe(true)
  })

  it('自身模板校验通过：无缺失、无多余、顺序一致', () => {
    const result = checkStandardHeaderRow(STANDARD_HEADERS)
    expect(result.ok).toBe(true)
    expect(result.missingHeaders).toEqual([])
    expect(result.unexpectedHeaders).toEqual([])
    expect(result.misordered).toBe(false)
  })

  it('缺少 offer 状态列会被识别（是否阻断由 REQUIRED_STANDARD_FIELDS 决定）', () => {
    const headers = STANDARD_HEADERS.filter((header) => header !== 'offer状态')
    const result = checkStandardHeaderRow(headers)
    expect(result.missingHeaders).toEqual(['offer状态'])
    expect(result.ok).toBe(false)
  })

  it('顺序错位只提示，仍算表头齐全', () => {
    const swapped = [...STANDARD_HEADERS]
    const [first, second] = [swapped[0], swapped[1]]
    swapped[0] = second
    swapped[1] = first
    const result = checkStandardHeaderRow(swapped)
    expect(result.misordered).toBe(true)
    expect(result.missingHeaders).toEqual([])
    expect(result.unexpectedHeaders).toEqual([])
  })

  it('额外列被列为 unexpected，不阻断导入', () => {
    const result = checkStandardHeaderRow([...STANDARD_HEADERS, '面试轮次'])
    expect(result.unexpectedHeaders).toEqual(['面试轮次'])
    expect(result.missingHeaders).toEqual([])
    expect(result.misordered).toBe(false)
  })
})
