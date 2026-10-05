import { describe, expect, it } from 'vitest'

import {
  AUTH_TAG_BITS,
  ENVELOPE_FORMAT_VERSION,
  IV_BYTES,
  buildAad,
  isEncryptedEnvelope,
  isCryptoError,
  openJson,
  parseEncryptedEnvelope,
  randomBytes,
  sealJson,
  type EncryptedEnvelope,
  type EnvelopeAadRef,
} from './index'

const AAD: EnvelopeAadRef = { vaultId: 'vault_test', revision: 1, purpose: 'object:dataset:d1' }

async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
}

async function codeOf(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation()
  } catch (error) {
    return isCryptoError(error) ? error.code : 'not-crypto-error'
  }
  return 'no-error'
}

describe('信封与附加认证数据（AAD）', () => {
  it('AAD 由仓 ID / 版本 / 用途唯一拼装，任一项变化即不同', () => {
    const base = buildAad(AAD)
    expect(base).toEqual(buildAad({ ...AAD }))
    expect(buildAad({ ...AAD, vaultId: 'vault_other' })).not.toEqual(base)
    expect(buildAad({ ...AAD, revision: 2 })).not.toEqual(base)
    expect(buildAad({ ...AAD, purpose: 'vault-check' })).not.toEqual(base)
  })

  it('格式常量与 PRD 10.3 一致：12 字节 IV、128 位认证标签', () => {
    expect(IV_BYTES).toBe(12)
    expect(AUTH_TAG_BITS).toBe(128)
    expect(ENVELOPE_FORMAT_VERSION).toBe(1)
  })
})

describe('sealJson / openJson', () => {
  it('加密后能原样解回（含中文与嵌套结构）', async () => {
    const key = await aesKey()
    const payload = { name: '张三', nested: { salary: 4000, tags: ['a', 'b'] }, empty: null }
    const envelope = await sealJson(key, payload, AAD)
    expect(isEncryptedEnvelope(envelope)).toBe(true)
    expect(await openJson(key, envelope, AAD)).toEqual(payload)
  })

  it('同一内容两次加密得到不同 IV 与不同密文（IV 绝不复用）', async () => {
    const key = await aesKey()
    const first = await sealJson(key, { name: '张三' }, AAD)
    const second = await sealJson(key, { name: '张三' }, AAD)
    expect(first.iv).not.toBe(second.iv)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(first.iv.length).toBeGreaterThan(0)
  })

  it('换一把密钥解不开（失败码统一为 decrypt-failed）', async () => {
    const key = await aesKey()
    const other = await aesKey()
    const envelope = await sealJson(key, { name: '张三' }, AAD)
    expect(await codeOf(() => openJson(other, envelope, AAD))).toBe('decrypt-failed')
  })

  it('篡改密文 / 换仓 ID / 换版本 / 换用途都解不开，且不返回任何原文', async () => {
    const key = await aesKey()
    const envelope = await sealJson(key, { name: '张三' }, AAD)
    // 只改密文第一个字符：仍是规范 base64（长度与尾部填充位不变），因此失败必然来自认证标签
    const tampered: EncryptedEnvelope = {
      ...envelope,
      ciphertext: envelope.ciphertext.startsWith('A')
        ? `B${envelope.ciphertext.slice(1)}`
        : `A${envelope.ciphertext.slice(1)}`,
    }
    expect(tampered.ciphertext).not.toBe(envelope.ciphertext)
    expect(await codeOf(() => openJson(key, tampered, AAD))).toBe('decrypt-failed')
    expect(await codeOf(() => openJson(key, envelope, { ...AAD, vaultId: 'vault_other' }))).toBe(
      'decrypt-failed',
    )
    expect(await codeOf(() => openJson(key, envelope, { ...AAD, revision: 2 }))).toBe(
      'decrypt-failed',
    )
    expect(await codeOf(() => openJson(key, envelope, { ...AAD, purpose: 'secret:x' }))).toBe(
      'decrypt-failed',
    )
  })

  it('不可序列化的内容拒绝加密（不写出半个信封）', async () => {
    const key = await aesKey()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(await codeOf(() => sealJson(key, cyclic, AAD))).toBe('invalid-params')
    expect(await codeOf(() => sealJson(key, undefined, AAD))).toBe('invalid-params')
  })

  it('自定义 toJSON 抛错时也按不可序列化处理', async () => {
    const key = await aesKey()
    const hostile = { toJSON: () => { throw new Error('boom') } }
    expect(await codeOf(() => sealJson(key, hostile, AAD))).toBe('invalid-params')
  })
})

describe('parseEncryptedEnvelope：拒绝不合规信封', () => {
  it('非对象 / 字段缺失 / 版本不支持都报错', () => {
    expect(() => parseEncryptedEnvelope(null)).toThrow()
    expect(() => parseEncryptedEnvelope({ formatVersion: 1, iv: randomBytes(12) })).toThrow()
    expect(() =>
      parseEncryptedEnvelope({ formatVersion: 2, iv: 'AA==', ciphertext: 'AA==' }),
    ).toThrow()
  })

  it('IV 长度不是 12 字节时拒绝解密', async () => {
    const key = await aesKey()
    const envelope = await sealJson(key, { name: '张三' }, AAD)
    const shortIv: EncryptedEnvelope = { ...envelope, iv: btoa('12345678') }
    expect(await codeOf(() => openJson(key, shortIv, AAD))).toBe('invalid-envelope')
  })

  it('密文短于认证标签长度时拒绝解密', async () => {
    const key = await aesKey()
    const envelope = await sealJson(key, { name: '张三' }, AAD)
    const tooShort: EncryptedEnvelope = { ...envelope, ciphertext: btoa('12345') }
    expect(await codeOf(() => openJson(key, tooShort, AAD))).toBe('invalid-envelope')
  })
})
