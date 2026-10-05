/**
 * 拒 offer 专项渲染冒烟测试（步骤10）。
 *
 * 为什么用 `react-dom/server`：与步骤8 的看板测试、步骤9 的分维度测试同一套理由——
 * 组件测试依赖（Testing Library + jsdom）属于步骤14，但「结论层与引擎的数字是否真的被渲染出来」
 * 必须被验证，不能只靠纯函数测试。`renderToStaticMarkup` 只跑**渲染**、不跑 effect，
 * 因此既不加载 ECharts，也不发任何请求。
 *
 * 数据红线：全部使用 `domain/analytics/fixtures.ts` 的**合成**夹具及其合成派生（AGENTS.md §2.6），
 * 不含任何真实候选人、HR、薪资、拒绝原因或文件名。
 *
 * 覆盖点（对应 PRD 9 章与本次任务的验收清单）：
 * 1. 四个空态分支：未导入 / 未确认映射 / 未提交清洗结果 / 仓已锁定；
 * 2. 两组口径卡片给出 N/J/P/A/R/D 与「分子 ÷ 分母」，并说清 D 含待入职；
 * 3. 对比口径说明明确写出「待入职与审批中不参与组间比较」；
 * 4. 原因分布列出全部类别；原因全缺失时填写率为 **0%** 且不造任何原因；
 * 5. 关注标签给出规则 ID、版本、未知条件与建议核查事项；
 * 6. 免责声明出现在页面上；
 * 7. 该页没有自己的筛选快照，因此**不得**出现下钻按钮（避免动到看板的筛选读数）。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  CURRENT_RULE_VERSION,
  REJECTION_REASON_CATEGORIES,
  REJECTION_RULE_VERSION,
  UNFILLED_REASON_LABEL,
  type ImportMapping,
  type NormalizedDataset,
  type NormalizedRecord,
  type RawSheet,
} from '../../domain'
import {
  FIXTURE_DATA_AS_OF,
  FIXTURE_IMPORTED_AT,
  PRD_12_2_RECORDS,
  syntheticRecord,
  syntheticRecords,
} from '../../domain/analytics/fixtures'
import { emitVaultEvent, subscribeVaultEvents } from '../../storage'
import { RETURN_TO_ALL_LABEL } from '../dashboard/dashboardText'
import { DRILLDOWN_LABEL } from '../dimensions/analysisText'
import {
  clearCleaningSettingsDraft,
  clearImportSession,
  commitNormalizedDataset,
  confirmImportMapping,
  setImportSheet,
} from '../../storage/sessionStore'

import RejectionWorkspace from './RejectionWorkspace'
import {
  DISCLAIMER_LABEL,
  LOCKED_DESCRIPTIONS,
  LOCKED_ITEMS,
  LOCKED_TITLE,
  NO_DATASET_RECORDS_NOTE,
  NO_DATASET_TITLE,
  NO_MAPPING_TITLE,
  NO_MATCHED_RECORDS_NOTE,
  NO_SHEET_TITLE,
  PAGE_TITLE,
  REASONS_EMPTY_NOTE,
  REASONS_NO_REASON_NOTE,
} from './rejectionText'

/* ------------------------------------------------------------------ 会话夹具 */

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

/** 合成已确认映射（拒 offer 专项只判断「是否已确认」，不重新解析列） */
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

/**
 * 由 PRD 12.2 合成验收集构造数据集。
 * 口径：N=6 / J=2 / P=1 / A=1 / R=2 / D=5，整体拒 offer 率 2÷5 = 40%；
 * 拒 offer 组 2 条（1 条已填「薪酬」、1 条未填写），入职组 2 条，两组比较人群 4 条。
 */
