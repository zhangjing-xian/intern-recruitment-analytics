// @vitest-environment jsdom
/**
 * 报告导出闸门的**真实 DOM 交互**测试（2026-09-27 修复导出死锁时新增）。
 *
 * ## 为什么要单独写这一组
 *
 * 原实现里 `canExport = checkPassed && preview !== null && confirmedFingerprint === fingerprint`，
 * 而 `confirmedFingerprint` **唯一**被写成非空的地方在四个导出按钮自己的 `onClick` 里——
 * 那四个按钮偏偏是 `disabled={!canExport}`。于是形成死锁：
 * 不点导出按钮就无法确认，不确认就点不了导出按钮，**导出功能永远不可用**。
 *
 * 步骤11 的验证是 `react-dom/server` 渲染冒烟（只断言文案与禁用态字符串），
 * 步骤14 的端到端也没有点过这个闸门，所以它一路活到了人工验收：
 * 用户看到的页面一边写「检查通过」，一边写「检查未通过：导出按钮保持禁用」。
 *
 * 这一组用例按用户的真实动作走一遍状态机：
 * 未生成预览（禁用）→ 生成并查看预览（可用）→ 改脱敏级别（预览作废、回到禁用）→ 重新生成（又可用）。
 * 同时断言**页面上的说法与事实一致**：检查通过时绝不出现「检查未通过」。
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_RULE_VERSION,
  type ImportMapping,
  type NormalizedDataset,
  type NormalizedRecord,
  type RawSheet,
} from '../../domain'
import {
  FIXTURE_DATA_AS_OF,
  FIXTURE_IMPORTED_AT,
  syntheticRecords,
} from '../../domain/analytics/fixtures'
import {
  clearCleaningSettingsDraft,
  clearImportSession,
  commitNormalizedDataset,
  confirmImportMapping,
  setImportSheet,
} from '../../storage/sessionStore'

import ExportWorkspace from './ExportWorkspace'
import { CHECK_BLOCKED_TITLE_AND_ADVICE, GATE_STALE_NOTE, SECTION_TITLES } from './exportText'
import * as exportText from './exportText'

afterEach(cleanup)

const COUNTS = {
  rawRowCount: 5,
  emptyRowCount: 0,
  keptRowCount: 5,
  removedDuplicateCount: 0,
  issueRowCount: 0,
  distinctRequirementCount: 5,
} as const

const RAW_SHEET: RawSheet = {
  sourceKind: 'csv',
  sourceSheet: '合成表',
  sourceFileName: 'synthetic.csv',
  header: {
    sourceKind: 'csv',
    sourceSheet: '合成表',
    sourceRow: 1,
    headers: ['状态'],
    hidden: false,
  },
  rows: [
    {
      sourceKind: 'csv',
      sourceSheet: '合成表',
      sourceRow: 2,
      cells: ['已入职'],
      emptyRow: false,
      hidden: false,
      parseNotes: [],
    },
  ],
  physicalRowCount: 2,
  columnCount: 1,
  emptyRowCount: 0,
  hiddenRowCount: 0,
  hiddenColumnIndexes: [],
  sheetHidden: false,
  formulaWithoutCacheCount: 0,
  skippedSheets: [],
  issues: [],
  date1904: null,
  encoding: 'utf-8',
  delimiter: ',',
}

const CONFIRMED_MAPPING: ImportMapping = {
  templateVersion: CURRENT_RULE_VERSION.templateVersion,
  templateName: null,
  sourceHeaderSignature: '状态',
  entries: [],
  merges: [],
  missingRequiredFields: [],
  ignoredColumns: [],
  confirmedAt: FIXTURE_IMPORTED_AT,
}

/** 5 条合成记录：覆盖入职 / 拒绝 / 待入职 / 审批中，够引擎与结论层跑起来 */
const RECORDS: readonly NormalizedRecord[] = syntheticRecords([
  { offerStatus: '已入职', city: '上海', requirementId: 'REQ-A-001' },
  { offerStatus: '已入职', city: '上海', requirementId: 'REQ-A-002' },
  { offerStatus: '拒绝offer', city: '广州', requirementId: 'REQ-A-003' },
  { offerStatus: '待入职', city: '广州', requirementId: 'REQ-A-004' },
  { offerStatus: 'offer审批中', city: '杭州', requirementId: 'REQ-A-005' },
])

function buildDataset(): NormalizedDataset {
  return {
    metadata: {
      datasetId: 'SYN-GATE',
      datasetName: '合成闸门数据集',
      batchId: 'SYN-GATE-BATCH',
      ruleVersion: CURRENT_RULE_VERSION,
      sourceKind: 'csv',
      sourceFileName: 'synthetic.csv',
      sourceSheet: '合成表',
      headerRowIndex: 1,
      encoding: 'utf-8',
      importedAt: FIXTURE_IMPORTED_AT,
      dataAsOf: FIXTURE_DATA_AS_OF,
      importMode: '新建快照',
      dedupStrategy: '确认后每组保留首条',
      salary: {
        option: '人民币元/月',
        currency: 'CNY',
        salaryUnit: '元/月',
        comparable: true,
        confirmedAt: FIXTURE_DATA_AS_OF,
      },
      counts: COUNTS,
      disabledModules: [],
      notes: [],
    },
    records: RECORDS,
    report: {
      counts: COUNTS,
      issues: [],
      issueCountsByCode: {},
      issueCountsBySeverity: { 阻断: 0, 字段错误: 0, 警告: 0 },
      exactDuplicateGroups: [],
      suspectedDuplicateGroups: [],
      duplicateRowCount: 0,
      ambiguousDateCount: 0,
      ambiguousDateSamples: [],
      cycleTooLongCount: 0,
      negativeCycleCount: 0,
      headerEchoRowCount: 0,
      droppedRowCount: 0,
      hiddenRowExcludedCount: 0,
      metricAvailability: [],
      decisionLog: [],
      notes: [],
    },
  }
}

