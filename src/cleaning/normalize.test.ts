/**
 * 清洗与规范化（docs/PRD.md 第 5 章）单测。
 *
 * 铁律：未确认映射 / 缺 offer 状态列一律拒绝清洗；空单元格 → null（不用 0 冒充）；
 * 日期只在日期列解析、需求 ID 保留前导 0；未确认去重前样本不减少；
 * 隐藏行默认包含、表头回声行默认保留，任何排除都计数并写入报告与决策日志。
 */

import { describe, expect, it } from 'vitest'

import {
  CURRENT_RULE_VERSION,
  EXTENSION_FIELDS,
  JOINED_STATUS,
  OTHER,
  PENDING_JOINING_STATUS,
  REJECTED_OFFER_STATUS,
  UNKNOWN,
  buildConfigRevision,
  buildSalarySetting,
  type DataQualityIssueCode,
  type DerivedRecordFields,
  type ExtensionFieldKey,
  type NormalizedRecord,
} from '../domain'

import {
  ALL_FIELD_KEYS,
  CONFIRMED_AT,
  DATA_AS_OF,
  buildCleaningInput,
  cleanFixture,
  cleanWith,
  headerOf,
  mappingWithExtension,
  type RowInput,
} from './testFixtures'

/** 一行「最正常」的已入职记录：启动 2026-01-01、入职 2026-01-11（周期 10 天） */
const BASE_ROW: RowInput = {
  requirementId: 'REQ-001',
  city: '上海',
  channel: 'Boss',
  offerStatus: JOINED_STATUS,
  recruitmentStartDate: '2026-01-01',
  joiningDate: '2026-01-11',
}

function codesOf(issues: readonly { readonly code: DataQualityIssueCode }[]): DataQualityIssueCode[] {
  return issues.map((issue) => issue.code)
}

/**
 * 派生字段在类型上是可空的（未计算阶段必须为 null），但清洗产出的记录一定带它。
 * 这里显式收窄一次，既让断言不必层层 `?.`，也保证 derived 缺失时用例直接报错而不是静默通过。
 */
function derivedOf(record: NormalizedRecord | undefined): DerivedRecordFields {
  if (record?.derived === undefined || record.derived === null) {
    throw new Error('记录缺少派生字段：清洗结果不完整')
  }
  return record.derived
}

describe('清洗前置条件：未确认的映射不进入清洗', () => {
  it('映射未确认时抛错，文案指向「字段映射」页而不是产出半成品', () => {
    const parts = buildCleaningInput({ rows: [BASE_ROW], mappingConfirmed: false })
    expect(parts.mapping.confirmedAt).toBeNull()
    expect(() => cleanWith(parts)).toThrow(/字段映射尚未确认/)
  })

  it('缺 offer 状态列时抛错（offer 状态是唯一必需字段）', () => {
    const parts = buildCleaningInput({
      fieldKeys: ['requirementId', 'city', 'salaryAmount'],
      rows: [{ requirementId: 'REQ-001', city: '上海' }],
    })
    expect(parts.mapping.confirmedAt).not.toBeNull()
    expect(parts.mapping.missingRequiredFields).toEqual(['offerStatus'])
    expect(() => cleanWith(parts)).toThrow(/缺少 offer 状态列/)
  })
})

