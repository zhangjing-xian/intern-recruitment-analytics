/**
 * AI 结果的展示与本地导出（AI-5，docs/PRD.md 16.4 / 16.5）。
 *
 * ## 四件事必须同时在场
 *
 * 1. **结果正文**：经 `parseAiMarkdown` → `AiMarkdownView` 渲染成 React 元素。
 *    本文件里**没有** `dangerouslySetInnerHTML`，也没有 `<a>` / `<img>` / `<iframe>`——
 *    「模型输出 HTML 会不会执行」「图片会不会发请求」在结构上就不成立（AI12）；
 * 2. **元数据**：请求 / 返回模型（**分别显示**，服务端可能返回别名解析结果）、
 *    时间、脱敏级别、规则版本、范围、`finish_reason`、用量；
 * 3. **本地敏感检查的提示**（AI15）：模型回复里出现敏感字段名或命中本地哨兵时如实提示，
 *    **且只报位置、不回显命中值**；
 * 4. **不覆盖本地统计的明确声明**：AI 的文字与看板数字是两件事，界面必须说出来。
 *
 * ## 复制与导出都走净化后的文本
 *
 * PRD 16.5：「复制使用净化后的 Markdown」。因此复制按钮复制的是
 * `sanitizeMarkdownText(parseAiMarkdown(content))`，**不是**模型原文——
 * 原文里的链接地址会被原样带走，用户贴到别处就可能变成可点链接。
 */

import { useMemo, useState } from 'react'

import { formatInteger } from '../../lib/format'
import { findExternalReferences, parseAiMarkdown, sanitizeMarkdownText } from '../../ai/aiMarkdown'
import { checkAiResponseText } from '../../ai/aiResponseCheck'
import { AI_FINISH_REASON_NOTES, finishStatusOf } from '../../ai/aiResult'
import { exportAiMarkdown, exportAiPrintHtml, type AiExportInput } from '../../ai/aiExport'
import type { AiHistoryPayload } from '../../ai/aiHistory'
import type { ExportResult } from '../../exporters'

import AiMarkdownView from './AiMarkdownView'
import { historyPayloadOf, type AiResultView } from './aiResultView'
import {
  AI_HISTORY_SAVE_FAILED_TITLE,
  AI_HISTORY_SAVE_LABEL,
  AI_HISTORY_SAVED_NOTE,
  AI_RESULT_COPY_FAILED,
  AI_RESULT_COPY_LABEL,
  AI_RESULT_COPY_OK,
  AI_RESULT_DOWNGRADE_TITLE,
  AI_RESULT_EXPORT_MD_LABEL,
  AI_RESULT_EXPORT_PDF_LABEL,
  AI_RESULT_EXPORT_BLOCKED_TITLE,
  AI_RESULT_LINKS_TITLE,
  AI_RESULT_META_TITLE,
  AI_RESULT_NOT_AUTHORITATIVE_NOTE,
  AI_RESULT_REFERENCE_BADGE,
  AI_RESULT_SENT_PAYLOAD_TITLE,
  AI_RESULT_TITLE,
  AI_RESULT_CHECK_TITLE,
} from './aiResultText'

export type AiResultPanelProps = {
  readonly view: AiResultView
  /**
   * 「保存到本地历史」：**只有点了才写盘**（PRD 16.5）。
   * 收到的是**载荷**（不含 id）——身份由加密仓在追加时生成。
   */
  readonly onSave?: (
    payload: AiHistoryPayload,
  ) => Promise<{ readonly ok: boolean; readonly reason?: string }>
  /** 复制实现；默认用剪贴板 API */
  readonly onCopy?: (text: string) => Promise<boolean>
}

/** 触发浏览器下载（本地生成，不发任何请求） */
function downloadText(fileName: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  // 立刻撤销：Blob URL 挂在文档上会让内容在内存里多留一段时间（PRD 10.5 要求锁定时撤销）
  URL.revokeObjectURL(url)
}