function seedSession(): void {
  clearImportSession()
  clearCleaningSettingsDraft()
  setImportSheet(RAW_SHEET)
  confirmImportMapping(CONFIRMED_MAPPING)
  commitNormalizedDataset(buildDataset())
}

function renderPage(): void {
  render(
    <MemoryRouter>
      <ExportWorkspace />
    </MemoryRouter>,
  )
}

/** 四个导出按钮（用 exportText 的标签定位，避免与页面文案漂移） */
function exportButtons(): readonly HTMLElement[] {
  /*
   * 三条定位纪律：
   * 1. 按钮的无障碍名称是「标签 + 说明文字」，因此必须用正则匹配（精确相等找不到）；
   * 2. 正则必须以 `^` 锚定在开头：`xlsx` 的说明里也写着「打印 / 另存为 PDF」，
   *    不锚定会同时命中两个按钮（这正是第一次写这条用例时踩到的坑）；
   * 3. 只在「导出」这一节里找，避免命中页面别处的同名说法。
   */
  const patternOf = (label: string): RegExp =>
    new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
  const actions = screen.getByText(SECTION_TITLES.actions).closest('section')
  if (actions === null) {
    throw new Error('找不到「导出」这一节')
  }
  const scoped = within(actions)
  return [
    exportText.EXPORT_LABELS.xlsx,
    exportText.EXPORT_LABELS.png,
    exportText.EXPORT_LABELS.pdf,
    exportText.EXPORT_LABELS.markdown,
  ].map((label) => scoped.getByRole('button', { name: patternOf(label) }))
}

function allDisabled(): boolean {
  return exportButtons().every((button) => (button as HTMLButtonElement).disabled)
}

function allEnabled(): boolean {
  return exportButtons().every((button) => !(button as HTMLButtonElement).disabled)
}

beforeEach(seedSession)

describe('报告导出闸门：先看预览才能导出（回归：曾经的死锁）', () => {
  it('生成并查看预览之后，四个导出按钮必须真的可用', async () => {
    const user = userEvent.setup()
    renderPage()

    // 1）还没生成预览：四个按钮都禁用，并说明要先看预览
    expect(allDisabled(), '预览前导出按钮必须是禁用的').toBe(true)
    const gates = screen.getByText(new RegExp(SECTION_TITLES.gates)).closest('section')
    expect(gates).not.toBeNull()
    expect(within(gates as HTMLElement).getByText(exportText.GATE_LOCKED_NOTE)).toBeTruthy()

    // 2）点「生成并查看预览」→ 按钮可用（这一条就是原死锁的回归断言）
    await user.click(screen.getByRole('button', { name: exportText.OPEN_PREVIEW_LABEL }))
    expect(allEnabled(), '看过预览之后导出按钮必须可用').toBe(true)
    expect(within(gates as HTMLElement).getByText(exportText.GATE_OPENED_NOTE)).toBeTruthy()

    // 3）检查确实通过，且页面上**没有**「检查未通过」这种与事实矛盾的说法
    expect(screen.getByText(exportText.CHECK_PASSED)).toBeTruthy()
    expect(screen.queryByText(CHECK_BLOCKED_TITLE_AND_ADVICE)).toBeNull()
  })

  it('改脱敏级别后预览立即作废：按钮回到禁用，且不会说成「检查未通过」', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: exportText.OPEN_PREVIEW_LABEL }))
    expect(allEnabled()).toBe(true)

    // 切到「严格」：旧预览立即撤销（PRD 18.5），必须重新生成
    await user.click(screen.getByRole('button', { name: /严格（strict）/ }))
    expect(allDisabled(), '改级别后必须重新看预览').toBe(true)
    // 改级别会把预览整个丢掉，因此这里应当说「先看预览」，而不是「检查未通过」
    // （这句话在闸门区和导出区各出现一次，所以用 getAllByText）
    expect(screen.getAllByText(exportText.GATE_LOCKED_NOTE).length).toBeGreaterThan(0)
    expect(screen.queryByText(CHECK_BLOCKED_TITLE_AND_ADVICE)).toBeNull()

    // 重新生成 → 又可用
    // 注意：改级别会把预览置空，因此按钮文案回到「生成并查看预览」（不是「重新生成预览」）
    await user.click(screen.getByRole('button', { name: exportText.OPEN_PREVIEW_LABEL }))
    expect(allEnabled(), '重新生成预览后必须再次可用').toBe(true)
  })

  it('改筛选后预览只是「过期」：提示说的是「预览已作废」，并给出重新生成的下一步', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: exportText.OPEN_PREVIEW_LABEL }))
    expect(allEnabled()).toBe(true)

    // 点一个城市筛选：预览对象还在，但它的指纹与当前筛选不再相等 → 过期
    await user.click(screen.getByRole('button', { name: /^上海/ }))
    expect(allDisabled(), '筛选变化后必须重新看预览').toBe(true)
    expect(screen.getByText(GATE_STALE_NOTE)).toBeTruthy()
    // 检查结果是旧预览的，因此**不能**说成「检查未通过」（这是修复前的原话）
    expect(screen.queryByText(CHECK_BLOCKED_TITLE_AND_ADVICE)).toBeNull()
  })
})
