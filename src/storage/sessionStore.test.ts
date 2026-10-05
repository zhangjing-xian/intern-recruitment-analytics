import { beforeEach, describe, expect, it } from 'vitest'

import {
  EMPTY_MAPPING_DECISIONS,
  applyMappingDecisions,
  buildImportMapping,
  buildMappingTemplate,
  suggestMapping,
  type NormalizedDataset,
  type RawSheet,
} from '../domain'
import { createDefaultCleaningSettings } from '../cleaning'
import {
  clearCleaningSettingsDraft,
  clearCommittedDataset,
  clearImportSession,
  clearMappingDraft,
  commitNormalizedDataset,
  confirmImportMapping,
  getCleaningSession,
  getImportSession,
  hasImportSheet,
  mappingTemplateKey,
  removeMappingTemplate,
  saveCleaningSettingsDraft,
  saveMappingDraft,
  saveMappingTemplate,
  setImportSheet,
} from './sessionStore'

const SENTINEL_NAME = '张三样例'
const SENTINEL_SALARY = 4000

function buildSheet(headers: readonly string[]): RawSheet {
  return {
    sourceKind: 'csv',
    sourceSheet: '合成表',
    sourceFileName: '合成_名单.csv',
    header: { sourceKind: 'csv', sourceSheet: '合成表', sourceRow: 1, headers, hidden: false },
    rows: [
      {
        sourceKind: 'csv',
        sourceSheet: '合成表',
        sourceRow: 2,
        cells: [SENTINEL_NAME, SENTINEL_SALARY, '已入职'],
        emptyRow: false,
        hidden: false,
        parseNotes: [],
      },
    ],
    physicalRowCount: 2,
    columnCount: headers.length,
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
}

const HEADERS = ['姓名', '薪资', 'offer状态']

function decisionsFor(headers: readonly string[]) {
  const plan = suggestMapping(headers)
  return applyMappingDecisions(plan, {
    ...EMPTY_MAPPING_DECISIONS,
    confirmedColumns: plan.entries.map((entry) => entry.columnIndex),
    acknowledgedPartialImport: true,
  })
}

/** 会话是模块级单例：每个用例前都回到干净状态，避免用例之间互相污染 */
function resetSession(): void {
  clearImportSession()
  clearCleaningSettingsDraft()
  for (const template of getImportSession().templates) {
    removeMappingTemplate(mappingTemplateKey(template))
  }
}

describe('临时内存会话（PRD 10.2 临时模式）', () => {
  beforeEach(resetSession)

  it('初始状态没有任何数据', () => {
    const snapshot = getImportSession()
    expect(snapshot.sheet).toBeNull()
    expect(snapshot.draft).toBeNull()
    expect(snapshot.confirmedMapping).toBeNull()
    expect(snapshot.templates).toEqual([])
    expect(hasImportSheet()).toBe(false)
  })

  it('写入解析结果后原样读回，且不带草稿与已确认映射', () => {
    const sheet = buildSheet(HEADERS)
    setImportSheet(sheet)
    expect(hasImportSheet()).toBe(true)
    const snapshot = getImportSession()
    expect(snapshot.sheet).toBe(sheet)
    expect(snapshot.draft).toBeNull()
    expect(snapshot.confirmedMapping).toBeNull()
  })

  it('草稿可以保留（返回导入页再回来不丢编辑），确认后作为步骤5 的输入', () => {
    setImportSheet(buildSheet(HEADERS))
    saveMappingDraft({ headerSignature: 'sig', decisions: EMPTY_MAPPING_DECISIONS })
    expect(getImportSession().draft?.headerSignature).toBe('sig')

    const state = decisionsFor(HEADERS)
    const mapping = buildImportMapping({
      state,
      templateName: null,
      confirmedAt: '2026-09-26T10:00:00.000Z',
    })
    confirmImportMapping(mapping)
    expect(getImportSession().confirmedMapping).toBe(mapping)
  })

  it('换一份新表会清掉旧草稿与旧确认，避免把 A 表的映射套到 B 表', () => {
    setImportSheet(buildSheet(HEADERS))
    saveMappingDraft({ headerSignature: 'sig-a', decisions: EMPTY_MAPPING_DECISIONS })
    confirmImportMapping(
      buildImportMapping({
        state: decisionsFor(HEADERS),
        templateName: null,
        confirmedAt: '2026-09-26T10:00:00.000Z',
      }),
    )

    const next = buildSheet(['需求ID', 'offer状态'])
    setImportSheet(next)
    const snapshot = getImportSession()
    expect(snapshot.sheet).toBe(next)
    expect(snapshot.draft).toBeNull()
    expect(snapshot.confirmedMapping).toBeNull()
  })

  it('没有当前表时忽略草稿写入，避免悬空草稿被下一次导入误用', () => {
    saveMappingDraft({ headerSignature: 'sig', decisions: EMPTY_MAPPING_DECISIONS })
    expect(getImportSession().draft).toBeNull()
  })

  it('映射模板在内存中保存、按名称+时间覆盖，并在清除数据集后保留', () => {
    setImportSheet(buildSheet(HEADERS))
    const state = decisionsFor(HEADERS)
    const first = buildMappingTemplate({ name: '模板', state, createdAt: '2026-09-26T10:00:00.000Z' })
    const second = buildMappingTemplate({
      name: '模板',
      state,
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    saveMappingTemplate(first)
    saveMappingTemplate(second)
    expect(getImportSession().templates).toHaveLength(1)

    setImportSheet(null)
    expect(getImportSession().sheet).toBeNull()
    expect(getImportSession().templates).toHaveLength(1)

    removeMappingTemplate(mappingTemplateKey(first))
    expect(getImportSession().templates).toEqual([])
  })

  it('会话快照可序列化且不含浏览器存储依赖（node 环境下没有 localStorage）', () => {
    const sheet = buildSheet(HEADERS)
    setImportSheet(sheet)
    expect(JSON.parse(JSON.stringify(getImportSession())).sheet.sourceSheet).toBe('合成表')
    expect(typeof globalThis.localStorage).toBe('undefined')
    expect(typeof globalThis.indexedDB).toBe('undefined')
  })
})

/** 清洗设置草稿：口径属于用户配置，换一份表也保留 */
const SETTINGS = createDefaultCleaningSettings({ dataAsOf: '2026-09-26' })

/** 换一份设置（截止日与导入方式都不同），用于验证「改设置即作废旧结论」 */
const SETTINGS_NEXT = createDefaultCleaningSettings({
  dataAsOf: '2026-09-25',
  importMode: '替换当前数据集',
})

/**
 * 会话只做「持有 / 作废」引用，不读数据集内部字段；
 * 用哨兵对象避免在存储层测试里复制整套清洗夹具（`as unknown as` 说明这是刻意的窄桩）。
 */
const DATASET = { metadata: { dataAsOf: '2026-09-26' } } as unknown as NormalizedDataset

describe('清洗会话（步骤5：设置草稿 + 已提交数据集，同样只在内存）', () => {
  beforeEach(resetSession)

  it('初始没有设置草稿与已提交数据集，进入清洗页时按最保守默认值创建', () => {
    const snapshot = getCleaningSession()
    expect(snapshot.settings).toBeNull()
    expect(snapshot.dataset).toBeNull()
  })

  it('保存设置草稿后按引用读回，提交数据集不会覆盖草稿', () => {
    saveCleaningSettingsDraft(SETTINGS)
    expect(getCleaningSession().settings).toBe(SETTINGS)

    commitNormalizedDataset(DATASET)
    expect(getCleaningSession().settings).toBe(SETTINGS)
    expect(getCleaningSession().dataset).toBe(DATASET)
  })

  it('改设置即作废旧结论：不得把旧数据集当成新设置的结论', () => {
    saveCleaningSettingsDraft(SETTINGS)
    commitNormalizedDataset(DATASET)

    saveCleaningSettingsDraft(SETTINGS_NEXT)
    const snapshot = getCleaningSession()
    expect(snapshot.settings).toBe(SETTINGS_NEXT)
    expect(snapshot.dataset).toBeNull()
  })

  it('作废已提交数据集只回到预览，不改设置草稿', () => {
    saveCleaningSettingsDraft(SETTINGS)
    commitNormalizedDataset(DATASET)

    clearCommittedDataset()
    const snapshot = getCleaningSession()
    expect(snapshot.dataset).toBeNull()
    expect(snapshot.settings).toBe(SETTINGS)
  })

  it('放弃设置草稿：清洗会话整份回到空（不残留旧数据集）', () => {
    saveCleaningSettingsDraft(SETTINGS)
    commitNormalizedDataset(DATASET)

    clearCleaningSettingsDraft()
    const snapshot = getCleaningSession()
    expect(snapshot.settings).toBeNull()
    expect(snapshot.dataset).toBeNull()
  })

  it('换表 / 放弃数据集会连带作废旧结论，但保留设置草稿（口径与数据无关）', () => {
    setImportSheet(buildSheet(HEADERS))
    saveCleaningSettingsDraft(SETTINGS)
    commitNormalizedDataset(DATASET)

    setImportSheet(buildSheet(['需求ID', 'offer状态']))
    expect(getCleaningSession().dataset).toBeNull()
    expect(getCleaningSession().settings).toBe(SETTINGS)

    commitNormalizedDataset(DATASET)
    setImportSheet(null)
    expect(getCleaningSession().dataset).toBeNull()
    expect(getCleaningSession().settings).toBe(SETTINGS)

    commitNormalizedDataset(DATASET)
    clearImportSession()
    expect(getCleaningSession().dataset).toBeNull()
    expect(getCleaningSession().settings).toBe(SETTINGS)
  })

  it('每次变更都替换整份快照：旧引用不被就地改写（React 可按引用比较）', () => {
    saveCleaningSettingsDraft(SETTINGS)
    const before = getCleaningSession()

    commitNormalizedDataset(DATASET)
    expect(getCleaningSession()).not.toBe(before)
    expect(before.dataset).toBeNull()
    expect(before.settings).toBe(SETTINGS)
  })

  it('放弃映射草稿只清草稿，已确认映射保留（确认是显式动作，不跟着草稿一起没）', () => {
    setImportSheet(buildSheet(HEADERS))
    saveMappingDraft({ headerSignature: 'sig', decisions: EMPTY_MAPPING_DECISIONS })
    const mapping = buildImportMapping({
      state: decisionsFor(HEADERS),
      templateName: null,
      confirmedAt: '2026-09-26T10:00:00.000Z',
    })
    confirmImportMapping(mapping)

    clearMappingDraft()
    const snapshot = getImportSession()
    expect(snapshot.draft).toBeNull()
    expect(snapshot.confirmedMapping).toBe(mapping)
  })
})

