/**
 * 加密备份的集成测试（fake-indexeddb + 真实 Web Crypto）。
 * 重点验证三件事（docs/PRD.md 10.5）：备份里没有明文、普通备份不含 AI Key、
 * 结构非法的备份**整份拒绝**（不做部分导入）。
 */
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIN_PBKDF2_ITERATIONS, deriveVaultKeys, sealJson } from '../crypto'
import {
  BACKUP_FILE_KIND,
  BACKUP_NOTICE,
  backupFileName,
  createEncryptedBackup,
  decryptEncryptedBackup,
  parseEncryptedBackup,
  restoreEncryptedBackup,
  type EncryptedBackupFile,
} from './backup'
import { asVaultError } from './errors'
import {
  clearVault,
  createVault,
  listVaultObjects,
  loadVaultObject,
  loadVaultSecret,
  lockVault,
  readVaultStatus,
  saveVaultObject,
  saveVaultSecret,
  unlockVault,
} from './vault'
import { VAULT_SECRET_SLOTS } from './vaultMeta'

const ITERATIONS = MIN_PBKDF2_ITERATIONS
const LOCAL_PASSWORD = 'local-password-1234'
const BACKUP_PASSWORD = 'backup-password-5678'
const NEW_LOCAL_PASSWORD = 'new-local-password-9999'
const NAME_SENTINEL = '张三哨兵'
const SECRET_SENTINEL = 'sk-sentinel-9f3a2b'

async function codeOf(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation()
  } catch (error) {
    return asVaultError(error).code
  }
  return 'no-error'
}

/** 把备份内容换成任意对象后重新加密：用于构造「密码正确但结构非法」的备份 */
async function forgeBackup(
  file: EncryptedBackupFile,
  content: unknown,
  password: string,
): Promise<string> {
  const keys = await deriveVaultKeys(password, file.kdf)
  const envelope = await sealJson(keys.dataKey, content, {
    vaultId: file.vaultId,
    revision: 1,
    purpose: 'backup',
  })
  return JSON.stringify({ ...file, envelope }, null, 2)
}

/** 只改密文第一个字符：仍是规范 base64，因此失败必然来自认证标签 */
function flipCiphertext(ciphertext: string): string {
  return ciphertext.startsWith('A') ? `B${ciphertext.slice(1)}` : `A${ciphertext.slice(1)}`
}

describe('backupFileName：文件名不含任何业务信息', () => {
  it('只带导出时间戳，扩展名为 .json', () => {
    expect(backupFileName(new Date(2026, 8, 26, 9, 5))).toBe(
      'intern-recruitment-backup-20260926-0905.json',
    )
  })
})


describe('加密备份：导出', () => {
  beforeEach(async () => {
    await clearVault()
    await createVault(LOCAL_PASSWORD, { iterations: ITERATIONS })
  })

  afterEach(async () => {
    await clearVault()
  })

  it('导出文本里没有明文业务数据，也不含 AI Key；元信息可在解密前读取', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)

    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })
    expect(backup.objectCount).toBe(1)
    expect(backup.text).not.toContain(NAME_SENTINEL)
    expect(backup.text).not.toContain(SECRET_SENTINEL)
    expect(backup.text).not.toContain('candidateName')
    expect(backup.text).not.toContain(LOCAL_PASSWORD)
    expect(backup.file.includesSecrets).toBe(false)
    expect(backup.file.notice).toBe(BACKUP_NOTICE)

    const parsed = parseEncryptedBackup(backup.text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.file.kind).toBe(BACKUP_FILE_KIND)
      expect(parsed.file.schemaVersion).toBe((await readVaultStatus()).schemaVersion)
      expect(parsed.file.kdf.salt).not.toBe('')
    }
  })

  it('指定对象种类时只导出该种类', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    await saveVaultObject('preference', { theme: 'light' })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, {
      kdfIterations: ITERATIONS,
      kinds: ['preference'],
    })
    expect(backup.objectCount).toBe(1)
    const content = await decryptEncryptedBackup(backup.file, BACKUP_PASSWORD)
    expect(content.objects.map((record) => record.kind)).toEqual(['preference'])
  })

  it('备份密码强度不足直接拒绝，不产出可疑的弱加密备份', async () => {
    expect(await codeOf(() => createEncryptedBackup('short'))).toBe('weak-password')
  })
})

describe('加密备份：解析与解密', () => {
  beforeEach(async () => {
    await clearVault()
    await createVault(LOCAL_PASSWORD, { iterations: ITERATIONS })
  })

  afterEach(async () => {
    await clearVault()
  })

  it('解析：非 JSON、非本站备份、版本不支持、声明含秘密槽位都被拒绝', async () => {
    expect(parseEncryptedBackup('不是 JSON')).toEqual({
      ok: false,
      reason: '不是合法的 JSON 文件',
    })
    expect(parseEncryptedBackup('[]').ok).toBe(false)
    expect(parseEncryptedBackup(JSON.stringify({ kind: 'other' })).ok).toBe(false)

    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })
    expect(parseEncryptedBackup(JSON.stringify({ ...backup.file, formatVersion: 99 })).ok).toBe(
      false,
    )

    const parsed = parseEncryptedBackup(JSON.stringify({ ...backup.file, includesSecrets: true }))
    expect(parsed.ok).toBe(false)
    expect(parsed.ok === false ? parsed.reason : '').toContain('秘密槽位')
  })

  it('解密：密码错误与文件被改都归为同一个失败，不区分原因', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })

    expect(await codeOf(() => decryptEncryptedBackup(backup.file, 'wrong-password-1234'))).toBe(
      'backup-password',
    )

    const tampered: EncryptedBackupFile = {
      ...backup.file,
      envelope: {
        ...backup.file.envelope,
        ciphertext: flipCiphertext(backup.file.envelope.ciphertext),
      },
    }
    expect(await codeOf(() => decryptEncryptedBackup(tampered, BACKUP_PASSWORD))).toBe(
      'backup-password',
    )
  })

  it('正确密码能解出对象清单，ID 与内容都完整', async () => {
    const saved = await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })
    const content = await decryptEncryptedBackup(backup.file, BACKUP_PASSWORD)
    expect(content.objects).toEqual([
      { id: saved.id, kind: 'dataset', payload: { candidateName: NAME_SENTINEL } },
    ])
  })
})


