import { useState } from 'react'

import { DEFAULT_IDLE_LOCK_MINUTES, MAX_IDLE_LOCK_MINUTES, MIN_IDLE_LOCK_MINUTES } from '../../storage'
import { IDLE_LOCK_OPTIONS, PASSWORD_HELP, checkPasswordInput } from './vaultText'

const PRIMARY_BUTTON =
  'inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400'
const GHOST_BUTTON =
  'inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400'
const FIELD = 'w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm'

type VaultSetupPanelProps = {
  /** create = 本机还没有仓（设置密码）；unlock = 已有仓但已锁定（输入密码） */
  readonly mode: 'create' | 'unlock'
  readonly busy: boolean
  readonly error: string | null
  readonly onCreate: (password: string, idleLockMinutes: number) => void
  readonly onUnlock: (password: string) => void
  readonly onForgetPassword: () => void
}

/**
 * 创建 / 解锁面板（步骤6）。
 *
 * 三条硬规则（docs/PRD.md 10.3、AGENTS.md §2.4）：
 * 1. 密码**永不外发**、不进 URL、不进日志；本组件不打印任何输入；
 * 2. 不承诺「内存彻底擦除」、不承诺找回密码（文案写清只能清空重建或用备份恢复）；
 * 3. 强度判断复用 `crypto` 的同一套口径（`checkPasswordInput`），不在界面另立标准。
 */
export default function VaultSetupPanel({
  mode,
  busy,
  error,
  onCreate,
  onUnlock,
  onForgetPassword,
}: VaultSetupPanelProps) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [idleLockMinutes, setIdleLockMinutes] = useState<number>(DEFAULT_IDLE_LOCK_MINUTES)
  const [localError, setLocalError] = useState<string | null>(null)

  const isCreate = mode === 'create'

  function submit(): void {
    const issue = checkPasswordInput(password, isCreate ? confirmation : undefined)
    if (issue !== null) {
      setLocalError(issue)
      return
    }
    setLocalError(null)
    if (isCreate) {
      onCreate(password, idleLockMinutes)
    } else {
      onUnlock(password)
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-900">
          {isCreate ? '创建加密本地仓' : '解锁本地仓'}
        </h2>
        <p className="text-xs text-slate-600">
          {isCreate
            ? '所有招聘数据（解析结果、清洗后的记录、统计与 AI 历史）都加密后存在这台电脑的 IndexedDB 里，不会上传到任何服务器。'
            : '刷新页面或闲置超时后需要重新解锁：密钥只在内存里，不写入磁盘。'}
        </p>
      </div>

      {error !== null ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="space-y-1 text-xs text-slate-700">
          <span className="font-medium text-slate-900">密码</span>
          <input
            autoComplete={isCreate ? 'new-password' : 'current-password'}
            className={FIELD}
            disabled={busy}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
            type="password"
            value={password}
          />
        </label>

        {isCreate ? (
          <label className="space-y-1 text-xs text-slate-700">
            <span className="font-medium text-slate-900">再次输入密码</span>
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
        ) : null}
      </div>

      {isCreate ? (
        <label className="block space-y-1 text-xs text-slate-700 lg:max-w-xs">
          <span className="font-medium text-slate-900">闲置自动锁定</span>
          <select
            className={FIELD}
            disabled={busy}
            onChange={(event) => {
              setIdleLockMinutes(Number(event.target.value))
            }}
            value={String(idleLockMinutes)}
          >
            {IDLE_LOCK_OPTIONS.map((minutes) => (
              <option key={minutes} value={String(minutes)}>
                {minutes} 分钟
              </option>
            ))}
          </select>
          <span className="block text-slate-500">
            范围 {MIN_IDLE_LOCK_MINUTES}–{MAX_IDLE_LOCK_MINUTES} 分钟，默认 15 分钟；锁定后随时可在本页修改。
          </span>
        </label>
      ) : null}

      {localError !== null ? (
        <p className="text-xs text-rose-700">{localError}</p>
      ) : (
        <p className="text-xs text-slate-500">{PASSWORD_HELP}</p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          className={PRIMARY_BUTTON}
          disabled={busy || password.length === 0}
          onClick={submit}
          type="button"
        >
          {busy ? '正在处理…' : isCreate ? '创建并解锁' : '解锁'}
        </button>
        {isCreate ? null : (
          <button
            className={GHOST_BUTTON}
            disabled={busy}
            onClick={onForgetPassword}
            type="button"
          >
            忘记密码？查看自救路径
          </button>
        )}
      </div>

      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
        <li>本地仓里没有密码哈希，也没有任何可以直接离线爆破的中间量；因此没有密码找回。</li>
        <li>忘记密码时只有两条路：用加密备份 + 备份密码恢复，或清空本地仓后重新导入。</li>
        <li>解锁状态只在本标签页内存里；打开其他标签页需要各自解锁，不会共享密钥。</li>
      </ul>
    </section>
  )
}
