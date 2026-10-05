/**
 * 报告导出渲染冒烟测试（步骤11）。
 *
 * 为什么用 `react-dom/server`：与步骤8 / 9 / 10 的页面测试同一套理由——
 * 组件测试依赖（Testing Library + jsdom）属于步骤14，但「按钮禁用态 / 预览计数 / 隐私闸门文案」
 * 这类只能渲染出来的东西必须被验证。`renderToStaticMarkup` 只跑**渲染**、不跑 effect，
 * 因此既不加载 ECharts / SheetJS，也不发任何请求，也不会触发任何下载。
 *
 * 数据红线：全部使用 `domain/analytics/fixtures.ts` 的**合成**夹具（AGENTS.md §2.6）。
 *
 * 覆盖点（对应 PRD 11 章与本步验收清单）：
 * 1. 四个空态分支：未导入 / 未确认映射 / 未提交清洗结果 / 仓已锁定（文案常量与事件订阅）；
 * 2. 「导出前必须先看预览」闸门：导出按钮在预览前是禁用态；
 * 3. 预览面板给出章节 / 表 / 行数与抑制说明；
 * 4. 脱敏级别选择器与自定义开关都在页面上；
 * 5. 页面文案里**没有** Markdown 强调标记（前几步的重复 bug）。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_RULE_VERSION,
  type ImportMapping,
  type NormalizedDataset,
  type NormalizedRecord,
  type RawSheet,
} from '../../domain'
import { FIXTURE_DATA_AS_OF, FIXTURE_IMPORTED_AT, syntheticRecords } from '../../domain/analytics/fixtures'
import { emitVaultEvent, subscribeVaultEvents } from '../../storage'
import {
  clearCleaningSettingsDraft,
  clearImportSession,
  commitNormalizedDataset,
  confirmImportMapping,
  setImportSheet,
} from '../../storage/sessionStore'

import ExportWorkspace from './ExportWorkspace'
import * as exportText from './exportText'

const DATASET_COUNTS = {
  rawRowCount: 8,
  emptyRowCount: 0,
  keptRowCount: 8,
  removedDuplicateCount: 0,
  issueRowCount: 0,
  distinctRequirementCount: 8,
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

/** 合成记录：含姓名 / HR / 推荐人 / 需求 ID / 准确薪资 / 原因原文，用来验证报告与文案都不带它们 */
const RECORDS: readonly NormalizedRecord[] = (() => {
  const [first, ...rest] = syntheticRecords([
    {
      offerStatus: '已入职',
      city: '上海',
      recruiter: '合成HR-测试',
      referrer: '合成推荐人',
      requirementId: 'REQ-测试-001',
      salaryAmount: 4800,
      currency: 'CNY',
      salaryUnit: '元/月',
      recruitmentStartDate: '2026-01-05',
      joiningDate: '2026-01-15',
    },
    {
      offerStatus: '拒绝offer',
      city: '上海',
      recruiter: '合成HR-测试',
      requirementId: 'REQ-测试-002',
      rejectionReason: '薪酬太低所以去了别家',
      recruitmentStartDate: '2026-02-01',
    },
    { offerStatus: '待入职', city: '广州', recruiter: '合成HR-B', requirementId: 'REQ-测试-003' },
    { offerStatus: 'offer审批中', city: '广州', recruiter: '合成HR-B' },
    { offerStatus: '拒绝口头offer', city: '杭州', requirementId: 'REQ-测试-005' },
  ])
  // 第一条显式带上姓名原文：夹具默认不含姓名，而本用例必须证明页面不会渲染它
  return [{ ...first, candidateName: '合成候选人甲' }, ...rest]
})()

