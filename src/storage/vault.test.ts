/**
 * 加密本地仓的集成测试（fake-indexeddb + 真实 Web Crypto）。
 *
 * 为什么用真实 Web Crypto：本步骤的风险集中在「密钥派生 / 信封 / AAD 绑定 / 事务原子性」，
 * 把加密替换成 mock 等于把要验证的东西换掉。IndexedDB 侧用 fake-indexeddb 提供同 API 的内存实现；
 * `fake-indexeddb/auto` 必须在 Dexie 真正连接前导入（Dexie 在连接时才读全局 `indexedDB`）。
 */
import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIN_PBKDF2_ITERATIONS, dropVaultKeys, hasVaultKeys } from '../crypto'
import { DATABASE_NAME, openVaultDatabase } from './db'
import { asVaultError } from './errors'
import {
  changeVaultPassword,
  clearVault,
  clearVaultObjects,
  clearVaultSecrets,
  createVault,
  deleteVaultObject,
  deleteVaultSecret,
  hasVaultSecret,
  listVaultObjects,
  loadVaultObject,
  loadVaultSecret,
  lockVault,
  readVaultIdleLockMinutes,
  readVaultStatus,
  saveVaultObject,
  saveVaultSecret,
  unlockVault,
  updateVaultIdleLockMinutes,
} from './vault'
import { VAULT_META_KEY } from './vaultMeta'
import { subscribeVaultEvents, type VaultEvent } from './vaultEvents'

/** 测试用迭代次数取下限：只验证算法与绑定关系，不给 CI 加 60 万次 PBKDF2 的负担 */
const ITERATIONS = MIN_PBKDF2_ITERATIONS
const PASSWORD = 'vault-password-1234'
const NEW_PASSWORD = 'vault-password-5678'
/** 明文哨兵：任何一处落盘都必须搜不到它们 */
const NAME_SENTINEL = '张三哨兵'
const SALARY_SENTINEL = '薪资哨兵-4000'
const SECRET_SENTINEL = 'sk-sentinel-9f3a2b'

/** 直接用原生 IndexedDB 读回全部记录（绕开 Dexie），用于证明「落盘只有密文」 */
async function openRawDatabase(): Promise<IDBDatabase> {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME)
    request.onerror = () => reject(request.error ?? new Error('打开本地库失败'))
    request.onsuccess = () => resolve(request.result)
  })
}

async function readRawStores(): Promise<Record<string, unknown[]>> {
  const db = await openRawDatabase()
  try {
    const names = Array.from(db.objectStoreNames)
    const transaction = db.transaction(names, 'readonly')
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('读取事务失败'))
      transaction.onabort = () => reject(transaction.error ?? new Error('读取事务被中止'))
    })
    const result: Record<string, unknown[]> = {}
    for (const name of names) {
      const request = transaction.objectStore(name).getAll()
      request.onsuccess = () => {
        result[name] = request.result as unknown[]
      }
    }
    await completed
    return result
  } finally {
    db.close()
  }
}

/** 只读索引名：用来证明「敏感字段没有被建索引」（索引键会明文写进 IndexedDB） */
async function readRawIndexNames(): Promise<Record<string, string[]>> {
  const db = await openRawDatabase()
  try {
    const result: Record<string, string[]> = {}
    for (const name of Array.from(db.objectStoreNames)) {
      const store = db.transaction(name, 'readonly').objectStore(name)
      result[name] = Array.from(store.indexNames).sort()
    }
    return result
  } finally {
    db.close()
  }
}

async function codeOf(operation: () => Promise<unknown>): Promise<string> {
  try {
    await operation()
  } catch (error) {
    return asVaultError(error).code
  }
  return 'no-error'
}


