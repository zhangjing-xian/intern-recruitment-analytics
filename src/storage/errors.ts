/**
 * 本地仓错误类型与**唯一**的用户文案（步骤6）。
 *
 * 为什么在这里收口：
 * - 界面只允许展示固定文案，绝不回显底层异常（密码错误与密文被篡改在 Web Crypto 里
 *   是同一种失败，任何「更精确」的提示都等于给攻击者反馈）；
 * - 「存储失败」必须说清楚**旧数据没事**（docs/PRD.md 10.5）：配额不足、被其他标签页
 *   占用、连接被关掉，都不会覆盖已保存的数据。
 */

import { isCryptoError } from '../crypto'

export type VaultErrorCode =
  /** 当前环境没有 IndexedDB（无痕模式 / 被禁用） */
  | 'unavailable'
  /** 本机已有本地仓 */
  | 'already-exists'
  /** 本机还没有本地仓 */
  | 'not-found'
  /** 已锁定 */
  | 'locked'
  /** 解锁失败：密码错误或数据被修改（不区分原因） */
  | 'unlock-failed'
  /** 新密码强度不足 */
  | 'weak-password'
  /** 会话过期：其他标签页改密 / 清空后，本标签必须重新解锁 */
  | 'stale-session'
  /** 待保存内容无法序列化（未写入任何数据） */
  | 'unsupported-payload'
  /** 入参不合法（未做任何修改） */
  | 'invalid-input'
  /** 备份文件格式不受支持或损坏（未做任何写入） */
  | 'invalid-backup'
  /** 备份密码错误或备份被修改 */
  | 'backup-password'
  /** 其他标签页仍占用本地仓 */
  | 'blocked'
  /** 存储配额不足 */
  | 'quota'
  /** 本地数据损坏或版本不一致 */
  | 'corrupted'

export const VAULT_ERROR_MESSAGES: Readonly<Record<VaultErrorCode, string>> = {
  unavailable:
    '当前环境不提供 IndexedDB（可能处于无痕模式或被浏览器禁用），加密本地仓不可用；临时内存模式仍可正常使用。',
  'already-exists': '本机已存在加密本地仓。如需重建，请先清空本地数据（该操作不可撤销）。',
  'not-found': '本机还没有加密本地仓，请先设置密码创建。',
  locked: '本地仓已锁定，请重新输入密码解锁。',
  'unlock-failed':
    '解锁失败：密码错误，或本地加密数据已被修改。密码无法找回，也没有后门；可用加密备份恢复（备份不含 AI Key）。',
  'weak-password': '密码强度不足：至少 8 个字符，且不能只包含空白字符。',
  'stale-session':
    '本地仓已被其他标签页修改（可能是改密或清空），本页面的解锁状态已失效，请重新解锁；未写入任何数据。',
  'unsupported-payload':
    '待保存内容无法序列化，本次未写入任何数据；已保存的内容保持不变。',
  'invalid-input': '输入不合法，本次未做任何修改。',
  'invalid-backup': '备份文件格式不受支持或已损坏，未做任何写入。',
  'backup-password': '备份解密失败：备份密码错误，或备份文件已被修改。',
  blocked: '其他标签页仍在使用本地仓，请关闭这些标签页后重试。',
  quota: '浏览器存储空间不足，本次写入未完成；已保存的数据保持不变。',
  corrupted: '本地数据已损坏或与当前版本不一致，请停止写入；如已有加密备份，请用备份恢复。',
}

export class VaultError extends Error {
  readonly code: VaultErrorCode

  constructor(code: VaultErrorCode, message: string, options?: { readonly cause?: unknown }) {
    super(message, options)
    this.name = 'VaultError'
    this.code = code
  }
}

export function vaultError(code: VaultErrorCode, detail?: string): VaultError {
  const base = VAULT_ERROR_MESSAGES[code]
  return new VaultError(code, detail === undefined ? base : `${base}（${detail}）`)
}

function errorName(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return ''
  }
  const name = (error as { readonly name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

/** IndexedDB / Dexie 异常 → 固定文案；不把底层 message 暴露给界面 */
export function mapDatabaseError(error: unknown): VaultError {
  const name = errorName(error)
  if (name === 'QuotaExceededError') {
    return new VaultError('quota', VAULT_ERROR_MESSAGES.quota, { cause: error })
  }
  if (name === 'BlockedError') {
    return new VaultError('blocked', VAULT_ERROR_MESSAGES.blocked, { cause: error })
  }
  if (name === 'DatabaseClosedError' || name === 'InvalidStateError') {
    return new VaultError('stale-session', VAULT_ERROR_MESSAGES['stale-session'], { cause: error })
  }
  return new VaultError('corrupted', VAULT_ERROR_MESSAGES.corrupted, { cause: error })
}

/** 任意异常 → VaultError；已是 VaultError 时原样返回（保留最初、更具体的错误码） */
export function asVaultError(error: unknown): VaultError {
  if (error instanceof VaultError) {
    return error
  }
  if (isCryptoError(error)) {
    if (error.code === 'locked') {
      return new VaultError('locked', VAULT_ERROR_MESSAGES.locked, { cause: error })
    }
    if (error.code === 'weak-password') {
      return new VaultError('weak-password', VAULT_ERROR_MESSAGES['weak-password'], { cause: error })
    }
    return new VaultError('corrupted', VAULT_ERROR_MESSAGES.corrupted, { cause: error })
  }
  return mapDatabaseError(error)
}

/** 用户可见文案；界面只允许通过它展示错误 */
export function vaultErrorMessage(error: unknown): string {
  return asVaultError(error).message
}

/** 统一的异常收敛包装：仓内所有公开 API 都经过它，避免出现裸 DexieError */
export async function runVaultOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    throw asVaultError(error)
  }
}