export default function AiResultPanel({ view, onSave, onCopy }: AiResultPanelProps) {
  const [copyDone, setCopyDone] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<{ ok: boolean; message: string } | null>(null)
  const [exportState, setExportState] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const document = useMemo(() => parseAiMarkdown(view.result.content), [view.result.content])
  const sanitized = useMemo(() => sanitizeMarkdownText(document), [document])
  const check = useMemo(
    () => checkAiResponseText(sanitized, view.sentinels ?? []),
    [sanitized, view.sentinels],
  )
  const references = useMemo(() => findExternalReferences(document), [document])
  const finishStatus = finishStatusOf(view.result.finishReason)

  const exportInput = useMemo<AiExportInput>(
    () => ({
      requestedAt: view.requestedAt,
      requestedModel: view.requestedModel,
      responseModel: view.responseModel,
      privacyLevel: view.privacyLevel,
      ruleVersionLabel: view.ruleVersionLabel,
      dataAsOf: view.dataAsOf,
      activeFilters: view.activeFilters,
      payloadJson: view.payloadJson,
      result: {
        content: view.result.content,
        finishReason: view.result.finishReason,
        usage: view.result.usage,
        responseId: view.result.responseId,
      },
      ...(view.sentinels === undefined ? {} : { sentinels: view.sentinels }),
      fileStamp: view.requestedAt,
    }),
    [view],
  )

  function handleExport(format: 'markdown' | 'pdf'): void {
    const outcome: ExportResult = format === 'markdown' ? exportAiMarkdown(exportInput) : exportAiPrintHtml(exportInput)
    if (!outcome.ok) {
      setExportState({ ok: false, message: outcome.error })
      return
    }
    if (format === 'pdf') {
      // 「打印 → 另存为 PDF」：打开新窗口写入已净化的 HTML，由浏览器负责中文字体与分页
      const text = outcome.artifact.text ?? ''
      /*
       * 与报告导出同一个坑（2026-09-27 修）：`window.open('', '_blank', 'noopener,...')`
       * 在带 `noopener` 时**返回 null**，于是新窗口是个空白页，界面却报「浏览器拦截了新窗口」。
       * 正确做法：普通窗口引用 + 写完前手动断掉 `opener`（防护效果相同，但引用还在）。
       */
      const opened = window.open('', '_blank')
      if (opened === null) {
        setExportState({
          ok: false,
          message: '浏览器拦截了新窗口，无法打开打印版。请允许本站打开弹出窗口后重试，或改用 Markdown 导出。',
        })
        return
      }
      try {
        opened.opener = null
      } catch {
        // 断不掉也只是少一层防护；内容是我们生成的静态 HTML，不因此放弃导出
      }
      opened.document.write(text)
      opened.document.close()
      setExportState({
        ok: true,
        message: '已在新的本机窗口中打开打印版：请在那里使用「打印 → 另存为 PDF」。该页面不会发起任何网络请求。',
      })
      return
    }
    downloadText(outcome.artifact.fileName, outcome.artifact.text ?? '', outcome.artifact.mimeType)
    setExportState({ ok: true, message: `已在本机生成并下载：${outcome.artifact.fileName}` })
  }

  function handleCopy(): void {
    const write = onCopy ?? defaultCopy
    void write(sanitized).then(
      (ok) => setCopyDone(ok ? AI_RESULT_COPY_OK : AI_RESULT_COPY_FAILED),
      () => setCopyDone(AI_RESULT_COPY_FAILED),
    )
  }

  function handleSave(): void {
    if (onSave === undefined) {
      return
    }
    setBusy(true)
    void onSave(historyPayloadOf(view, new Date().toISOString())).then(
      (outcome) => {
        setBusy(false)
        setSaveState(
          outcome.ok
            ? { ok: true, message: AI_HISTORY_SAVED_NOTE }
            : { ok: false, message: `${AI_HISTORY_SAVE_FAILED_TITLE}${outcome.reason ?? ''}` },
        )
      },
      () => {
        setBusy(false)
        setSaveState({ ok: false, message: AI_HISTORY_SAVE_FAILED_TITLE })
      },
    )
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{AI_RESULT_TITLE}</h2>
        {/* 来源标注：与本地统计是两件事，必须显眼 */}
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900">
          {AI_RESULT_NOT_AUTHORITATIVE_NOTE}
        </p>
      </div>

      {/*
        迟到响应：期间发生过锁定 / 清空 / 切换，因此这份结果不再属于当前状态。
        这里**不渲染正文**——展示它等于让用户以为结果可用。
        判定只看调用方传进来的 `view.current`（它在 response 落地那一刻由世代号比较得出），
        面板自己不再读全局世代号：那会让「历史里的旧结果」也被判成迟到。
      */}
      {view.current ? null : (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          这份结果已被判定为迟到响应（期间发生了锁定、清空或会话失效），因此不展示、不保存、也不导出。
          要重新分析请回到看板重新生成预览并确认。
        </p>
      )}

      {view.current ? (
        <>
          <section className="space-y-1">
            <h3 className="text-xs font-semibold text-slate-800">{AI_RESULT_META_TITLE}</h3>
            <dl className="grid grid-cols-1 gap-1 text-xs text-slate-700 md:grid-cols-2">
              <div>请求时间：{view.requestedAt}</div>
              <div>
                请求模型 {view.requestedModel}｜返回模型 {view.responseModel ?? '未返回'}
              </div>
              <div>脱敏级别：{view.privacyLevel}</div>
              <div>规则版本：{view.ruleVersionLabel}</div>
              <div>数据截至日：{view.dataAsOf}</div>
              <div>提示词版本：{view.promptVersion}｜载荷结构版本：{view.schemaVersionOfPayload}</div>
              <div>
                生效筛选：
                {view.activeFilters.length === 0 ? '未启用筛选' : view.activeFilters.join('；')}
              </div>
              <div>预览 hash：<span className="font-mono">{view.previewHash}</span></div>
              <div>结束原因：{view.result.finishReason ?? '未返回'}</div>
              <div>
                用量：
                {view.result.usage === null
                  ? '服务端未返回'
                  : `输入 ${formatInteger(view.result.usage.promptTokens)} / 输出 ${formatInteger(view.result.usage.completionTokens)} / 合计 ${formatInteger(view.result.usage.totalTokens)} tokens`}
              </div>
            </dl>
            <p className="text-xs leading-5 text-slate-600">
              {AI_FINISH_REASON_NOTES[finishStatus]}
            </p>
          </section>

          {/*
            本地敏感检查（AI15）：只报位置、不回显命中值。
            命中不等于「模型收到了敏感数据」——它也可能只是在解释「没有姓名字段」。
          */}
          {check.hasFindings ? (
            <section className="rounded border border-amber-300 bg-amber-50 p-3">
              <h3 className="text-xs font-semibold text-amber-900">{AI_RESULT_CHECK_TITLE}</h3>
              <p className="mt-1 text-xs leading-5 text-amber-900">{check.note}</p>
            </section>
          ) : null}

          {references.length > 0 ? (
            <section className="rounded border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-xs font-semibold text-slate-800">{AI_RESULT_LINKS_TITLE}</h3>
              <ul className="mt-1 space-y-0.5 break-all text-xs leading-5 text-slate-600">
                {references.map((reference) => (
                  <li key={reference}>
                    <span className="mr-1 rounded bg-slate-200 px-1 text-[10px] text-slate-700">
                      {AI_RESULT_REFERENCE_BADGE}
                    </span>
                    {reference}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {document.downgrades.length > 0 ? (
            <section className="rounded border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-xs font-semibold text-slate-800">{AI_RESULT_DOWNGRADE_TITLE}</h3>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-600">
                {document.downgrades.map((item) => (
                  <li key={item.detail}>{item.detail}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* 结果正文：只渲染白名单节点，React 负责转义 */}
          <section className="rounded border border-slate-200 p-3">
            <AiMarkdownView document={document} />
          </section>

          <details className="rounded border border-slate-200 p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-700">
              {AI_RESULT_SENT_PAYLOAD_TITLE}
            </summary>
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-800">
              {view.payloadJson}
            </pre>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              onClick={handleCopy}
              type="button"
            >
              {AI_RESULT_COPY_LABEL}
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => handleExport('markdown')}
              type="button"
            >
              {AI_RESULT_EXPORT_MD_LABEL}
            </button>
            <button
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => handleExport('pdf')}
              type="button"
            >
              {AI_RESULT_EXPORT_PDF_LABEL}
            </button>
            {onSave === undefined ? null : (
              <button
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={busy}
                onClick={handleSave}
                type="button"
              >
                {AI_HISTORY_SAVE_LABEL}
              </button>
            )}
          </div>

          {copyDone === null ? null : (
            <p className="text-xs leading-5 text-slate-600">{copyDone}</p>
          )}
          {saveState === null ? null : (
            <p
              className={
                saveState.ok
                  ? 'text-xs leading-5 text-emerald-800'
                  : 'text-xs leading-5 text-rose-800'
              }
            >
              {saveState.message}
            </p>
          )}
          {exportState === null ? null : (
            <p
              className={
                exportState.ok
                  ? 'text-xs leading-5 text-emerald-800'
                  : 'text-xs leading-5 text-rose-800'
              }
            >
              {exportState.ok ? exportState.message : `${AI_RESULT_EXPORT_BLOCKED_TITLE}${exportState.message}`}
            </p>
          )}

          <p className="text-xs leading-5 text-slate-500">
            本页所有操作都在本机完成：复制、导出与保存历史都不会发起任何网络请求。导出前会在本地再跑一次敏感检查，命中即阻断。
          </p>
        </>
      ) : null}
    </section>
  )
}

/** 默认复制实现：优先异步剪贴板 API；不可用时如实告诉用户「请手动选择」 */
async function defaultCopy(text: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return false
  }
  try {
    await clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}


