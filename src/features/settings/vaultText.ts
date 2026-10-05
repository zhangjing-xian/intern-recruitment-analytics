/**
 * 本地仓的展示文案与纯格式化（步骤6，纯函数，不依赖 React / Dexie）。
 *
 * 为什么单独一层：文案与「未知值怎么显示」属于口径，必须能被单测固定住，且**只能有一处**：
 * - 未知不等于 0：配额 / 占用未知时显示「未知」，绝不显示 0（0 会被读成「没占用」）；
 * - 密码强度判断复用 `crypto` 的 `checkPasswordStrength`，界面**不**另写一套规则
 *   （否则界面放过、加密层拒绝就会出现「按钮能点但一定失败」）；
 * - 锁定原因要如实区分（手动 / 闲置 / 其他标签页），否则用户会以为程序自己乱锁。
 */

import { MIN_PASSWORD_LENGTH, checkPasswordStrength } from '../../crypto'
import { EMPTY_VALUE, formatDateTime } from '../../lib/format'
import {
  DEFAULT_IDLE_LOCK_MINUTES,
  MAX_IDLE_LOCK_MINUTES,
  MIN_IDLE_LOCK_MINUTES,
  formatBytes,
  type StorageEstimate,
  type VaultLockReason,
  type VaultSecretSlot,
  type VaultState,
} from '../../storage'

export const VAULT_STATE_LABELS: Readonly<Record<VaultState, string>> = {
  absent: '本机还没有本地仓',
  locked: '已锁定',
  unlocked: '已解锁',
}

/** 闲置锁定可选分钟数：都在 `MIN_IDLE_LOCK_MINUTES`–`MAX_IDLE_LOCK_MINUTES` 内，默认 15 */
export const IDLE_LOCK_OPTIONS: readonly number[] = [5, 10, 15, 30, 60]

export const IDLE_LOCK_HELP = `闲置超过设定时间后自动锁定并丢弃内存中的密钥；可选范围 ${MIN_IDLE_LOCK_MINUTES}–${MAX_IDLE_LOCK_MINUTES} 分钟，默认 ${DEFAULT_IDLE_LOCK_MINUTES} 分钟。刷新页面同样需要重新解锁。`

const LOCK_REASON_LABELS: Readonly<Record<VaultLockReason, string>> = {
  manual: '你手动点击了锁定，内存密钥已丢弃。',
  idle: '闲置超时，已自动锁定并丢弃内存密钥。',
  tab: '其他标签页修改了本地仓（改密或清空），本页的解锁状态已失效。',
  cleared: '本地仓已被清空，内存密钥已丢弃。',
}

const SECRET_SLOT_LABELS: Readonly<Record<VaultSecretSlot, string>> = {
  'ai-api-key': 'DeepSeek API Key',
}

export function describeVaultState(state: VaultState): string {
  return VAULT_STATE_LABELS[state]
}

export function describeLockReason(reason: VaultLockReason): string {
  return LOCK_REASON_LABELS[reason]
}

export function describeSecretSlot(slot: VaultSecretSlot): string {
  return SECRET_SLOT_LABELS[slot]
}

/** 仓 ID 是纯随机标识（不含业务含义）；列表里只展示前 8 位便于区分，不隐藏也不夸张 */
export function shortVaultId(vaultId: string | null): string {
  if (vaultId === null || vaultId.length === 0) {
    return EMPTY_VALUE
  }
  return vaultId.length <= 8 ? vaultId : `${vaultId.slice(0, 8)}…`
}

export function formatCreatedAt(createdAt: string | null): string {
  return createdAt === null ? EMPTY_VALUE : formatDateTime(createdAt)
}

/**
 * 存储占用：任一侧未知就说未知，**不**用 0 代替。
 * 字节格式化复用 `storage/quota.ts` 的 `formatBytes`（同一处实现，界面不另写一套）。
 */
export function formatStorageUsage(estimate: StorageEstimate): string {
  if (!estimate.supported) {
    return '当前浏览器不提供存储占用信息'
  }
  if (estimate.usageBytes === null) {
    return '占用未知（浏览器未提供）'
  }
  const used = formatBytes(estimate.usageBytes)
  if (estimate.quotaBytes === null) {
    return `已用 ${used}，配额未知`
  }
  const ratio =
    estimate.usageRatio === null ? null : `（${(estimate.usageRatio * 100).toFixed(1)}%）`
  return `已用 ${used} / 配额 ${formatBytes(estimate.quotaBytes)}${ratio ?? ''}`
}

export function formatPersistedState(persisted: boolean | null): string {
  if (persisted === null) {
    return '是否已申请持久化：未知（当前浏览器不提供）'
  }
  return persisted
    ? '已申请持久化存储：浏览器回收本地数据的概率更低，但仍不是保证。'
    : '尚未申请持久化存储：浏览器在空间紧张时可能回收本地数据，建议申请。'
}

/** 距自动锁定的剩余时间；未计时（remainingMs ≤ 0）时返回空串，由界面决定不显示 */
export function formatIdleRemaining(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    return ''
  }
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) {
    return `剩余 ${seconds} 秒自动锁定`
  }
  return `剩余 ${minutes} 分 ${seconds} 秒自动锁定`
}

/**
 * 密码输入的本地预检：只做「明显不合规」的即时反馈。
 * 强度规则来自 `crypto/kdf.ts`（与加密层同一份判断），这里额外要求两次输入一致。
 * 返回 `null` 表示可以提交；返回字符串表示要先修正的问题。
 */
export function checkPasswordInput(password: string, confirmation?: string): string | null {
  const strength = checkPasswordStrength(password)
  if (!strength.ok) {
    return strength.reason
  }
  if (confirmation !== undefined && password !== confirmation) {
    return '两次输入的密码不一致'
  }
  return null
}

/** 密码提示：不写「多久一定能破」，只写成本来源（PBKDF2 迭代次数） */
export const PASSWORD_HELP = `密码至少 ${MIN_PASSWORD_LENGTH} 个字符，只在内存中用于派生 AES-GCM 密钥；本地仓里没有密码哈希，也没有找回方式（忘记密码只能用加密备份恢复，或清空本地仓重建）。`

/**
 * 破坏性操作的确认短语（界面与测试共用同一常量，避免两边写得不一样）。
 * 短语本身不含任何数据内容，只是把「想清楚了」变成一次可验证的操作。
 */
export const CLEAR_OBJECTS_PHRASE = '清空业务数据'
export const DELETE_SECRET_PHRASE = '删除 AI Key'
export const CLEAR_VAULT_PHRASE = '清空本地仓'
/**
 * 清空 AI 历史（AI-6）：与清空业务数据、删除 Key、清空本地仓**互不代替**，
 * 因此必须有自己的一句短语——共用短语会让用户在同一个输入框里做出两件不同的事。
 */
export const CLEAR_AI_HISTORY_PHRASE = '清空 AI 历史'

/** 确认短语是否匹配（忽略首尾空白，其余必须逐字一致） */
export function isPhraseConfirmed(value: string, phrase: string): boolean {
  return value.trim() === phrase
}