describe('加密本地仓：状态与解锁', () => {
  beforeEach(async () => {
    await clearVault()
  })

  afterEach(async () => {
    await clearVault()
  })

  it('没有本地仓时状态是 absent，且此时读写会明确报「已锁定」而不是静默失败', async () => {
    const status = await readVaultStatus()
    expect(status.state).toBe('absent')
    expect(status.databaseName).toBe(DATABASE_NAME)
    expect(status.vaultId).toBeNull()
    expect(status.revision).toBeNull()
    expect(status.objectCount).toBe(0)
    expect(status.secretCount).toBe(0)
    expect(status.idleLockMinutes).toBe(15)
    expect(hasVaultKeys()).toBe(false)
    expect(await codeOf(() => loadVaultObject('dataset', 'missing'))).toBe('locked')
  })

  it('创建本地仓：写入加密校验串、进入解锁态、记录 KDF 参数；重复创建被拒绝', async () => {
    const created = await createVault(PASSWORD, { iterations: ITERATIONS, idleLockMinutes: 20 })
    expect(created.state).toBe('unlocked')
    expect(created.vaultId?.startsWith('vault_')).toBe(true)
    expect(created.revision).toBe(1)
    expect(created.kdfIterations).toBe(ITERATIONS)
    expect(created.idleLockMinutes).toBe(20)
    expect(created.schemaCompatible).toBe(true)
    expect(await codeOf(() => createVault('another-password-1234'))).toBe('already-exists')
  })

  it('解锁 / 锁定：错误密码不解锁、锁定后读写被拒绝', async () => {
    await createVault(PASSWORD, { iterations: ITERATIONS })
    lockVault()
    expect((await readVaultStatus()).state).toBe('locked')
    expect(hasVaultKeys()).toBe(false)

    expect(await codeOf(() => unlockVault('wrong-password-1234'))).toBe('unlock-failed')
    expect(hasVaultKeys()).toBe(false)

    const unlocked = await unlockVault(PASSWORD)
    expect(unlocked.state).toBe('unlocked')
    expect(hasVaultKeys()).toBe(true)

    lockVault()
    expect(await codeOf(() => saveVaultObject('dataset', { name: NAME_SENTINEL }))).toBe('locked')
    expect(await codeOf(() => loadVaultSecret('ai-api-key'))).toBe('locked')
  })

  it('刷新页面（内存密钥丢失）后必须重新解锁才能读到数据', async () => {
    await createVault(PASSWORD, { iterations: ITERATIONS })
    const saved = await saveVaultObject('dataset', { name: NAME_SENTINEL })

    // 模拟整页刷新：内存密钥被丢弃，IndexedDB 里的密文仍在
    dropVaultKeys()
    expect((await readVaultStatus()).state).toBe('locked')
    expect((await readVaultStatus()).objectCount).toBe(1)
    expect(await codeOf(() => loadVaultObject('dataset', saved.id))).toBe('locked')

    await unlockVault(PASSWORD)
    expect(await loadVaultObject('dataset', saved.id)).toEqual({ name: NAME_SENTINEL })
  })

  it('没有本地仓时解锁提示「还没有本地仓」，不伪造解锁成功', async () => {
    expect(await codeOf(() => unlockVault(PASSWORD))).toBe('not-found')
  })
})


