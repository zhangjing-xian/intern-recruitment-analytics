import { useCallback, useEffect, useState } from 'react'

import { subscribeKeyState } from '../../crypto'
import {
  VAULT_ERROR_MESSAGES,
  activeVaultSessionGuard,
  encryptedVault,
  readVaultIdleRemainingMs,
  subscribeVaultEvents,
  vaultErrorMessage,
  type StorageEstimate,
  type VaultLockReason,
  type VaultStatus,
} from '../../storage'
import PhraseConfirm from './PhraseConfirm'
import VaultManagerPanel from './VaultManagerPanel'
import VaultSetupPanel from './VaultSetupPanel'
import { CLEAR_VAULT_PHRASE, describeLockReason, isPhraseConfirmed } from './vaultText'

/**
 * 设置页的本地仓入口（步骤6）。
 *
 * 职责边界：
 * - 界面只调用 `encryptedVault` 懒门面（动态加载 Dexie），**不**直接 import `vault.ts`，
 *   也不碰 IndexedDB / localStorage 的任何 API；
 * - 倒计时由应用外壳的会话守卫统一维护（`readVaultIdleRemainingMs`），本页只读，不另起计时器；
 * - 一切错误都经 `vaultErrorMessage` 收敛成固定文案，绝不回显底层异常（密码错误与密文被篡改同文案）；
 * - 忘记密码时只提供「用加密备份恢复」或「清空整个本地仓」两条路，不伪装成可以找回。
 */
