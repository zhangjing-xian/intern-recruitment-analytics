import { describe, expect, it } from 'vitest'

import {
  base64ToBytes,
  bytesToBase64,
  bytesToUtf8,
  concatBytes,
  isCryptoError,
  utf8ToBytes,
  zeroBytes,
} from './index'

describe('crypto/encoding：UTF-8 与字节', () => {
  it('多字节字符往返一致（含中文、符号、emoji）', () => {
    const text = '张三·offer 已入职 ✓ 🎉'
    expect(bytesToUtf8(utf8ToBytes(text))).toBe(text)
  })

  it('空字符串往返为空字节数组', () => {
    expect(utf8ToBytes('')).toEqual(new Uint8Array(0))
    expect(bytesToUtf8(new Uint8Array(0))).toBe('')
  })

  it('不是合法 UTF-8 的字节直接报错，而不是替换成 U+FFFD', () => {
    // 0xff 在 UTF-8 中永远不是合法起始字节；宁可失败也不产出「看起来正常」的文本
    expect(() => bytesToUtf8(new Uint8Array([0xff, 0xfe]))).toThrow()
  })
})

describe('crypto/encoding：严格 base64', () => {
  it('全字节区间往返一致', () => {
    const bytes = new Uint8Array(256)
    for (let index = 0; index < 256; index += 1) {
      bytes[index] = index
    }
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('空内容合法', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array(0))
  })

  it('拒绝长度不是 4 的倍数、非法字符、多余填充', () => {
    for (const bad of ['AA', 'AAA', 'A A=', 'AA*A', 'AAAA====', 'A===']) {
      expect(() => base64ToBytes(bad)).toThrow()
    }
  })

  it('拒绝尾部填充位非零的非最短形式（AA== 合法，AB== 非法）', () => {
    expect(base64ToBytes('AA==')).toEqual(new Uint8Array([0]))
    let code: string | null = null
    try {
      base64ToBytes('AB==')
    } catch (error) {
      code = isCryptoError(error) ? error.code : 'not-crypto-error'
    }
    expect(code).toBe('invalid-envelope')
  })
})

describe('crypto/encoding：拼接与清零', () => {
  it('concatBytes 按顺序拼接，空数组得空结果', () => {
    const merged = concatBytes([utf8ToBytes('ab'), new Uint8Array(0), utf8ToBytes('cd')])
    expect(merged).toEqual(utf8ToBytes('abcd'))
    expect(concatBytes([])).toEqual(new Uint8Array(0))
  })

  it('zeroBytes 就地清零（尽力而为，不代表物理擦除）', () => {
    const bytes = utf8ToBytes('vault-password')
    zeroBytes(bytes)
    expect(bytes.every((value) => value === 0)).toBe(true)
  })
})
