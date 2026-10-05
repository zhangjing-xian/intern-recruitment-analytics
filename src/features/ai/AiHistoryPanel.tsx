/**
 * AI 调用历史页（AI-5，docs/PRD.md 16.5）。
 *
 * ## 这一页的四条边界
 *
 * 1. **打开本页不发任何请求**：只读加密仓里的 `aiHistory` 对象；
 * 2. **不自动重发**：历史条目只能查看、导出、删除——没有任何「重新分析」按钮。
 *    要再分析必须回看板重新预览并逐次确认；
 * 3. **历史离线可读**：内容全部来自本地仓，不依赖任何网络；
 * 4. **删除动作互不代替**：删单条 / 清空历史是两个动作；两者都**不动**招聘源数据与 Key。
 *
 * ## 复用结果面板而不是另写一套展示
 *
 * 历史详情直接复用 `AiResultPanel`（经 `resultViewOfHistoryEntry` 构造视图）。
 * 另写一套会让「同样的内容在两处渲染成不一样的东西」，而渲染**方式**恰恰是
 * AI12（不执行脚本、不发图片请求）的验收对象——只允许一套实现。
 */

import { useCallback, useEffect, useState } from 'react'

import PhraseConfirm from '../settings/PhraseConfirm'
import { isPhraseConfirmed } from '../settings/vaultText'
import {
  clearAiHistory,
  deleteAiHistoryEntry,
  loadAiHistory,
  type AiHistoryEntry,
} from '../../ai/aiHistory'

import AiResultPanel from './AiResultPanel'
import { resultViewOfHistoryEntry } from './aiResultView'
import {
  AI_HISTORY_CLEAR_LABEL,
  AI_HISTORY_CLEAR_NOTE,
  AI_HISTORY_CLEAR_PHRASE,
  AI_HISTORY_DELETE_LABEL,
  AI_HISTORY_DELETE_NOTE,
  AI_HISTORY_EMPTY,
  AI_HISTORY_INTRO,
  AI_HISTORY_LOAD_FAILED,
  AI_HISTORY_NO_KEY_NOTE,
  AI_HISTORY_TITLE,
  historySummaryOf,
} from './aiResultText'

export type AiHistoryPanelProps = {
  /** 只读加载（测试可注入）；缺省读加密仓 */
  readonly load?: () => Promise<{ entries: readonly AiHistoryEntry[]; reason: string | null }>
  readonly remove?: (id: string) => Promise<number>
  readonly clearAll?: () => Promise<number>
}

export default function AiHistoryPanel({
  load = loadAiHistory,
  remove = deleteAiHistoryEntry,
  clearAll = clearAiHistory,
}: AiHistoryPanelProps) {
  const [entries, setEntries] = useState<readonly AiHistoryEntry[]>([])
  const [reason, setReason] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [clearPhrase, setClearPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const result = await load()
    setEntries(result.entries)
    setReason(result.reason)
  }, [load])

  useEffect(() => {
    let cancelled = false
    void load().then((result) => {
      if (!cancelled) {
        setEntries(result.entries)
        setReason(result.reason)
      }
    })
    return () => {
      cancelled = true
    }
  }, [load])

  function handleDelete(id: string): void {
    setBusy(true)
    void remove(id).then(
      (removed) => {
        setBusy(false)
        setNotice(removed > 0 ? '已删除这一条历史。' : '这一条历史本来就不存在，未做任何修改。')
        if (expandedId === id) {
          setExpandedId(null)
        }
        void refresh()
      },
      () => {
        setBusy(false)
        setNotice('删除失败：当前可能是临时模式或本地仓未解锁。')
      },
    )
  }

  function handleClearAll(): void {
    setBusy(true)
    void clearAll().then(
      (removed) => {
        setBusy(false)
        setClearPhrase('')
        setExpandedId(null)
        setNotice(
          removed > 0
            ? `已清空 ${String(removed)} 条 AI 历史。招聘源数据与本地仓里的 API Key 未受影响。`
            : '本来就没有可清空的历史。',
        )
        void refresh()
      },
      () => {
        setBusy(false)
        setNotice('清空失败：当前可能是临时模式或本地仓未解锁。')
      },
    )
  }

  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">{AI_HISTORY_TITLE}</h2>
        <p className="text-xs leading-5 text-slate-600">{AI_HISTORY_INTRO}</p>
        <p className="text-xs leading-5 text-slate-500">{AI_HISTORY_NO_KEY_NOTE}</p>
      </section>

      {reason === null ? null : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {AI_HISTORY_LOAD_FAILED}
          {reason}
        </p>
      )}
      {notice === null ? null : (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-xs leading-5 text-slate-600">
          {AI_HISTORY_EMPTY}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li className="rounded-lg border border-slate-200 bg-white p-3" key={entry.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1">
                  <p className="text-xs text-slate-700">{historySummaryOf(entry)}</p>
                  <p className="font-mono text-[11px] text-slate-400">{entry.id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-md border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
                    onClick={() =>
                      setExpandedId((current) => (current === entry.id ? null : entry.id))
                    }
                    type="button"
                  >
                    {expandedId === entry.id ? '收起详情' : '查看详情'}
                  </button>
                  <button
                    className="rounded-md border border-rose-300 px-3 py-1 text-xs text-rose-800 hover:bg-rose-50 disabled:cursor-not-allowed disabled:text-slate-400"
                    disabled={busy}
                    onClick={() => handleDelete(entry.id)}
                    type="button"
                  >
                    {AI_HISTORY_DELETE_LABEL}
                  </button>
                </div>
              </div>

              {expandedId === entry.id ? (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  {/*
                    历史条目是**当时的快照**，因此 `current: true`：
                    世代号管的是「在途请求的响应还算不算数」，与已保存的历史无关。
                  */}
                  <AiResultPanel view={resultViewOfHistoryEntry(entry)} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {entries.length === 0 ? null : (
        <section className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/40 p-4">
          <h3 className="text-sm font-semibold text-rose-900">{AI_HISTORY_CLEAR_LABEL}</h3>
          <p className="text-xs leading-5 text-rose-900">{AI_HISTORY_CLEAR_NOTE}</p>
          <p className="text-xs leading-5 text-rose-900">{AI_HISTORY_DELETE_NOTE}</p>
          <PhraseConfirm
            busy={busy}
            onChange={setClearPhrase}
            phrase={AI_HISTORY_CLEAR_PHRASE}
            value={clearPhrase}
          />
          <button
            className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-300"
            disabled={busy || !isPhraseConfirmed(clearPhrase, AI_HISTORY_CLEAR_PHRASE)}
            onClick={handleClearAll}
            type="button"
          >
            {AI_HISTORY_CLEAR_LABEL}
          </button>
        </section>
      )}
    </div>
  )
}
