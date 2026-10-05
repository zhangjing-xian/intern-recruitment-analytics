import { useState } from 'react'

import { formatInteger } from '../../lib/format'
import type { StorageEstimate, VaultStatus } from '../../storage'
import ClearScopePanel from './ClearScopePanel'
import PhraseConfirm from './PhraseConfirm'
import { buildClearLayers } from './clearScope'
import {
  CLEAR_OBJECTS_PHRASE,
  CLEAR_VAULT_PHRASE,
  DELETE_SECRET_PHRASE,
  IDLE_LOCK_HELP,
  IDLE_LOCK_OPTIONS,
  PASSWORD_HELP,
  checkPasswordInput,
  describeSecretSlot,
  formatCreatedAt,
  formatIdleRemaining,
  formatPersistedState,
  formatStorageUsage,
  isPhraseConfirmed,
  shortVaultId,
} from './vaultText'

const SECTION = 'space-y-4 rounded-lg border border-slate-200 bg-white p-4'
const DANGER_SECTION = 'space-y-4 rounded-lg border border-rose-200 bg-rose-50/40 p-4'
const PRIMARY_BUTTON =
  'inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400'
const GHOST_BUTTON =
  'inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400'
const DANGER_BUTTON =
  'inline-flex items-center rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-300'
const FIELD = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm'

type VaultManagerPanelProps = {
  readonly status: VaultStatus
  readonly busy: boolean
  readonly error: string | null
  readonly notice: string | null
  /** 距自动锁定的剩余毫秒数；未计时为 0（界面据此不显示倒计时） */
  readonly idleRemainingMs: number
  /** 存储占用；null = 还没读取过 */
  readonly estimate: StorageEstimate | null
  readonly hasAiKey: boolean
  readonly onLock: () => void
  readonly onChangeIdleMinutes: (minutes: number) => void
  readonly onChangePassword: (oldPassword: string, newPassword: string) => void
  readonly onRefreshEstimate: () => void
  readonly onRequestPersistent: () => void
  readonly onClearObjects: () => void
  readonly onDeleteSecret: () => void
  readonly onClearAll: () => void
}

/**
 * 已解锁状态下的本地仓管理（步骤6）：状态、锁定、闲置时长、改密、占用、清除。
 *
 * 口径提醒（写在界面上，避免用户误解）：
 * - 锁定只丢弃内存密钥，并清空**内存中的业务数据**（导入结果、已提交数据集、映射草稿）；
 *   用户配置（清洗口径草稿、映射模板）保留；
 * - 本地仓只存密文；秘密槽位（AI Key）与业务数据分开生命周期，普通备份不含 Key；
 * - 三个清除动作互不代替：清业务数据、删 AI Key、清空整个本地仓。
 */
