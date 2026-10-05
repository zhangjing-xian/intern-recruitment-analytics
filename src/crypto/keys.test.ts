import { afterEach, describe, expect, it } from 'vitest'

import {
  activeVaultKeys,
  dropVaultKeys,
  hasVaultKeys,
  installVaultKeys,
  isCryptoError,
  keyStateSnapshot,
  requireSlotKey,
  requireVaultKeys,
  subscribeKeyState,
  type KeyStateSnapshot,
  type VaultKeySet,
} from './index'

async function keySet(revision = 1): Promise<VaultKeySet> {
  const material = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  const secret = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  return {
    vaultId: 'vault_test',
    revision,
    kdfIterations: 100_000,
    unlockedAt: new Date().toISOString(),
    keys: { data: material as CryptoKey, secret: secret as CryptoKey },
  }
}

afterEach(() => {
  dropVaultKeys()
})

describe('密钥槽位：只在内存、锁定即不可达', () => {
  it('初始为锁定态：取密钥抛 locked，快照为未解锁', () => {
    expect(hasVaultKeys()).toBe(false)
    expect(activeVaultKeys()).toBeNull()
    expect(keyStateSnapshot()).toEqual({ unlocked: false, vaultId: null, revision: null })
    let code: string | null = null
    try {
      requireVaultKeys()
    } catch (error) {
      code = isCryptoError(error) ? error.code : 'not-crypto-error'
    }
    expect(code).toBe('locked')
    expect(() => requireSlotKey('data')).toThrow()
  })

  it('安装后两把密钥都可取，丢弃后立即不可达', async () => {
    installVaultKeys(await keySet(2))
    expect(hasVaultKeys()).toBe(true)
    expect(keyStateSnapshot()).toEqual({ unlocked: true, vaultId: 'vault_test', revision: 2 })
    expect(requireSlotKey('data')).not.toBe(requireSlotKey('secret'))
    dropVaultKeys()
    expect(hasVaultKeys()).toBe(false)
    expect(() => requireSlotKey('secret')).toThrow()
  })

  it('订阅者收到解锁（含仓 ID 与版本）与锁定通知；取消订阅后不再收到', async () => {
    const events: KeyStateSnapshot[] = []
    const unsubscribe = subscribeKeyState((snapshot) => {
      events.push(snapshot)
    })
    installVaultKeys(await keySet(1))
    unsubscribe()
    dropVaultKeys()
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ unlocked: true, vaultId: 'vault_test', revision: 1 })
  })
})
