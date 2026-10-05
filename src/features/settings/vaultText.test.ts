import { describe, expect, it } from 'vitest'

import {
  DEFAULT_IDLE_LOCK_MINUTES,
  MAX_IDLE_LOCK_MINUTES,
  MIN_IDLE_LOCK_MINUTES,
  type StorageEstimate,
  type VaultLockReason,
} from '../../storage'
import {
  IDLE_LOCK_OPTIONS,
  PASSWORD_HELP,
  checkPasswordInput,
  describeLockReason,
  describeVaultState,
  formatCreatedAt,
  formatIdleRemaining,
  formatPersistedState,
  formatStorageUsage,
  shortVaultId,
} from './vaultText'

function estimate(patch: Partial<StorageEstimate>): StorageEstimate {
  return {
    supported: true,
    usageBytes: 12 * 1024,
    quotaBytes: 1024 * 1024,
    persisted: false,
    usageRatio: 0.0117,
    ...patch,
  }
}

describe('本地仓状态与原因文案', () => {
  it('三种仓状态各有独立文案，不含技术术语', () => {
    const labels = (['absent', 'locked', 'unlocked'] as const).map(describeVaultState)
    expect(new Set(labels).size).toBe(3)
    for (const label of labels) {
      expect(label).not.toMatch(/(IndexedDB|Dexie|CryptoKey)/)
    }
  })

  it('四种锁定原因互不相同，手动与闲置必须能区分', () => {
    const reasons: readonly VaultLockReason[] = ['manual', 'idle', 'tab', 'cleared']
    const texts = reasons.map(describeLockReason)
    expect(new Set(texts).size).toBe(4)
    expect(describeLockReason('manual')).toContain('手动')
    expect(describeLockReason('idle')).toContain('闲置')
  })
})

describe('仓标识与时间展示', () => {
  it('短仓 ID：缺失显示占位，短标识原样，长标识截断到 8 位', () => {
    expect(shortVaultId(null)).toBe('—')
    expect(shortVaultId('')).toBe('—')
    expect(shortVaultId('abcd1234')).toBe('abcd1234')
    expect(shortVaultId('abcdefghijkl')).toBe('abcdefgh…')
  })

  it('创建时间缺失时显示占位，不显示 Invalid Date', () => {
    expect(formatCreatedAt(null)).toBe('—')
    const shown = formatCreatedAt('2026-09-26T09:05:00.000Z')
    expect(shown).not.toBe('—')
    expect(shown).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('存储占用文案：未知绝不显示成 0', () => {
  it('浏览器不支持时说明「不提供」，不显示 0 B', () => {
    const text = formatStorageUsage(estimate({ supported: false, usageBytes: null, quotaBytes: null, usageRatio: null }))
    expect(text).toContain('不提供')
    expect(text).not.toContain('0 B')
  })

  it('占用未知时只说未知，不显示 0', () => {
    const text = formatStorageUsage(estimate({ usageBytes: null, usageRatio: null }))
    expect(text).toContain('未知')
    expect(text).not.toContain('0 B')
  })

  it('配额未知时仍展示已用量，并说明配额未知', () => {
    const text = formatStorageUsage(estimate({ quotaBytes: null, usageRatio: null }))
    expect(text).toContain('12 KB')
    expect(text).toContain('配额未知')
  })

  it('两侧都已知时给出已用 / 配额与百分比', () => {
    const text = formatStorageUsage(estimate({}))
    // 字节格式化与 `storage/quota.ts` 的 formatBytes 同一处实现：12 KB / 1 MB 就是它的输出
    expect(text).toBe('已用 12 KB / 配额 1 MB（1.2%）')
  })
})

describe('持久化状态文案', () => {
  it('未知 / 未申请 / 已申请三者可区分', () => {
    const unknown = formatPersistedState(null)
    const no = formatPersistedState(false)
    const yes = formatPersistedState(true)
    expect(new Set([unknown, no, yes]).size).toBe(3)
    expect(unknown).toContain('未知')
    expect(no).toContain('尚未')
    expect(yes).toContain('已申请')
  })

  it('已申请也不承诺数据绝不丢失', () => {
    const text = formatPersistedState(true)
    expect(text).toContain('仍不是保证')
    expect(text).not.toMatch(/绝不会|绝对不会|一定不会/)
  })
})

describe('闲置倒计时文案', () => {
  it('未计时或到点时返回空串（界面据此不显示倒计时）', () => {
    expect(formatIdleRemaining(0)).toBe('')
    expect(formatIdleRemaining(-1000)).toBe('')
    expect(formatIdleRemaining(Number.NaN)).toBe('')
  })

  it('不足 1 分钟只显示秒，超过 1 分钟显示分与秒', () => {
    expect(formatIdleRemaining(59_000)).toBe('剩余 59 秒自动锁定')
    expect(formatIdleRemaining(60_000)).toBe('剩余 1 分 0 秒自动锁定')
    expect(formatIdleRemaining(900_000)).toBe('剩余 15 分 0 秒自动锁定')
    expect(formatIdleRemaining(899_500)).toBe('剩余 15 分 0 秒自动锁定')
    expect(formatIdleRemaining(868_000)).toBe('剩余 14 分 28 秒自动锁定')
  })
})

describe('密码输入预检：与加密层同一套强度口径', () => {
  it('长度不足时给出与加密层一致的理由', () => {
    expect(checkPasswordInput('short')).toContain('8')
    expect(checkPasswordInput('        ')).toContain('空白')
  })

  it('两次输入不一致时拒绝', () => {
    expect(checkPasswordInput('好密码-2026-abc', '好密码-2026-abd')).toBe('两次输入的密码不一致')
  })

  it('只传一次密码时不检查一致性', () => {
    expect(checkPasswordInput('好密码-2026-abc')).toBeNull()
    expect(checkPasswordInput('好密码-2026-abc', '好密码-2026-abc')).toBeNull()
  })

  it('密码提示写明无找回方式与最低长度', () => {
    expect(PASSWORD_HELP).toContain('没有找回方式')
    expect(PASSWORD_HELP).toContain('8')
  })
})

describe('闲置锁定选项', () => {
  it('全部落在允许范围内，且包含默认值', () => {
    for (const minutes of IDLE_LOCK_OPTIONS) {
      expect(minutes).toBeGreaterThanOrEqual(MIN_IDLE_LOCK_MINUTES)
      expect(minutes).toBeLessThanOrEqual(MAX_IDLE_LOCK_MINUTES)
    }
    expect(IDLE_LOCK_OPTIONS).toContain(DEFAULT_IDLE_LOCK_MINUTES)
  })
})
