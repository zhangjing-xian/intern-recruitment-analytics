/**
 * 字节 / 文本 / base64 编解码（加密层专用）。
 *
 * 为什么自己做而不是用库：本地仓要「零额外运行时依赖、全部同源打包」，
 * 而 base64 只有两个方向的转换；但**必须严格**——信封里的 iv / ciphertext / salt
 * 都靠它落到 IndexedDB，一旦容忍非规范编码（多余填充、非法字符、超长），
 * 攻击面就从「认证加密」扩散到「编码解析歧义」。因此这里只接受**最小编码**：
 * 解码后再编码必须与原文完全一致。
 *
 * 大对象（备份文件可能到 MB 级）不能一次 `String.fromCharCode(...bytes)`，
 * 否则会超出引擎的参数个数上限，所以按块拼接。
 */

import { CryptoError } from './errors'

/** base64 字符集 + 仅允许出现在末尾的填充 */
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/
/** `String.fromCharCode` 的参数个数上限（不同引擎约 60k~125k），取 32k 留足余量 */
const CHUNK_SIZE = 0x8000

/**
 * 字节数组类型别名。
 * TypeScript 5.7 起 `Uint8Array` 变成泛型：不显式标注时，函数返回的 `Uint8Array`
 * 会被推断成 `Uint8Array<ArrayBufferLike>`，而 Web Crypto 只接受挂在普通 `ArrayBuffer`
 * 上的视图，直接传参会报「not assignable to BufferSource」。
 * 因此 crypto 层统一用这个别名，表示「由 `new Uint8Array(n)` / `TextEncoder` 产生、
 * 一定挂在普通 ArrayBuffer 上的字节数组」。
 */
export type Bytes = Uint8Array<ArrayBuffer>

export function utf8ToBytes(text: string): Bytes {
  return new TextEncoder().encode(text)
}

/**
 * 字节 → UTF-8 文本。
 * `fatal: true`：不合法字节序列直接报错，而不是替换成 U+FFFD。
 * 由于 AES-GCM 已认证内容，这里报错只会出现在「密钥/附加数据不匹配却仍然解开」的
 * 不可能情形，宁可失败也不产出看似正常的文本。
 */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE))
  }
  return btoa(binary)
}

/** 严格 base64 → 字节；非规范编码一律抛 `invalid-envelope`，不做「尽力解析」 */
export function base64ToBytes(text: string): Bytes {
  if (text.length % 4 !== 0 || !BASE64_PATTERN.test(text)) {
    throw new CryptoError('invalid-envelope', '密文编码非法（不是规范的 base64）')
  }
  let binary: string
  try {
    binary = atob(text)
  } catch {
    throw new CryptoError('invalid-envelope', '密文编码非法（无法解码）')
  }
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  if (bytesToBase64(bytes) !== text) {
    throw new CryptoError('invalid-envelope', '密文编码非法（不是最短 base64 形式）')
  }
  return bytes
}

export function concatBytes(parts: readonly Bytes[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    merged.set(part, offset)
    offset += part.length
  }
  return merged
}

/**
 * 尽力清零字节缓冲区。
 * 注意：只对本函数收到的这一份拷贝有效——JavaScript 无法保证物理内存取证级擦除，
 * 因此文档与界面文案都**不得**承诺「内存已彻底擦除」（docs/PRD.md 10.3）。
 */
export function zeroBytes(bytes: Uint8Array): void {
  bytes.fill(0)
}
