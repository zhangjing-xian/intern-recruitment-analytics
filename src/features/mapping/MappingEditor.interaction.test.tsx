// @vitest-environment jsdom
/**
 * 字段映射页的**真实 DOM 交互**测试（步骤14，覆盖 A02 与 A03）。
 *
 * ## 这一组补的是什么
 *
 * 步骤4 的交付状态里如实写着「下拉改写 / 冲突按钮 / 模板保存等**交互**未在真实浏览器内操作验证」，
 * 当时只有纯函数测试与静态渲染。这里用 jsdom + Testing Library 把三条最要紧的规则点成行为：
 *
 * 1. **缺 offer 状态列必须阻断**（不能靠「看起来识别得不错」就放行）；
 * 2. **别名建议必须逐列确认**——列出的阻断原因里能读到它，未确认时提交按钮是禁用的；
 * 3. **确认后才写入会话**：点「确认字段映射」→ 会话里出现已确认映射，页面给出进入清洗的入口。
 *
 * 数据全部是合成表头（AGENTS.md §2.6）；会话是内存会话，测试之间用 `beforeEach` 清干净。
 */

import { MemoryRouter } from 'react-router-dom'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { STANDARD_HEADERS } from '../../domain'
import {
  clearImportSession,
  getImportSession,
  setImportSheet,
} from '../../storage/sessionStore'
import type { RawCellValue, RawRow, RawSheet } from '../../domain'

import MappingEditor from './MappingEditor'

/** 合成原始表：只给表头与一行数据，够映射层用 */
function buildSheet(headers: readonly string[]): RawSheet {
  const cells: readonly RawCellValue[] = headers.map((_, index) => `合成-${String(index + 1)}`)
  const row: RawRow = {
    sourceKind: 'csv',
    sourceSheet: '合成表',
    sourceRow: 2,
    cells,
    emptyRow: false,
    hidden: false,
    parseNotes: [],
  }
  return {
    source: { kind: 'paste', label: '合成粘贴内容' },
    sheetName: '合成表',
    header: { rowIndex: 1, headers },
    rows: [row],
    hiddenColumns: [],
    hiddenRows: [],
    issues: [],
  } as unknown as RawSheet
}

function renderEditor(headers: readonly string[]): void {
  render(
    <MemoryRouter>
      <MappingEditor initialDraft={null} initialMapping={null} sheet={buildSheet(headers)} />
    </MemoryRouter>,
  )
}

/** 提交按钮：文案固定，禁用态表示「还不能提交」 */
function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: '确认字段映射' }) as HTMLButtonElement
}

/** 「还不能提交的原因」这一节里的条目 */
function blockingReasons(): readonly string[] {
  const heading = screen.queryByText('还不能提交的原因')
  if (heading === null) {
    return []
  }
  const section = heading.closest('section')
  if (section === null) {
    return []
  }
  return [...section.querySelectorAll('li')].map((item) => item.textContent ?? '')
}

beforeEach(() => {
  clearImportSession()
})

afterEach(() => {
  cleanup()
  clearImportSession()
})

describe('步骤14：字段映射的阻断与确认（A02 / A03）', () => {
  it('缺 offer 状态列 → 阻断提交，并逐条说明原因', () => {
    // 故意去掉 required 的「offer状态」列
    const headers = STANDARD_HEADERS.filter((header) => header !== 'offer状态')
    renderEditor(headers)

    expect(submitButton().disabled).toBe(true)
    const reasons = blockingReasons()
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.join('\n')).toContain('offer状态')
    // 阻断原因必须说清「为什么」，而不是只把按钮灰掉
    expect(reasons.join('\n')).toMatch(/阻断|必填|缺失/)
  })

  it('别名命中只是建议：未逐列确认时不能提交，确认后才可以', async () => {
    const user = userEvent.setup()
    // 把 offer状态 换成它的别名「offer进度」：命中别名 → 必须由用户确认
    const headers = STANDARD_HEADERS.map((header) =>
      header === 'offer状态' ? 'offer进度' : header,
    )
    renderEditor(headers)

    // 1) 引擎阻断，并如实说明「还有几列是别名 / 模糊建议」
    expect(submitButton().disabled).toBe(true)
    const reasons = blockingReasons().join('\n')
    expect(reasons).toMatch(/别名 \/ 模糊建议/)
    expect(reasons).toMatch(/逐列确认/)

    // 2) 界面要让人知道**是哪一列**：该行打着「别名建议」标记
    expect(screen.getByText('别名建议')).toBeTruthy()
    expect(screen.getByText('offer进度')).toBeTruthy()

    // 3) 逐列确认（表里那一行的「确认」勾选框）
    const confirmBoxes = screen.getAllByRole('checkbox')
    expect(confirmBoxes.length).toBeGreaterThan(0)
    await user.click(confirmBoxes[0] as HTMLElement)

    // 4) 确认之后提交按钮变为可用，点它才会写入会话
    expect(submitButton().disabled).toBe(false)
    await user.click(submitButton())
    expect(screen.getByRole('link', { name: '下一步：清洗预览' })).toBeTruthy()
  })

  it('标准 21 列表头：精确命中无需逐列确认，且确认后写入会话', async () => {
    const user = userEvent.setup()
    renderEditor(STANDARD_HEADERS)

    // 精确匹配不需要人工确认 → 可以直接提交
    expect(submitButton().disabled).toBe(false)
    expect(blockingReasons()).toEqual([])

    await user.click(submitButton())

    // 会话里出现已确认映射，并给出进入清洗的入口
    expect(getImportSession().confirmedMapping).not.toBeNull()
    expect(screen.getByRole('link', { name: '下一步：清洗预览' })).toBeTruthy()
  })

  it('未确认映射时不会进入清洗：页面明确写出这句话', () => {
    const headers = STANDARD_HEADERS.filter((header) => header !== 'offer状态')
    renderEditor(headers)

    expect(screen.getByText(/未确认时不会进入清洗/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: '下一步：清洗预览' })).toBeNull()
    expect(getImportSession().confirmedMapping).toBeNull()
  })
})

describe('步骤14：导入页空态与映射页的衔接', () => {
  it('会话里放了表之后，映射页不再显示空态', () => {
    setImportSheet(buildSheet(STANDARD_HEADERS))
    renderEditor(STANDARD_HEADERS)
    // 空态文案「还没有可映射的表头」不应出现（表已在会话里）
    expect(screen.queryByText('还没有可映射的表头')).toBeNull()
  })
})