describe('行数口径：跳过与保留都计数', () => {
  it('空行跳过但计数：原始行 − 空行 − 去重移除 = 保留行', () => {
    const { dataset } = cleanFixture({
      rows: [BASE_ROW, null, { ...BASE_ROW, requirementId: 'REQ-002' }],
    })
    expect(dataset.report.counts).toEqual({
      rawRowCount: 3,
      emptyRowCount: 1,
      keptRowCount: 2,
      removedDuplicateCount: 0,
      issueRowCount: 0,
      distinctRequirementCount: 2,
    })
    expect(dataset.report.issues).toEqual([])
    expect(dataset.report.notes[0]).toContain('空行 1')
    expect(dataset.report.notes[0]).toContain('保留 2')
  })

  it('隐藏行默认包含（隐藏 ≠ 无效）；排除时计数并写进决策日志', () => {
    const rows: readonly (RowInput | null)[] = [BASE_ROW, { ...BASE_ROW, requirementId: 'REQ-002' }]
    const included = cleanFixture({ rows, hiddenRowIndexes: [1] })
    expect(included.dataset.records).toHaveLength(2)
    expect(included.dataset.report.hiddenRowExcludedCount).toBe(0)
    expect(included.dataset.report.counts.rawRowCount).toBe(2)
    expect(included.dataset.report.counts.keptRowCount).toBe(2)

    const excluded = cleanFixture({
      rows,
      hiddenRowIndexes: [1],
      settings: { includeHiddenRows: false },
    })
    expect(excluded.dataset.records).toHaveLength(1)
    expect(excluded.dataset.report.hiddenRowExcludedCount).toBe(1)
    // 原始行数不因设置变化：口径始终对着源文件
    expect(excluded.dataset.report.counts.rawRowCount).toBe(2)
    expect(excluded.dataset.report.counts.keptRowCount).toBe(1)
    const decision = excluded.dataset.report.decisionLog.find((entry) => entry.id === 'hiddenRows')
    expect(decision?.detail).toContain('排除 1 行隐藏行')
  })

  it('记录保留源行的原值与规范化日志（可追溯，不丢原文）', () => {
    const { dataset } = cleanFixture({ rows: [BASE_ROW] })
    const record = dataset.records[0]
    expect(record?.sourceRow).toBe(2)
    expect(record?.values).toEqual([...ALL_FIELD_KEYS].map((key) => (key in BASE_ROW ? BASE_ROW[key] : null)))
    expect(record?.recordId).toBe('rec-fixture-001')
    expect(record?.candidateDisplayId).toBeTruthy()
    expect(record?.importedAt).toBe('2026-05-08T09:30:00.000Z')
    expect(record?.dataAsOf).toBe(DATA_AS_OF)
    expect(record?.datasetId).toBe('dataset-fixture')
    expect(record?.normalizationLog.length).toBeGreaterThan(0)
  })
})

describe('表头回声行：默认只提示、不静默消费', () => {
  const echoed: RowInput = { ...BASE_ROW, requirementId: headerOf('requirementId') }

  it('含表头文本的行只提示、仍保留，并写入记录质量标记', () => {
    const { dataset } = cleanFixture({ rows: [echoed] })
    expect(dataset.records).toHaveLength(1)
    expect(dataset.report.headerEchoRowCount).toBe(1)
    expect(dataset.report.droppedRowCount).toBe(0)
    expect(codesOf(dataset.report.issues)).toContain('HEADER_ECHO_CELL')
    expect(derivedOf(dataset.records[0]).dataQualityFlags).toContain('HEADER_ECHO_CELL')
  })

  it('开启「剔除表头回声行」后才真正剔除，并计数、写入决策日志', () => {
    const { dataset } = cleanFixture({ rows: [echoed], settings: { dropHeaderEchoRows: true } })
    expect(dataset.records).toHaveLength(0)
    expect(dataset.report.headerEchoRowCount).toBe(1)
    expect(dataset.report.droppedRowCount).toBe(1)
    expect(dataset.report.counts.keptRowCount).toBe(0)
    const decision = dataset.report.decisionLog.find((entry) => entry.id === 'headerEcho')
    expect(decision?.detail).toContain('已剔除 1 行表头回声行')
    expect(decision?.confirmed).toBe(true)
  })
})

