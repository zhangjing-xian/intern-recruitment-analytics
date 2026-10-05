/**
 * 密钥派生（PBKDF2-HMAC-SHA-256）。
 *
 * 口径按 docs/PRD.md 10.3：
 * - 迭代次数做本机基准并**持久化**（存在仓元数据里），初始值 600,000；
 *   这是初始配置而不是永久安全保证，换设备要重新基准（见 `recommendKdfIterations`）；
 * - salt 随机 ≥16 字节，每个本地仓一份；
 * - 派生出的密钥**不可导出**（`extractable: false`）且只用于 AES-GCM 加解密；
 * - 一次派生 64 字节并切成两把独立密钥：
 *   - `dataKey`：业务数据、清洗记录、分析缓存；
 *   - `secretKey`：AI Key 等秘密槽位。
 *   这样「AI Key 的密文」与「业务数据的密文」不共用同一把密钥（docs/PRD.md 10.3
 *   「API Key 仅可加密存储，不能与解密密钥一并落盘」）；中间字节缓冲区用完即清零。
 * - 派生口令只在本机内存中短暂存在，**绝不**落盘，也不保存任何形式的密码哈希。
 */

import { base64ToBytes, bytesToBase64, utf8ToBytes, zeroBytes, type Bytes } from './encoding'
import { CryptoError } from './errors'
import { randomBytes } from './random'

export const PBKDF2_NAME = 'PBKDF2'
export const PBKDF2_HASH = 'SHA-256'
export const KDF_FORMAT_VERSION = 1
export const DEFAULT_PBKDF2_ITERATIONS = 600_000
export const MIN_PBKDF2_ITERATIONS = 100_000
export const MAX_PBKDF2_ITERATIONS = 2_000_000
export const SALT_BYTES = 16
export const AES_KEY_BITS = 256
/** 一次派生两把 256 位密钥（数据密钥 + 秘密槽位密钥） */
export const DERIVED_BITS = AES_KEY_BITS * 2

/** 密码最短长度：只挡「一眼可暴力」的输入，真正的成本来自 PBKDF2 迭代次数 */
export const MIN_PASSWORD_LENGTH = 8

export type KdfParams = {
  readonly formatVersion: number
  readonly name: typeof PBKDF2_NAME
  readonly hash: typeof PBKDF2_HASH
  readonly iterations: number
  /** base64（≥16 字节）；salt 不是秘密，明文随仓元数据保存 */
  readonly salt: string
  readonly keyLengthBits: typeof AES_KEY_BITS
}

export function isValidKdfIterations(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_PBKDF2_ITERATIONS &&
    value <= MAX_PBKDF2_ITERATIONS
  )
}

export function createKdfParams(iterations: number = DEFAULT_PBKDF2_ITERATIONS): KdfParams {
  if (!isValidKdfIterations(iterations)) {
    throw new CryptoError(
      'invalid-params',
      `PBKDF2 迭代次数必须在 ${MIN_PBKDF2_ITERATIONS}–${MAX_PBKDF2_ITERATIONS} 之间`,
    )
  }
  return {
    formatVersion: KDF_FORMAT_VERSION,
    name: PBKDF2_NAME,
    hash: PBKDF2_HASH,
    iterations,
    salt: bytesToBase64(randomBytes(SALT_BYTES)),
    keyLengthBits: AES_KEY_BITS,
  }
}

/**
 * 严格解析持久化的 KDF 参数：任何一项不符合当前口径就报错，
 * **不**做「将就着用」的降级（例如把 1,000 次迭代当默认值），否则等于静默削弱加密。
 */
