import { useEffect, useMemo, useState } from 'react'

import { subscribeKeyState } from '../crypto'
import EmptyState from '../components/EmptyState'
import PageShell from '../components/PageShell'
import { AI_UNAVAILABLE_NOTE, aiBlockedByPageCsp } from '../lib/aiAvailability'
import AiSettingsPanel, { type AiLocalRuleInput } from '../features/settings/AiSettingsPanel'
import StorageBoundaryPanel from '../features/settings/StorageBoundaryPanel'
import VaultWorkspace from '../features/settings/VaultWorkspace'
import { encryptedVault } from '../storage'
import { getCleaningSession } from '../storage/sessionStore'
import { aiLocalRulesOf } from '../ai/subjectRules'

/**
 * 设置页（步骤6 起接入加密本地仓；步骤12 补存储边界与多标签页协作说明；
 * AI-3 补 AI 设置面板；AI-6 补三级脱敏、本地规则二次确认、代理边界与 AI 数据删除）。
 *
 * 本页只负责摆放：本地仓部分的所有读写都走 `features/settings/VaultWorkspace`
 * → `storage/encryptedVault` 懒门面，页面自身不接触 IndexedDB / localStorage。
 * 清除分层范围由 `VaultManagerPanel` → `ClearScopePanel` 展示（范围模型在 `clearScope.ts`）。
 *
 * `vaultUnlocked` 只是**读**一次仓状态后传给 AI 面板：AI 面板需要它来决定
 * 「加密保存 / 读入 / 删除 Key」这几个动作能不能点（未解锁时点了必然失败，
 * 与其让用户点了再看错误，不如按真实状态禁用并说明原因）。
 *
 * `localRules` 是本机**当前生效的本地规则**（学校名单 / 别名 / 规则版本）：
 * 只有已提交的数据集才知道自己当时用的是哪套配置，因此从 `metadata.cleaningSettings`
 * 取（步骤12 的原话：变更影响必须从这里取基准，不能靠组件记一份）。
 * 没有已提交数据集时一律传 `null`——界面据此显示「读不到」，**不编造**一份空名单当事实。
 */
export default function SettingsPage() {
  const [vaultUnlocked, setVaultUnlocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void encryptedVault
        .status()
        .then((status) => {
          if (!cancelled) {
            setVaultUnlocked(status.state === 'unlocked')
          }
        })
        .catch(() => {
          // 读不到状态就按「未解锁」处理：宁可少给几个按钮，也不给一个必然失败的按钮
          if (!cancelled) {
            setVaultUnlocked(false)
          }
        })
    }
    refresh()
    return () => {
      cancelled = true
    }
  }, [])

  // 解锁 / 锁定都会改变可用动作，统一重新读一次（含其他标签页触发的变化）
  useEffect(() => subscribeKeyState(() => {
    let cancelled = false
    void encryptedVault.status().then((status) => {
      if (!cancelled) {
        setVaultUnlocked(status.state === 'unlocked')
      }
    })
    return () => {
      cancelled = true
    }
  }), [])

  /**
   * 内存会话里的已提交数据集 → 本地规则视图输入。
   *
   * 会话快照是模块级内存对象（`sessionStore`），这里在**挂载时**读一次：
   * 改名单 / 换数据集都发生在别的页面，回到设置页会重新挂载，因此不会读到陈旧值；
   * 反过来，为它加一套跨模块订阅是没有必要的复杂度。
   * 取值口径（从 `metadata.cleaningSettings` 取哪几个字段）在 `aiLocalRulesOf` 里，
   * 与看板算指纹时用的是**同一个函数**。
   */
  const localRules: AiLocalRuleInput = useMemo(
    () => aiLocalRulesOf(getCleaningSession().dataset),
    [],
  )

  return (
    <PageShell path="/settings">
      <div className="space-y-6">
        <VaultWorkspace />

        {/*
          「这一份产物能不能用 AI」由页面自己的 meta CSP 决定（`src/lib/aiAvailability.ts`）：
          本地版 / 公开部署那一份是 `connect-src 'none'`，AI 请求会被浏览器直接拦下，
          因此不摆出一个永远用不了的面板，而是把事实写清楚（见 D-102）。
        */}
        {aiBlockedByPageCsp() ? (
          <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">AI 深度分析（本部署不可用）</h2>
            <p className="text-xs leading-5 text-slate-600">{AI_UNAVAILABLE_NOTE}</p>
          </section>
        ) : (
          <AiSettingsPanel localRules={localRules} vaultUnlocked={vaultUnlocked} />
        )}

        <StorageBoundaryPanel />

        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">本机加密的边界（请先读这一节）</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs leading-6 text-slate-600">
            <li>数据只在这台电脑的浏览器里；没有服务器、没有云端副本，换电脑或换浏览器都看不到。</li>
            <li>密码无法找回：本地仓不保存密码哈希，忘记密码只能用加密备份恢复或清空重建。</li>
            <li>
              浏览器可能在空间紧张时回收本地数据，因此提供「申请持久化存储」；这只能降低概率，
              不等于保证，重要数据请用加密备份留存。
            </li>
            <li>锁定、刷新或闲置超时都会丢弃内存密钥，需要重新解锁后才能继续查看已有数据。</li>
            <li>AI Key 存在独立的秘密槽位，普通备份不含它，删除 Key 与清空业务数据互不代替。</li>
          </ul>
        </section>

        <EmptyState
          description="上面是本地仓、AI 设置、存储边界与清除范围。下面这些设置项有的已经在别的页面生效，有的还没接入界面——如实列出来，避免在设置页重复造一份口径来源。"
          items={[
            '清洗口径（去重策略、薪资计薪口径、日月顺序、时间基准与截至日、GPT 名单与学校别名）：在「清洗预览」页的设置面板里编辑，那里同时显示规则配置版本与提交前的变更影响预览。AI 摘要里的「学校层次」就来自这份名单，改名单会让本页的规则确认失效',
            'AI：开关、Key 会话与加密保存、模型与参数、默认脱敏级别、岗位类别映射、本地规则二次确认、代理边界与清空 AI 历史都在本页上方。看板右上角「AI 深度分析」负责生成完整脱敏预览并逐次确认；唯一的出站路径只在确认之后使用一次',
            'AI 结果与历史：查看、复制、导出与删除在「AI 结果」与「AI 历史」两页；历史只在显式保存后写入加密仓，删除单条与清空历史互不代替',
            '加密备份：导出与恢复的口径与接口已经实现（备份本体不含 AI Key、恢复前整份校验），但设置页还没有导入 / 导出界面，接入前请勿把备份当作唯一的留存手段',
            '阈值与规则版本：长周期提示阈值在清洗口径里；规则版本由代码决定，不提供界面编辑（这是刻意的：口径只允许一处实现）',
          ]}
          title="其余设置项的现状"
        />
      </div>
    </PageShell>
  )
}