describe('文本与枚举铁律', () => {
  it('需求 ID 永远按文本保留前导 0，看起来像日期的文本也不被解析成日期', () => {
    const { dataset } = cleanFixture({
      rows: [
        { ...BASE_ROW, requirementId: '000123' },
        { ...BASE_ROW, requirementId: '2026-05-08' },
      ],
    })
    expect(dataset.records.map((record) => record.requirementId)).toEqual(['000123', '2026-05-08'])
  })

  it('未识别的枚举值保留原值、记 UNKNOWN_ENUM_VALUE，并禁用对应维度', () => {
    const { dataset } = cleanFixture({
      rows: [{ ...BASE_ROW, city: '□城市□', channel: '□渠道□', education: '□学历□' }],
    })
    const record = dataset.records[0]
    // 城市 / 渠道有「兜底其他」；教育这类没有兜底桶的值只能记未知
    expect(record?.city).toBe(OTHER)
    expect(record?.channel).toBe(OTHER)
    expect(record?.education).toBe(UNKNOWN)
    // 原值必须保留，供用户核对与修正
    expect(record?.cityRaw).toBe('□城市□')
    expect(record?.channelRaw).toBe('□渠道□')
    // 没有 *Raw 伴生字段的列，原值仍然完整保留在行原值里（可追溯）
    const educationColumn = ALL_FIELD_KEYS.indexOf('education')
    expect(record?.values[educationColumn]).toBe('□学历□')
    expect(codesOf(dataset.report.issues)).toEqual([
      'UNKNOWN_ENUM_VALUE',
      'UNKNOWN_ENUM_VALUE',
      'UNKNOWN_ENUM_VALUE',
    ])
    expect(dataset.metadata.disabledModules).toEqual(['房补对比', '渠道对比'])
  })

  it('缺失一律记 null：不用 0 冒充房补、不用否冒充未知、未知 ≠ 否', () => {
    const { dataset } = cleanFixture({ rows: [{ offerStatus: JOINED_STATUS }] })
    const record = dataset.records[0]
    expect(record?.requirementId).toBeNull()
    expect(record?.city).toBe(UNKNOWN)
    expect(record?.education).toBe(UNKNOWN)
    expect(record?.housingType).toBe(UNKNOWN)
    expect(record?.housingAmount).toBeNull()
    expect(record?.salaryAmount).toBeNull()
    expect(record?.graduationYear).toBeNull()
    expect(record?.school).toBeNull()
    expect(record?.isGptSchool).toBeNull()
  })
})

describe('日期只在日期列解析', () => {
  it('日期列按 YYYY-MM-DD 归一；非标准写法也能识别', () => {
    const { dataset } = cleanFixture({
      rows: [{ ...BASE_ROW, recruitmentStartDate: '2026/1/5', joiningDate: '2026年1月15日' }],
    })
    const record = dataset.records[0]
    expect(record?.recruitmentStartDate).toBe('2026-01-05')
    expect(record?.joiningDate).toBe('2026-01-15')
    expect(derivedOf(record).recruitmentCycleDays).toBe(10)
  })

  it('日月歧义（未确认顺序）不转换、只提示，并在报告里给出原值样例', () => {
    const { dataset } = cleanFixture({ rows: [{ ...BASE_ROW, joiningDate: '01/02/2026' }] })
    const record = dataset.records[0]
    expect(record?.joiningDate).toBeNull()
    expect(codesOf(dataset.report.issues)).toContain('DATE_NOT_CONVERTED')
    expect(dataset.report.ambiguousDateCount).toBe(1)
    expect(dataset.report.ambiguousDateSamples).toEqual(['01/02/2026'])
    expect(dataset.report.notes.some((note) => note.includes('日月歧义'))).toBe(true)
    // 周期因此保持未知，而不是猜一个日期
    expect(derivedOf(record).recruitmentCycleDays).toBeNull()
  })

  it('确认日月顺序后按确认口径换算，歧义计数清零', () => {
    const { dataset } = cleanFixture({
      rows: [{ ...BASE_ROW, joiningDate: '01/02/2026' }],
      settings: { ambiguousDateOrder: 'day-first' },
    })
    expect(dataset.records[0]?.joiningDate).toBe('2026-02-01')
    expect(dataset.report.ambiguousDateCount).toBe(0)
    expect(dataset.report.ambiguousDateSamples).toEqual([])
    const decision = dataset.report.decisionLog.find((entry) => entry.id === 'ambiguousDateOrder')
    expect(decision?.confirmed).toBe(true)
  })

  it('非法日期记 INVALID_DATE，值保持 null（不悄悄进位）', () => {
    const { dataset } = cleanFixture({ rows: [{ ...BASE_ROW, joiningDate: '2026-02-30' }] })
    expect(dataset.records[0]?.joiningDate).toBeNull()
    expect(codesOf(dataset.report.issues)).toContain('INVALID_DATE')
    expect(dataset.report.issueCountsByCode.INVALID_DATE).toBe(1)
  })
})