function buildDataset(records: readonly NormalizedRecord[] = PRD_12_2_RECORDS): NormalizedDataset {
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

/**
 * 原因全缺失的合成变体：两条拒 offer 记录都把原因置空。
 * PRD 9.2 明确要求这种输入显示**填写率 0%**，且本地与 AI 都不得输出「主要因为薪酬」。
 */
const REASONS_ALL_MISSING_RECORDS: readonly NormalizedRecord[] = PRD_12_2_RECORDS.map((record) =>
  record.offerStatus === '拒绝offer' || record.offerStatus === '拒绝口头offer'
    ? { ...record, rejectionReason: null }
    : record,
)

/** 渲染成 HTML（保留标签，便于断言表头与「分子 ÷ 分母」这类结构化文本） */
function renderRejectionHtml(): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <RejectionWorkspace />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  clearImportSession()
  clearCleaningSettingsDraft()
})

/* ------------------------------------------------------------------ 空态 */

describe('RejectionWorkspace 空态', () => {
  it('没有任何数据时说明「还没有可分析的记录」，不显示示例比例', () => {
    const html = renderRejectionHtml()

    expect(html).toContain(NO_SHEET_TITLE)
    expect(html).toContain('先去导入数据')
    // 空态下不得出现分析面板标题（避免「空白卡片 + 0 值」掩盖状态）
    expect(html).not.toContain('拒 offer 原因分布')
    expect(html).not.toContain('拒 offer 运营关注标签')
  })

  it('已导入但未确认映射时指回映射页', () => {
    setImportSheet(RAW_SHEET)

    const html = renderRejectionHtml()

    expect(html).toContain(NO_MAPPING_TITLE)
    expect(html).toContain('先去确认字段映射')
  })

  it('确认映射但未提交清洗结果时指回清洗页', () => {
    setImportSheet(RAW_SHEET)
    confirmImportMapping(CONFIRMED_MAPPING)

    const html = renderRejectionHtml()

    expect(html).toContain(NO_DATASET_TITLE)
    expect(html).toContain('去清洗预览并提交')
  })

  it('本地仓锁定事件被界面层订阅，且锁定态文案与其它空态互不串用', () => {
    /*
     * 为什么这样测：`renderToStaticMarkup` 只跑渲染、不跑 effect，
     * 而锁定态是**存到 React state 里**的分支，因此服务端渲染无法走到它。
     * 这里分两段验证同一条契约：
     * 1. 锁定事件确实经 `subscribeVaultEvents` 广播到订阅者（`RejectionWorkspace` 的 effect 就是订阅者）；
     * 2. 锁定态的四段文案齐备且与别的空态不重复（否则界面上会出现两套「为什么没有数据」的说法）。
     */
    const received: string[] = []
    const unsubscribe = subscribeVaultEvents((event) => {
      received.push(event.type)
    })
    emitVaultEvent({ type: 'locked', reason: 'idle' })
    unsubscribe()

    expect(received).toEqual(['locked'])
    expect(LOCKED_TITLE).toBe('本地仓已锁定')
    expect(Object.values(LOCKED_DESCRIPTIONS).every((text) => text.length > 0)).toBe(true)
    expect(LOCKED_DESCRIPTIONS.idle).not.toBe(LOCKED_DESCRIPTIONS.manual)
    expect(LOCKED_ITEMS.length).toBeGreaterThan(0)
    // 锁定态与另外三个空态的标题不得互相复用
    expect(new Set([LOCKED_TITLE, NO_SHEET_TITLE, NO_MAPPING_TITLE, NO_DATASET_TITLE]).size).toBe(4)
  })

  it('已提交的数据集里没有记录时明确说明，不显示 0%', () => {
    commitNormalizedDataset(buildDataset([]))

    const html = renderRejectionHtml()

    expect(html).toContain('已提交的数据集里没有记录')
    expect(html).not.toContain('0.00%')
  })
})

/* ------------------------------------------------------------------ 两组口径 */

