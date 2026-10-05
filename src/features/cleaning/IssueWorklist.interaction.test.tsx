// @vitest-environment jsdom
/**
 * 异常行清单与人工修正的**真实 DOM 交互**测试（用户需求 ①，2026-09-27）。
 *
 * ## 这一组证的是什么
 *
 * 需求原文：「清洗数据后的异常值，提供修改的地方」。因此这里按用户的真实动作顺序验证：
 *
 * 1. 异常行**能被找到**：清单把这些行列出来，并显示命中的问题（不用再翻页找徽章）；
 * 2. 点「修改这一格」→ 弹窗**把原值与自动清洗值都摆出来**（改的是规则算错的那一格）；
 * 3. **原因必填**：不填保存会被挡住，并说明原因；数据集**一个字节都没变**；
 * 4. 填好保存 → 值真的变了，**原来的问题标记随之消失**，并出现「已人工修改」与撤销入口；
 * 5. 点撤销 → 那一格回到规则算出的值。
 *
 * ## 为什么用「重新跑 cleanSheet」而不是改组件里的记录
 *
 * 这正是 D-091 的核心：修正是**清洗的输入**。harness 与 `CleaningEditor` 用同一条数据流
 * （设置 → `cleanSheet` → 报告与记录），因此这里的断言等价于「改设置后整份数据重算」。
 *
 * 图表 / ECharts 不参与本文件；端到端由 `tests/e2e/local-flow.spec.ts` 在真实 Chrome 里覆盖。
 */

import { useMemo, useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanSheet, sheetSignatureOf } from '../../cleaning'
import type { CleaningSettings, DataQualityIssueCode, ManualCorrection } from '../../domain'
import { buildCleaningInput, cleanFixture, type RowInput } from '../../cleaning/testFixtures'
import IssueWorklistPanel from './IssueWorklistPanel'
import { FIX_REASON_REQUIRED, WORKLIST_FIX_LABEL, WORKLIST_UNDO_LABEL } from './manualFixText'

afterEach(cleanup)

/** 城市写法不在别名表里 → 触发「未识别的枚举值（已保留原值）」；其余字段都给合法值 */
const ROWS: readonly RowInput[] = [
  { offerStatus: '已入职', requirementId: 'REQ-8001', city: '未识别城市样例', salaryAmount: 4000 },
  { offerStatus: '已入职', requirementId: 'REQ-8002', city: '上海', salaryAmount: 4200 },
]

/** 与 CleaningEditor 同一条数据流：设置 → cleanSheet → 报告 + 记录 */
function Harness() {
  const parts = useMemo(() => buildCleaningInput({ rows: ROWS }), [])
  const sheetSignature = useMemo(() => sheetSignatureOf(parts.sheet), [parts.sheet])
  const [settings, setSettings] = useState<CleaningSettings>(parts.settings)
  const [lastNotice, setLastNotice] = useState('')

  const dataset = useMemo(
    () =>
      cleanSheet({
        sheet: parts.sheet,
        mapping: parts.mapping,
        settings,
        datasetId: 'dataset-fix',
        batchId: 'batch-fix',
        datasetName: '合成修正用例',
        importedAt: '2026-09-27T10:00:00.000Z',
        createRecordId: () => 'REC-FIX-1',
      }),
    [parts, settings],
  )

  const apply = (input: {
    readonly sourceRow: number
    readonly field: ManualCorrection['field']
    readonly correctedValue: string
    readonly reason: string
  }): void => {
    const next: ManualCorrection = {
      sourceSheet: parts.sheet.sourceSheet,
      sourceRow: input.sourceRow,
      field: input.field,
      correctedValue: input.correctedValue,
      reason: input.reason,
      correctedAt: '2026-09-27T11:00:00.000Z',
    }
    setSettings((current) => ({
      ...current,
      manualCorrections: [
        ...current.manualCorrections.filter(
          (item) => !(item.sourceRow === input.sourceRow && item.field === input.field),
        ),
        next,
      ],
      manualCorrectionsSheetSignature: sheetSignature,
    }))
    setLastNotice('已保存一处人工修改')
  }

  const remove = (correction: ManualCorrection): void => {
    setSettings((current) => ({
      ...current,
      manualCorrections: current.manualCorrections.filter(
        (item) => !(item.sourceRow === correction.sourceRow && item.field === correction.field),
      ),
      manualCorrectionsSheetSignature: null,
    }))
    setLastNotice('已撤销这处修改')
  }

  return (
    <>
      <p data-testid="notice">{lastNotice}</p>
      <p data-testid="revision">{dataset.metadata.ruleVersion.configRevision}</p>
      <ul data-testid="values">
        {dataset.records.map((record) => (
          <li key={record.recordId}>
            {record.sourceRow}：{String(record.city)}｜
            {((record.derived?.dataQualityFlags ?? []) as readonly DataQualityIssueCode[]).join(',')}
          </li>
        ))}
      </ul>
      <IssueWorklistPanel
        corrections={settings.manualCorrections}
        datasetName="合成修正用例"
        onApply={apply}
        onRemove={remove}
        records={dataset.records}
        report={dataset.report}
        sheetSignature={sheetSignature}
      />
    </>
  )
}