describe('周期与派生字段', () => {
  it('已入职且日期合法：实际周期 = 日历日差，计入核心分母', () => {
    const { dataset } = cleanFixture({ rows: [BASE_ROW] })
    const derived = derivedOf(dataset.records[0])
    expect(derived.recruitmentCycleDays).toBe(10)
    expect(derived.actualCycleEligible).toBe(true)
    expect(derived.plannedCycleEligible).toBe(false)
    expect(derived.countedInCoreDenominator).toBe(true)
    expect(derived.isRejected).toBe(false)
    expect(derived.isAccepted).toBe(true)
  })

  it('待入职：入职时间按计划日期使用（只提示），实际周期仍为未知', () => {
    const { dataset } = cleanFixture({ rows: [{ ...BASE_ROW, offerStatus: PENDING_JOINING_STATUS }] })
    const derived = derivedOf(dataset.records[0])
    expect(derived.recruitmentCycleDays).toBeNull()
    expect(derived.actualCycleEligible).toBe(false)
    expect(derived.plannedCycleEligible).toBe(true)
    expect(derived.countedInCoreDenominator).toBe(true)
    expect(codesOf(dataset.report.issues)).toEqual(['PLANNED_DATE_UNCERTAIN'])
    expect(dataset.report.notes.some((note) => note.includes('计划日期'))).toBe(true)
  })

  it('拒 offer：isRejected = true、isAccepted = false，仍计入核心分母', () => {
    const { dataset } = cleanFixture({
      rows: [
        {
          ...BASE_ROW,
          offerStatus: REJECTED_OFFER_STATUS,
          joiningDate: null,
          rejectionReason: '薪酬不满意',
        },
      ],
    })
    const record = dataset.records[0]
    const derived = derivedOf(record)
    expect(derived.isRejected).toBe(true)
    expect(derived.isAccepted).toBe(false)
    expect(derived.countedInCoreDenominator).toBe(true)
    // 没有入职日期就没有实际周期，不强行算
    expect(derived.recruitmentCycleDays).toBeNull()
  })

  it('未识别状态：既不接受也不拒绝（null），不计入核心分母，原值保留', () => {
    const { dataset } = cleanFixture({ rows: [{ ...BASE_ROW, offerStatus: '待定X' }] })
    const record = dataset.records[0]
    expect(record?.offerStatus).toBe(UNKNOWN)
    expect(record?.offerStatusRaw).toBe('待定X')
    const derived = derivedOf(record)
    expect(derived.isAccepted).toBeNull()
    expect(derived.isRejected).toBeNull()
    expect(derived.countedInCoreDenominator).toBe(false)
  })

  it('负周期只提示不删除，且不参与周期口径与核心分母', () => {
    const { dataset } = cleanFixture({
      rows: [{ ...BASE_ROW, recruitmentStartDate: '2026-01-11', joiningDate: '2026-01-01' }],
    })
    const derived = derivedOf(dataset.records[0])
    expect(derived.recruitmentCycleDays).toBeNull()
    expect(derived.actualCycleEligible).toBe(false)
    expect(dataset.report.negativeCycleCount).toBe(1)
    expect(codesOf(dataset.report.issues)).toContain('NEGATIVE_CYCLE')
    expect(dataset.report.counts.keptRowCount).toBe(1)
  })

  it('超长周期只提示核实，阈值可配置且不截尾', () => {
    const rows: readonly (RowInput | null)[] = [{ ...BASE_ROW, joiningDate: '2026-12-31' }]
    const { dataset } = cleanFixture({ rows })
    expect(dataset.report.cycleTooLongCount).toBe(1)
    expect(derivedOf(dataset.records[0]).recruitmentCycleDays).toBe(364)
    expect(codesOf(dataset.report.issues)).toContain('CYCLE_TOO_LONG')

    const relaxed = cleanFixture({ rows, settings: { cycleTooLongDays: 365 } })
    expect(relaxed.dataset.report.cycleTooLongCount).toBe(0)
    // 阈值只影响提示，不影响数值本身
    expect(derivedOf(relaxed.dataset.records[0]).recruitmentCycleDays).toBe(364)
  })
})