describe('加密本地仓：业务对象与秘密槽位', () => {
  beforeEach(async () => {
    await clearVault()
    await createVault(PASSWORD, { iterations: ITERATIONS })
  })

  afterEach(async () => {
    await clearVault()
  })

  it('保存 / 读取 / 列出 / 删除对象：往返一致，缺失返回 null（不返回空对象）', async () => {
    const saved = await saveVaultObject('dataset', { name: NAME_SENTINEL, salary: SALARY_SENTINEL })
    expect(saved.kind).toBe('dataset')
    expect(saved.id.startsWith('dataset_')).toBe(true)
    expect(saved.revision).toBe(1)

    expect(await loadVaultObject('dataset', saved.id)).toEqual({
      name: NAME_SENTINEL,
      salary: SALARY_SENTINEL,
    })
    expect(await loadVaultObject('dataset', 'dataset_missing')).toBeNull()

    const listed = await listVaultObjects<{ name: string }>('dataset')
    expect(listed.map((record) => record.id)).toEqual([saved.id])
    expect(listed[0]?.payload.name).toBe(NAME_SENTINEL)

    expect(await deleteVaultObject('dataset', saved.id)).toBe(1)
    expect(await deleteVaultObject('dataset', saved.id)).toBe(0)
    expect(await listVaultObjects('dataset')).toEqual([])
  })

  it('对象种类不匹配时拒绝解密（不把别的种类的密文当成本次对象）', async () => {
    const saved = await saveVaultObject('dataset', { name: NAME_SENTINEL })
    expect(await codeOf(() => loadVaultObject('preference', saved.id))).toBe('corrupted')
    expect(await codeOf(() => deleteVaultObject('preference', saved.id))).toBe('invalid-input')
    expect(await loadVaultObject('dataset', saved.id)).toEqual({ name: NAME_SENTINEL })
  })

  it('不可序列化的内容拒绝保存且不写入任何行', async () => {
    const cyclic: Record<string, unknown> = { name: NAME_SENTINEL }
    cyclic.self = cyclic
    expect(await codeOf(() => saveVaultObject('dataset', cyclic))).toBe('unsupported-payload')
    expect((await readVaultStatus()).objectCount).toBe(0)
  })

  it('秘密槽位：保存 / 读取 / 删除 / 清空，空值被拒绝', async () => {
    expect(await hasVaultSecret('ai-api-key')).toBe(false)
    expect(await loadVaultSecret('ai-api-key')).toBeNull()

    const saved = await saveVaultSecret('ai-api-key', SECRET_SENTINEL)
    expect(saved.revision).toBe(1)
    expect(await hasVaultSecret('ai-api-key')).toBe(true)
    expect(await loadVaultSecret('ai-api-key')).toBe(SECRET_SENTINEL)
    expect((await readVaultStatus()).secretCount).toBe(1)

    expect(await codeOf(() => saveVaultSecret('ai-api-key', '   '))).toBe('invalid-input')
    expect(await deleteVaultSecret('ai-api-key')).toBe(1)
    expect(await deleteVaultSecret('ai-api-key')).toBe(0)
    expect(await clearVaultSecrets()).toBe(0)
  })

  it('清空业务对象不会连带删除 AI Key（两者生命周期独立）', async () => {
    const dataset = await saveVaultObject('dataset', { name: NAME_SENTINEL })
    await saveVaultObject('preference', { theme: 'light' })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)

    expect(await clearVaultObjects('dataset')).toBe(1)
    expect(await loadVaultObject('dataset', dataset.id)).toBeNull()
    expect(await hasVaultSecret('ai-api-key')).toBe(true)
    expect(await listVaultObjects('preference')).toHaveLength(1)

    expect(await clearVaultObjects()).toBe(1)
    expect(await loadVaultSecret('ai-api-key')).toBe(SECRET_SENTINEL)
  })
})


describe('加密本地仓：落盘只有密文', () => {
  beforeEach(async () => {
    await clearVault()
    await createVault(PASSWORD, { iterations: ITERATIONS })
  })

  afterEach(async () => {
    await clearVault()
  })

  it('明文哨兵、字段名、密码与原始 JSON 都不出现在任何表里', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL, salaryText: SALARY_SENTINEL })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)

    const stores = await readRawStores()
    expect(Object.keys(stores).sort()).toEqual(['meta', 'objects', 'secrets'])
    const text = JSON.stringify(stores)
    for (const secret of [
      NAME_SENTINEL,
      SALARY_SENTINEL,
      SECRET_SENTINEL,
      'candidateName',
      'salaryText',
      PASSWORD,
    ]) {
      expect(text).not.toContain(secret)
    }
    // 落盘的是信封（格式版本 + base64 的 IV / 密文），不是可读负载
    expect(text).toContain('ciphertext')
    expect(text).toContain('formatVersion')
  })

  it('只对非敏感字段建索引：meta 与 secrets 无索引，objects 只有 kind / revision', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)
    expect(await readRawIndexNames()).toEqual({
      meta: [],
      objects: ['kind', 'revision'],
      secrets: [],
    })
  })

  it('每行的字段集合固定：只有随机 ID / 固定枚举 / 版本号 / 信封', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)
    const stores = await readRawStores()
    const metaRow = stores.meta?.[0] as Record<string, unknown>
    const objectRow = stores.objects?.[0] as Record<string, unknown>
    const secretRow = stores.secrets?.[0] as Record<string, unknown>
    expect(Object.keys(metaRow).sort()).toEqual(['key', 'value'])
    expect(metaRow.key).toBe(VAULT_META_KEY)
    expect(Object.keys(objectRow).sort()).toEqual(['envelope', 'id', 'kind', 'revision'])
    expect(typeof objectRow.id).toBe('string')
    expect(String(objectRow.id).startsWith('dataset_')).toBe(true)
    expect(objectRow.kind).toBe('dataset')
    expect(Object.keys(secretRow).sort()).toEqual(['envelope', 'revision', 'slot'])
    expect(secretRow.slot).toBe('ai-api-key')
  })
})

