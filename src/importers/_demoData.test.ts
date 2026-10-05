/**
 * 演示数据自检：确认 `_demo/demo-intern-recruitment.tsv` 真的能被本项目的导入链路吃下去。
 *
 * 为什么值得单独测：演示数据是按 `TEMPLATE_COLUMNS` 契约生成的，一旦列序 / 表头漂移，
 * 用户拿到文件后会在**映射页**卡住（甚至看不出为什么「未识别」），
 * 而这一步不该由用户体验来发现。因此这里走真实的
 * `parseDelimitedGrid` + `checkStandardHeaderRow` + `suggestMapping`。
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { suggestMapping } from '../domain/mapping'
import { checkStandardHeaderRow } from '../domain/template'

import { parseDelimitedGrid } from './delimited'
import type { RawGridRow } from './grid'

const DEMO_PATH = '_demo/demo-intern-recruitment.tsv'
/** 演示数据的记录条数（表头之外的行） */
const DEMO_RECORD_COUNT = 50

function readRows(): readonly RawGridRow[] {
  const result = parseDelimitedGrid(readFileSync(DEMO_PATH, 'utf8'), { delimiter: '\t' })
  expect(result.limitViolation).toBeNull()
  expect(result.cancelled).toBe(false)
  return result.grid.rows
}

/** 把一行取成纯文本数组（`RawGridCell` 的值在 `.value` 上，缺失为 null） */
function cellsOf(row: RawGridRow): readonly string[] {
  return row.cells.map((cell) => (cell.value === null ? '' : String(cell.value)))
}

describe('演示数据可被导入链路解析', () => {
  it('制表符分隔解析出的列数与模板一致，且记录条数符合预期', () => {
    const rows = readRows()
    expect(rows.length).toBe(DEMO_RECORD_COUNT + 1) // 表头 + 记录
    for (const row of rows) {
      expect(cellsOf(row).length, '每行列数必须等于 21').toBe(21)
    }
  })

  it('表头与标准模板完全一致（不缺列、不多列、顺序也对）', () => {
    const rows = readRows()
    const check = checkStandardHeaderRow(cellsOf(rows[0]))
    expect(check.ok).toBe(true)
    expect(check.missingHeaders).toEqual([])
    expect(check.unexpectedHeaders).toEqual([])
    expect(check.misordered).toBe(false)
  })

  it('字段自动识别不需要人工兜底：列数与列数一致，且无未确认的自动结论', () => {
    const rows = readRows()
    const plan = suggestMapping(cellsOf(rows[0]))
    expect(plan.columnCount).toBe(21)
    expect(plan.entries.length).toBe(21)
    // 标准模板的表头应当**全部**能自动识别（精确或规范化匹配），否则演示数据就是半成品
    expect(plan.autoMatchedCount).toBe(21)
    // 同一目标字段被多列指向时引擎会标出冲突；演示数据不得有冲突
    const conflictGroups = new Set(
      plan.entries.map((entry) => entry.conflictGroupId).filter((id) => id !== null),
    )
    expect([...conflictGroups]).toEqual([])
  })

  it('offer 状态列被识别到正确的目标字段（它是导入的阻断条件）', () => {
    const rows = readRows()
    const plan = suggestMapping(cellsOf(rows[0]))
    const statusIndex = cellsOf(rows[0]).indexOf('offer状态')
    expect(statusIndex).toBeGreaterThanOrEqual(0)
    expect(plan.entries[statusIndex].targetField).toBe('offerStatus')
    expect(plan.entries[statusIndex].requiresConfirmation).toBe(false)
  })

  it('数据行里同时含已入职 / 待入职 / 审批中 / 拒 offer，看板与专项页都有内容可看', () => {
    const rows = readRows()
    const headers = cellsOf(rows[0])
    const statusIndex = headers.indexOf('offer状态')
    const statuses = rows.slice(1).map((row) => cellsOf(row)[statusIndex])
    for (const expected of ['已入职', '待入职', 'offer审批中', '拒绝offer', '拒绝口头offer']) {
      expect(statuses, `缺少状态：${expected}`).toContain(expected)
    }
    // 拒 offer 里要有「填了原因」与「没填原因」两种，才能演示填写率与未分类提示
    const reasonIndex = headers.indexOf('拒绝原因分类')
    const reasons = rows
      .slice(1)
      .filter((row) => {
        const status = cellsOf(row)[statusIndex]
        return status === '拒绝offer' || status === '拒绝口头offer'
      })
      .map((row) => cellsOf(row)[reasonIndex])
    expect(reasons.some((reason) => reason !== '')).toBe(true)
    expect(reasons.some((reason) => reason === '')).toBe(true)
  })

  it('不含任何真实数据哨兵（AGENTS §2.6：演示数据必须是合成的）', () => {
    const text = readFileSync(DEMO_PATH, 'utf8')
    for (const sentinel of ['张示例', '示例推']) {
      expect(text.includes(sentinel), `演示数据含真实值：${sentinel}`).toBe(false)
    }
  })
})