describe('薪资口径：未确认不猜币种与计薪周期', () => {
  /** 用户反馈 ① 之后默认口径是「人民币元/月」，因此这一组用例必须**显式**选「暂不确定」 */
  const UNCONFIRMED = buildSalarySetting('暂不确定')

  it('未确认：金额按原值保留、记 SALARY_UNIT_UNCONFIRMED、禁用待遇对比（但仍报有效样本数）', () => {
    const { dataset } = cleanFixture({
      rows: [{ ...BASE_ROW, salaryAmount: 200 }],
      settings: { salary: UNCONFIRMED },
    })
    expect(dataset.records[0]?.salaryAmount).toBe(200)
    // 未确认时币种与计薪周期**都不写**，不能在清洗结果里凭空出现「元/月」
    expect(dataset.records[0]?.currency).toBeNull()
    expect(dataset.records[0]?.salaryUnit).toBeNull()
    expect(codesOf(dataset.report.issues)).toEqual(['SALARY_UNIT_UNCONFIRMED'])
    expect(dataset.metadata.salary.comparable).toBe(false)
    const salary = dataset.report.metricAvailability.find((entry) => entry.module === '薪资对比')
    expect(salary?.available).toBe(false)
    expect(salary?.validSampleCount).toBe(1)
    expect(dataset.report.notes.some((note) => note.includes('禁用待遇对比'))).toBe(true)
  })

  it('默认口径（不传 salary 设置）：按人民币元/月标注币种与周期，且不产生未确认问题', () => {
    const { dataset } = cleanFixture({ rows: [{ ...BASE_ROW, salaryAmount: 200 }] })
    expect(dataset.metadata.salary.option).toBe('人民币元/月')
    expect(dataset.records[0]?.currency).toBe('CNY')
    expect(dataset.records[0]?.salaryUnit).toBe('元/月')
    expect(dataset.report.issueCountsByCode.SALARY_UNIT_UNCONFIRMED).toBeUndefined()
  })

  it('确认口径（人民币元/月）后可参与待遇对比，不再产生未确认问题', () => {
    const salary = buildSalarySetting('人民币元/月', CONFIRMED_AT)
    const { dataset } = cleanFixture({
      rows: [{ ...BASE_ROW, salaryAmount: 200 }],
      settings: { salary },
    })
    expect(dataset.report.issueCountsByCode.SALARY_UNIT_UNCONFIRMED).toBeUndefined()
    expect(dataset.metadata.salary).toEqual(salary)
    expect(
      dataset.report.metricAvailability.find((entry) => entry.module === '薪资对比')?.available,
    ).toBe(true)
    expect(dataset.report.decisionLog.find((entry) => entry.id === 'salary')?.confirmed).toBe(true)
  })

  it('整列没有薪资时既不提示也不折算：空值保持 null', () => {
    const { dataset } = cleanFixture({ rows: [BASE_ROW] })
    expect(dataset.records[0]?.salaryAmount).toBeNull()
    expect(codesOf(dataset.report.issues)).toEqual([])
    expect(
      dataset.report.metricAvailability.find((entry) => entry.module === '薪资对比')?.validSampleCount,
    ).toBe(0)
  })
})

