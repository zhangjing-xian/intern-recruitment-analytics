/**
 * AI 数据的独立删除动作（AI-6，docs/PRD.md 16.5 / 18.2）。
 *
 * ## 为什么这一个面板只做「清空 AI 历史」这一件事
 *
 * 三个动作必须**互不代替**，而它们的破坏性不同、需要的确认也不同：
 * - 清空 AI 历史：只删历史（本面板，逐字确认）；
 * - 删除 API Key：只删秘密槽位（在「API Key」一节，逐字确认，AI-3 已交付）；
 * - 清空整个本地仓：连招聘数据一起删（在「清除数据的范围」一节，逐字确认）。
 *
 * 把三个按钮并排放在一起会让人以为它们是同一个动作的三档强度。因此这里只放**一个**
 * 动作，另外两个用文字指向它们真正所在的位置。
 *
 * ## 两条纪律
 *
 * 1. **只删 `aiHistory` 这一种类**（`clearAiHistory` 的实现），不动源数据、不动 Key；
 * 2. **未解锁时不做假动作**：按钮禁用并说明原因（临时模式下没有历史可删，
 *    但界面仍要能解释「为什么这里点不了」）。
 */

import { useState } from 'react'

import { clearAiHistory } from '../../ai/aiHistory'
import { encryptedVault } from '../../storage'
import PhraseConfirm from './PhraseConfirm'
import { CLEAR_AI_HISTORY_PHRASE, isPhraseConfirmed } from './vaultText'
import {
  AI_RETENTION_ALL_POINTER,
  AI_RETENTION_HISTORY_LABEL,
  AI_RETENTION_HISTORY_NOTE,
  AI_RETENTION_INTRO,
  AI_RETENTION_KEY_POINTER,
  AI_RETENTION_LOCKED_NOTE,
  AI_RETENTION_TITLE,
} from './aiSettingsText'

type AiRetentionPanelProps = {
  readonly vaultUnlocked: boolean
}

export default function AiRetentionPanel({ vaultUnlocked }: AiRetentionPanelProps) {
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<string | null>(null)

  function handleClear(): void {
    setBusy(true)
    setOutcome(null)
    /*
     * 先读一次仓状态再删：`clearAiHistory` 在读不到仓时返回 0（它把异常收敛成「没删掉」），
     * 若不先判断，就会把「仓已锁定」说成「本来就没有历史」——那是两件事，
     * 前者需要用户解锁，后者什么都不用做。
     */
    void encryptedVault
      .status()
      .then((status) => {
        if (status.state !== 'unlocked') {
          setBusy(false)
          setOutcome('本地仓当前未解锁，因此没有删除任何内容。请先解锁本地仓再操作。')
          return null
        }
        return clearAiHistory()
      })
      .then((removed) => {
        if (removed === null) {
          return
        }
        setBusy(false)
        setPhrase('')
        setOutcome(
          removed > 0
            ? `已清空 ${String(removed)} 条 AI 历史。招聘数据、清洗设置与 API Key 都没有被改动；历史无法恢复。`
            : '本地仓里本来就没有 AI 历史，未做任何修改。',
        )
      })
      .catch(() => {
        setBusy(false)
        setOutcome('清空历史失败：本地仓可能已锁定。未做任何修改。')
      })
  }

  const canClear = vaultUnlocked && !busy && isPhraseConfirmed(phrase, CLEAR_AI_HISTORY_PHRASE)

  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{AI_RETENTION_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{AI_RETENTION_INTRO}</p>
      </div>

      <div className="space-y-2 rounded border border-rose-200 bg-rose-50/40 p-2">
        <p className="text-xs leading-5 text-rose-900">{AI_RETENTION_HISTORY_NOTE}</p>
        {vaultUnlocked ? null : (
          <p className="text-xs leading-5 text-amber-900">{AI_RETENTION_LOCKED_NOTE}</p>
        )}
        <PhraseConfirm
          busy={busy || !vaultUnlocked}
          onChange={setPhrase}
          phrase={CLEAR_AI_HISTORY_PHRASE}
          value={phrase}
        />
        <button
          className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-300"
          disabled={!canClear}
          onClick={handleClear}
          type="button"
        >
          {AI_RETENTION_HISTORY_LABEL}
        </button>
      </div>

      {outcome === null ? null : (
        <p className="rounded border border-slate-300 bg-slate-50 p-2 text-xs leading-5 text-slate-700">
          {outcome}
        </p>
      )}

      <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-500">
        <li>{AI_RETENTION_KEY_POINTER}</li>
        <li>{AI_RETENTION_ALL_POINTER}</li>
      </ul>
    </section>
  )
}