describe('RejectionWorkspace 两组口径与核心率', () => {
  beforeEach(() => {
    commitNormalizedDataset(buildDataset())
  })

  it('页头给出规则版本、数据截至日与免责声明', () => {
    const html = renderRejectionHtml()

    expect(html).toContain(PAGE_TITLE)
    // 页头显示的是**拒 offer 规则集版本**（rejection-rules/1），不是数据集的清洗规则版本
    expect(html).toContain(REJECTION_RULE_VERSION)
    expect(REJECTION_RULE_VERSION).not.toBe(CURRENT_RULE_VERSION.rulesVersion)
    expect(html).toContain(FIXTURE_DATA_AS_OF)
    expect(html).toContain(DISCLAIMER_LABEL)
    // 免责声明必须在页面上真出现（含「不是个人拒 offer 概率」这层边界）
    expect(html).toContain('不是个人拒 offer 概率')
  })

  it('两张口径卡片各给出 N/J/P/A/R/D 与「分子 ÷ 分母」', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('全部记录（核心率口径）')
    expect(html).toContain('两组比较人群（拒 offer 组 + 入职组）')
    expect(html).toContain('N 总 offer 记录数（含审批中）')
    expect(html).toContain('D 核心分母（J + P + R）')
    expect(html).toContain('拒 offer 率（R ÷ D）')
    // 核心口径：2 ÷ 5 = 40.00%；两组口径：2 ÷ 4 = 50.00%
    expect(html).toContain('分子 2 ÷ 分母 5')
    expect(html).toContain('40.00%')
    expect(html).toContain('分子 2 ÷ 分母 4')
    expect(html).toContain('50.00%')
    // 样本门槛判定来自引擎的 sampleSufficiencyOf
    expect(html).toContain('样本门槛')
    expect(html).toContain('不参与自动排名与结论')
  })

  it('对比口径说明写出「D 含待入职」且「待入职与审批中不参与组间比较」', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('两个人群不同，不能混用')
    expect(html).toContain('核心拒 offer 率的分母 D = 5')
    expect(html).toContain('含待入职 P = 1')
    expect(html).toContain('已排除审批中 A = 1')
    expect(html).toContain('待入职与审批中不参与组间比较')
    // 卡片正文也要重复这条口径，避免读者只看卡片不看说明
    expect(html).toContain('待入职仍在拒 offer 率分母 D 中')
  })

  /*
   * 用户需求 ③：本页此前**一张图都没有**。这里断言两张图确实被渲染出来
   * （`EChart` 服务端渲染输出 role="img" + aria-label），并且原因图的图注写清了分母是 R。
   * 真实绘制（canvas 像素）由端到端用例在浏览器里覆盖。
   */
  it('渲染出原因分布图与维度率对比图，且图注写清分母口径', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('拒绝原因分布')
    expect(html).toContain('拒绝原因分布：分母为全部拒 offer 记录')
    expect(html).toContain('图上每一根柱子的分母都是全部拒 offer 记录 R')
    expect(html).toContain('的核心分母与拒 offer 率、入职率；合并分组不进图')
    // 图例文字活在 ECharts 的 option 里（服务端渲染不出画布），因此这里断言页面上的说明文字：
    // 两个率不是互补关系、分母都是 D —— 读图前先把口径讲清楚
    expect(html).toContain('不是互补关系')
    expect(html).toContain('两个率的分母都是核心分母 D')
    expect((html.match(/role="img"/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })

  it('分维度对比表打开组内构成两列，并声明它是画像构成而不是拒 offer 率', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('拒 offer 组（/R）')
    expect(html).toContain('入职组（/J）')
    expect(html).toContain('画像构成')
    expect(html).toContain('分母为该取值的 D')
    // 每个维度都渲染：维度标签来自引擎的 GROUP_DIMENSION_LABELS
    expect(html).toContain('渠道')
    expect(html).toContain('房补类型')
  })

  it('分维度表不提供下钻按钮（下钻是看板交互，本页用筛选面板缩小范围）', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('本页不提供下钻按钮')
    /*
     * 断言的是「下钻**按钮**不存在」，不是「页面上不出现这四个字」：
     * 用户反馈 ② 之后本页每个模块都有「返回全部数据」，而它的提示文案里写着
     * 「一键清掉当前所有筛选（含『只看该组』下钻…）」——那是说明文字，不是下钻入口。
     * 因此这里只认按钮元素本身。
     */
    expect(html).not.toContain(`>${DRILLDOWN_LABEL}</button>`)
    // 但本页确实接入了筛选面板（与看板同一份口径）
    expect(html).toContain('全局筛选（与看板共用同一份筛选口径）')
  })

  /*
   * 用户反馈 ②：本页 4 个有标题栏的模块（原因 / 维度对比 / 关注标签 / 行动建议）
   * 各有一个「返回全部数据」，与看板同一个按钮组件、同一个清筛选纯函数。
   */
  it('本页每个模块标题栏都有「返回全部数据」', () => {
    const html = renderRejectionHtml()
    const count = html.split(`>${RETURN_TO_ALL_LABEL}</button>`).length - 1
    expect(count).toBe(4)
  })
})