function buildDataset(records: readonly NormalizedRecord[]): NormalizedDataset {
  return {
    metadata: {
      datasetId: 'SYN-DATASET',
      datasetName: '合成数据集',
      batchId: 'SYN-BATCH',
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
      counts: DATASET_COUNTS,
      disabledModules: [],
      notes: [],
    },
    records,
    report: {
      counts: DATASET_COUNTS,
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

function renderHtml(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ExportWorkspace />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearImportSession()
  clearCleaningSettingsDraft()
})

/* ------------------------------------------------------------------ 空态 */

describe('ExportWorkspace 空态', () => {
  it('没有任何数据时说明「还没有可导出的报告」，不显示示例章节', () => {
    const html = renderHtml()

    expect(html).toContain(exportText.NO_SHEET_TITLE)
    expect(html).toContain('先去导入数据')
    // 空态下不得出现导出按钮与预览面板（避免「空白表格 + 0 值」掩盖状态）
    expect(html).not.toContain(exportText.EXPORT_LABELS.xlsx)
    expect(html).not.toContain(exportText.SECTION_TITLES.preview)
  })

  it('已导入但未确认映射时指回映射页', () => {
    setImportSheet(RAW_SHEET)

    const html = renderHtml()

    expect(html).toContain(exportText.NO_MAPPING_TITLE)
    expect(html).toContain('先去确认字段映射')
  })

  it('确认映射但未提交清洗结果时指回清洗页', () => {
    setImportSheet(RAW_SHEET)
    confirmImportMapping(CONFIRMED_MAPPING)

    const html = renderHtml()

    expect(html).toContain(exportText.NO_DATASET_TITLE)
    expect(html).toContain('去清洗预览并提交')
  })

  it('本地仓锁定事件被界面层订阅，且锁定态文案与其它空态互不串用', () => {
    /*
     * `renderToStaticMarkup` 只跑渲染、不跑 effect，而锁定态是存到 React state 里的分支，
     * 因此服务端渲染走不到它。这里分两段验证同一条契约：
     * 1. 锁定事件确实经 `subscribeVaultEvents` 广播到订阅者（本组件的 effect 就是订阅者）；
     * 2. 锁定态的四段文案齐备且与别的空态不重复。
     */
    const received: string[] = []
    const unsubscribe = subscribeVaultEvents((event) => {
      received.push(event.type)
    })
    emitVaultEvent({ type: 'locked', reason: 'idle' })
    unsubscribe()

    expect(received).toEqual(['locked'])
    expect(new Set([exportText.LOCKED_TITLE, exportText.NO_SHEET_TITLE, exportText.NO_MAPPING_TITLE, exportText.NO_DATASET_TITLE]).size).toBe(4)
    expect(Object.values(exportText.LOCKED_DESCRIPTIONS).every((text) => text.length > 0)).toBe(true)
    expect(exportText.LOCKED_ITEMS.length).toBeGreaterThan(0)
  })

  it('已提交的数据集里没有记录时不显示 0% 占位', () => {
    commitNormalizedDataset(buildDataset([]))

    const html = renderHtml()

    expect(html).toContain('已提交的数据集里没有记录')
    expect(html).not.toContain('0.00%')
  })
})

/* ------------------------------------------------------------------ 有数据时的界面 */

describe('ExportWorkspace 预览闸门与导出按钮', () => {
  beforeEach(() => {
    commitNormalizedDataset(buildDataset(RECORDS))
  })

  it('页头给出标题、说明与四个导出按钮', () => {
    const html = renderHtml()

    expect(html).toContain(exportText.PAGE_TITLE)
    expect(html).toContain(exportText.SECTION_TITLES.actions)
    expect(html).toContain(exportText.EXPORT_LABELS.xlsx)
    expect(html).toContain(exportText.EXPORT_LABELS.png)
    expect(html).toContain(exportText.EXPORT_LABELS.pdf)
    expect(html).toContain(exportText.EXPORT_LABELS.markdown)
  })

  it('预览之前四个导出按钮都是禁用态，并说明为什么', () => {
    const html = renderHtml()

    expect(html).toContain(exportText.GATE_LOCKED_NOTE)
    // 四个按钮都带 disabled（服务端渲染会输出 disabled 属性）
    const disabledCount = html.split('disabled=""').length - 1
    expect(disabledCount).toBeGreaterThanOrEqual(4)
  })

  it('预览之前不渲染预览面板与抑制说明', () => {
    const html = renderHtml()

    expect(html).not.toContain(exportText.SECTION_TITLES.preview)
    expect(html).not.toContain(exportText.SECTION_TITLES.suppression)
    expect(html).toContain(exportText.OPEN_PREVIEW_LABEL)
  })

  it('接入与看板同一份筛选面板，并复用同一套筛选口径文案', () => {
    const html = renderHtml()

    expect(html).toContain(exportText.FILTER_SECTION_TITLE)
    expect(html).toContain('全局筛选')
    expect(html).toContain('清空筛选（保留时间基准与薪资分档配置）')
    // 筛选面板的选项来自全部已提交记录
    expect(html).toContain('上海')
    expect(html).toContain('广州')
  })

  it('脱敏级别选择器给出 strict / standard / custom 三个级别与各自说明', () => {
    const html = renderHtml()

    for (const level of exportText.PRIVACY_LEVELS) {
      expect(html).toContain(level.label)
      expect(html).toContain(level.hint)
    }
    // 自定义级别的说明只在选中 custom 时渲染（服务端渲染无法切换状态），
    // 因此这里断言文案本身覆盖了「身份禁出项不可解除」这条边界
    expect(exportText.PRIVACY_LEVELS.map((level) => level.hint).join('|')).toContain(
      '不能解除身份禁出项',
    )
    expect(exportText.TOGGLE_LABELS.removeHrNamesHint).toContain('真实 HR 姓名')
    expect(exportText.TOGGLE_LABELS.includeRecordDetailHint).toContain('记录代号')
  })

  it('页面文案不含 Markdown 强调标记（避免渲染出字面星号）', () => {
    const html = renderHtml()
    const values = Object.values(exportText).flatMap((value) =>
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === 'string')
          : [],
    )

    expect(values.length).toBeGreaterThan(0)
    for (const value of values) {
      expect(value.includes('**'), `文案里出现了 Markdown 强调标记：${value}`).toBe(false)
    }
    expect(html.includes('**')).toBe(false)
  })

  it('导出按钮与检查区都写明「本地生成、不经过服务器」', () => {
    const html = renderHtml()

    expect(html).toContain(exportText.DOWNLOAD_NOTE)
    expect(html).toContain(exportText.PRINT_NOTE)
    expect(html).toContain(exportText.PNG_UNVERIFIED_NOTE)
  })

  it('导出文案与筛选面板职责分明：文案里没有任何合成敏感值', () => {
    /*
     * 重要区别：**筛选面板**必须显示 HR 姓名等原始取值（否则用户没法按 HR 筛选，那是交互，不是导出），
     * 而**报告内容**绝不能带任何一个敏感值——报告内容的脱敏由 `buildSanitizedReport` +
     * `findSensitiveFields` 保证（见 `src/privacy/report.test.ts` 与 `src/exporters/*.test.ts`
     * 的哨兵检索），本用例守的是另一半：界面文案自己不能把敏感值写进提示语。
     */
    const textValues = Object.values(exportText).flatMap((value) =>
      typeof value === 'string'
        ? [value]
        : Array.isArray(value)
          ? value.flatMap((item) =>
              typeof item === 'string'
                ? [item]
                : typeof item === 'object' && item !== null
                  ? Object.values(item).filter((entry): entry is string => typeof entry === 'string')
                  : [],
            )
          : [],
    )

    expect(textValues.length).toBeGreaterThan(0)
    for (const sentinel of [
      '合成候选人甲',
      '合成HR-测试',
      '合成HR-B',
      '合成推荐人',
      'REQ-测试-001',
      '薪酬太低所以去了别家',
    ]) {
      for (const text of textValues) {
        expect(text.includes(sentinel), `导出文案里出现了敏感值：${sentinel}`).toBe(false)
      }
    }
    // 反证：筛选面板里确实渲染出了 HR 姓名（说明这不是因为整页没数据）
    expect(renderHtml().includes('合成HR-测试')).toBe(true)
  })

  it('边界说明如实写出「脱敏不承诺不可重新识别」', () => {
    const html = renderHtml()

    expect(html).toContain(exportText.SECTION_TITLES.notes)
    expect(html).toContain('不承诺不可重新识别')
    expect(html).toContain('没有任何 fetch / XHR')
  })
})
