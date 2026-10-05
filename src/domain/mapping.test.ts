import { describe, expect, it } from 'vitest'

import { STANDARD_HEADERS } from './fields'
import {
  EMPTY_MAPPING_DECISIONS,
  applyMappingDecisions,
  applyMappingTemplate,
  buildImportMapping,
  buildMappingTemplate,
  conflictsFor,
  disabledModulesForMissingFields,
  headerSignature,
  headerSimilarity,
  parseMappingTemplate,
  serializeMappingTemplate,
  suggestHeaderTarget,
  suggestMapping,
  summarizeColumns,
  type MappingDecisions,
  type MappingState,
} from './mapping'
import { ISSUE_SEVERITY } from './quality'
import { TEMPLATE_VERSION } from './version'
import type { RawCellValue, RawRow, RawSheet } from './types'

/** 合成 21 列表头（顺序与标准模板一致） */
const STANDARD_HEADERS_FULL: readonly string[] = [...STANDARD_HEADERS]

function buildSheet(
  headers: readonly string[],
  rows: readonly (readonly RawCellValue[])[],
  extras: {
    readonly emptyRows?: number
    readonly hiddenColumns?: readonly number[]
    readonly hiddenRows?: readonly number[]
  } = {},
): RawSheet {
  const emptyRows = extras.emptyRows ?? 0
  const hiddenRows = new Set(extras.hiddenRows ?? [])
  const dataRows: RawRow[] = rows.map((cells, index) => {
    const sourceRow = index + 2
    return {
      sourceKind: 'csv',
      sourceSheet: '合成表',
      sourceRow,
      cells,
      emptyRow: cells.every((cell) => cell === null || cell === ''),
      hidden: hiddenRows.has(sourceRow),
      parseNotes: [],
    }
  })
  for (let index = 0; index < emptyRows; index += 1) {
    dataRows.push({
      sourceKind: 'csv',
      sourceSheet: '合成表',
      sourceRow: rows.length + index + 2,
      cells: headers.map(() => null),
      emptyRow: true,
      hidden: false,
      parseNotes: [],
    })
  }
  return {
    sourceKind: 'csv',
    sourceSheet: '合成表',
    sourceFileName: null,
    header: {
      sourceKind: 'csv',
      sourceSheet: '合成表',
      sourceRow: 1,
      headers,
      hidden: false,
    },
    rows: dataRows,
    physicalRowCount: rows.length + emptyRows + 1,
    columnCount: headers.length,
    emptyRowCount: emptyRows,
    hiddenRowCount: hiddenRows.size,
    hiddenColumnIndexes: extras.hiddenColumns ?? [],
    sheetHidden: false,
    formulaWithoutCacheCount: 0,
    skippedSheets: [],
    issues: [],
    date1904: null,
    encoding: 'utf-8',
    delimiter: ',',
  }
}

function stateFor(
  headers: readonly string[],
  decisions: Partial<MappingDecisions> = {},
): MappingState {
  const plan = suggestMapping(headers)
  return applyMappingDecisions(plan, { ...EMPTY_MAPPING_DECISIONS, ...decisions })
}