describe('重复处理：确认后才减少样本', () => {
  const duplicateRows: readonly (RowInput | null)[] = [BASE_ROW, { ...BASE_ROW }]

  it('完全重复默认只提示、样本不减少，消息说明尚未减少', () => {
    const { dataset } = cleanFixture({ rows: duplicateRows })
    expect(dataset.records).toHaveLength(2)
    expect(dataset.report.counts.removedDuplicateCount).toBe(0)
    expect(dataset.report.exactDuplicateGroups).toHaveLength(1)
    expect(dataset.report.duplicateRowCount).toBe(2)
    const issue = dataset.report.issues.find((entry) => entry.code === 'EXACT_DUPLICATE')
    expect(issue?.sourceRow).toBe(2)
    expect(issue?.message).toContain('待您确认后才会减少样本')
    expect(dataset.records.map((record) => record.dedupDecision.action)).toEqual([
      'pendingUserConfirmation',
      'pendingUserConfirmation',
    ])
    expect(
      dataset.records.every((record) => derivedOf(record).dataQualityFlags.includes('EXACT_DUPLICATE')),
    ).toBe(true)
    expect(dataset.report.decisionLog.find((entry) => entry.id === 'dedup')?.detail).toContain(
      '样本不减少',
    )
  })

  it('确认去重后每组保留首条，被移除的行不计入记录但计入报告', () => {
    const { dataset } = cleanFixture({ rows: duplicateRows, settings: { dedupConfirmed: true } })
    expect(dataset.records).toHaveLength(1)
    expect(dataset.records[0]?.sourceRow).toBe(2)
    expect(dataset.records[0]?.dedupDecision.action).not.toBe('removedAsDuplicate')
    expect(dataset.report.counts.removedDuplicateCount).toBe(1)
    expect(dataset.report.counts.keptRowCount).toBe(1)
  })

  it('「保留全部」策略下即使确认也不移除任何行', () => {
    const { dataset } = cleanFixture({
      rows: duplicateRows,
      settings: { dedupConfirmed: true, dedupStrategy: '保留全部' },
    })
    expect(dataset.records).toHaveLength(2)
    expect(dataset.report.counts.removedDuplicateCount).toBe(0)
  })

  it('疑似重复只提示、永不自动合并（疑似 ≠ 已确认重复）', () => {
    const rows: readonly (RowInput | null)[] = [
      { ...BASE_ROW, candidateName: '张三' },
      { ...BASE_ROW, candidateName: '张三', city: '北京' },
    ]
    const { dataset } = cleanFixture({ rows })
    expect(dataset.records).toHaveLength(2)
    expect(dataset.report.suspectedDuplicateGroups).toHaveLength(1)
    expect(dataset.report.counts.removedDuplicateCount).toBe(0)
    expect(codesOf(dataset.report.issues)).toContain('SUSPECTED_DUPLICATE')
    expect(dataset.records.map((record) => record.dedupDecision.decidedBy)).toEqual([
      'default',
      'default',
    ])

    // 用户确认去重后，疑似分组同样按「每组保留首条」处理：决定权在用户，不在算法
    const confirmed = cleanFixture({ rows, settings: { dedupConfirmed: true } })
    expect(confirmed.dataset.records).toHaveLength(1)
    expect(confirmed.dataset.records[0]?.sourceRow).toBe(2)
    expect(confirmed.dataset.records[0]?.dedupDecision.decidedBy).toBe('user')
    expect(confirmed.dataset.report.counts.removedDuplicateCount).toBe(1)
  })
})

