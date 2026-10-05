/**
 * 本地仓元数据契约（**不依赖 Dexie / IndexedDB**，可被界面与纯函数层安全引用）。
 *
 * 仓里只放「非敏感、必须能明文读到」的东西（docs/PRD.md 10.3「加密信封存储：
 * formatVersion、schemaVersion、kdf 参数、salt、iv、ciphertext 及最小非敏感随机标识」）：
 * - 仓 ID：纯随机标识，不含任何业务含义；
 * - KDF 参数（含 salt 与迭代次数）：没有它就无法在解锁前派生密钥；
 * - 版本号 `revision`：改密 +1，用于识别「用旧密钥写入」的多标签冲突；
 * - `idleLockMinutes`：闲置锁定分钟数，默认 15；
 * - `verification`：用**数据密钥**加密的固定校验串。解锁时只做一次解密校验，
 *   因此仓里**没有**密码哈希，也没有任何可以用离线字典攻击的中间量。
 *
 * 业务数据（姓名、薪资、HR、文件名、清洗记录）一律不在本结构里，也不能建索引。
 */

import { type EncryptedEnvelope, parseEncryptedEnvelope, type KdfParams, parseKdfParams } from '../crypto'
import { CURRENT_RULE_VERSION, type RuleVersion, SCHEMA_VERSION } from '../domain'

/** meta 表的主键：一个本地仓只有一条元数据 */
export const VAULT_META_KEY = 'vault'
export const VAULT_META_FORMAT_VERSION = 1

export const DEFAULT_IDLE_LOCK_MINUTES = 15
export const MIN_IDLE_LOCK_MINUTES = 1
export const MAX_IDLE_LOCK_MINUTES = 120

/** 用于校验密码的固定串：加密后存在 `verification` 里，解密结果必须与它完全一致 */
export const VAULT_VERIFICATION_TEXT = 'intern-recruitment/vault-verification'

/** 仓内对象种类：种类名会明文存在索引里，因此只能是固定枚举，不能带业务含义 */
export const VAULT_OBJECT_KINDS = [
  'dataset',
  'cleaningSettings',
  'mappingTemplate',
  'preference',
  'aiHistory',
  'analysisCache',
] as const

export type VaultObjectKind = (typeof VAULT_OBJECT_KINDS)[number]

export function isVaultObjectKind(value: unknown): value is VaultObjectKind {
  return typeof value === 'string' && (VAULT_OBJECT_KINDS as readonly string[]).includes(value)
}

/**
 * 秘密槽位：与业务数据**分开的生命周期**（docs/PRD.md 10.3、实施计划步骤6「新增项」）。
 * - 用 `secretKey` 加密，与业务数据密钥不同；
 * - 普通备份**排除**这些槽位，清除 AI 历史也不会删掉 Key；
 * - 目前只有 AI Key 一个槽位，后续新增槽位必须同时更新这里的枚举与备份/清除口径。
 */
export const VAULT_SECRET_SLOTS = ['ai-api-key'] as const

export type VaultSecretSlot = (typeof VAULT_SECRET_SLOTS)[number]

export type VaultMeta = {
  readonly formatVersion: number
  readonly vaultId: string
  /** 写入时的领域数据结构版本，用于迁移判断（主版本不同必须提示迁移，不静默转换） */
  readonly schemaVersion: string
  readonly ruleVersion: RuleVersion
  readonly kdf: KdfParams
  /** 仓版本：改密后 +1；对象行与秘密行都记录写入时的版本 */
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly idleLockMinutes: number
  readonly verification: EncryptedEnvelope
}

export function isIdleLockMinutes(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_IDLE_LOCK_MINUTES &&
    value <= MAX_IDLE_LOCK_MINUTES
  )
}

export function normalizeIdleLockMinutes(
  value: unknown,
  fallback: number = DEFAULT_IDLE_LOCK_MINUTES,
): number {
  return isIdleLockMinutes(value) ? value : fallback
}

export function createVaultMeta(input: {
  readonly vaultId: string
  readonly kdf: KdfParams
  readonly revision: number
  readonly verification: EncryptedEnvelope
  readonly idleLockMinutes?: number
  readonly schemaVersion?: string
  readonly ruleVersion?: RuleVersion
  readonly now?: string
}): VaultMeta {
  const now = input.now ?? new Date().toISOString()
  return {
    formatVersion: VAULT_META_FORMAT_VERSION,
    vaultId: input.vaultId,
    schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
    ruleVersion: input.ruleVersion ?? CURRENT_RULE_VERSION,
    kdf: input.kdf,
    revision: input.revision,
    createdAt: now,
    updatedAt: now,
    idleLockMinutes: normalizeIdleLockMinutes(input.idleLockMinutes),
    verification: input.verification,
  }
}

export type VaultMetaParseResult =
  | { readonly ok: true; readonly meta: VaultMeta }
  | { readonly ok: false; readonly reason: 'unsupported-format' | 'invalid' }

export function isRuleVersion(value: unknown): value is RuleVersion {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.schemaVersion === 'string' &&
    typeof record.rulesVersion === 'string' &&
    typeof record.dictionaryVersion === 'string' &&
    typeof record.templateVersion === 'string'
  )
}

/**
 * 严格解析仓元数据。
 * 为什么返回「原因」而不是 null：格式版本过高与内容损坏对用户的处置完全不同
 * （前者要升级应用 / 用对应版本导入备份，后者只能用备份恢复），不能混成一句话。
 */
export function parseVaultMeta(value: unknown): VaultMetaParseResult {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, reason: 'invalid' }
  }
  const record = value as Record<string, unknown>
  if (record.formatVersion !== VAULT_META_FORMAT_VERSION) {
    return { ok: false, reason: 'unsupported-format' }
  }
  if (typeof record.vaultId !== 'string' || record.vaultId.length === 0) {
    return { ok: false, reason: 'invalid' }
  }
  if (typeof record.schemaVersion !== 'string' || !isRuleVersion(record.ruleVersion)) {
    return { ok: false, reason: 'invalid' }
  }
  if (
    typeof record.revision !== 'number' ||
    !Number.isInteger(record.revision) ||
    record.revision < 1
  ) {
    return { ok: false, reason: 'invalid' }
  }
  if (typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') {
    return { ok: false, reason: 'invalid' }
  }
  if (!isIdleLockMinutes(record.idleLockMinutes)) {
    return { ok: false, reason: 'invalid' }
  }
  let kdf: KdfParams
  let verification: EncryptedEnvelope
  try {
    kdf = parseKdfParams(record.kdf)
    verification = parseEncryptedEnvelope(record.verification)
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  return {
    ok: true,
    meta: {
      formatVersion: VAULT_META_FORMAT_VERSION,
      vaultId: record.vaultId,
      schemaVersion: record.schemaVersion,
      ruleVersion: record.ruleVersion,
      kdf,
      revision: record.revision,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      idleLockMinutes: record.idleLockMinutes,
      verification,
    },
  }
}