describe('加密本地仓：版本、多标签与清空', () => {
  beforeEach(async () => {
    await clearVault()
    await createVault(PASSWORD, { iterations: ITERATIONS })
  })

  afterEach(async () => {
    await clearVault()
  })

  it('闲置分钟数：默认 15、只接受 1–120 的整数、锁定态也能读回', async () => {
    expect(await readVaultIdleLockMinutes()).toBe(15)
    expect(await codeOf(() => updateVaultIdleLockMinutes(0))).toBe('invalid-input')
    expect(await codeOf(() => updateVaultIdleLockMinutes(1.5))).toBe('invalid-input')
    expect(await codeOf(() => updateVaultIdleLockMinutes(121))).toBe('invalid-input')

    const updated = await updateVaultIdleLockMinutes(30)
    expect(updated.idleLockMinutes).toBe(30)
    lockVault()
    expect(await readVaultIdleLockMinutes()).toBe(30)
  })

  it('改密：整仓重加密、版本 +1、旧密码失效、内容一条不少', async () => {
    const dataset = await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)

    const changed = await changeVaultPassword(PASSWORD, NEW_PASSWORD, { iterations: ITERATIONS })
    expect(changed.state).toBe('unlocked')
    expect(changed.revision).toBe(2)
    expect(changed.objectCount).toBe(1)
    expect(changed.secretCount).toBe(1)
    // 改密后本标签已装上新密钥，可继续读写
    expect(await loadVaultObject('dataset', dataset.id)).toEqual({ candidateName: NAME_SENTINEL })
    expect(await loadVaultSecret('ai-api-key')).toBe(SECRET_SENTINEL)

    lockVault()
    expect(await codeOf(() => unlockVault(PASSWORD))).toBe('unlock-failed')
    await unlockVault(NEW_PASSWORD)
    expect(await loadVaultObject('dataset', dataset.id)).toEqual({ candidateName: NAME_SENTINEL })
  })

  it('改密时旧密码错误一律拒绝（不会把仓改成一半新一半旧）', async () => {
    const dataset = await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    expect(await codeOf(() => changeVaultPassword('wrong-password', NEW_PASSWORD))).toBe(
      'unlock-failed',
    )
    expect((await readVaultStatus()).revision).toBe(1)
    expect(await loadVaultObject('dataset', dataset.id)).toEqual({ candidateName: NAME_SENTINEL })
  })

  it('其他标签页改密后：本标签写入被拒绝为 stale-session，并立刻丢弃密钥', async () => {
    const events: VaultEvent[] = []
    const unsubscribe = subscribeVaultEvents((event) => events.push(event))
    try {
      await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
      // 模拟「另一个标签页改了密」：库里的版本号被推进，本标签内存密钥仍是旧版本
      const db = openVaultDatabase()
      const row = await db.meta.get(VAULT_META_KEY)
      const meta = row?.value as { readonly revision: number }
      await db.meta.put({ key: VAULT_META_KEY, value: { ...meta, revision: meta.revision + 1 } })

      expect(await codeOf(() => saveVaultObject('dataset', { candidateName: '新数据' }))).toBe(
        'stale-session',
      )
      expect(events.some((event) => event.type === 'stale-session')).toBe(true)
      expect(hasVaultKeys()).toBe(false)
    } finally {
      unsubscribe()
    }
  })

  it('清空本地仓：删除整个库、丢弃密钥，之后状态回到 absent', async () => {
    await saveVaultObject('dataset', { candidateName: NAME_SENTINEL })
    await saveVaultSecret('ai-api-key', SECRET_SENTINEL)

    await clearVault()
    expect(hasVaultKeys()).toBe(false)
    const status = await readVaultStatus()
    expect(status.state).toBe('absent')
    expect(status.vaultId).toBeNull()
    expect(await codeOf(() => unlockVault(PASSWORD))).toBe('not-found')
    // 读状态会经 Dexie 重新建库（空表），所以这里断言「一张空表，无任何记录」
    const stores = await readRawStores()
    expect(Object.keys(stores).sort()).toEqual(['meta', 'objects', 'secrets'])
    expect(Object.values(stores).every((rows) => rows.length === 0)).toBe(true)
  })
})

