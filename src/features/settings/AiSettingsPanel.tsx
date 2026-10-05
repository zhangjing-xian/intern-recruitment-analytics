/**
 * AI 设置面板（AI-3，docs/PRD.md 18.1 / 18.2 / 18.3）。
 *
 * ## 这一个面板要同时说清三件事
 *
 * 1. **开关与授权**：打开开关不等于授权发送（每次仍要逐次确认）；关闭不删 Key、不删历史；
 * 2. **Key 的去向**：默认只在内存；显式勾选才加密落盘；认证时**必然**作为 Authorization
 *    头发给 DeepSeek——因此不能说「绝不离开设备」（PRD 10.1 明确禁止这种说法）；
 * 3. **模型的真实情况**：目录随版本打包、核实日期可见、旧模型标兼容风险且**不自动替换**、
 *    不支持的参数在界面禁用而不是发出去被静默忽略。
 *
 * ## 一条刻意的分工
 *
 * 本面板**不做**任何参数收敛、可用性判断或费用计算——那些全部调 `src/ai/` 的纯函数
 * （`resolveAiParams` / `paramSupportOf` / `estimateCost`）。界面只负责摆放与文案。
 * 这样「界面放过、请求层拒绝」这类不一致在结构上不会出现。
 *
 * ## Key 的四条动作互不代替
 *
 * 保存到内存 / 加密保存 / 读入内存 / 删除（内存、仓各一个）。合并成「保存」一个按钮
 * 会让人以为「保存了 = 也加密了」，而那正是 PRD 18.2 花一整行区分的事。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  AI_CATALOG_SOURCES,
  AI_CATALOG_VERIFIED_AT,
  AI_MODEL_CATALOG,
  AI_REASONING_EFFORTS,
  AI_PARAM_RANGES,
  estimateCost,
  formatCostEstimate,
  paramSupportOf,
  type AiReasoningEffort,
} from '../../ai/catalog'
import { AI_DEFAULT_DESTINATION } from '../../privacy/aiPreview'
import {
  describeResolvedParams,
  resolveAiParams,
  type AiConfigDraft,
  type AiThinkingSetting,
} from '../../ai/aiConfig'
import {
  checkApiKeyFormat,
  clearAiKeySession,
  grantAiKeyPermission,
  readAiKeyForRequest,
  readAiKeySnapshot,
  revokeAiKeyPermissionIfOriginChanged,
  setAiKeySession,
  subscribeAiKeyState,
  type AiKeySnapshot,
} from '../../ai/keySession'
import {
  AI_SETTINGS_OBJECT_ID,
  aiDestinationOf,
  defaultAiSettings,
  loadAiSettings,
  saveAiSettings,
  type AiSettings,
} from '../../ai/aiSettings'
import {
  buildAiSubjectRules,
  confirmAiSubjectRules,
  isAiSubjectRulesConfirmed,
  subjectRulesFingerprint,
  type AiLocalRuleInput,
  type AiSubjectRulesInput,
} from '../../ai/subjectRules'
import type { PositionCategoryRule } from '../../privacy/aiSummary'
import type { PrivacyLevel } from '../../privacy/sanitize'
import type { AiAllowedDimension } from '../../privacy/aiSummary'
import { encryptedVault } from '../../storage'
import { formatInteger } from '../../lib/format'

import AiPrivacyLevelPanel from './AiPrivacyLevelPanel'
import AiProxyPanel from './AiProxyPanel'
import AiRetentionPanel from './AiRetentionPanel'
import AiSubjectRulesPanel from './AiSubjectRulesPanel'
import { isPhraseConfirmed, DELETE_SECRET_PHRASE } from './vaultText'
import PhraseConfirm from './PhraseConfirm'
import {
  AI_BOUNDARY_ITEMS,
  AI_BOUNDARY_TITLE,
  AI_COST_NOTE,
  AI_COST_TITLE,
  AI_DESTINATION_TITLE,
  AI_DISABLED_KEEPS_NOTE,
  AI_ENABLED_NOTE,
  AI_KEY_CLEAR_MEMORY_LABEL,
  AI_KEY_DELETE_LABEL,
  AI_KEY_ENCRYPTED_LABEL,
  AI_KEY_HINT,
  AI_KEY_INPUT_LABEL,
  AI_KEY_INPUT_PLACEHOLDER,
  AI_KEY_LOAD_LABEL,
  AI_KEY_MEMORY_LABEL,
  AI_KEY_NO_FORMAT_CHECK_NOTE,
  AI_KEY_SAVE_ENCRYPTED_LABEL,
  AI_KEY_SAVE_LABEL,
  AI_KEY_TITLE,
  AI_KEY_TRANSMISSION_NOTE,
  AI_MODEL_CATALOG_NOTE,
  AI_MODEL_TITLE,
  AI_PERMISSION_TITLE,
  AI_SETTINGS_INTRO,
  AI_SETTINGS_TITLE,
  AI_SWITCH_OFF,
  AI_SWITCH_ON,
  describeAiDestination,
  describeKeyMask,
  describeKeyPermission,
  describeKeyState,
  formatPositionCategoryLines,
} from './aiSettingsText'

/**
 * 本机**当前生效的本地规则**（AI-6）。
 *
 * 由设置页从内存会话读出后传进来（学校层次名单来自已提交数据集，
 * 岗位类别映射来自 AI 偏好）。刻意不在这里读会话：设置页是唯一的读点，
 * 这样「同一份规则」不会有两处来源。
 */