describe('表头四级匹配（PRD 4.3 / A03）', () => {
  it('标准 21 列表头全部精确匹配，且不需要逐列确认', () => {
    const plan = suggestMapping(STANDARD_HEADERS_FULL)
    expect(plan.entries).toHaveLength(21)
    expect(plan.entries.map((entry) => entry.targetField)).toEqual([
      'requirementId',
      'recruiter',
      'city',
      'department',
      'position',
      'jobFamily',
      'requirementType',
      'recruitmentStartDate',
      'joiningDate',
      'expectedEndDate',
      'candidateName',
      'graduationYear',
      'education',
      'school',
      'isGptSchool',
      'referrer',
      'channel',
      'salaryAmount',
      'housingRaw',
      'offerStatus',
      'rejectionReason',
    ])
    expect(plan.entries.every((entry) => entry.matchLevel === 'exact')).toBe(true)
    expect(plan.entries.every((entry) => entry.requiresConfirmation === false)).toBe(true)
    expect(plan.entries.every((entry) => entry.targetExtension === null)).toBe(true)
    expect(plan.autoMatchedCount).toBe(21)
  })

  it('标准 21 列匹配后可以直接确认提交', () => {
    const state = stateFor(STANDARD_HEADERS_FULL)
    expect(state.missingStandardFields).toEqual([])
    expect(state.conflicts).toEqual([])
    expect(state.blocking).toBe(false)
    expect(state.canConfirm).toBe(true)
    expect(state.reasons).toEqual([])
    expect(state.counts.mappedStandardCount).toBe(21)
    expect(state.counts.ignoredCount).toBe(0)
  })

  it('去 BOM / 首尾空格 / 全半角差异按规范化匹配，且不需要确认', () => {
    const plan = suggestMapping(['\uFEFF需求ID ', '　Offer状态'])
    expect(plan.entries[0].targetField).toBe('requirementId')
    expect(plan.entries[0].matchLevel).toBe('normalized')
    expect(plan.entries[0].requiresConfirmation).toBe(false)
    expect(plan.entries[1].targetField).toBe('offerStatus')
    expect(plan.entries[1].matchLevel).toBe('normalized')
    expect(plan.entries[1].requiresConfirmation).toBe(false)
  })

  it('内置别名命中只给建议，必须由用户确认', () => {
    const plan = suggestMapping(['招聘负责人', '职位', '住房补贴'])
    expect(plan.entries.map((entry) => entry.targetField)).toEqual([
      'recruiter',
      'position',
      'housingRaw',
    ])
    expect(plan.entries.every((entry) => entry.matchLevel === 'alias')).toBe(true)
    expect(plan.entries.every((entry) => entry.requiresConfirmation)).toBe(true)
    expect(plan.entries.every((entry) => entry.confidence < 1)).toBe(true)
    expect(plan.autoMatchedCount).toBe(0)
  })

  it('模糊建议必须确认，且永不自动提交', () => {
    const suggestion = suggestHeaderTarget('启动招聘日期')
    expect(suggestion.matchLevel).toBe('fuzzy')
    expect(suggestion.targetField).toBe('recruitmentStartDate')
    expect(suggestion.requiresConfirmation).toBe(true)
    expect(suggestion.confidence).toBeGreaterThanOrEqual(0.6)
    expect(suggestion.confidence).toBeLessThan(1)

    const state = stateFor(['启动招聘日期', 'offer状态'])
    expect(state.blocking).toBe(false)
    expect(state.canConfirm).toBe(false)
    expect(state.counts.pendingConfirmationCount).toBe(1)
    expect(state.reasons.join('')).toContain('模糊建议')
  })

  it('相似度函数在边界上稳定', () => {
    expect(headerSimilarity('姓名', '姓名')).toBe(1)
    expect(headerSimilarity('', '姓名')).toBe(0)
    expect(headerSimilarity('启动招聘日期', '启动招聘时间')).toBeCloseTo(0.6, 5)
    expect(headerSimilarity('姓名', '候选人姓名')).toBeGreaterThan(0.6)
    expect(headerSimilarity('渠道', '学校')).toBe(0)
  })

  it('学历与学位、招聘 HR 与推荐人、入职时间与 offer 接受时间不互相自动映射', () => {
    expect(suggestHeaderTarget('学位').targetField).toBeNull()
    expect(suggestHeaderTarget('学位').blockedReason).not.toBeNull()
    expect(suggestHeaderTarget('推荐人').targetField).toBe('referrer')
    expect(suggestHeaderTarget('招聘负责人').targetField).toBe('recruiter')
    expect(suggestHeaderTarget('入职时间').targetField).toBe('joiningDate')
    const accepted = suggestHeaderTarget('offer接受时间')
    expect(accepted.targetField).toBeNull()
    expect(accepted.targetExtension).toBe('offerAcceptedDate')
  })

  it('未识别列默认忽略，不参与任何目标字段', () => {
    const plan = suggestMapping(['备注', '内部编号-自定义'])
    expect(plan.entries.map((entry) => entry.targetField)).toEqual([null, null])
    expect(plan.entries.map((entry) => entry.matchLevel)).toEqual(['ignored', 'ignored'])
  })

  it('扩展列按精确匹配落到 targetExtension，与标准字段互斥', () => {
    const plan = suggestMapping(['offer唯一ID', 'offer状态'])
    expect(plan.entries[0].targetExtension).toBe('offerId')
    expect(plan.entries[0].targetField).toBeNull()
    expect(plan.entries[0].matchLevel).toBe('exact')
  })
})