export default function VaultWorkspace() {
  const [status, setStatus] = useState<VaultStatus | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<StorageEstimate | null>(null)
  const [hasAiKey, setHasAiKey] = useState(false)
  /** 只用来触发「每秒重渲染」；真正的剩余毫秒数在渲染时从会话守卫读（见 `idleRemainingMs` 派生值） */
  const [, setIdleTick] = useState(0)
  const [lockReason, setLockReason] = useState<VaultLockReason | null>(null)
  const [showRecovery, setShowRecovery] = useState(false)
  const [recoveryPhrase, setRecoveryPhrase] = useState('')

  const unlocked = status !== null && status.state === 'unlocked'
  /** 锁定时按「没有 AI Key」展示：不让上一次解锁读到的布尔值残留在界面上 */
  const aiKeyPresent = unlocked && hasAiKey

  const refreshStatus = useCallback(async (): Promise<void> => {
    try {
      setStatus(await encryptedVault.status())
      setStatusError(null)
    } catch (cause) {
      setStatusError(vaultErrorMessage(cause))
    }
  }, [])

  const run = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await operation()
    } catch (cause) {
      setError(vaultErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }, [])

  /**
   * 首屏读取一次仓状态与占用估算。
   * setState 只发生在 promise 回调里（不在 effect 体内同步触发）：一次渲染就能拿到结果，
   * 也避免「effect 里再触发一轮渲染」的串行渲染。
   */
  useEffect(() => {
    let cancelled = false
    void encryptedVault
      .status()
      .then((next) => {
        if (!cancelled) {
          setStatus(next)
          setStatusError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setStatusError(vaultErrorMessage(cause))
        }
      })
    void encryptedVault.estimate().then((next) => {
      if (!cancelled) {
        setEstimate(next)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  /** 解锁 / 锁定都会改变仓状态（含其他标签页触发的），统一重新读一次 */
  useEffect(() => subscribeKeyState(() => {
    void refreshStatus()
  }), [refreshStatus])

  /** 锁定、其他标签页改密、仓被清空：都要在界面上说清楚发生了什么 */
  useEffect(() => subscribeVaultEvents((event) => {
    if (event.type === 'locked') {
      setLockReason(event.reason)
      setNotice(null)
      setShowRecovery(false)
    }
    if (event.type === 'stale-session') {
      setError(VAULT_ERROR_MESSAGES['stale-session'])
    }
    if (event.type === 'revision-changed' || event.type === 'cleared') {
      setNotice(null)
    }
  }), [])

  /** 秘密槽位是否存在：只读布尔值，不读取也不展示 Key 内容（锁定时不改 state，由 `aiKeyPresent` 兜底） */
  useEffect(() => {
    if (!unlocked) {
      return
    }
    let cancelled = false
    void encryptedVault
      .hasSecret('ai-api-key')
      .then((value) => {
        if (!cancelled) {
          setHasAiKey(value)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHasAiKey(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [unlocked])

  /**
   * 倒计时：只读外壳守卫的剩余时间（`readVaultIdleRemainingMs`），本页不另起计时逻辑。
   * 定时器只负责「每秒催一次重渲染」，剩余毫秒数在渲染时读（见下面的派生值）；
   * 锁定时固定显示 0，不让上一次解锁的读数残留。
   */
  useEffect(() => {
    if (!unlocked) {
      return
    }
    const handle = window.setInterval(() => {
      setIdleTick((value) => value + 1)
    }, 1000)
    return () => {
      window.clearInterval(handle)
    }
  }, [unlocked])

  const idleRemainingMs = unlocked ? readVaultIdleRemainingMs() : 0

  function handleCreate(password: string, idleLockMinutes: number): void {
    void run(async () => {
      setStatus(await encryptedVault.create(password, { idleLockMinutes }))
      setLockReason(null)
      setNotice(`本地仓已创建并解锁：闲置 ${idleLockMinutes} 分钟后自动锁定。`)
    })
  }

  function handleUnlock(password: string): void {
    void run(async () => {
      setStatus(await encryptedVault.unlock(password))
      setLockReason(null)
      setNotice('已解锁。密钥只在内存中，锁定或刷新都会丢弃。')
    })
  }

  function handleLock(): void {
    encryptedVault.lock('manual')
    void refreshStatus()
  }

  function handleChangePassword(oldPassword: string, newPassword: string): void {
    void run(async () => {
      setStatus(await encryptedVault.changePassword(oldPassword, newPassword))
      setNotice('密码已修改：旧密码立即失效，其他标签页会被要求重新解锁。')
    })
  }

  function handleChangeIdleMinutes(minutes: number): void {
    void run(async () => {
      setStatus(await encryptedVault.setIdleLockMinutes(minutes))
      activeVaultSessionGuard()?.setIdleLockMinutes(minutes)
      setNotice(`闲置锁定已改为 ${minutes} 分钟。`)
    })
  }

  function handleRefreshEstimate(): void {
    void run(async () => {
      setEstimate(await encryptedVault.estimate())
    })
  }

  function handleRequestPersistent(): void {
    void run(async () => {
      setEstimate(await encryptedVault.requestPersistent())
      setNotice('已向浏览器申请持久化存储；是否同意由浏览器决定，界面按最新状态如实展示。')
    })
  }

  function handleClearObjects(): void {
    void run(async () => {
      const removed = await encryptedVault.clearObjects()
      setStatus(await encryptedVault.status())
      setNotice(`已清空 ${removed} 条业务对象；密码与 AI Key 保留。`)
    })
  }

  function handleDeleteSecret(): void {
    void run(async () => {
      const removed = await encryptedVault.deleteSecret('ai-api-key')
      setHasAiKey(false)
      setStatus(await encryptedVault.status())
      setNotice(removed > 0 ? 'AI Key 已从本地仓删除。' : '本地仓里没有保存 AI Key，未做任何修改。')
    })
  }

  function handleClearAll(): void {
    void run(async () => {
      await encryptedVault.clearAll()
      await refreshStatus()
      setEstimate(await encryptedVault.estimate())
      setHasAiKey(false)
      setLockReason(null)
      setShowRecovery(false)
      setRecoveryPhrase('')
      setNotice('本地仓已清空：密文与密钥槽位都已删除，需要重新创建才能再次保存数据。')
    })
  }

  if (status === null) {
    return (
      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">加密本地仓</h2>
        <p className="text-sm text-slate-600">正在读取本地仓状态…</p>
        {statusError === null ? null : (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {statusError}
          </p>
        )}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {lockReason === null ? null : (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {describeLockReason(lockReason)}
        </p>
      )}

      {statusError === null ? null : (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {statusError}
        </p>
      )}

      {unlocked || !showRecovery ? null : (
        <section className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/40 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-rose-900">忘记密码时的自救路径</h2>
            <p className="text-xs text-rose-900/80">
              本项目不保存密码哈希，也没有服务端可以重置：密码无法找回，请先确认下面两条路都知道自己在做什么。
            </p>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-700">
            <li>
              用加密备份恢复：备份用备份时设置的密码加密，与本地仓当前密码无关；
              恢复前需要先清空本机本地仓（下面的操作），再导入备份。
            </li>
            <li>
              清空本机本地仓：删除数据库「{status.databaseName}」里的全部密文与密钥槽位，回到未创建状态；
              此操作不可撤销，也不会上传任何内容。
            </li>
          </ol>
          <PhraseConfirm
            busy={busy}
            onChange={setRecoveryPhrase}
            phrase={CLEAR_VAULT_PHRASE}
            value={recoveryPhrase}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex items-center rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-300"
              disabled={busy || !isPhraseConfirmed(recoveryPhrase, CLEAR_VAULT_PHRASE)}
              onClick={handleClearAll}
              type="button"
            >
              清空整个本地仓
            </button>
            <button
              className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50"
              disabled={busy}
              onClick={() => {
                setShowRecovery(false)
                setRecoveryPhrase('')
              }}
              type="button"
            >
              返回解锁
            </button>
          </div>
        </section>
      )}

      {unlocked ? (
        <VaultManagerPanel
          busy={busy}
          error={error}
          estimate={estimate}
          hasAiKey={aiKeyPresent}
          idleRemainingMs={idleRemainingMs}
          notice={notice}
          onChangeIdleMinutes={handleChangeIdleMinutes}
          onChangePassword={handleChangePassword}
          onClearAll={handleClearAll}
          onClearObjects={handleClearObjects}
          onDeleteSecret={handleDeleteSecret}
          onLock={handleLock}
          onRefreshEstimate={handleRefreshEstimate}
          onRequestPersistent={handleRequestPersistent}
          status={status}
        />
      ) : (
        <VaultSetupPanel
          busy={busy}
          error={error}
          mode={status.state === 'absent' ? 'create' : 'unlock'}
          onCreate={handleCreate}
          onForgetPassword={() => {
            setShowRecovery(true)
          }}
          onUnlock={handleUnlock}
        />
      )}
    </div>
  )
}
