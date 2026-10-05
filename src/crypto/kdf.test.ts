import { describe, expect, it } from 'vitest'

import {
  AES_KEY_BITS,
  DEFAULT_PBKDF2_ITERATIONS,
  MAX_PBKDF2_ITERATIONS,
  MIN_PBKDF2_ITERATIONS,
  MIN_PASSWORD_LENGTH,
  SALT_BYTES,
  assertAcceptablePassword,
  base64ToBytes,
  benchmarkKdf,
  checkPasswordStrength,
  createKdfParams,
  deriveVaultKeys,
  isCryptoError,
  isValidKdfIterations,
  openJson,
  parseKdfParams,
  recommendKdfIterations,
  sealJson,
} from './index'

/** 迭代次数下限：测试只验证「算法与绑定关系」，不把 60 万次迭代的成本带进 CI */
const FAST_ITERATIONS = MIN_PBKDF2_ITERATIONS

const AAD = { vaultId: 'vault_test', revision: 1, purpose: 'vault-check' } as const

async function codeOf(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation()
  } catch (error) {
    return isCryptoError(error) ? error.code : 'not-crypto-error'
  }
  return 'no-error'
}

describe('KDF 参数：salt、迭代次数与严格解析', () => {
  it('默认 600,000 次迭代，salt 为 16 字节随机值（两次不同）', () => {
    const first = createKdfParams()
    const second = createKdfParams()
    expect(first.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS)
    expect(base64ToBytes(first.salt).length).toBe(SALT_BYTES)
    expect(first.salt).not.toBe(second.salt)
    expect(first.keyLengthBits).toBe(AES_KEY_BITS)
  })

  it('迭代次数越界即拒绝（不做「将就着用」的降级）', () => {
    expect(isValidKdfIterations(MIN_PBKDF2_ITERATIONS)).toBe(true)
    expect(isValidKdfIterations(MAX_PBKDF2_ITERATIONS)).toBe(true)
    expect(isValidKdfIterations(1_000)).toBe(false)
    expect(isValidKdfIterations(2_000_001)).toBe(false)
    expect(() => createKdfParams(1_000)).toThrow()
  })

  it('解析持久化参数：被削弱的迭代次数、陌生算法、过短 salt 都不接受', () => {
    const params = createKdfParams(FAST_ITERATIONS)
    expect(parseKdfParams(params).iterations).toBe(FAST_ITERATIONS)
    expect(() => parseKdfParams({ ...params, iterations: 1 })).toThrow()
    expect(() => parseKdfParams({ ...params, hash: 'SHA-1' })).toThrow()
    expect(() => parseKdfParams({ ...params, salt: btoa('short') })).toThrow()
    expect(() => parseKdfParams({ ...params, formatVersion: 2 })).toThrow()
    expect(() => parseKdfParams(null)).toThrow()
  })
})

describe('deriveVaultKeys：两把独立密钥 + 密码绑定', () => {
  it('同密码同 salt 派生结果可互相解密；数据密钥与秘密密钥互相解不开', async () => {
    const params = createKdfParams(FAST_ITERATIONS)
    const first = await deriveVaultKeys('正确密码-1234', params)
    const second = await deriveVaultKeys('正确密码-1234', params)
    const envelope = await sealJson(first.dataKey, { name: '张三' }, AAD)
    expect(await openJson(second.dataKey, envelope, AAD)).toEqual({ name: '张三' })
    expect(first.dataKey.extractable).toBe(false)
    expect(first.secretKey.extractable).toBe(false)
    expect(await codeOf(() => openJson(first.secretKey, envelope, AAD))).toBe('decrypt-failed')
  })

  it('密码不同即解不开（错误码统一，不透露差异）', async () => {
    const params = createKdfParams(FAST_ITERATIONS)
    const right = await deriveVaultKeys('正确密码-1234', params)
    const wrong = await deriveVaultKeys('错误密码-1234', params)
    const envelope = await sealJson(right.dataKey, { name: '张三' }, AAD)
    expect(await codeOf(() => openJson(wrong.dataKey, envelope, AAD))).toBe('decrypt-failed')
  })

  it('空密码拒绝派生', async () => {
    const params = createKdfParams(FAST_ITERATIONS)
    expect(await codeOf(() => deriveVaultKeys('', params))).toBe('invalid-params')
  })
})

describe('密码强度与基准建议', () => {
  it(`长度不足 ${MIN_PASSWORD_LENGTH} 或全是空白时拒绝`, () => {
    expect(checkPasswordStrength('short').ok).toBe(false)
    expect(checkPasswordStrength('        ').ok).toBe(false)
    expect(checkPasswordStrength('good-password').ok).toBe(true)
    expect(() => assertAcceptablePassword('123')).toThrow()
  })

  it('recommendKdfIterations 按目标耗时缩放并夹在允许区间内', () => {
    expect(recommendKdfIterations(400, 600_000, 400)).toBe(600_000)
    expect(recommendKdfIterations(800, 600_000, 400)).toBe(300_000)
    expect(recommendKdfIterations(1, 600_000, 400)).toBe(MAX_PBKDF2_ITERATIONS)
    expect(recommendKdfIterations(0, 600_000)).toBe(DEFAULT_PBKDF2_ITERATIONS)
    expect(recommendKdfIterations(400, 1)).toBe(DEFAULT_PBKDF2_ITERATIONS)
  })

  it('benchmarkKdf 只记录耗时，不改动迭代次数', async () => {
    const benchmark = await benchmarkKdf(FAST_ITERATIONS)
    expect(benchmark.iterations).toBe(FAST_ITERATIONS)
    expect(benchmark.durationMs).toBeGreaterThanOrEqual(0)
    expect(Number.isNaN(Date.parse(benchmark.measuredAt))).toBe(false)
  })
})