describe('加密备份：恢复', () => {
  beforeEach(async () => {
    await clearVault()
    await createVault(LOCAL_PASSWORD, { iterations: ITERATIONS })
  })

  afterEach(async () => {
    await clearVault()
  })

  /** 造一份备份，然后把本机清空、用新密码重建（模拟换设备 / 重装） */
  async function backupThenFreshVault(): Promise<{ readonly text: string; readonly id: string }> {
    const saved = await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })
    await clearVault()
    await createVault(NEW_LOCAL_PASSWORD, { iterations: ITERATIONS })
    return { text: backup.text, id: saved.id }
  }

  it('merge：对象与内容恢复，AI Key 不在备份里（必须重新填写）', async () => {
    const { text, id } = await backupThenFreshVault()
    const result = await restoreEncryptedBackup(text, BACKUP_PASSWORD)
    expect(result.mode).toBe('merge')
    expect(result.restoredCount).toBe(1)
    expect(await loadVaultObject('dataset', id)).toEqual({ candidateName: NAME_SENTINEL })
    expect(await loadVaultSecret(VAULT_SECRET_SLOTS[0])).toBeNull()

    // 恢复用的是备份密码，本机密码不变：锁上之后仍要用本机密码解锁
    lockVault()
    await unlockVault(NEW_LOCAL_PASSWORD)
    expect(await loadVaultObject('dataset', id)).toEqual({ candidateName: NAME_SENTINEL })
  })

  it('merge：同一份备份导入两次不覆盖已有对象，而是各自换新 ID', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })

    await restoreEncryptedBackup(backup.text, BACKUP_PASSWORD)
    await restoreEncryptedBackup(backup.text, BACKUP_PASSWORD)

    const records = await listVaultObjects<{ candidateName: string }>('dataset')
    expect(records).toHaveLength(3)
    expect(new Set(records.map((record) => record.id)).size).toBe(3)
  })

  it('replace：先清空业务对象再导入，秘密槽位不受影响', async () => {
    await saveVaultObject('preference', { theme: 'light' })
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, {
      kdfIterations: ITERATIONS,
      kinds: ['dataset'],
    })
    await saveVaultSecret(VAULT_SECRET_SLOTS[0], SECRET_SENTINEL)

    const result = await restoreEncryptedBackup(backup.text, BACKUP_PASSWORD, { mode: 'replace' })
    expect(result.restoredCount).toBe(1)
    expect(await listVaultObjects('preference')).toEqual([])
    expect(await listVaultObjects('dataset')).toHaveLength(1)
    expect(await loadVaultSecret(VAULT_SECRET_SLOTS[0])).toBe(SECRET_SENTINEL)
  })

  it('结构非法（未知对象种类 / 缺 ID / 缺内容）整份拒绝，且原数据完好', async () => {
    const saved = await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })

    const unknownKind = await forgeBackup(
      backup.file,
      { objects: [{ id: saved.id, kind: 'unknown-kind', payload: { a: 1 } }] },
      BACKUP_PASSWORD,
    )
    expect(await codeOf(() => restoreEncryptedBackup(unknownKind, BACKUP_PASSWORD))).toBe(
      'invalid-backup',
    )

    const missingId = await forgeBackup(
      backup.file,
      { objects: [{ kind: 'dataset', payload: { a: 1 } }] },
      BACKUP_PASSWORD,
    )
    expect(await codeOf(() => restoreEncryptedBackup(missingId, BACKUP_PASSWORD))).toBe(
      'invalid-backup',
    )

    const missingPayload = await forgeBackup(
      backup.file,
      { objects: [{ id: saved.id, kind: 'dataset' }] },
      BACKUP_PASSWORD,
    )
    expect(await codeOf(() => restoreEncryptedBackup(missingPayload, BACKUP_PASSWORD))).toBe(
      'invalid-backup',
    )

    expect(await loadVaultObject('dataset', saved.id)).toEqual({ candidateName: NAME_SENTINEL })
    expect((await readVaultStatus()).objectCount).toBe(1)
  })

  it('声明含秘密槽位 / 密码错误的备份都拒绝恢复', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })
    const withSecrets = JSON.stringify({ ...backup.file, includesSecrets: true })
    expect(await codeOf(() => restoreEncryptedBackup(withSecrets, BACKUP_PASSWORD))).toBe(
      'invalid-backup',
    )
    expect(await codeOf(() => restoreEncryptedBackup(backup.text, 'wrong-password-1234'))).toBe(
      'backup-password',
    )
    expect(await codeOf(() => restoreEncryptedBackup('{', BACKUP_PASSWORD))).toBe('invalid-backup')
  })

  it('数据结构版本不兼容时拒绝导入（提示用对应版本的应用）', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    const backup = await createEncryptedBackup(BACKUP_PASSWORD, { kdfIterations: ITERATIONS })
    const incompatible = JSON.stringify({ ...backup.file, schemaVersion: '9.0.0' })
    expect(await codeOf(() => restoreEncryptedBackup(incompatible, BACKUP_PASSWORD))).toBe(
      'invalid-backup',
    )
  })
})
