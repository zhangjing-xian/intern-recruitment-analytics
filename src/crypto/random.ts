/**
 * 随机字节与**非敏感**随机标识。
 *
 * 用途分工（docs/PRD.md 10.3）：
 * - `randomBytes`：salt（≥16 字节）与每次加密独立的 12 字节 IV；
 * - `randomId`：本地仓 ID / 对象 ID / 备份 ID。这些标识会**明文**出现在 IndexedDB
 *   主键与信封的附加认证数据里，所以它必须是纯随机、不含任何业务含义的字符串：
 *   不用姓名、不用需求 ID、不用原始行号，也不做可枚举的自增序号。
 *
 * 使用 `crypto.getRandomValues`（CSPRNG）；单次调用上限 65536 字节，超出则分块。
 */

import { bytesToBase64, type Bytes } from './encoding'
import { CryptoError } from './errors'

/** getRandomValues 单次上限（规范值），超过会抛 QuotaExceededError */
const MAX_RANDOM_BYTES = 65_536

export function randomBytes(length: number): Bytes {
  if (!Number.isInteger(length) || length <= 0) {
    throw new CryptoError('invalid-params', '随机字节长度必须是正整数')
  }
  const bytes = new Uint8Array(length)
  for (let offset = 0; offset < length; offset += MAX_RANDOM_BYTES) {
    const end = Math.min(offset + MAX_RANDOM_BYTES, length)
    crypto.getRandomValues(bytes.subarray(offset, end))
  }
  return bytes
}

/** 18 字节随机 → 24 个 base64url 字符（无填充、无 `+` `/`，可安全用作主键与文件名片段） */
export function randomId(prefix: string): string {
  if (prefix.length === 0) {
    throw new CryptoError('invalid-params', '标识前缀不能为空')
  }
  const token = bytesToBase64(randomBytes(18))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `${prefix}_${token}`
}
