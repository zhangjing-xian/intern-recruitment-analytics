// @vitest-environment jsdom
/**
 * 「已提交的数据集什么时候会被作废」的真实 DOM 交互测试（2026-09-27 晚）。
 *
 * ## 这一组守的是什么
 *
 * 用户在人工验收里说：「有时候已经上传了数据，但重新进入分析看板，又要重新确认清洗预览」。
 * 查下去 `CleaningEditor` 里那个「编辑即写回会话草稿」的 `useEffect` **在挂载时也会跑**，
 * 而写回草稿的语义是「设置变了 → 已提交的结论作废」——
 * 于是**只是打开（或回到）清洗预览页、一个字都没改**，刚提交的数据集就被扔掉了。
 *
 * 现在的口径：**改了设置才作废**。这一组用真实渲染把它钉住：
 * 1. 挂载后数据集仍然在（这条以前是失败的）；
 * 2. 真的改一个设置之后，数据集确实被作废（这条不能因为修 bug 而失效）。
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { cleanSheet } from '../../cleaning'
import { buildCleaningInput, type RowInput } from '../../cleaning/testFixtures'
import {
  clearCleaningSettingsDraft,
  clearImportSession,
  commitNormalizedDataset,
  getCleaningSession,
  saveCleaningSettingsDraft,
} from '../../storage/sessionStore'
import CleaningEditor from './CleaningEditor'

afterEach(cleanup)
beforeEach(() => {
  // 内存会话是模块级状态：每个用例从干净状态开始，避免互相污染
  clearCleaningSettingsDraft()
  clearImportSession()
})

/** 合成数据：两行合法记录，字段齐全（AGENTS §2.6 只用合成数据） */
const ROWS: readonly RowInput[] = [
  { offerStatus: '已入职', requirementId: 'REQ-9001', city: '上海', salaryAmount: 4000 },
  { offerStatus: '拒绝offer', requirementId: 'REQ-9002', city: '广州', salaryAmount: 4200 },
]

/** 与用户真实操作顺序一致：先有设置草稿 → 提交数据集 → 再回到清洗页 */
function seedCommittedDataset(): ReturnType<typeof buildCleaningInput> {
  const parts = buildCleaningInput({ rows: ROWS })
  saveCleaningSettingsDraft(parts.settings)
  commitNormalizedDataset(
    cleanSheet({
      sheet: parts.sheet,
      mapping: parts.mapping,
      settings: parts.settings,
      datasetId: 'dataset-keep',
      batchId: 'batch-keep',
      datasetName: '合成数据集',
      importedAt: '2026-09-27T10:00:00.000Z',
      createRecordId: () => 'REC-KEEP-1',
    }),
  )
  return parts
}

function renderEditor(parts: ReturnType<typeof buildCleaningInput>) {
  return render(
    <MemoryRouter>
      <CleaningEditor
        initialSettings={parts.settings}
        mapping={parts.mapping}
        sheet={parts.sheet}
      />
    </MemoryRouter>,
  )
}

describe('清洗页与已提交数据集的关系', () => {
  it('只是打开清洗预览页（没改任何设置）不会作废已提交的数据集', async () => {
    const parts = seedCommittedDataset()
    expect(getCleaningSession().dataset).not.toBeNull()

    renderEditor(parts)

    // 等 effect 跑完（挂载时会写回草稿——这正是过去作废数据集的时机）
    await waitFor(() => {
      expect(screen.getByText(/清洗口径/)).toBeTruthy()
    })
    expect(getCleaningSession().dataset, '没改设置就不该作废').not.toBeNull()
  })

  it('真的改了设置之后，数据集确实被作废（口径不能被这次修复带走）', async () => {
    const user = userEvent.setup()
    const parts = seedCommittedDataset()

    renderEditor(parts)
    await waitFor(() => {
      expect(screen.getByText(/清洗口径/)).toBeTruthy()
    })

    await user.click(screen.getByRole('checkbox', { name: /渠道缺失时按推荐人补成/ }))

    await waitFor(() => {
      expect(getCleaningSession().dataset, '改了设置必须作废').toBeNull()
    })
  })
})