describe('冲突检测与解决（PRD 4.3：必须选择或显式合并）', () => {
  const headers = ['姓名', '候选人姓名', 'offer状态']

  it('多个源列指向同一目标即为阻断冲突', () => {
    const plan = suggestMapping(headers)
    expect(plan.entries[0].conflictGroupId).toBe('conflict:field:candidateName')
    expect(plan.entries[1].conflictGroupId).toBe('conflict:field:candidateName')

    const state = applyMappingDecisions(plan, EMPTY_MAPPING_DECISIONS)
    expect(state.conflicts).toHaveLength(1)
    expect(state.conflicts[0].columnIndexes).toEqual([0, 1])
    expect(state.blocking).toBe(true)
    expect(state.canConfirm).toBe(false)
    expect(state.issues.map((issue) => issue.code)).toEqual(['FIELD_CONFLICT'])
    expect(state.issues[0].severity).toBe(ISSUE_SEVERITY.FIELD_CONFLICT)
    expect(state.reasons.join('')).toContain('冲突')
  })

  it('选择其中一列后冲突解除，未选中的列变为忽略', () => {
    const plan = suggestMapping(headers)
    const state = applyMappingDecisions(plan, {
      ...EMPTY_MAPPING_DECISIONS,
      acknowledgedPartialImport: true,
      conflictResolutions: {
        'conflict:field:candidateName': { kind: 'keep', columnIndex: 1 },
      },
    })
    expect(state.conflicts).toEqual([])
    expect(state.blocking).toBe(false)
    expect(state.entries[0].targetField).toBeNull()
    expect(state.entries[0].matchLevel).toBe('ignored')
    expect(state.entries[1].targetField).toBe('candidateName')
    expect(state.entries[1].matchLevel).toBe('manual')
    expect(state.entries[1].requiresConfirmation).toBe(false)
    expect(state.canConfirm).toBe(true)
  })

  it('显式合并规则按列顺序取第一个非空值，冲突同样解除', () => {
    const plan = suggestMapping(headers)
    const state = applyMappingDecisions(plan, {
      ...EMPTY_MAPPING_DECISIONS,
      acknowledgedPartialImport: true,
      conflictResolutions: {
        'conflict:field:candidateName': { kind: 'merge', strategy: 'first-non-empty' },
      },
    })
    expect(state.conflicts).toEqual([])
    expect(state.merges).toHaveLength(1)
    expect(state.merges[0]).toEqual({
      targetField: 'candidateName',
      targetExtension: null,
      strategy: 'first-non-empty',
      columnIndexes: [0, 1],
    })
    expect(state.entries[0].targetField).toBe('candidateName')
    expect(state.entries[1].targetField).toBe('candidateName')
    expect(state.canConfirm).toBe(true)
  })

  it('冲突处置指向已不存在的列时回到未解决状态，不静默兜底', () => {
    const plan = suggestMapping(headers)
    const state = applyMappingDecisions(plan, {
      ...EMPTY_MAPPING_DECISIONS,
      conflictResolutions: {
        'conflict:field:candidateName': { kind: 'keep', columnIndex: 9 },
      },
    })
    expect(state.conflicts).toHaveLength(1)
    expect(state.blocking).toBe(true)
  })

  it('人工把两列改成同一目标时立即产生冲突', () => {
    const plan = suggestMapping(['渠道', '学校', 'offer状态'])
    const state = applyMappingDecisions(plan, {
      ...EMPTY_MAPPING_DECISIONS,
      overrides: { 1: { targetField: 'channel', targetExtension: null } },
    })
    expect(state.conflicts).toHaveLength(1)
    expect(state.conflicts[0].columnIndexes).toEqual([0, 1])
    expect(conflictsFor(state.entries, state.merges)).toHaveLength(1)
  })
})

