/**
 * 人工修正的单测（用户需求 ①，2026-09-27）。
 *
 * 口径由用户在问答中确认，硬约束见 `docs/DECISIONS.md` D-091：
 *
 * 1. 修正是**清洗的输入**（不是界面状态）：改完立刻由清洗层重算，问题码跟着变；
 * 2. **五栏可回溯**：原值 / 自动清洗值 / 人工修正值 / 原因 / 时间；
 * 3. **缺失一律 null**：把值改成空白就是缺失，绝不写 0；
 * 4. **换表不套用**：表签名不一致时一条修正都不应用，并在报告说明里如实写出来；
 * 5. 修正进配置摘要（改修正 = 换版本），且**录入顺序不影响摘要**。
 *
 * 本文件只验证清洗层；界面（异常行清单与弹窗）由 jsdom 与端到端用例覆盖。
 */

import { describe, expect, it } from 'vitest'

import { buildConfigRevision, type DataQualityIssueCode, type ManualCorrection } from '../domain'
import { cleanSheet } from './normalize'
import { sheetSignatureOf } from './sheetSignature'
import { buildCleaningInput, cleanFixture, type RowInput } from './testFixtures'

/** 一行：城市写的是别名表里没有的写法，启动日期非法 —— 两处都有问题，便于验证「改完问题码跟着变」 */
const ROW: RowInput = {
  offerStatus: '已入职',
  requirementId: 'REQ-7001',
  city: '未识别城市样例',
  recruitmentStartDate: '不是日期',
  joiningDate: '2026-03-10',
  salaryAmount: 4000,
}

function correctionOf(
  fixture: ReturnType<typeof cleanFixture>,
  input: { readonly field: ManualCorrection['field']; readonly correctedValue: string; readonly sourceRow?: number },
): ManualCorrection {
  return {
    sourceSheet: fixture.sheet.sourceSheet,
    sourceRow: input.sourceRow ?? fixture.sheet.rows[0]?.sourceRow ?? 2,
    field: input.field,
    correctedValue: input.correctedValue,
    reason: '合成测试：来源表写错了，按 HR 确认值修正',
    correctedAt: '2026-09-27T10:00:00.000Z',
  }
}

function flagsOf(dataset: ReturnType<typeof cleanFixture>['dataset']): readonly DataQualityIssueCode[] {
  return dataset.records[0]?.derived?.dataQualityFlags ?? []
}

describe('人工修正：默认没有修正时行为不变', () => {
  it('空修正清单 + 无签名 → 值与原逻辑一致，且没有任何人工修正标记', () => {
    const { dataset } = cleanFixture({ rows: [ROW] })
    expect(dataset.records[0]?.city).toBe('其他')
    expect(flagsOf(dataset)).not.toContain('MANUAL_CORRECTION_APPLIED')
    expect(dataset.report.notes.some((note) => note.includes('人工修改'))).toBe(false)
  })
})

describe('人工修正：改一格并留下五栏', () => {
  it('城市改成「上海」→ 值生效、日志带原值/自动值/修正值/原因/时间，并出现人工修正标记', () => {
    const base = cleanFixture({ rows: [ROW] })
    const correction = correctionOf(base, { field: 'city', correctedValue: '上海' })
    const { dataset } = cleanFixture({
      rows: [ROW],
      settings: {
        manualCorrections: [correction],
        manualCorrectionsSheetSignature: sheetSignatureOf(base.sheet),
      },
    })

    const record = dataset.records[0]
    expect(record?.city).toBe('上海')

    const entry = (record?.normalizationLog ?? []).find((item) => item.rule === 'manual-correction')
    expect(entry, '必须留下一条 manual-correction 日志').toBeDefined()
    expect(entry?.field).toBe('city')
    expect(entry?.rawValue).toBe('未识别城市样例') // 原值
    expect(entry?.autoValue).toBe('其他') // 自动清洗值（规则本来算出来的）
    expect(entry?.normalizedValue).toBe('上海') // 人工修正值
    expect(entry?.reason).toBe(correction.reason)
    expect(entry?.ruleVersion).toBeTruthy()
    expect(entry?.source).toBe('manual')
    expect(entry?.confirmed).toBe(true)
    expect(entry?.issueCodes).toContain('MANUAL_CORRECTION_APPLIED')

    expect(flagsOf(dataset)).toContain('MANUAL_CORRECTION_APPLIED')
    expect(dataset.report.notes.some((note) => note.includes('含 1 处人工修改'))).toBe(true)
  })

  it('修正非法日期 → 原来的「日期非法」标记随之消失（问题码按重算结果更新）', () => {
    const base = cleanFixture({ rows: [ROW] })
    const before = flagsOf(base.dataset)
    expect(before, '前置条件：原值应当触发日期类问题').toContain('INVALID_DATE')

    const { dataset } = cleanFixture({
      rows: [ROW],
      settings: {
        manualCorrections: [correctionOf(base, { field: 'recruitmentStartDate', correctedValue: '2026-03-01' })],
        manualCorrectionsSheetSignature: sheetSignatureOf(base.sheet),
      },
    })
    expect(dataset.records[0]?.recruitmentStartDate).toBe('2026-03-01')
    expect(flagsOf(dataset)).not.toContain('INVALID_DATE')
    expect(flagsOf(dataset)).toContain('MANUAL_CORRECTION_APPLIED')
  })

  it('改成空白 = 缺失（null），绝不写 0', () => {
    const base = cleanFixture({ rows: [ROW] })
    const { dataset } = cleanFixture({
      rows: [ROW],
      settings: {
        manualCorrections: [correctionOf(base, { field: 'salaryAmount', correctedValue: '' })],
        manualCorrectionsSheetSignature: sheetSignatureOf(base.sheet),
      },
    })
    const record = dataset.records[0]
    expect(record?.salaryAmount).toBeNull()
    expect(record?.salaryAmount).not.toBe(0)
  })
})