export default function VaultManagerPanel({
  status,
  busy,
  error,
  notice,
  idleRemainingMs,
  estimate,
  hasAiKey,
  onLock,
  onChangeIdleMinutes,
  onChangePassword,
  onRefreshEstimate,
  onRequestPersistent,
  onClearObjects,
  onDeleteSecret,
  onClearAll,
}: VaultManagerPanelProps) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordIssue, setPasswordIssue] = useState<string | null>(null)
  const [objectsPhrase, setObjectsPhrase] = useState('')
  const [secretPhrase, setSecretPhrase] = useState('')
  const [vaultPhrase, setVaultPhrase] = useState('')

  const remaining = formatIdleRemaining(idleRemainingMs)
  /**
   * 清除范围清单（title 文案的唯一来源）。
   * 为什么从 `clearScope` 取标题而不是在这里再写一遍：三个动作的**叫法**必须与范围说明
   * 逐字一致，否则用户按范围说明去找按钮时会找不到（「1. 清空业务数据」与「清空业务数据」是两回事）。
   */
  const clearLayers = buildClearLayers(status)
  const clearLayer = (id: (typeof clearLayers)[number]['id']): string =>
    clearLayers.find((layer) => layer.id === id)?.label ?? id

  function submitPasswordChange(): void {
    const issue = checkPasswordInput(newPassword, confirmation)
    if (issue !== null) {
      setPasswordIssue(issue)
      return
    }
    if (oldPassword.length === 0) {
      setPasswordIssue('请输入当前密码')
      return
    }
    setPasswordIssue(null)
    onChangePassword(oldPassword, newPassword)
    setOldPassword('')
    setNewPassword('')
    setConfirmation('')
  }

  return (
    <div className="space-y-4">

      <section className={SECTION}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">加密本地仓（已解锁）</h2>
            <p className="text-xs text-slate-600">
              业务数据以 AES-GCM 密文存放在本机 IndexedDB；密钥由密码经 PBKDF2 派生，只在内存中。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {remaining === '' ? (
              <span className="text-xs text-slate-500">未在计时（解锁后开始计时）</span>
            ) : (
              <span className="text-xs text-amber-700">{remaining}</span>
            )}
            <button className={PRIMARY_BUTTON} disabled={busy} onClick={onLock} type="button">
              立即锁定
            </button>
          </div>
        </div>

        <dl className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-slate-500">仓标识</dt>
            <dd className="font-medium text-slate-900">{shortVaultId(status.vaultId)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">创建时间</dt>
            <dd className="font-medium text-slate-900">{formatCreatedAt(status.createdAt)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">业务对象 / 秘密槽位</dt>
            <dd className="font-medium text-slate-900">
              {formatInteger(status.objectCount)} / {formatInteger(status.secretCount)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">仓版本 / KDF 迭代次数</dt>
            <dd className="font-medium text-slate-900">
              {formatInteger(status.revision)} /{' '}
              {status.kdfIterations === null ? '—' : formatInteger(status.kdfIterations)}
            </dd>
          </div>
        </dl>

        {status.schemaCompatible ? null : (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            本机数据的数据结构版本与当前应用不一致（本机：{status.schemaVersion ?? '未知'}）。请勿继续写入：
            先用对应版本导出加密备份，再用加密备份恢复，不要指望静默转换。
          </p>
        )}

        {error !== null ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </p>
        ) : null}
        {notice !== null ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {notice}
          </p>
        ) : null}
      </section>

      <section className={SECTION}>
        <h2 className="text-sm font-semibold text-slate-900">闲置自动锁定</h2>
        <label className="block space-y-1 text-xs text-slate-700 lg:max-w-xs">
          <span className="font-medium text-slate-900">锁定前的闲置时长</span>
          <select
            className={FIELD}
            disabled={busy}
            onChange={(event) => {
              onChangeIdleMinutes(Number(event.target.value))
            }}
            value={String(status.idleLockMinutes)}
          >
            {IDLE_LOCK_OPTIONS.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {minutes} 分钟
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-slate-500">{IDLE_LOCK_HELP}</p>
        <p className="text-xs text-slate-500">
          锁定会清空内存中的导入结果、已提交数据集与映射草稿；清洗口径草稿与映射模板会保留（它们属于配置，不是业务数据）。
        </p>
      </section>

      <section className={SECTION}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-slate-900">存储占用</h2>
            <p className="text-xs text-slate-600">
              {estimate === null ? '尚未读取存储占用信息。' : formatStorageUsage(estimate)}
            </p>
            <p className="text-xs text-slate-500">
              {estimate === null
                ? '读取后显示「已用 / 配额」；未知一律显示未知，不显示 0。'
                : formatPersistedState(estimate.persisted)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={GHOST_BUTTON} disabled={busy} onClick={onRefreshEstimate} type="button">
              刷新占用
            </button>
            <button
              className={GHOST_BUTTON}
              disabled={busy}
              onClick={onRequestPersistent}
              type="button"
            >
              申请持久化存储
            </button>
          </div>
        </div>
      </section>

      <section className={SECTION}>
        <h2 className="text-sm font-semibold text-slate-900">修改密码</h2>
        <p className="text-xs text-slate-600">
          改密会用新密码重新派生密钥并重写整个仓（仓版本 +1），其他已打开的标签页会被要求重新解锁。
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="space-y-1 text-xs text-slate-700">
            <span className="font-medium text-slate-900">当前密码</span>
            <input
              autoComplete="current-password"
              className={FIELD}
              disabled={busy}
              onChange={(event) => {
                setOldPassword(event.target.value)
              }}
              type="password"
              value={oldPassword}
            />
          </label>
          <label className="space-y-1 text-xs text-slate-700">
            <span className="font-medium text-slate-900">新密码</span>
            <input
              autoComplete="new-password"
              className={FIELD}
              disabled={busy}
              onChange={(event) => {
                setNewPassword(event.target.value)
              }}
              type="password"
              value={newPassword}
            />
          </label>
          <label className="space-y-1 text-xs text-slate-700">
            <span className="font-medium text-slate-900">再次输入新密码</span>
            <input
              autoComplete="new-password"
              className={FIELD}
              disabled={busy}
              onChange={(event) => {
                setConfirmation(event.target.value)
              }}
              type="password"
              value={confirmation}
            />
          </label>
        </div>
        {passwordIssue !== null ? (
          <p className="text-xs text-rose-700">{passwordIssue}</p>
        ) : (
          <p className="text-xs text-slate-500">{PASSWORD_HELP}</p>
        )}
        <button
          className={PRIMARY_BUTTON}
          disabled={busy || oldPassword.length === 0 || newPassword.length === 0}
          onClick={submitPasswordChange}
          type="button"
        >
          修改密码
        </button>
      </section>

      <section className={DANGER_SECTION}>
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-rose-900">清除数据（三个互不代替的动作）</h2>
          <p className="text-xs text-rose-900/80">
            所有数据只在这台电脑上，没有云端副本，清除后无法撤销。每个动作都要求逐字输入确认短语。
          </p>
        </div>

        <ClearScopePanel status={status} />

        <div className="space-y-2 rounded-md border border-rose-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-900">{clearLayer('clear-objects')}</h3>
          <p className="text-xs text-slate-600">
            删除已保存的数据集、清洗设置、映射模板与 AI 历史；保留密码与 AI Key，本地仓继续可用。
          </p>
          <PhraseConfirm
            busy={busy}
            onChange={setObjectsPhrase}
            phrase={CLEAR_OBJECTS_PHRASE}
            value={objectsPhrase}
          />
          <button
            className={DANGER_BUTTON}
            disabled={busy || !isPhraseConfirmed(objectsPhrase, CLEAR_OBJECTS_PHRASE)}
            onClick={() => {
              onClearObjects()
              setObjectsPhrase('')
            }}
            type="button"
          >
            清空业务数据
          </button>
        </div>

        <div className="space-y-2 rounded-md border border-rose-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-900">{clearLayer('delete-ai-key')}</h3>
          <p className="text-xs text-slate-600">
            秘密槽位与业务数据分开生命周期：删除 {describeSecretSlot('ai-api-key')} 不影响任何数据集，
            清空业务数据也不会顺手删掉它。当前状态：
            {hasAiKey ? '已保存一个 Key（内容不可读回展示）' : '未保存'}。
          </p>
          <PhraseConfirm
            busy={busy}
            onChange={setSecretPhrase}
            phrase={DELETE_SECRET_PHRASE}
            value={secretPhrase}
          />
          <button
            className={DANGER_BUTTON}
            disabled={busy || !isPhraseConfirmed(secretPhrase, DELETE_SECRET_PHRASE)}
            onClick={() => {
              onDeleteSecret()
              setSecretPhrase('')
            }}
            type="button"
          >
            删除 AI Key
          </button>
        </div>

        <div className="space-y-2 rounded-md border border-rose-200 bg-white p-3">
          <h3 className="text-xs font-semibold text-slate-900">{clearLayer('clear-vault')}</h3>
          <p className="text-xs text-slate-600">
            删除本机 IndexedDB 数据库「{status.databaseName}」的全部内容：密文与密钥槽位一起删除，仓回到未创建状态。
            密码无法找回，因此该操作等同于放弃全部本地数据。
          </p>
          <PhraseConfirm
            busy={busy}
            onChange={setVaultPhrase}
            phrase={CLEAR_VAULT_PHRASE}
            value={vaultPhrase}
          />
          <button
            className={DANGER_BUTTON}
            disabled={busy || !isPhraseConfirmed(vaultPhrase, CLEAR_VAULT_PHRASE)}
            onClick={() => {
              onClearAll()
              setVaultPhrase('')
            }}
            type="button"
          >
            清空整个本地仓
          </button>
        </div>
      </section>
    </div>
  )
}