/* ------------------------------------------------------------------ 全局筛选 */

describe('RejectionWorkspace 全局筛选（复用步骤8 的筛选口径）', () => {
  /*
   * 本页的筛选不另建一套状态，而是复用 `dashboardFilters` 的纯逻辑层与同一个 `GlobalFilterPanel`，
   * 因此这里断言的是「面板确实渲染出来了，且选项来自传入的全部记录」。
   * 真正「筛选后结论随之变化」由 `applyFilters` 的既有单测保证（本页调用的就是同一个函数）。
   */
  const CITY_RECORDS = syntheticRecords([
    { offerStatus: '拒绝offer', city: '上海', channel: 'Boss', rejectionReason: '薪酬' },
    { offerStatus: '已入职', city: '上海', channel: 'Boss' },
    { offerStatus: '已入职', city: '广州', channel: '内推' },
    { offerStatus: '待入职', city: '杭州', channel: '内推' },
  ])

  it('未启用筛选时明确说明「等于全部已提交记录」', () => {
    commitNormalizedDataset(buildDataset(CITY_RECORDS))

    const html = renderRejectionHtml()

    expect(html).toContain('全局筛选（与看板共用同一份筛选口径）')
    expect(html).toContain('未启用任何筛选：等于全部已提交记录')
    expect(html).toContain('4 条（N，含审批中）')
  })

  it('筛选面板的选项来自全部已提交记录（三地都出现）', () => {
    commitNormalizedDataset(buildDataset(CITY_RECORDS))

    const html = renderRejectionHtml()

    // 维度选项清单来自传入的 allRecords（不是筛选后的子集），因此其他筛选生效时选项不会消失
    expect(html).toContain('上海')
    expect(html).toContain('广州')
    expect(html).toContain('杭州')
    expect(html).toContain('清空')
  })

  it('数据集里有拒 offer 但全被排除时，原因占比显示「—」而不是 0%', () => {
    // 只有审批中 → R = 0：原因分布的分母为 0，占比必须是「—」而不是 0.00%
    commitNormalizedDataset(
      buildDataset(
        syntheticRecords([
          { offerStatus: 'offer审批中', city: '上海' },
          { offerStatus: 'offer审批中', city: '上海' },
        ]),
      ),
    )

    const html = renderRejectionHtml()
    expect(html).toContain('—')
    // 拒 offer 率为 0/0 → 「—」；绝不能出现 0.00% 冒充 0%
    expect(html).not.toContain('0.00%')
  })

  it('筛选分支保留「筛选后没有记录」这一空态及其说明文案', () => {
    /*
     * 「筛选后一条都不剩」在这个夹具体系里没法真的触发：`renderToStaticMarkup` 不跑 effect，
     * 无法在渲染前把筛选状态设成「空结果」。
     * 因此这里退一步，把该空态的**文案常量**钉住——它是分支唯一会被用户看到的东西，
     * 而且必须与「数据集本身为空」的文案不同（两者的下一步动作完全不同）。
     */
    expect(NO_MATCHED_RECORDS_NOTE).not.toBe(NO_DATASET_RECORDS_NOTE)
    expect(NO_MATCHED_RECORDS_NOTE).toContain('筛选')
    expect(NO_DATASET_RECORDS_NOTE).toContain('数据集')
    // 两段文案都必须**明确说明不显示 0% 占位**（措辞里出现「0%」正是为了声明这一点）
    expect(NO_MATCHED_RECORDS_NOTE).toContain('不显示 0%')
    expect(NO_DATASET_RECORDS_NOTE).toContain('不显示 0%')
  })
})