describe('人工修正：换表不套用', () => {
  it('表签名不一致（或缺失）→ 一条都不应用，并在报告说明里写出来', () => {
    const base = cleanFixture({ rows: [ROW] })
    const correction = correctionOf(base, { field: 'city', correctedValue: '上海' })

    for (const signature of [null, 'DEADBEEF']) {
      const { dataset } = cleanFixture({
        rows: [ROW],
        settings: {
          manualCorrections: [correction],
          manualCorrectionsSheetSignature: signature,
        },
      })
      expect(dataset.records[0]?.city, `签名=${String(signature)} 时不该应用`).toBe('其他')
      expect(flagsOf(dataset)).not.toContain('MANUAL_CORRECTION_APPLIED')
      expect(
        dataset.report.notes.some((note) => note.includes('没有应用')),
        '必须如实说明「有 N 处修正没有应用」',
      ).toBe(true)
    }
  })
})

describe('人工修正：进配置摘要且与录入顺序无关', () => {
  it('改修正换摘要；同样两条修正换个录入顺序，摘要不变', () => {
    const base = cleanFixture({ rows: [ROW] })
    const signature = sheetSignatureOf(base.sheet)
    const a = correctionOf(base, { field: 'city', correctedValue: '上海' })
    const b = correctionOf(base, { field: 'recruitmentStartDate', correctedValue: '2026-03-01' })

    const none = buildConfigRevision(base.settings)
    const one = buildConfigRevision({ ...base.settings, manualCorrections: [a], manualCorrectionsSheetSignature: signature })
    const two = buildConfigRevision({
      ...base.settings,
      manualCorrections: [a, b],
      manualCorrectionsSheetSignature: signature,
    })
    const twoReordered = buildConfigRevision({
      ...base.settings,
      manualCorrections: [b, a],
      manualCorrectionsSheetSignature: signature,
    })
    const changedValue = buildConfigRevision({
      ...base.settings,
      manualCorrections: [{ ...a, correctedValue: '广州' }],
      manualCorrectionsSheetSignature: signature,
    })

    expect(one).not.toBe(none)
    expect(two).not.toBe(one)
    expect(twoReordered).toBe(two)
    expect(changedValue).not.toBe(one)
    // 只改「原因」不换版本：原因是回溯信息，不是结果
    expect(
      buildConfigRevision({
        ...base.settings,
        manualCorrections: [{ ...a, reason: '换了个说法' }],
        manualCorrectionsSheetSignature: signature,
      }),
    ).toBe(one)
  })
})

describe('人工修正：与 recordId 无关（换一次清洗照样生效）', () => {
  it('即使两次清洗的 recordId 完全不同，修正仍按物理行号生效', () => {
    const base = cleanFixture({ rows: [ROW] })
    const parts = buildCleaningInput({
      rows: [ROW],
      settings: {
        manualCorrections: [correctionOf(base, { field: 'city', correctedValue: '上海' })],
        manualCorrectionsSheetSignature: sheetSignatureOf(base.sheet),
      },
    })

    /*
     * 关键：这里刻意用**完全不同**的 recordId 生成器跑两次。
     * 应用里的 recordId 来自 `newRecordId()`（随机），因此修正**不能**以 recordId 为键
     * —— 物理行号才是稳定键（见 `ManualCorrection` 的注释）。
     */
    let counter = 0
    const run = () => {
      counter += 1
      return cleanSheet({
        sheet: parts.sheet,
        mapping: parts.mapping,
        settings: parts.settings,
        datasetId: `dataset-${String(counter)}`,
        batchId: `batch-${String(counter)}`,
        datasetName: '合成修正用例',
        importedAt: '2026-09-27T10:00:00.000Z',
        createRecordId: () => `REC-${String(counter)}-${String(Math.floor(Math.random() * 1e9))}`,
      })
    }

    const first = run()
    const second = run()
    expect(first.records[0]?.recordId).not.toBe(second.records[0]?.recordId)
    expect(first.records[0]?.city).toBe('上海')
    expect(second.records[0]?.city).toBe('上海')
    expect(first.records[0]?.derived?.dataQualityFlags).toContain('MANUAL_CORRECTION_APPLIED')
    expect(second.records[0]?.derived?.dataQualityFlags).toContain('MANUAL_CORRECTION_APPLIED')
  })
})
