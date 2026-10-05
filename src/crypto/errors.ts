/**
 * 加密层错误类型（唯一来源）。
 *
 * 为什么单独定义：解锁、解密、信封解析失败都必须收敛成**少量、固定**的错误码，
 * 上层界面只按错误码给出固定文案，绝不把底层异常细节直接展示；
 * Web Crypto 在「密码错误」与「密文被修改」两种情况下都抛同一种 `OperationError`，
 * 按 docs/PRD.md 10.3 的要求，这两者本来就当**同一种失败**处理。
 */

export type CryptoErrorCode =
  /** 密钥不在内存：已锁定或从未解锁 */
  | 'locked'
  /** 参数非法：迭代次数越界、salt 太短、待加密内容不可序列化等 */
  | 'invalid-params'
  /** 信封结构非法：字段缺失、base64 非法、IV 长度不对 */
  | 'invalid-envelope'
  /** 解密失败：密钥不匹配、密文被改、附加认证数据不匹配 */
  | 'decrypt-failed'
  /** 格式版本高于当前应用支持范围（拒绝静默转换） */
  | 'unsupported-format'
  /** 密码强度不足 */
  | 'weak-password'

export class CryptoError extends Error {
  readonly code: CryptoErrorCode

  constructor(code: CryptoErrorCode, message: string) {
    super(message)
    this.name = 'CryptoError'
    this.code = code
  }
}

export function isCryptoError(value: unknown): value is CryptoError {
  return value instanceof CryptoError
}