export type { AiLocalRuleInput }

export type AiSettingsPanelProps = {
  /** 本地仓是否已解锁（加密保存 / 读入 / 删除都需要它） */
  readonly vaultUnlocked: boolean
  /** 本机生效的本地规则（岗位类别映射除外——那一项是本面板自己维护的偏好） */
  readonly localRules: AiLocalRuleInput
  /**
   * 每次偏好变化后回调（用户反馈，2026-09-27 晚）。
   *
   * 为什么需要它：这个面板现在也会被**分析看板**内联使用，而看板自己持有一份
   * `aiSettings` 状态（决定「生成预览」能不能点、以及传给工作区的参数）。
   * 面板改了开关却没人告诉看板，就会出现用户实际遇到的矛盾画面：
   * 面板里开关是开的，旁边却写着「AI 深度分析当前是关闭状态」。
   * 因此每次保存（无论是否写进仓）都把最新偏好回传一次。
   */
  readonly onSettingsChange?: (settings: AiSettings) => void
}

export default function AiSettingsPanel({
  vaultUnlocked,
  localRules,
  onSettingsChange,
}: AiSettingsPanelProps) {
  const [settings, setSettings] = useState<AiSettings>(() => defaultAiSettings())
  const [keySnapshot, setKeySnapshot] = useState<AiKeySnapshot>(readAiKeySnapshot)
  const [persistedInVault, setPersistedInVault] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [deletePhrase, setDeletePhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * 当前**生效**的请求目的地（AI-6）：由 `aiDestinationOf` 唯一判定
   * （没登记代理、或登记了但没确认 → 官方端点）。界面不自己拼地址。
   */
  const destination = useMemo(() => aiDestinationOf(settings), [settings])

  const draft: AiConfigDraft = useMemo(
    () => ({
      model: settings.params.model,
      thinking: settings.params.thinking,
      reasoningEffort: settings.params.reasoningEffort ?? '',
      temperature: settings.params.temperature === undefined ? '' : String(settings.params.temperature),
      topP: settings.params.topP === undefined ? '' : String(settings.params.topP),
      maxTokens: String(settings.params.maxTokens),
      timeoutMs: String(settings.params.timeoutMs),
    }),
    [settings.params],
  )
  const config = useMemo(() => resolveAiParams(draft), [draft])

  /* ------------------------------------------------ 本地规则与二次确认（AI-6） */

  const subjectRulesInput: AiSubjectRulesInput = useMemo(
    () => ({ ...localRules, positionCategories: settings.positionCategories }),
    [localRules, settings.positionCategories],
  )
  const subjectRules = useMemo(
    () => buildAiSubjectRules(subjectRulesInput),
    [subjectRulesInput],
  )
  const subjectRulesFingerprintValue = useMemo(
    () => subjectRulesFingerprint(subjectRulesInput),
    [subjectRulesInput],
  )
  const subjectConfirmation = useMemo(
    () =>
      settings.subjectRulesConfirmedAt === null
        ? null
        : {
            fingerprint: settings.subjectRulesFingerprint ?? '',
            confirmedAt: settings.subjectRulesConfirmedAt,
          },
    [settings.subjectRulesConfirmedAt, settings.subjectRulesFingerprint],
  )
  const subjectRulesConfirmed = isAiSubjectRulesConfirmed(subjectConfirmation, subjectRulesInput)
  const subjectRulesStale = !subjectRulesConfirmed && settings.subjectRulesConfirmedAt !== null


  /** 内存中的 Key 状态：由会话层广播（订阅时会立刻回放一次当前状态） */
  useEffect(() => subscribeAiKeyState(setKeySnapshot), [])

  /**
   * 仓里是否存过 Key：只在解锁后查一次布尔值（不读取、不展示 Key 内容）。
   *
   * 注意这里**不在 effect 体内同步 setState**：那会触发级联渲染（lint 的
   * `react(set-state-in-effect)` 正是抓这个）。未解锁时的重置合并进 promise 回调里完成。
   */
  useEffect(() => {
    let cancelled = false
    const read = vaultUnlocked
      ? encryptedVault.hasSecret('ai-api-key')
      : Promise.resolve(false)
    void read
      .then((present) => {
        if (!cancelled) {
          setPersistedInVault(present)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPersistedInVault(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [vaultUnlocked])

  /** 首屏读一次偏好（没有仓 / 未解锁时回落到默认值，不报错） */
  useEffect(() => {
    let cancelled = false
    void loadAiSettings().then((loaded) => {
      if (!cancelled) {
        setSettings(loaded)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，未做任何修改。')
    } finally {
      setBusy(false)
    }
  }, [])

  /**
   * 保存偏好：**只写非敏感项**（开关 / 保存方式 / 参数 / 脱敏级别 / 岗位类别映射 / 代理登记）。
   * Key 不在这条路径上——它由下面四个独立动作处理。
   *
   * 返回值是「有没有写进本地仓」：调用方据此决定提示语，**不谎称已保存**
   * （临时模式或未解锁时偏好只在内存生效，刷新即失）。
   */
  const persist = useCallback(
    async (next: AiSettings, successNote: string): Promise<boolean> => {
      setSettings(next)
      /*
       * 先把「用户刚做的选择」回传给宿主（分析看板）：它在自己的状态里也持有一份偏好，
       * 不回传就会出现「面板里开关开着、旁边写着已关闭」的矛盾画面。
       * 回传发生在**写仓结果未知之前**，因为这是用户的选择，与能不能落盘无关。
       */
      onSettingsChange?.(next)
      const result = await saveAiSettings(next)
      if (result.ok) {
        setSettings(result.settings)
        setNotice(successNote)
        return true
      }
      setNotice(null)
      setError(
        `配置已在本次会话生效，但没能写入本地仓：${result.reason} 临时模式只在内存，刷新即失。`,
      )
      return false
    },
    [onSettingsChange],
  )

  function handleToggleEnabled(): void {
    const next = !settings.enabled
    void persist(
      { ...settings, enabled: next },
      next
        ? 'AI 深度分析已开启。注意：这不是永久授权，每次发送仍需在看板预览后确认。'
        : 'AI 深度分析已关闭。已保存的 Key 与 AI 历史都保留；本地功能不受影响。',
    )
  }

  function handleKeyStorageChange(mode: AiSettings['keyStorage']): void {
    void persist(
      { ...settings, keyStorage: mode },
      mode === 'encrypted'
        ? '已选择「加密保存在本地仓」：点「加密保存到本地仓」后才会写入。'
        : '已选择「只在内存」：Key 不会写入本地仓。若仓里已存有一份，请用「删除本地仓中的 Key」删掉它。',
    )
  }

  function handleParamChange(next: AiConfigDraft): void {
    // 参数改动立即生效并持久化（它们参与预览 hash，改了就作废旧确认）
    const resolved = resolveAiParams(next)
    void persist({ ...settings, params: resolved.params }, '模型与参数已保存。')
  }

  /** 三级脱敏：设置页存的是**默认级别**（预览面板里的临时切换不写回这里） */
  function handlePrivacyLevelChange(
    level: PrivacyLevel,
    customDimensions: readonly AiAllowedDimension[],
  ): void {
    void persist(
      { ...settings, privacyLevel: level, customDimensions },
      level === 'custom'
        ? '默认脱敏级别已改为自定义：只有你勾选的维度会进入以后的载荷。'
        : '默认脱敏级别已保存；看板里的预览会从这一级别开始，改级别必须重新生成预览。',
    )
  }

  /**
   * 岗位类别映射（AI-6）：保存即换指纹，因此上一次的规则确认会**自动失效**。
   * 这里刻意不做「顺手把确认也续上」——那正是「用户改了规则却沿用旧同意」的事故。
   */
  function handlePositionCategories(rules: readonly PositionCategoryRule[]): void {
    void persist(
      { ...settings, positionCategories: rules },
      `岗位类别映射已保存（${String(rules.length)} 条）。规则指纹已变化，需要重新确认这批规则。`,
    )
  }

  function handleConfirmSubjectRules(): void {
    const confirmation = confirmAiSubjectRules(subjectRulesInput, new Date().toISOString())
    void persist(
      {
        ...settings,
        subjectRulesFingerprint: confirmation.fingerprint,
        subjectRulesConfirmedAt: confirmation.confirmedAt,
      },
      '这批本地规则已确认，可以用于摘要。规则一改，这次确认就失效。',
    )
  }

  /**
   * 登记代理地址（AI-6）：**先撤销旧地址的许可，再保存新地址**。
   *
   * 顺序有意义：先撤销保证「旧 Key 不会被转发到新地址」在任何中间状态下都成立
   * （PRD 18.6 原文）。返回的两项由面板如实告知用户：是否撤销了旧许可、
   * 以及这份登记有没有真的写进本地仓（没写进去就不能说「已登记」）。
   */
  async function handleRegisterProxy(
    origin: string,
  ): Promise<{ readonly revokedPermission: boolean; readonly persisted: boolean }> {
    const revokedPermission = revokeAiKeyPermissionIfOriginChanged(origin)
    const persisted = await persist(
      { ...settings, proxy: { origin, acknowledgedAt: new Date().toISOString() } },
      `请求目的地已改为 ${origin}/chat/completions。目标地址由你自己控制，代理能看到 Key 与摘要。`,
    )
    return { revokedPermission, persisted }
  }

  /** 取消登记：回到官方地址；旧代理地址上的许可同样撤销 */
  async function handleClearProxy(): Promise<{ readonly revokedPermission: boolean }> {
    const revokedPermission = revokeAiKeyPermissionIfOriginChanged(AI_DEFAULT_DESTINATION.origin)
    await persist(
      { ...settings, proxy: { origin: null, acknowledgedAt: null } },
      revokedPermission
        ? '已取消代理登记，请求目的地回到官方端点；代理地址上的 Key 许可已撤销。'
        : '已取消代理登记，请求目的地回到官方端点。',
    )
    return { revokedPermission }
  }

  function handleSaveToMemory(): void {
    void run(async () => {
      const check = checkApiKeyFormat(keyDraft)
      if (!check.ok) {
        setError(check.problem)
        return
      }
      setAiKeySession(keyDraft, new Date().toISOString())
      grantAiKeyPermission(destination, new Date().toISOString())
      setKeyDraft('')
      setNotice('Key 已放入内存，本次会话可用；锁定或刷新即丢弃。')
    })
  }

  function handleSaveEncrypted(): void {
    void run(async () => {
      const check = checkApiKeyFormat(keyDraft)
      if (!check.ok) {
        setError(check.problem)
        return
      }
      if (!vaultUnlocked) {
        setError('保存到本地仓需要先解锁（或先创建本地仓）。临时模式的 Key 只能放在内存里。')
        return
      }
      await encryptedVault.saveSecret('ai-api-key', keyDraft)
      setPersistedInVault(true)
      setKeyDraft('')
      setNotice(
        'Key 已加密保存到本地仓的独立秘密槽位（与业务数据密钥不同）。普通备份不含 Key，恢复后需要重新填写。',
      )
    })
  }

  function handleLoadFromVault(): void {
    void run(async () => {
      if (!vaultUnlocked) {
        setError('从本地仓读入需要先解锁。')
        return
      }
      const stored = await encryptedVault.loadSecret('ai-api-key')
      if (stored === null) {
        setError('本地仓里没有保存 Key——无法读取不存在的内容。')
        return
      }
      setAiKeySession(stored, new Date().toISOString())
      grantAiKeyPermission(destination, new Date().toISOString())
      setNotice('已从本地仓读入内存，本次会话可用；锁定或刷新会再次丢弃。')
    })
  }

  function handleClearMemory(): void {
    clearAiKeySession()
    setNotice('已清空内存中的 Key。本地仓里的那一份（如果有）没有被删除。')
  }

  function handleDeleteFromVault(): void {
    void run(async () => {
      if (!vaultUnlocked) {
        setError('删除本地仓中的 Key 需要先解锁。')
        return
      }
      const removed = await encryptedVault.deleteSecret('ai-api-key')
      setPersistedInVault(false)
      setDeletePhrase('')
      setNotice(
        removed > 0
          ? '已从本地仓删除 Key。招聘数据不受影响。'
          : '本地仓里本来就没有 Key，未做任何修改。',
      )
    })
  }

  const canDeleteFromVault = vaultUnlocked && persistedInVault && isPhraseConfirmed(deletePhrase, DELETE_SECRET_PHRASE)
  const keyForMask = readAiKeyForRequest()

  return (
    <div className="space-y-4">
      {/* ---------------------------------------------------------- 开关 */}
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-slate-900">{AI_SETTINGS_TITLE}</h2>
          <p className="text-xs leading-5 text-slate-600">{AI_SETTINGS_INTRO}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className={`inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300 ${
              settings.enabled ? 'bg-rose-700 hover:bg-rose-800' : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
            disabled={busy}
            onClick={handleToggleEnabled}
            type="button"
          >
            {settings.enabled ? AI_SWITCH_OFF : AI_SWITCH_ON}
          </button>
          <span className="text-xs text-slate-700">
            当前状态：{settings.enabled ? '已开启' : '已关闭（默认）'}
          </span>
        </div>
        <p className="text-xs leading-5 text-slate-600">{AI_ENABLED_NOTE}</p>
        <p className="text-xs leading-5 text-slate-600">{AI_DISABLED_KEEPS_NOTE}</p>
      </section>

      {error === null ? null : (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      )}
      {notice === null ? null : (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      {/* ---------------------------------------------------------- Key */}
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">{AI_KEY_TITLE}</h3>
          <p className="text-xs leading-5 text-slate-600">{AI_KEY_HINT}</p>
        </div>

        <p className="rounded border border-slate-200 bg-slate-50 p-2 text-xs leading-5 text-slate-700">
          {describeKeyState({ session: keySnapshot, persistedInVault, vaultUnlocked })}
          {keySnapshot.present && keyForMask !== null ? (
            <>　当前内存中的 Key：<span className="font-mono">{describeKeyMask(keyForMask)}</span></>
          ) : null}
        </p>

        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
          {AI_KEY_TRANSMISSION_NOTE}
        </p>

        <label className="block text-xs text-slate-700">
          {AI_KEY_INPUT_LABEL}
          <input
            autoComplete="off"
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            onChange={(event) => setKeyDraft(event.target.value)}
            placeholder={AI_KEY_INPUT_PLACEHOLDER}
            type="password"
            value={keyDraft}
          />
        </label>
        <p className="text-xs leading-5 text-slate-500">{AI_KEY_NO_FORMAT_CHECK_NOTE}</p>

        <fieldset className="space-y-1">
          <legend className="text-xs font-medium text-slate-800">保存方式</legend>
          <label className="flex items-start gap-2 text-xs leading-5 text-slate-700">
            <input
              checked={settings.keyStorage === 'memory'}
              className="mt-0.5"
              name="ai-key-storage"
              onChange={() => handleKeyStorageChange('memory')}
              type="radio"
            />
            <span>{AI_KEY_MEMORY_LABEL}</span>
          </label>
          <label className="flex items-start gap-2 text-xs leading-5 text-slate-700">
            <input
              checked={settings.keyStorage === 'encrypted'}
              className="mt-0.5"
              name="ai-key-storage"
              onChange={() => handleKeyStorageChange('encrypted')}
              type="radio"
            />
            <span>{AI_KEY_ENCRYPTED_LABEL}</span>
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={busy || keyDraft.trim() === ''}
            onClick={handleSaveToMemory}
            type="button"
          >
            {AI_KEY_SAVE_LABEL}
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={busy || keyDraft.trim() === '' || settings.keyStorage !== 'encrypted'}
            onClick={handleSaveEncrypted}
            type="button"
          >
            {AI_KEY_SAVE_ENCRYPTED_LABEL}
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={busy || !vaultUnlocked}
            onClick={handleLoadFromVault}
            type="button"
          >
            {AI_KEY_LOAD_LABEL}
          </button>
          <button
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={busy || !keySnapshot.present}
            onClick={handleClearMemory}
            type="button"
          >
            {AI_KEY_CLEAR_MEMORY_LABEL}
          </button>
        </div>

        {/* 删除仓里的 Key 是破坏性且**不可逆**的，按项目惯例要短语二次确认 */}
        <div className="space-y-2 rounded border border-rose-200 bg-rose-50/40 p-2">
          <p className="text-xs leading-5 text-rose-900">
            删除本地仓中的 Key 不可撤销（可以用加密备份恢复业务数据，但备份不含 Key。此操作不会删除招聘数据，也不会删除 AI 历史）。
          </p>
          <PhraseConfirm
            busy={busy || !persistedInVault || !vaultUnlocked}
            onChange={setDeletePhrase}
            phrase={DELETE_SECRET_PHRASE}
            value={deletePhrase}
          />
          <button
            className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-300"
            disabled={busy || !canDeleteFromVault}
            onClick={handleDeleteFromVault}
            type="button"
          >
            {AI_KEY_DELETE_LABEL}
          </button>
        </div>
      </section>

      {/* ---------------------------------------------------------- 许可 */}
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{AI_PERMISSION_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">
          {describeKeyPermission(keySnapshot.permission, destination)}
        </p>
      </section>

      {/* ---------------------------------------------------------- 出站目的地（AI-6） */}
      <section className="space-y-1 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{AI_DESTINATION_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-700">
          当前目的地：<span className="font-mono">{describeAiDestination(destination)}</span>
        </p>
        <p className="text-xs leading-5 text-slate-500">
          费用上限估算见下一节；真实费用由 DeepSeek 按其计费规则结算，本应用不查询余额。
        </p>
      </section>

      {/* ---------------------------------------------------------- 三级脱敏（AI-6） */}
      <AiPrivacyLevelPanel
        busy={busy}
        customDimensions={settings.customDimensions}
        onChange={handlePrivacyLevelChange}
        privacyLevel={settings.privacyLevel}
      />

      {/* ---------------------------------------------------------- 本地规则与二次确认（AI-6） */}
      {/*
        `key` 取映射的文本形式：偏好是**异步**读回的（首帧拿到的是默认值），
        而映射编辑器里有一份本地草稿。不加 key 的话，读回之后规则视图会显示真实映射、
        输入框却还是空的——两处说法不一致。key 变化即重挂载，草稿跟着最新偏好走。
      */}
      <AiSubjectRulesPanel
        busy={busy}
        confirmed={subjectRulesConfirmed}
        confirmedAt={settings.subjectRulesConfirmedAt}
        fingerprint={subjectRulesFingerprintValue}
        key={formatPositionCategoryLines(settings.positionCategories)}
        onChangePositionCategories={handlePositionCategories}
        onConfirm={handleConfirmSubjectRules}
        positionCategories={settings.positionCategories}
        rules={subjectRules}
        staleConfirmation={subjectRulesStale}
      />

      {/* ---------------------------------------------------------- 模型与参数 */}
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-slate-900">{AI_MODEL_TITLE}</h3>
          <p className="text-xs leading-5 text-slate-600">{AI_MODEL_CATALOG_NOTE}</p>
        </div>

        <label className="block text-xs text-slate-700">
          模型
          <select
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
            onChange={(event) => handleParamChange({ ...draft, model: event.target.value })}
            value={AI_MODEL_CATALOG.some((spec) => spec.id === draft.model) ? draft.model : ''}
          >
            <option value="">（自定义模型 ID：见下方输入框）</option>
            {AI_MODEL_CATALOG.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-slate-700">
          自定义模型 ID
          <input
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            onChange={(event) => handleParamChange({ ...draft, model: event.target.value })}
            type="text"
            value={draft.model}
          />
        </label>

        <dl className="grid grid-cols-1 gap-2 text-xs text-slate-700 md:grid-cols-2">
          <div>
            <dt className="text-slate-500">官方模型版本</dt>
            <dd>{config.spec.modelVersion}</dd>
          </div>
          <div>
            <dt className="text-slate-500">上下文 / 输出上限</dt>
            <dd>
              {formatInteger(config.spec.contextWindowTokens)} / {formatInteger(config.spec.maxOutputTokens)} tokens
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">输入价（缓存未命中 / 命中，高峰）</dt>
            <dd>
              {config.spec.pricing.inputCacheMissPerMillion.peak} 元 / {config.spec.pricing.inputCacheHitPerMillion.peak} 元
              每百万 tokens
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">输出价（高峰）</dt>
            <dd>{config.spec.pricing.outputPerMillion.peak} 元每百万 tokens</dd>
          </div>
        </dl>

        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <label className="text-xs text-slate-700">
            思考模式
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              disabled={!paramSupportOf(config.spec, 'thinking', false).supported}
              onChange={(event) =>
                handleParamChange({ ...draft, thinking: event.target.value as AiThinkingSetting })
              }
              value={draft.thinking}
            >
              <option value="auto">不指定（服务端按模型默认处理）</option>
              <option value="enabled">开启</option>
              <option value="disabled">关闭</option>
            </select>
          </label>
          <label className="text-xs text-slate-700">
            推理强度 reasoning_effort
            <select
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              disabled={!paramSupportOf(config.spec, 'reasoningEffort', config.thinkingActive).supported}
              onChange={(event) =>
                handleParamChange({ ...draft, reasoningEffort: event.target.value as AiReasoningEffort | '' })
              }
              value={draft.reasoningEffort}
            >
              <option value="">不指定（服务端默认档位）</option>
              {AI_REASONING_EFFORTS.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-700">
            温度 temperature
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
              disabled={!paramSupportOf(config.spec, 'temperature', config.thinkingActive).supported}
              max={AI_PARAM_RANGES.temperature.max}
              min={AI_PARAM_RANGES.temperature.min}
              onChange={(event) => handleParamChange({ ...draft, temperature: event.target.value })}
              step={AI_PARAM_RANGES.temperature.step}
              type="number"
              value={draft.temperature}
            />
          </label>
          <label className="text-xs text-slate-700">
            top_p（只在思考模式生效）
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
              disabled={!paramSupportOf(config.spec, 'topP', config.thinkingActive).supported}
              max={AI_PARAM_RANGES.topP.max}
              min={AI_PARAM_RANGES.topP.min}
              onChange={(event) => handleParamChange({ ...draft, topP: event.target.value })}
              step={AI_PARAM_RANGES.topP.step}
              type="number"
              value={draft.topP}
            />
          </label>
          <label className="text-xs text-slate-700">
            最长输出 max_tokens
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              max={Math.min(config.spec.maxOutputTokens, AI_PARAM_RANGES.maxTokens.max)}
              min={AI_PARAM_RANGES.maxTokens.min}
              onChange={(event) => handleParamChange({ ...draft, maxTokens: event.target.value })}
              type="number"
              value={draft.maxTokens}
            />
          </label>
          <label className="text-xs text-slate-700">
            超时（毫秒）
            <input
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-xs"
              max={AI_PARAM_RANGES.timeoutMs.max}
              min={AI_PARAM_RANGES.timeoutMs.min}
              onChange={(event) => handleParamChange({ ...draft, timeoutMs: event.target.value })}
              step={AI_PARAM_RANGES.timeoutMs.step}
              type="number"
              value={draft.timeoutMs}
            />
          </label>
        </div>

        <div className="rounded border border-slate-200 bg-slate-50 p-2">
          <p className="text-xs font-medium text-slate-800">实际会发送的参数</p>
          <ul className="mt-1 space-y-0.5 text-xs leading-5 text-slate-600">
            {describeResolvedParams(config).map((row) => (
              <li key={row.label}>
                {row.label}：{row.value}
              </li>
            ))}
          </ul>
        </div>

        {config.notices.length === 0 ? null : (
          <div className="rounded border border-amber-300 bg-amber-50 p-2">
            <p className="text-xs font-medium text-amber-900">
              本机自动调整 / 需要你知道的 {config.notices.length} 项
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-5 text-amber-900">
              {config.notices.map((item) => (
                <li key={`${item.code}-${item.detail}`}>{item.detail}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ---------------------------------------------------------- 费用 */}
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{AI_COST_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{AI_COST_NOTE}</p>
        {/*
          这里的估算是**按空载荷**算的（设置页还没有摘要）：只用于说明「输出上限值多少钱」。
          真实的一次请求费用在看板的预览面板里按实际摘要长度重算。
        */}
        <p className="text-xs leading-5 text-slate-700">
          {formatCostEstimate(
            estimateCost({
              spec: config.spec,
              inputCharCount: 0,
              maxOutputTokens: config.params.maxTokens,
            }),
          )}
        </p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-500">
          {estimateCost({
            spec: config.spec,
            inputCharCount: 0,
            maxOutputTokens: config.params.maxTokens,
          }).assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------- 代理边界（AI-6） */}
      <AiProxyPanel
        busy={busy}
        destination={destination}
        onClear={handleClearProxy}
        onRegister={handleRegisterProxy}
        proxyAcknowledgedAt={settings.proxy.acknowledgedAt}
        proxyOrigin={settings.proxy.origin}
      />

      {/* ---------------------------------------------------------- AI 数据的删除动作（AI-6） */}
      <AiRetentionPanel vaultUnlocked={vaultUnlocked} />

      {/* ---------------------------------------------------------- 边界 */}
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{AI_BOUNDARY_TITLE}</h3>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
          {AI_BOUNDARY_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="text-xs leading-5 text-slate-500">
          目录核实日期 {AI_CATALOG_VERIFIED_AT}；来源：
          {AI_CATALOG_SOURCES.map((url) => (
            <span className="break-all" key={url}>
              {' '}
              {url}
            </span>
          ))}
        </p>
        <p className="text-xs leading-5 text-slate-500">
          偏好记录 ID：<span className="font-mono">{AI_SETTINGS_OBJECT_ID}</span>
          （只存开关、保存方式、参数、脱敏级别、岗位类别映射与代理登记，不含 Key 与历史）
        </p>
      </section>
    </div>
  )
}