describe('扩展列：只有用户显式映射后才存在', () => {
  function firstExtensionKey(): ExtensionFieldKey {
    const [first] = EXTENSION_FIELDS
    if (first === undefined) {
      throw new Error('扩展列字段未登记')
    }
    return first.key
  }

  it('未映射的额外列不取值、不产生问题、不影响指标', () => {
    const { dataset } = cleanFixture({
      rows: [BASE_ROW],
      extraColumns: [{ header: '宿舍地址', values: ['A 栋'] }],
    })
    expect(dataset.report.issues).toEqual([])
    expect(dataset.records[0]?.extensions).toEqual({})
    expect(dataset.report.decisionLog.some((entry) => entry.id === 'extensions')).toBe(false)
  })

  it('用户显式映射后按扩展列取值，并在决策日志里说明不折现', () => {
    const extension = firstExtensionKey()
    const { dataset } = cleanFixture({
      rows: [BASE_ROW],
      extraColumns: [{ header: '宿舍地址', values: ['2026-05-08'] }],
      mappingFor: (sheet) =>
        mappingWithExtension(sheet, { columnIndex: ALL_FIELD_KEYS.length, extension }),
    })
    expect(dataset.records[0]?.extensions[extension]).toBeDefined()
    const decision = dataset.report.decisionLog.find((entry) => entry.id === 'extensions')
    expect(decision?.detail).toContain('已映射 1 个扩展列')
    // 金额类扩展列（住宿价值等）不折现、也不并入现金房补
    expect(decision?.detail).toContain('不并入现金房补')
    expect(dataset.report.issues).toEqual([])
  })

  it('扩展列本身缺失不产生任何问题（缺失 ≠ 错误）', () => {
    const extension = firstExtensionKey()
    const { dataset } = cleanFixture({
      rows: [BASE_ROW, { ...BASE_ROW, requirementId: 'REQ-002' }],
      extraColumns: [{ header: '宿舍地址', values: ['2026-05-08', null] }],
      mappingFor: (sheet) =>
        mappingWithExtension(sheet, { columnIndex: ALL_FIELD_KEYS.length, extension }),
    })
    expect(dataset.records[0]?.extensions[extension]).toBeDefined()
    expect(dataset.records[1]?.extensions[extension]).toBeUndefined()
    expect(codesOf(dataset.report.issues)).toEqual([])
  })
})