export function parseKdfParams(value: unknown): KdfParams {
  if (typeof value !== 'object' || value === null) {
    throw new CryptoError('invalid-envelope', '缺少 KDF 参数')
  }
  const record = value as Record<string, unknown>
  if (record.formatVersion !== KDF_FORMAT_VERSION) {
    throw new CryptoError('unsupported-format', 'KDF 参数版本不受支持')
  }
  if (record.name !== PBKDF2_NAME || record.hash !== PBKDF2_HASH) {
    throw new CryptoError('unsupported-format', 'KDF 算法不受支持')
  }
  if (!isValidKdfIterations(record.iterations)) {
    throw new CryptoError('invalid-envelope', 'KDF 迭代次数非法')
  }
  if (record.keyLengthBits !== AES_KEY_BITS) {
    throw new CryptoError('unsupported-format', 'KDF 输出长度不受支持')
  }
  if (typeof record.salt !== 'string') {
    throw new CryptoError('invalid-envelope', '缺少 salt')
  }
  const salt = base64ToBytes(record.salt)
  if (salt.length < SALT_BYTES) {
    throw new CryptoError('invalid-envelope', `salt 不得少于 ${SALT_BYTES} 字节`)
  }
  return {
    formatVersion: KDF_FORMAT_VERSION,
    name: PBKDF2_NAME,
    hash: PBKDF2_HASH,
    iterations: record.iterations,
    salt: bytesToBase64(salt),
    keyLengthBits: AES_KEY_BITS,
  }
}

export type VaultKeyMaterial = {
  /** 业务数据密钥（不可导出） */
  readonly dataKey: CryptoKey
  /** 秘密槽位密钥（不可导出）；与数据密钥同源口令但**不同密钥** */
  readonly secretKey: CryptoKey
}

async function importAesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: AES_KEY_BITS }, false, [
    'encrypt',
    'decrypt',
  ])
}

function assertPasswordProvided(password: string): void {
  if (typeof password !== 'string' || password.length === 0) {
    throw new CryptoError('invalid-params', '密码不能为空')
  }
}

/**
 * 由密码与 KDF 参数派生两把 AES-GCM-256 密钥。
 * 中间字节缓冲区在 `finally` 中清零（尽力而为，见 encoding.zeroBytes 的说明）。
 */
export async function deriveVaultKeys(
  password: string,
  params: KdfParams,
): Promise<VaultKeyMaterial> {
  assertPasswordProvided(password)
  const salt = base64ToBytes(params.salt)
  const baseKey = await crypto.subtle.importKey('raw', utf8ToBytes(password), PBKDF2_NAME, false, [
    'deriveBits',
  ])
  const bits: Bytes = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: PBKDF2_NAME, hash: PBKDF2_HASH, salt, iterations: params.iterations },
      baseKey,
      DERIVED_BITS,
    ),
  )
  try {
    const dataKey = await importAesKey(bits.subarray(0, AES_KEY_BITS / 8))
    const secretKey = await importAesKey(bits.subarray(AES_KEY_BITS / 8, DERIVED_BITS / 8))
    return { dataKey, secretKey }
  } finally {
    zeroBytes(bits)
  }
}

export type KdfBenchmark = {
  readonly iterations: number
  readonly durationMs: number
  readonly measuredAt: string
}

/**
 * 本机 KDF 基准：只用来**记录**当前设备跑一轮派生的耗时（写进交付证据与文档），
 * 不做自动降级，也不会在低电量 / 后台标签页偷偷减少迭代次数。
 */
export async function benchmarkKdf(
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<KdfBenchmark> {
  const params = createKdfParams(iterations)
  const startedAt = Date.now()
  await deriveVaultKeys('benchmark-password-not-a-user-secret', params)
  return {
    iterations,
    durationMs: Date.now() - startedAt,
    measuredAt: new Date().toISOString(),
  }
}

/** 按基准结果给出「目标耗时」对应的迭代次数，并夹在允许区间内 */
export function recommendKdfIterations(
  measuredMs: number,
  measuredIterations: number,
  targetMs = 400,
): number {
  if (!Number.isFinite(measuredMs) || measuredMs <= 0 || !isValidKdfIterations(measuredIterations)) {
    return DEFAULT_PBKDF2_ITERATIONS
  }
  const scaled = Math.round((measuredIterations * targetMs) / measuredMs)
  return Math.min(MAX_PBKDF2_ITERATIONS, Math.max(MIN_PBKDF2_ITERATIONS, scaled))
}

export type PasswordCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

export function checkPasswordStrength(password: string): PasswordCheck {
  if (typeof password !== 'string' || password.trim().length === 0) {
    return { ok: false, reason: '密码不能只包含空白字符' }
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `密码至少需要 ${MIN_PASSWORD_LENGTH} 个字符` }
  }
  return { ok: true }
}

export function assertAcceptablePassword(password: string): void {
  const checked = checkPasswordStrength(password)
  if (!checked.ok) {
    throw new CryptoError('weak-password', checked.reason)
  }
}