describe('缺列与部分分析导入（PRD 4.1）', () => {
  it('缺少 offer 状态列属阻断，并给出 offer 状态映射问题码', () => {
    const state = stateFor(['需求ID', '姓名'])
    expect(state.missingRequiredFields).toEqual(['offerStatus'])
    expect(state.blocking).toBe(true)
    expect(state.canConfirm).toBe(false)
    expect(state.issues.map((issue) => issue.code)).toEqual(['MISSING_OFFER_STATUS_COLUMN'])
    expect(state.issues[0].severity).toBe('阻断')
    expect(state.reasons.join('')).toContain('offer状态')
  })

  it('缺少其他标准列要逐项告知并说明被禁用的模块', () => {
    const state = stateFor(['offer状态', '姓名'])
    expect(state.missingStandardFields).toContain('city')
    expect(state.missingStandardFields).toContain('salaryAmount')
    expect(state.disabledModules).toContain('城市对比')
    expect(state.disabledModules).toContain('薪资对比')
    expect(state.blocking).toBe(false)
    expect(state.needsPartialImportAcknowledgement).toBe(true)
    expect(state.canConfirm).toBe(false)

    const acknowledged = stateFor(['offer状态', '姓名'], { acknowledgedPartialImport: true })
    expect(acknowledged.canConfirm).toBe(true)
    expect(acknowledged.reasons).toEqual([])
  })

  it('缺列 → 禁用模块的映射按固定顺序返回', () => {
    expect(disabledModulesForMissingFields(['channel', 'recruiter'])).toEqual(['渠道对比', 'HR效能'])
    expect(disabledModulesForMissingFields(['candidateName'])).toEqual([])
    expect(disabledModulesForMissingFields(['offerStatus'])).toContain('核心率')
  })
})

describe('映射状态与 ImportMapping', () => {
  it('人工改写记为 manual，明确忽略记为 ignored', () => {
    const plan = suggestMapping(['需求ID', '备注', 'offer状态'])
    const state = applyMappingDecisions(plan, {
      ...EMPTY_MAPPING_DECISIONS,
      overrides: {
        0: null,
        1: { targetField: 'position', targetExtension: null },
      },
    })
    expect(state.entries[0].matchLevel).toBe('ignored')
    expect(state.entries[0].targetField).toBeNull()
    expect(state.entries[1].matchLevel).toBe('manual')
    expect(state.entries[1].targetField).toBe('position')
    expect(state.ignoredColumns).toEqual(['需求ID'])
    expect(state.counts.mappedStandardCount).toBe(2)
    expect(state.counts.ignoredCount).toBe(1)
    expect(state.missingStandardFields).toContain('requirementId')
  })

  it('确认后可生成 ImportMapping，且带上版本与确认时间', () => {
    const state = fullyConfirmedState(['需求ID', 'offer状态', '备注'])
    expect(state.canConfirm).toBe(true)
    const mapping = buildImportMapping({
      state,
      templateName: '8 月名单',
      confirmedAt: '2026-09-26T10:00:00.000Z',
    })
    expect(mapping.templateVersion).toBe(TEMPLATE_VERSION)
    expect(mapping.templateName).toBe('8 月名单')
    expect(mapping.confirmedAt).toBe('2026-09-26T10:00:00.000Z')
    expect(mapping.ignoredColumns).toEqual(['备注'])
    expect(mapping.missingRequiredFields).toEqual([])
    expect(mapping.merges).toEqual([])
    expect(mapping.entries).toHaveLength(3)
    expect(mapping.sourceHeaderSignature).toBe(headerSignature(['需求ID', 'offer状态', '备注']))
  })
})

/** 逐列确认所有建议，并确认「部分分析导入」（模拟用户在映射页把全部待确认项处理完） */
function fullyConfirmedState(headers: readonly string[]): MappingState {
  const plan = suggestMapping(headers)
  return applyMappingDecisions(plan, {
    ...EMPTY_MAPPING_DECISIONS,
    confirmedColumns: plan.entries.map((entry) => entry.columnIndex),
    acknowledgedPartialImport: true,
  })
}