/* ------------------------------------------------------------------ 原因分布 */

describe('RejectionWorkspace 原因分布', () => {
  it('列出全部受控类别，并给出填写率与「未分类」计数', () => {
    commitNormalizedDataset(buildDataset())

    const html = renderRejectionHtml()

    for (const category of REJECTION_REASON_CATEGORIES) {
      expect(html).toContain(category)
    }
    expect(html).toContain('原因填写率（已填写 ÷ R）')
    // PRD 12.2 夹具：R = 2，已填 1 条 → 填写率 50.00%
    expect(html).toContain('50.00%')
    expect(html).toContain('有值但不在字典内（未分类）')
    expect(html).toContain('命中字典的条数')
    // 字典内命中的是「薪酬」，因此这一行计数为 1
    expect(html).toContain('薪酬')
  })

  it('原因全缺失时填写率为 0%，并明说不得推断原因', () => {
    commitNormalizedDataset(buildDataset(REASONS_ALL_MISSING_RECORDS))

    const html = renderRejectionHtml()

    // 分母 R = 2 而一条都没填：这是**真 0%**，必须显示（与「分母 0 显示 —」不同）
    expect(html).toContain('0.00%')
    expect(html).toContain(REASONS_NO_REASON_NOTE)
    // 「未填写」是独立一行，且计数为 2（两条拒 offer 记录）
    expect(html).toContain(UNFILLED_REASON_LABEL)
    expect(html).toContain('未填写计数：2')
    // 未分类样例会提示维护字典，而不是猜一个原因
    expect(html).toContain('没有未分类原值样例')
  })

  it('没有拒 offer 记录时原因占比显示「—」，不显示 0%', () => {
    // 只留一条已入职记录：R = 0，因此原因分布的分母为 0、各占比必须是 null（「—」）
    const dataset = buildDataset([
      syntheticRecord({
        offerStatus: '已入职',
        recruitmentStartDate: '2026-01-05',
        joiningDate: '2026-01-15',
      }),
    ])
    commitNormalizedDataset(dataset)

    const html = renderRejectionHtml()

    expect(html).toContain('R = 0')
    expect(html).toContain(REASONS_EMPTY_NOTE)
    // 全部 11 个类别行都要出现（计数 0 也保留），且「未填写」的占比是「—」而不是 0.00%
    for (const category of REJECTION_REASON_CATEGORIES) {
      expect(html).toContain(category)
    }
    expect(html).toContain(UNFILLED_REASON_LABEL)
    // 原因区的占比单元格渲染为「—」：断言「占比 — 」这一结构，而不是断言整页没有 0%
    // （拒 offer 率 0/1 = 0.00% 是**真 0**，必须显示）
    expect(html).toMatch(/占拒 offer 总数 R<\/th>[\s\S]*?—/)
    expect(html).toContain('原因填写率')
  })
})

/* ------------------------------------------------------------------ 关注标签 */

