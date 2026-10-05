/**
 * 自有 / 本地代理的**显式配置边界**（AI-6，docs/PRD.md 18.6）。
 *
 * ## 这个面板为什么长这样
 *
 * 代理在本项目里是一个「高级且危险」的开关：请求的 Authorization 头与脱敏摘要正文
 * 都要经过它，也就是**Key 与摘要原文都会落在代理上**。因此这里刻意做成
 * 「先读完边界 → 逐条勾选确认 → 才允许保存地址」，而不是一个随手能填的输入框。
 *
 * 三条实现纪律：
 * 1. **地址校验在 `src/ai/aiProxy.ts`**（只接受 https，回环地址可用 http；
 *    不接受凭据 / 路径 / 查询串），界面不另写一套判断；
 * 2. **改地址即撤销旧许可**：保存新地址时调 `revokeAiKeyPermissionIfOriginChanged`，
 *    旧 Key 不会被转发到新地址（PRD 18.6 原文）——这一步不是提示，是代码；
 * 3. **不提供代理程序**：本仓库没有任何代理实现，说明文字也这么写。
 */

import { useState } from 'react'

import {
  AI_PROXY_ACKNOWLEDGEMENTS,
  AI_PROXY_BOUNDARY_ITEMS,
  AI_PROXY_INVALID_NOTE,
  parseAiProxyOrigin,
} from '../../ai/aiProxy'
import type { AiDestination } from '../../privacy/aiPreview'

import {
  AI_PROXY_ACK_REQUIRED_NOTE,
  AI_PROXY_ADDRESS_LABEL,
  AI_PROXY_ADDRESS_PLACEHOLDER,
  AI_PROXY_CLEAR_LABEL,
  AI_PROXY_CURRENT_LABEL,
  AI_PROXY_INTRO,
  AI_PROXY_OFFICIAL_NOTE,
  AI_PROXY_SAVE_LABEL,
  AI_PROXY_TITLE,
  describeAiDestination,
} from './aiSettingsText'

type AiProxyPanelProps = {
  /** 已登记的代理 origin；`null` = 未登记（请求发往官方端点） */
  readonly proxyOrigin: string | null
  /** 已登记的确认时间；只有它与地址同时存在才算登记成功 */
  readonly proxyAcknowledgedAt: string | null
  /** 当前**生效**的请求目的地（由 `aiDestinationOf` 算出，界面不重算） */
  readonly destination: AiDestination
  readonly busy: boolean
  /** 登记（或改地址）：返回本次是否撤销了旧许可、以及有没有真的写进本地仓 */
  readonly onRegister: (
    origin: string,
  ) => Promise<{ readonly revokedPermission: boolean; readonly persisted: boolean }>
  readonly onClear: () => Promise<{ readonly revokedPermission: boolean }>
}

export default function AiProxyPanel({
  proxyOrigin,
  proxyAcknowledgedAt,
  destination,
  busy,
  onRegister,
  onClear,
}: AiProxyPanelProps) {
  const [address, setAddress] = useState('')
  const [acknowledged, setAcknowledged] = useState<readonly number[]>([])
  const [problem, setProblem] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)

  const registered = proxyOrigin !== null && proxyAcknowledgedAt !== null
  const allAcknowledged = acknowledged.length === AI_PROXY_ACKNOWLEDGEMENTS.length

  function handleSave(): void {
    const parsed = parseAiProxyOrigin(address)
    if (!parsed.ok) {
      setProblem(parsed.problem)
      setOutcome(null)
      return
    }
    setProblem(null)
    void onRegister(parsed.origin).then((result) => {
      const revoked = result.revokedPermission
        ? '旧地址上的 Key 许可已被撤销，旧 Key 不会被转发到这个新地址。'
        : '原有的 Key 许可仍然有效（地址没变）。'
      setOutcome(
        /*
         * 写不进本地仓时**不说「已登记」**：那会让人以为刷新后还在。
         * 内存里确实生效了（当前这次会话的目的地已经变了），这一点也要说清。
         */
        result.persisted
          ? `已登记 ${parsed.origin}。${revoked}`
          : `本次会话的目的地已临时改为 ${parsed.origin}，但没能写入本地仓（临时模式或未解锁）：刷新即回到官方端点。${revoked}`,
      )
      setAddress('')
      setAcknowledged([])
    })
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{AI_PROXY_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{AI_PROXY_INTRO}</p>
      </div>

      <div className="space-y-1 rounded border border-rose-200 bg-rose-50/40 p-2">
        <p className="text-xs font-medium text-rose-900">代理会看到什么（先读这一段）</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-rose-900">
          {AI_PROXY_BOUNDARY_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>

      <p className="text-xs leading-5 text-slate-700">
        {AI_PROXY_CURRENT_LABEL}：<span className="font-mono">{describeAiDestination(destination)}</span>
        {registered ? '' : `（未登记代理：${AI_PROXY_OFFICIAL_NOTE}）`}
      </p>

      <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-2">
        <p className="text-xs font-medium text-slate-800">{AI_PROXY_ACK_REQUIRED_NOTE}</p>
        {AI_PROXY_ACKNOWLEDGEMENTS.map((item, index) => (
          <label className="flex items-start gap-2 text-xs leading-5 text-slate-700" key={item}>
            <input
              checked={acknowledged.includes(index)}
              className="mt-0.5"
              disabled={busy}
              onChange={() =>
                setAcknowledged((current) =>
                  current.includes(index)
                    ? current.filter((value) => value !== index)
                    : [...current, index],
                )
              }
              type="checkbox"
            />
            <span>{item}</span>
          </label>
        ))}
      </div>

      <label className="block text-xs text-slate-700">
        {AI_PROXY_ADDRESS_LABEL}
        <input
          autoComplete="off"
          className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
          disabled={busy}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={AI_PROXY_ADDRESS_PLACEHOLDER}
          type="text"
          value={address}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          disabled={busy || address.trim() === '' || !allAcknowledged}
          onClick={handleSave}
          type="button"
        >
          {AI_PROXY_SAVE_LABEL}
        </button>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
          disabled={busy || !registered}
          onClick={() => {
            void onClear().then((result) => {
              setOutcome(
                result.revokedPermission
                  ? '已取消代理登记：请求目的地回到官方端点，旧代理地址上的 Key 许可已撤销。'
                  : '已取消代理登记：请求目的地回到官方端点。',
              )
            })
          }}
          type="button"
        >
          {AI_PROXY_CLEAR_LABEL}
        </button>
      </div>

      {problem === null ? null : (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
          {problem}
        </p>
      )}
      <p className="text-xs leading-5 text-slate-500">{AI_PROXY_INVALID_NOTE}</p>
      {outcome === null ? null : (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs leading-5 text-emerald-900">
          {outcome}
        </p>
      )}
    </section>
  )
}