describe('元数据与报告同源，口径可追溯', () => {
  it('元数据带规则版本、来源、口径与计数，计数与报告完全一致', () => {
    const { dataset } = cleanFixture({ rows: [BASE_ROW] })
    expect(dataset.metadata.datasetId).toBe('dataset-fixture')
    expect(dataset.metadata.batchId).toBe('batch-fixture')
    expect(dataset.metadata.datasetName).toBe('夹具数据集')
    expect(dataset.metadata.sourceSheet).toBe('名单')
    expect(dataset.metadata.headerRowIndex).toBe(1)
    expect(dataset.metadata.importedAt).toBe('2026-05-08T09:30:00.000Z')
    expect(dataset.metadata.importMode).toBe('新建快照')
    expect(dataset.metadata.dedupStrategy).toBe('确认后每组保留首条')
    expect(dataset.metadata.dataAsOf).toBe(DATA_AS_OF)
    // 规则版本 = 语义基线 + 本次**配置摘要**（步骤12）：改了名单 / 别名 / 去重策略就换版本，
    // 旧数据集保存的是它当时那份摘要，所以「旧报告不因新名单改变」是可核对的事实。
    expect(dataset.metadata.ruleVersion).toEqual({
      ...CURRENT_RULE_VERSION,
      configRevision: dataset.metadata.ruleVersion.configRevision,
    })
    expect(dataset.metadata.ruleVersion.configRevision).toMatch(/^[0-9A-F]{8}$/)
    expect(dataset.metadata.counts).toEqual(dataset.report.counts)
    expect(dataset.metadata.disabledModules).toEqual([])
    // 报告与元数据共用同一份说明，界面不必各写一份
    expect(dataset.metadata.notes).toBe(dataset.report.notes)
  })

  it('配置摘要随名单变化：改名单换版本，同一名单复算不变（步骤12 验收）', () => {
    /*
     * 这是步骤12 的核心可核对性：`rulesVersion` 只在规则**实现**变化时才动，
     * 无法表达「用户改了名单」。配置摘要补上这一层：
     * - 同一份设置重复清洗 → 摘要完全一致（「同配置同结果」可核对）；
     * - 改了名单 → 摘要变化（报告能回溯到「按哪套名单算的」）；
     * - 旧数据集保存的是它**当时**那份摘要，所以后来的修改不会追溯改变旧报告。
     */
    const base = cleanFixture({ rows: [BASE_ROW] })
    const again = cleanFixture({ rows: [BASE_ROW] })
    expect(again.dataset.metadata.ruleVersion.configRevision).toBe(
      base.dataset.metadata.ruleVersion.configRevision,
    )

    const changed = cleanFixture({
      rows: [BASE_ROW],
      settings: { gptList: ['合成大学', '另一所合成学院'] },
    })
    expect(changed.dataset.metadata.ruleVersion.configRevision).not.toBe(
      base.dataset.metadata.ruleVersion.configRevision,
    )

    // 旧数据集对象本身没有被改动（新摘要只属于新数据集）
    expect(base.dataset.metadata.ruleVersion.configRevision).toBe(
      buildConfigRevision(base.input.settings),
    )
    expect(changed.dataset.metadata.ruleVersion.configRevision).toBe(
      buildConfigRevision(changed.input.settings),
    )
  })

  it('决策日志覆盖全部关键口径，未确认项明确标为未确认', () => {
    const { dataset } = cleanFixture({ rows: [BASE_ROW] })
    const entries = dataset.report.decisionLog
    expect(entries.map((entry) => entry.id)).toEqual([
      'dataAsOf',
      'salary',
      'ambiguousDateOrder',
      'dedup',
      'importMode',
      'emptyRows',
      'hiddenRows',
      'headerEcho',
      'gptList',
      'schoolAliases',
      'cycleTooLong',
    ])
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    expect(byId.get('salary')?.confirmed).toBe(false)
    expect(byId.get('dedup')?.confirmed).toBe(false)
    expect(byId.get('ambiguousDateOrder')?.confirmed).toBe(false)
    expect(byId.get('importMode')?.confirmed).toBe(true)
    expect(byId.get('cycleTooLong')?.confirmed).toBe(true)
    expect(entries.every((entry) => entry.label.length > 0 && entry.detail.length > 0)).toBe(true)
  })

  it('问题同时按代码与严重度汇总，问题行数按行去重', () => {
    const { dataset } = cleanFixture({
      rows: [{ ...BASE_ROW, salaryAmount: 200, joiningDate: '01/02/2026' }],
      // 显式选「暂不确定」才能触发薪资口径问题（默认口径自用户反馈 ① 起是人民币元/月）
      settings: { salary: buildSalarySetting('暂不确定') },
    })
    expect(dataset.report.issueCountsByCode).toEqual({
      SALARY_UNIT_UNCONFIRMED: 1,
      DATE_NOT_CONVERTED: 1,
    })
    expect(dataset.report.issueCountsBySeverity).toEqual({ 阻断: 0, 字段错误: 0, 警告: 2 })
    // 同一行两个问题只算一行
    expect(dataset.report.counts.issueRowCount).toBe(1)
    const flags = [...derivedOf(dataset.records[0]).dataQualityFlags].sort()
    expect(flags).toEqual(['DATE_NOT_CONVERTED', 'SALARY_UNIT_UNCONFIRMED'])
  })
})