describe('RejectionWorkspace 关注标签与建议', () => {
  beforeEach(() => {
    commitNormalizedDataset(buildDataset())
  })

  it('每条规则给出规则 ID、版本、级别徽标与结论文案', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('拒 offer 运营关注标签')
    expect(html).toContain('规则 ID / 版本')
    // 规则集里这几条必须在页面上可回溯（规则 ID 就是回溯入口）
    expect(html).toContain('R-NOSUB')
    expect(html).toContain('R-LOWPAY')
    expect(html).toContain('R-GPT-NOSUB-LOWPAY')
    expect(html).toContain('R-LOWPAY-WAIT')
    expect(html).toContain(`（${REJECTION_RULE_VERSION}）`)
    // 级别徽标：夹具的命中样本量为 0 → 只允许出现「样本不足」，不允许出现另外两级的徽标文字
    expect(html).toContain('>样本不足<')
    expect(html).not.toContain('>仅供描述<')
    expect(html).not.toContain('>观察到关联<')
    // 引擎的结论文案原样渲染（title 里的规则标签 + 「命中样本不足（有效分母」）
    expect(html).toContain('的命中样本不足（有效分母')
    expect(html).toContain('只作为线索记录，不构成结论')
  })

  it('渲染未知条件与建议核查事项（未知条件必须可见）', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('未知条件（必须显式保留）')
    // 拒 offer 记录缺拒绝日期 → 等待条件恒为未知，且说明中要写清「不得当 0 或未超时」
    expect(html).toContain('附件缺拒绝日期，历史等待时长未知（不得当 0 或未超时）')
    expect(html).toContain('等待超阈值')
    // 每条规则的建议核查事项来自规则定义
    expect(html).toContain('核查住宿需求与房补资格')
    expect(html).toContain('核查报价与同岗基准')
    expect(html).toContain('适用范围：当前筛选下的两组比较人群')
  })

  it('给出命中记录数、有效 D / R、比较基准与率差，且不出现任何概率表述', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('命中记录数')
    expect(html).toContain('有效 D / R')
    expect(html).toContain('比较基准')
    expect(html).toContain('率差（百分点）')
    expect(html).toContain('当前筛选下的整体拒 offer 率 R ÷ D')
    // 规则筛查的定位必须写在页面上
    expect(html).toContain('规则筛查')
    expect(html).toContain('不是个人概率模型')
    // 禁止把结论写成概率：页面不得出现任何「概率 = 数字」的表述
    expect(html).not.toMatch(/拒 offer 概率\s*[:：=]?\s*\d/)
    expect(html).not.toContain('可能性')
    expect(html).not.toContain('预计会拒')
  })

  it('组内有效 D 与整体率同口径（D 含待入职），命中拆分本身不含待入职', () => {
    /*
     * 造一条**必然被 R-NOSUB 命中、但不在两组比较人群内**的记录：房补明确「无补贴」的待入职。
     * 期望：命中记录数里没有它（命中统计只发生在 R ∪ J 内），但它的 D 仍要计入组内分母——
     * 否则规则侧的率与整体基准率会是两个分母，率差就不可比。
     */
    const withPendingNoSubsidy: readonly NormalizedRecord[] = [
      ...PRD_12_2_RECORDS,
      syntheticRecord({
        offerStatus: '待入职',
        housingType: '无补贴',
        recruitmentStartDate: '2026-03-01',
        joiningDate: '2026-03-21',
      }),
    ]
    commitNormalizedDataset(buildDataset(withPendingNoSubsidy))

    const html = renderRejectionHtml()

    expect(html).toContain('R-NOSUB')
    // 文案必须说清 D 的构成，避免读者把「有效 D」等同于「命中拆分之和」
    expect(html).toContain('D 与整体率同口径')
    expect(html).toContain('D 核心分母（J + P + R）')
    // 该待入职记录不进拒 offer 组 / 入职组，因此比较人群仍只有 4 条
    expect(html).toContain('共 4 条；待入职与审批中不参与命中统计')
  })

  it('行动建议按「观察 → 建议」成对渲染（本夹具命中样本不足）', () => {
    const html = renderRejectionHtml()

    expect(html).toContain('行动建议')
    expect(html).toContain('观察')
    expect(html).toContain('建议')
    // 夹具的规则全是 insufficient → 结论层给出「小样本 → 继续采集」
    expect(html).toContain('继续采集：当前样本量只够描述，不足以形成结论')
    expect(html).toContain('当前样本量只够描述')
  })

  it('原因全缺失时给出「补充拒绝访谈」建议（原因缺失 → 补访谈，不猜原因）', () => {
    commitNormalizedDataset(buildDataset(REASONS_ALL_MISSING_RECORDS))

    const html = renderRejectionHtml()

    expect(html).toContain('补充拒绝访谈')
    expect(html).toContain('当前原因分布不足以支撑结论')
  })
})
