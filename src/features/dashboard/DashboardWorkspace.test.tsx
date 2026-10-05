/**
 * 看板渲染冒烟测试（步骤8）。
 *
 * 为什么用 `react-dom/server`：本仓库的组件测试依赖（Testing Library + jsdom）属于步骤14，
 * 但「看板是否真的把引擎数字渲染出来」必须被验证，不能只靠纯函数测试。
 * `renderToStaticMarkup` 只跑**渲染**、不跑 effect，因此既不会加载 ECharts，也不会发任何请求，
 * 正好用来断言：空态分支、KPI 的数字与分母、状态结构 / 趋势 / 明细三张表是否真的出现，
 * 以及 AI 入口是不是禁用占位。
 *
 * 数据全部来自 `domain/analytics/fixtures.ts` 的**合成**夹具（测试专用入口）。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_RULE_VERSION,
  type ImportMapping,
  type NormalizedDataset,
  type RawSheet,
} from '../../domain'
import {
  FIXTURE_DATA_AS_OF,
  FIXTURE_IMPORTED_AT,
  PRD_12_2_RECORDS,
} from '../../domain/analytics/fixtures'
import {
  clearCleaningSettingsDraft,
  clearImportSession,
  commitNormalizedDataset,
  confirmImportMapping,
  setImportSheet,
} from '../../storage/sessionStore'
import { AI_DISABLED_NOTE } from '../ai/aiText'

import DashboardWorkspace from './DashboardWorkspace'

const DATASET_COUNTS = {
  rawRowCount: 7,
  emptyRowCount: 1,
  keptRowCount: 6,
  removedDuplicateCount: 0,
  issueRowCount: 0,
  distinctRequirementCount: 6,
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

/** 合成已确认映射（字段映射页的产物；看板只判断「是否已确认」，不重新解析列） */
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

/** 由 PRD 12.2 合成验收集构造一份完整数据集（N=6 / J=2 / P=1 / A=1 / R=2 / D=5） */
function buildDataset(): NormalizedDataset {
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
        confirmedAt: FIXTURE_IMPORTED_AT,
      },
      counts: DATASET_COUNTS,
      disabledModules: [],
      notes: [],
    },
    records: PRD_12_2_RECORDS,
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

/** 渲染成纯文本（去掉 React 在相邻文本节点之间插入的注释标记，便于断言整句文案） */
function renderDashboardText(): string {
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <DashboardWorkspace />
    </MemoryRouter>,
  )
  return html.replace(/<!--.*?-->/g, '')
}

beforeEach(() => {
  clearImportSession()
  clearCleaningSettingsDraft()
})

describe('DashboardWorkspace 空态', () => {
  it('没有任何数据时说明「还没有可分析的记录」，不显示示例数字', () => {
    const text = renderDashboardText()

    expect(text).toContain('还没有可分析的记录')
    expect(text).toContain('先去导入数据')
    // 空态下不得出现任何 KPI 卡片标题（避免「空白图表 + 0 值」掩盖状态）
    expect(text).not.toContain('总 offer 记录数（含审批中）')
  })

  it('已导入但未确认映射时指回映射页', () => {
    setImportSheet(RAW_SHEET)

    const text = renderDashboardText()

    expect(text).toContain('字段映射尚未确认')
    expect(text).toContain('先去确认字段映射')
  })

  it('确认映射但未提交清洗结果时指回清洗页', () => {
    setImportSheet(RAW_SHEET)
    confirmImportMapping(CONFIRMED_MAPPING)

    const text = renderDashboardText()

    expect(text).toContain('还没有已提交的清洗结果')
    expect(text).toContain('去清洗预览并提交')
  })
})

describe('DashboardWorkspace 渲染引擎结果', () => {
  beforeEach(() => {
    commitNormalizedDataset(buildDataset())
  })

  it('渲染核心卡片与全部率的分母', () => {
    const text = renderDashboardText()

    expect(text).toContain('总 offer 记录数（含审批中）')
    expect(text).toContain('核心分母 D')
    expect(text).toContain('接受率 (J+P)/D（接受 ≠ 实际入职）')
    // PRD 12.2 验收集：接受率 3/5 = 60%，拒 offer 率 2/5 = 40%，审批中占比 1/6 ≈ 16.67%
    expect(text).toContain('分子 3 ÷ 分母 5')
    expect(text).toContain('60.00%')
    expect(text).toContain('40.00%')
    expect(text).toContain('16.67%')
  })

  it('状态结构表保留「其他」与「未知」两行，并给出数据边界说明', () => {
    const text = renderDashboardText()

    expect(text).toContain('状态结构（分母 = N）')
    expect(text).toContain('其他')
    expect(text).toContain('未知')
    expect(text).toContain('不呈现全链路漏斗')
  })

  it('趋势表按合法日期分月，并写明不是「发 offer 趋势」', () => {
    const text = renderDashboardText()

    expect(text).toContain('时间趋势（启动招聘日期）')
    expect(text).toContain('2026-01')
    expect(text).toContain('2026-02')
    expect(text).toContain('2026-03')
    expect(text).toContain('不能')
    expect(text).toContain('发 offer 趋势')
  })

  it('明细表默认用候选人 ID，且不出现姓名列', () => {
    const text = renderDashboardText()

    expect(text).toContain('记录明细（当前筛选后 6 条）')
    expect(text).toContain('SYN-0001')
    expect(text).toContain('候选人 ID')
    expect(text).not.toContain('候选人姓名')
  })

  it('右上角 AI 入口可点，但只展开本地预览并说明不发起请求', () => {
    const text = renderDashboardText()

    expect(text).toContain('AI 深度分析（本地脱敏预览）')
    /*
     * AI-3 起入口按开关状态给不同说明：
     * - 关闭（默认）时给 `AI_DISABLED_NOTE`——本地功能不受影响、去设置页打开；
     * - 开启时才给 `AI_ENTRY_NOTE`——点击只生成本地预览、不发请求。
     * 本用例跑在默认状态（关闭）下，因此这里断言关闭说明；开启态的说明由
     * `AiAnalysisWorkspace` 的渲染测试覆盖。
     */
    expect(text).toContain('AI 已关闭（默认）')
    expect(text).toContain(AI_DISABLED_NOTE)
    // AI-1 起入口不再是禁用占位：它只切换预览面板的显示，开关本身不发请求
    expect(text).not.toContain('AI 深度分析（后续步骤接入）')
    expect(text).toContain('aria-expanded="false"')
  })

  it('顶部快照栏展示数据集、去重策略、截至日与规则版本', () => {
    const text = renderDashboardText()

    expect(text).toContain('数据与口径快照')
    expect(text).toContain('合成数据集')
    expect(text).toContain('确认后每组保留首条')
    expect(text).toContain(FIXTURE_DATA_AS_OF)
    expect(text).toContain(CURRENT_RULE_VERSION.rulesVersion)
    expect(text).toContain('当前生效筛选')
    expect(text).toContain('未启用任何筛选：以下所有指标为全量口径。')
  })
})