describe('映射模板（PRD 4.3：只存表头与字段，不存示例数据）', () => {
  const headers = ['需求ID', '招聘负责人', 'offer状态', '内部备注']

  it('保存 → 序列化 → 解析可以完整往返', () => {
    const state = applyMappingDecisions(suggestMapping(headers), {
      ...EMPTY_MAPPING_DECISIONS,
      confirmedColumns: [1],
      overrides: { 3: null },
    })
    const template = buildMappingTemplate({
      name: '  8 月名单  ',
      state,
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    expect(template.name).toBe('8 月名单')
    expect(template.formatVersion).toBe('1.0.0')
    expect(template.templateVersion).toBe(TEMPLATE_VERSION)
    expect(template.headerCount).toBe(4)
    expect(template.sourceHeaderSignature).toBe(headerSignature(headers))
    expect(template.entries).toEqual([
      { sourceHeader: '需求ID', targetField: 'requirementId', targetExtension: null },
      { sourceHeader: '招聘负责人', targetField: 'recruiter', targetExtension: null },
      { sourceHeader: 'offer状态', targetField: 'offerStatus', targetExtension: null },
      { sourceHeader: '内部备注', targetField: null, targetExtension: null },
    ])

    const parsed = parseMappingTemplate(serializeMappingTemplate(template))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.template).toEqual(template)
    }
  })

  it('模板文本里不含任何单元格样例值', () => {
    const sheet = buildSheet(['姓名', '薪资', 'offer状态'], [['张三样例', 4000, '已入职']])
    const state = fullyConfirmedState(['姓名', '薪资', 'offer状态'])
    const template = buildMappingTemplate({
      name: '含哨兵的模板',
      state,
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    const text = serializeMappingTemplate(template)
    expect(sheet.rows).toHaveLength(1)
    expect(text).not.toContain('张三样例')
    expect(text).not.toContain('4000')
    expect(text).not.toContain('已入职')
    expect(text).not.toContain('合成表')
  })

  it('源表头签名与列顺序无关，但与表头集合有关', () => {
    expect(headerSignature(['姓名', '薪资'])).toBe(headerSignature(['薪资', '姓名']))
    expect(headerSignature(['姓名', '薪资'])).not.toBe(headerSignature(['姓名', '学校']))
  })

  it('复用模板按表头名匹配，未出现的表头逐条提示', () => {
    const template = buildMappingTemplate({
      name: '模板',
      state: fullyConfirmedState(headers),
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    const application = applyMappingTemplate(template, [
      '内部备注',
      'offer状态',
      '新增列',
      '需求ID',
      '招聘负责人',
    ])
    expect(application.matchedColumnCount).toBe(4)
    expect(application.untouchedColumnCount).toBe(1)
    expect(application.unmatchedHeaders).toEqual([])
    expect(application.templateOverrides[0]).toBeNull()
    expect(application.templateOverrides[1]).toEqual({
      targetField: 'offerStatus',
      targetExtension: null,
    })

    const applied = applyMappingDecisions(
      suggestMapping(['内部备注', 'offer状态', '新增列']),
      {
        ...EMPTY_MAPPING_DECISIONS,
        templateOverrides: application.templateOverrides,
      },
    )
    expect(applied.entries[0].matchLevel).toBe('ignored')
    expect(applied.entries[1].matchLevel).toBe('template')
    expect(applied.entries[1].requiresConfirmation).toBe(false)
    expect(applied.entries[2].matchLevel).toBe('ignored')

    const partial = applyMappingTemplate(template, ['offer状态', '全新列'])
    expect(partial.matchedColumnCount).toBe(1)
    expect(partial.untouchedColumnCount).toBe(1)
    expect(partial.unmatchedHeaders).toEqual(['需求ID', '招聘负责人', '内部备注'])
  })

  it('复用模板时合并规则同样按表头名恢复', () => {
    const mergeHeaders = ['姓名', '候选人姓名', 'offer状态']
    const state = applyMappingDecisions(suggestMapping(mergeHeaders), {
      ...EMPTY_MAPPING_DECISIONS,
      conflictResolutions: {
        'conflict:field:candidateName': { kind: 'merge', strategy: 'first-non-empty' },
      },
    })
    const template = buildMappingTemplate({
      name: '合并模板',
      state,
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    expect(template.merges).toEqual([
      {
        targetField: 'candidateName',
        targetExtension: null,
        strategy: 'first-non-empty',
        sourceHeaders: ['姓名', '候选人姓名'],
      },
    ])

    const reorderedHeaders = ['候选人姓名', 'offer状态', '姓名']
    const application = applyMappingTemplate(template, reorderedHeaders)
    expect(application.conflictResolutions).toEqual({
      'conflict:field:candidateName': { kind: 'merge', strategy: 'first-non-empty' },
    })
    const replayed = applyMappingDecisions(suggestMapping(reorderedHeaders), {
      ...EMPTY_MAPPING_DECISIONS,
      templateOverrides: application.templateOverrides,
      conflictResolutions: application.conflictResolutions,
      acknowledgedPartialImport: true,
    })
    expect(replayed.conflicts).toEqual([])
    expect(replayed.merges[0].columnIndexes).toEqual([0, 2])
    expect(replayed.canConfirm).toBe(true)
  })

  it('解析模板时严格拒绝非法结构', () => {
    const template = buildMappingTemplate({
      name: '模板',
      state: fullyConfirmedState(headers),
      createdAt: '2026-09-26T10:00:00.000Z',
    })
    const okText = serializeMappingTemplate(template)

    expect(parseMappingTemplate('不是 JSON')).toMatchObject({ ok: false })
    expect(parseMappingTemplate('[]')).toMatchObject({ ok: false })
    expect(parseMappingTemplate(okText.replace('"1.0.0"', '"2.0.0"'))).toMatchObject({ ok: false })
    expect(parseMappingTemplate(okText.replace('"entries"', '"sampleValues"'))).toMatchObject({
      ok: false,
      error: expect.stringContaining('不得包含'),
    })
    expect(parseMappingTemplate(okText.replace('"requirementId"', '"不存在的字段"'))).toMatchObject({
      ok: false,
      error: expect.stringContaining('标准字段键非法'),
    })

    const tampered = JSON.parse(okText) as {
      entries: { sourceHeader: string; targetField: string | null; targetExtension: string | null }[]
    }
    for (const entry of tampered.entries) {
      if (entry.sourceHeader === 'offer状态') {
        entry.targetExtension = 'offerId'
      }
    }
    expect(parseMappingTemplate(JSON.stringify(tampered))).toMatchObject({
      ok: false,
      error: expect.stringContaining('互斥'),
    })
  })
})

describe('列样例摘要（仅本机展示）', () => {
  it('统计非空数、去重样例、空行与隐藏列标记', () => {
    const sheet = buildSheet(
      ['姓名', '薪资', '空列'],
      [
        ['张三样例', 4000, null],
        ['张三样例', 4000, null],
        ['李四样例', null, null],
        [null, '', ''],
      ],
      { emptyRows: 2, hiddenColumns: [2] },
    )
    const summaries = summarizeColumns(sheet)
    expect(summaries).toHaveLength(3)
    expect(summaries[0].nonEmptyCount).toBe(3)
    expect(summaries[0].samples).toEqual(['张三样例', '李四样例'])
    expect(summaries[0].allEmpty).toBe(false)
    expect(summaries[1].nonEmptyCount).toBe(2)
    expect(summaries[1].samples).toEqual(['4000'])
    expect(summaries[2].allEmpty).toBe(true)
    expect(summaries[2].hidden).toBe(true)
    expect(summaries[0].hidden).toBe(false)
  })

  it('超长样例被截断并标记', () => {
    const longValue = '很长很长的样例文本'.repeat(6)
    const sheet = buildSheet(['备注'], [[longValue]])
    const summaries = summarizeColumns(sheet, { maxSamples: 2, maxSampleLength: 10 })
    expect(summaries[0].samples[0]).toBe(`${longValue.slice(0, 10)}…`)
    expect(summaries[0].sampleTruncated).toBe(true)
  })
})





