/**
 * 加密信封（AES-GCM-256）。
 *
 * 为什么把「信封」单独抽出来：本地仓里每个对象（数据集、清洗设置、AI 历史……）
 * 落盘的都是同一种结构，格式一旦分散定义，就很容易出现「某处漏了 IV 或漏了 AAD」。
 * 结构按 docs/PRD.md 10.3：
 * - `formatVersion`：信封格式版本，版本不认识就拒绝解密（不静默降级）；
 * - `iv`：**每次加密都新生成**的 12 字节随机数，绝不复用（重复 IV 会直接毁掉 GCM 的安全性）；
 * - `ciphertext`：密文 + 128 位认证标签（Web Crypto 的 AES-GCM 会把标签附在密文尾部）；
 * - `sealedAt`：非敏感的时间戳，只用于排查，解密不依赖它。
 *
 * 「仓 ID + 版本 + 用途」不放进信封，而是作为**附加认证数据**（AAD）参与认证：
 * 解密时用当前仓的 ID 与版本重新拼一遍，因此把 A 仓的信封挪到 B 仓、或把旧版本的信封
 * 混进新版本（改密后）都会认证失败，而不是解出「看起来正常」的内容。
 */

import { base64ToBytes, bytesToBase64, bytesToUtf8, utf8ToBytes, zeroBytes, type Bytes } from './encoding'
import { CryptoError } from './errors'
import { randomBytes } from './random'

export const ENVELOPE_FORMAT_VERSION = 1
/** GCM 标准 IV 长度；不允许 96 位以外的长度进入我们的格式 */
export const IV_BYTES = 12
/** 认证标签位数（128 位 = 16 字节） */
export const AUTH_TAG_BITS = 128
const AUTH_TAG_BYTES = AUTH_TAG_BITS / 8

export type EnvelopeAadRef = {
  /** 本地仓 ID（非敏感随机标识） */
  readonly vaultId: string
  /** 本地仓版本号：改密后 +1，防止旧信封被重新塞回 */
  readonly revision: number
  /** 用途标识，例如 `object:dataset:<id>` / `secret:ai-api-key` / `vault-check` */
  readonly purpose: string
}

export type EncryptedEnvelope = {
  readonly formatVersion: number
  readonly iv: string
  readonly ciphertext: string
  readonly sealedAt: string
}

/** AAD 的**唯一**拼装方式：必须与解密时完全一致，因此只在这里实现一次 */
export function buildAad(ref: EnvelopeAadRef): Bytes {
  return utf8ToBytes(
    [ENVELOPE_FORMAT_VERSION, ref.vaultId, String(ref.revision), ref.purpose].join('|'),
  )
}

function serializeJson(value: unknown): string {
  let text: string | undefined
  try {
    text = JSON.stringify(value)
  } catch {
    throw new CryptoError('invalid-params', '待加密内容无法序列化（存在循环引用或非法值）')
  }
  if (text === undefined) {
    throw new CryptoError('invalid-params', '待加密内容必须是可序列化的对象')
  }
  return text
}

export function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    record.formatVersion === ENVELOPE_FORMAT_VERSION &&
    typeof record.iv === 'string' &&
    typeof record.ciphertext === 'string' &&
    typeof record.sealedAt === 'string'
  )
}

/** 严格解析：形状或版本不符合当前格式即报错（用于「解析不可信来源」的场景，如备份文件） */
export function parseEncryptedEnvelope(value: unknown): EncryptedEnvelope {
  if (typeof value !== 'object' || value === null) {
    throw new CryptoError('invalid-envelope', '缺少加密信封')
  }
  const record = value as Record<string, unknown>
  if (record.formatVersion !== ENVELOPE_FORMAT_VERSION) {
    throw new CryptoError('unsupported-format', '加密信封格式版本不受支持')
  }
  if (typeof record.iv !== 'string' || typeof record.ciphertext !== 'string') {
    throw new CryptoError('invalid-envelope', '加密信封字段不完整')
  }
  return {
    formatVersion: ENVELOPE_FORMAT_VERSION,
    iv: record.iv,
    ciphertext: record.ciphertext,
    sealedAt: typeof record.sealedAt === 'string' ? record.sealedAt : '',
  }
}

/** 加密任意可序列化对象；每次调用都会生成新的 12 字节 IV */
export async function sealJson(
  key: CryptoKey,
  value: unknown,
  ref: EnvelopeAadRef,
): Promise<EncryptedEnvelope> {
  const plaintext = utf8ToBytes(serializeJson(value))
  const iv = randomBytes(IV_BYTES)
  try {
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: buildAad(ref), tagLength: AUTH_TAG_BITS },
        key,
        plaintext,
      ),
    )
    return {
      formatVersion: ENVELOPE_FORMAT_VERSION,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(ciphertext),
      sealedAt: new Date().toISOString(),
    }
  } finally {
    // 明文拷贝用完即清零；原始 JS 对象仍在调用方，这里只减少多一份驻留
    zeroBytes(plaintext)
  }
}

/**
 * 解密并解析 JSON。
 * 密钥不匹配、密文被篡改、AAD 不匹配、内容不是 UTF-8 JSON —— 全部收敛成同一个
 * `decrypt-failed`，不区分原因、不回显任何原文（docs/PRD.md 10.3）。
 */
export async function openJson<T>(
  key: CryptoKey,
  envelope: EncryptedEnvelope,
  ref: EnvelopeAadRef,
): Promise<T> {
  const parsed = parseEncryptedEnvelope(envelope)
  const iv = base64ToBytes(parsed.iv)
  if (iv.length !== IV_BYTES) {
    throw new CryptoError('invalid-envelope', `IV 必须为 ${IV_BYTES} 字节`)
  }
  const ciphertext = base64ToBytes(parsed.ciphertext)
  if (ciphertext.length <= AUTH_TAG_BYTES) {
    throw new CryptoError('invalid-envelope', '密文长度不足，缺少认证标签')
  }
  let plaintext: Uint8Array
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: buildAad(ref), tagLength: AUTH_TAG_BITS },
        key,
        ciphertext,
      ),
    )
  } catch {
    throw new CryptoError('decrypt-failed', '解密失败：密钥不匹配或数据已被修改')
  }
  try {
    return JSON.parse(bytesToUtf8(plaintext)) as T
  } catch {
    throw new CryptoError('decrypt-failed', '解密内容不是合法 JSON')
  } finally {
    zeroBytes(plaintext)
  }
}