function flagsRowOf(sourceRow: number): string {
  const items = screen.getByTestId('values').querySelectorAll('li')
  for (const item of items) {
    if (item.textContent?.startsWith(`${String(sourceRow)}：`)) {
      return item.textContent
    }
  }
  throw new Error(`没找到第 ${String(sourceRow)} 行`)
}

describe('用户需求①：异常行清单与人工修正', () => {
  it('前置条件：合成数据里第 2 行确实带「未识别枚举值」标记', () => {
    const { dataset } = cleanFixture({ rows: ROWS })
    const flags = dataset.records[0]?.derived?.dataQualityFlags ?? []
    expect(flags).toContain('UNKNOWN_ENUM_VALUE')
  })

  it('清单列出异常行；点修改 → 弹窗显示原值与自动清洗值 → 原因必填 → 保存后重算 → 可撤销', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    // 1）异常行在清单里，且显示命中的问题（不再是"翻页找徽章"）
    const worklist = screen.getByRole('heading', { name: /异常行清单/ })
    const panel = worklist.closest('section')
    expect(panel).not.toBeNull()
    const scoped = within(panel as HTMLElement)
    expect(scoped.getByText('未识别的枚举值（已保留原值）')).toBeTruthy()
    expect(flagsRowOf(2)).toContain('UNKNOWN_ENUM_VALUE')
    const revisionBefore = screen.getByTestId('revision').textContent

    /** 清单里包含这一条问题的那一行（同一份合成数据里其他行也可能有问题，因此按内容定位） */
    const anomalyRow = scoped
      .getAllByRole('row')
      .find((row) => row.textContent?.includes('未识别的枚举值（已保留原值）'))
    expect(anomalyRow, '清单里应当有这一行').toBeDefined()
    const rowScope = within(anomalyRow as HTMLElement)

    // 2）打开改值窗口：原值与自动清洗值都要在
    await user.click(rowScope.getByRole('button', { name: WORKLIST_FIX_LABEL }))
    const dialog = screen.getByRole('dialog', { name: /人工修改这一格/ })
    expect(within(dialog).getByText('未识别城市样例')).toBeTruthy() // 原值
    expect(within(dialog).getAllByText('其他').length).toBeGreaterThan(0) // 自动清洗值

    // 3）原因没填 → 挡住，并说明为什么；数据一个字节都没变
    await user.click(within(dialog).getByRole('button', { name: '保存这处修改' }))
    expect(within(dialog).getByText(FIX_REASON_REQUIRED)).toBeTruthy()
    expect(flagsRowOf(2)).toContain('UNKNOWN_ENUM_VALUE')
    expect(screen.getByTestId('revision').textContent).toBe(revisionBefore)

    // 4）填新值与原因 → 保存 → 值变了、原问题标记消失、出现撤销入口
    // 明确选「城市」而不是依赖默认字段：默认值只是便利，正确性不能建立在它上面
    await user.selectOptions(within(dialog).getByLabelText('要改的字段'), 'city')
    const valueInput = within(dialog).getByLabelText('改成什么')
    await user.clear(valueInput)
    await user.type(valueInput, '上海')
    await user.type(within(dialog).getByLabelText('为什么这么改（必填）'), '来源表写法有误，按 HR 确认')
    await user.click(within(dialog).getByRole('button', { name: '保存这处修改' }))

    expect(screen.getByTestId('notice').textContent).toBe('已保存一处人工修改')
    expect(flagsRowOf(2)).toContain('上海')
    expect(flagsRowOf(2), '原来的「未识别枚举值」必须随重算消失').not.toContain('UNKNOWN_ENUM_VALUE')
    expect(flagsRowOf(2), '应当出现「这一格是人工修改的」标记').toContain('MANUAL_CORRECTION_APPLIED')
    // 修正进了配置摘要：否则「同一份数据两次分析不同」无法解释
    expect(screen.getByTestId('revision').textContent).not.toBe(revisionBefore)

    // 5）撤销 → 回到规则算出的值（改完之后那一行的问题徽章已经消失，因此按撤销按钮定位）
    await user.click(scoped.getByRole('button', { name: WORKLIST_UNDO_LABEL }))
    expect(screen.getByTestId('notice').textContent).toBe('已撤销这处修改')
    expect(flagsRowOf(2)).toContain('其他')
    expect(flagsRowOf(2)).toContain('UNKNOWN_ENUM_VALUE')
    expect(screen.getByTestId('revision').textContent).toBe(revisionBefore)
  })
})
