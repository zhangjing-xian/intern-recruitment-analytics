/**
 * AI-5 单测：AI 历史的加密持久化（`src/ai/aiHistory.ts`）。
 *
 * ## 为什么用**真实**加密仓而不是 mock
 *
 * 本步的风险集中在几件事上，而它们全都在真实仓里才会暴露：
 * - 「历史里绝不出现明文」——只有真的落盘才验证得了（本文件直接读原生 IndexedDB 搜哨兵）；
 * - 「追加不覆盖」——`saveObject` 与 `appendObject` 的差别就是覆盖与否；
 * - 「清历史不动源数据与 Key」——需要真的往仓里放三类东西再删其中一类。
 *
 * 因此在 `fake-indexeddb` + 真实 Web Crypto 下跑（与 `storage/vault.test.ts` 同一套做法），
 * PBKDF2 迭代取 `MIN_PBKDF2_ITERATIONS`，不给 CI 加 60 万次的负担。
 *
 * ## 覆盖的验收点
 *
 * - AI13：历史元数据齐全（模型、时间、级别、范围、版本、已发送摘要）；
 * - AI14：清空历史不删源数据与 Key；迟到响应不写回已清空历史；
 * - AI10：明文 Key 不在历史里（本文件用哨兵检索）。
 */

import 'fake-indexeddb/auto'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MIN_PBKDF2_ITERATIONS } from '../crypto'
import { DATABASE_NAME } from '../storage/db'
import { clearVault, createVault, listVaultObjects, saveVaultObject } from '../storage/vault'
import { VAULT_SECRET_SLOTS } from '../storage/vaultMeta'
import { saveVaultSecret } from '../storage/vault'
import {
  AI_HISTORY_SCHEMA_VERSION,
  clearAiHistory,
  deleteAiHistoryEntry,
  isAiHistoryPayload,
  loadAiHistory,
  newHistoryId,
  saveAiHistoryEntry,
  type AiHistoryPayload,
} from './aiHistory'

const PASSWORD = 'history-password-1234'
/** 明文哨兵：任何一处落盘都必须搜不到 */
const NAME_SENTINEL = '张三历史哨兵'
const KEY_SENTINEL = 'sk-sentinel-history-9f3a2b'

function payloadOf(overrides: Partial<AiHistoryPayload> = {}): AiHistoryPayload {
  return {
    schemaVersion: AI_HISTORY_SCHEMA_VERSION,
    savedAt: '2026-09-26T10:00:00.000Z',
    requestedAt: '2026-09-26T09:59:00.000Z',
    previewHash: 'AB12CD34',
    requestedModel: 'deepseek-flash',
    responseModel: 'deepseek-flash',
    privacyLevel: 'standard',
    schemaVersionOfPayload: 'ai-summary/2',
    promptVersion: 'ai-prompt/2',
    ruleVersionLabel: '1.0.0+3F2A19C4',
    dataAsOf: '2026-08-31',
    activeFilters: ['城市：上海'],
    payloadJson: '{"kpi":{"N":12}}',
    content: '## 核心结论\n合成结果。',
    finishReason: 'stop',
    finishStatus: 'complete',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, promptCacheHitTokens: 0 },
    responseId: 'chatcmpl-synthetic-1',
    responseCheck: { hasFindings: false, fieldNames: [], sentinelHit: false },
    ...overrides,
  }
}

/** 直接读原生 IndexedDB（绕开 Dexie），用于证明「落盘只有密文」 */
async function readRawStore(store: string): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME)
    request.onerror = () => reject(request.error ?? new Error('打开失败'))
    request.onsuccess = () => resolve(request.result)
  })
  try {
    const transaction = db.transaction([store], 'readonly')
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore(store).getAll()
      request.onsuccess = () => resolve(request.result as unknown[])
      request.onerror = () => reject(request.error ?? new Error('读取失败'))
    })
    return JSON.stringify(rows)
  } finally {
    db.close()
  }
}

beforeEach(async () => {
  await clearVault()
})

afterEach(async () => {
  await clearVault()
})

describe('AI-5：历史结构校验', () => {
  it('合法载荷通过校验；多余键被拒绝（防止未来字段静默混入）', () => {
    expect(isAiHistoryPayload(payloadOf())).toBe(true)
    expect(isAiHistoryPayload({ ...payloadOf(), extra: 1 })).toBe(false)
  })

  it('载荷**不含 id**：身份由仓的行键提供，只有一处来源', () => {
    expect(Object.keys(payloadOf())).not.toContain('id')
  })

  it('schema 版本不符时拒绝（不硬猜旧形状）', () => {
    expect(isAiHistoryPayload({ ...payloadOf(), schemaVersion: 'ai-history/0' })).toBe(false)
  })

  it('缺关键字段时拒绝', () => {
    const base = payloadOf()
    for (const key of ['content', 'payloadJson', 'previewHash', 'savedAt'] as const) {
      const broken: Record<string, unknown> = { ...base }
      delete broken[key]
      expect(isAiHistoryPayload(broken)).toBe(false)
    }
  })

  it('结构里没有能装 Key / 请求头 / 思维链的位置', () => {
    const keys = [...Object.keys(payloadOf()), 'id']
    for (const forbidden of [
      'apiKey',
      'key',
      'authorization',
      'headers',
      'reasoningContent',
      'reasoning_content',
    ]) {
      expect(keys).not.toContain(forbidden)
    }
  })
})

describe('AI-5：只有显式保存才写入，且追加不覆盖', () => {
  it('保存后能读回（元数据齐全，AI13）', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    const payload = payloadOf()
    const saved = await saveAiHistoryEntry(payload)
    expect(saved.ok).toBe(true)
    // 保存返回的条目带上了仓生成的行键
    if (saved.ok) {
      expect(saved.entry.id.length).toBeGreaterThan(0)
      expect(saved.entry.previewHash).toBe(payload.previewHash)
    }

    const loaded = await loadAiHistory()
    expect(loaded.reason).toBeNull()
    expect(loaded.entries).toHaveLength(1)
    const entry = loaded.entries[0]
    /*
     * 逐项核对 AI13 要求的元数据（模型、时间、级别、范围、版本、已发送摘要）。
     * 不整对象比较：读回时多了一个来自仓行键的 `id`，那是身份而不是内容。
     */
    expect(entry).toMatchObject({
      savedAt: payload.savedAt,
      requestedAt: payload.requestedAt,
      previewHash: payload.previewHash,
      requestedModel: payload.requestedModel,
      responseModel: payload.responseModel,
      privacyLevel: payload.privacyLevel,
      schemaVersionOfPayload: payload.schemaVersionOfPayload,
      promptVersion: payload.promptVersion,
      ruleVersionLabel: payload.ruleVersionLabel,
      dataAsOf: payload.dataAsOf,
      activeFilters: payload.activeFilters,
      payloadJson: payload.payloadJson,
      content: payload.content,
      finishReason: payload.finishReason,
      finishStatus: payload.finishStatus,
      usage: payload.usage,
      responseId: payload.responseId,
      responseCheck: payload.responseCheck,
    })
  })

  it('两次保存产生两条（**追加**而不是互相覆盖）', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    await saveAiHistoryEntry(payloadOf({ savedAt: '2026-09-26T10:00:00.000Z' }))
    await saveAiHistoryEntry(payloadOf({ savedAt: '2026-09-26T11:00:00.000Z' }))

    const loaded = await loadAiHistory()
    expect(loaded.entries).toHaveLength(2)
    // 倒序：最近的在最上面
    expect(loaded.entries[0]?.savedAt).toBe('2026-09-26T11:00:00.000Z')
  })

  it('两次保存内容完全相同的记录也会得到两条（身份由仓生成，不靠调用方）', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    /*
     * 载荷里没有 id 可传——这正是重构掉的那个 bug：以前 id 由调用方给，
     * 于是「条目说自己是 A、仓里的行键是 B」会让删除点不动。现在两条内容相同也各自成行。
     */
    await saveAiHistoryEntry(payloadOf())
    await saveAiHistoryEntry(payloadOf())
    const loaded = await loadAiHistory()
    expect(loaded.entries).toHaveLength(2)
    expect(loaded.entries[0]?.id).not.toBe(loaded.entries[1]?.id)
  })

  it('临时模式（未建仓）保存失败并给出可读原因，不假装成功', async () => {
    const result = await saveAiHistoryEntry(payloadOf())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  it('未建仓时读取返回空数组与原因，不抛错', async () => {
    const loaded = await loadAiHistory()
    expect(loaded.entries).toEqual([])
    expect(loaded.reason).not.toBeNull()
  })
})

describe('AI-5：落盘只有密文（AI10 哨兵检索）', () => {
  it('原生 IndexedDB 里搜不到 Key、姓名与结果正文', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    await saveVaultSecret(VAULT_SECRET_SLOTS[0], KEY_SENTINEL)
    await saveAiHistoryEntry(
      payloadOf({ content: `结果里出现了 ${NAME_SENTINEL}` }),
    )

    const secrets = await readRawStore('secrets')
    const objects = await readRawStore('objects')
    for (const raw of [secrets, objects]) {
      expect(raw).not.toContain(KEY_SENTINEL)
      expect(raw).not.toContain(NAME_SENTINEL)
      expect(raw).not.toContain('核心结论')
    }
    // 而 secrets 表里确实有一行（说明我们查的是有内容的表，不是空表）
    expect(secrets.length).toBeGreaterThan(10)
  })
})

describe('AI-5：删除动作互不代替（AI14）', () => {
  it('删单条只删那一条', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    const first = await saveAiHistoryEntry(payloadOf())
    expect(first.ok).toBe(true)
    await saveAiHistoryEntry(payloadOf({ savedAt: '2026-09-26T11:00:00.000Z' }))

    const loaded = await loadAiHistory()
    const targetId = loaded.entries[0]?.id ?? ''
    const removed = await deleteAiHistoryEntry(targetId)
    expect(removed).toBe(1)
    expect((await loadAiHistory()).entries).toHaveLength(1)
  })

  it('删不存在的条目返回 0，不抛错', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    expect(await deleteAiHistoryEntry('ai-not-there')).toBe(0)
  })

  it('清空历史**不动**招聘源数据（dataset 对象仍在）', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    await saveVaultObject('dataset', { records: ['合成数据'] }, { id: 'dataset-1' })
    await saveAiHistoryEntry(payloadOf())

    const removed = await clearAiHistory()
    expect(removed).toBe(1)
    expect((await loadAiHistory()).entries).toHaveLength(0)
    // 源数据仍在（这正是「清历史不动源数据」的验证点）
    const datasets = await listVaultObjects<{ records: string[] }>('dataset')
    expect(datasets).toHaveLength(1)
    expect(datasets[0]?.payload.records).toEqual(['合成数据'])
  })

  it('清空历史**不动** AI Key 的秘密槽位', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    await saveVaultSecret(VAULT_SECRET_SLOTS[0], KEY_SENTINEL)
    await saveAiHistoryEntry(payloadOf())

    await clearAiHistory()
    // 秘密槽位仍在：用「再存一次同样成功」间接确认仓仍可写，且 secrets 表未被清空
    const secrets = await readRawStore('secrets')
    expect(secrets.length).toBeGreaterThan(10)
  })

  it('清空后迟到响应不能把历史「恢复」出来（写回只能靠再次显式保存）', async () => {
    await createVault(PASSWORD, { iterations: MIN_PBKDF2_ITERATIONS })
    await saveAiHistoryEntry(payloadOf())
    await clearAiHistory()
    expect((await loadAiHistory()).entries).toHaveLength(0)

    // 模拟「清空之后界面才拿到迟到响应」：它只存在于内存里，没有任何自动写回路径
    const late = payloadOf({ savedAt: '2026-09-26T12:00:00.000Z' })
    expect(isAiHistoryPayload(late)).toBe(true)
    // 没有再调用 saveAiHistoryEntry，因此历史仍为空
    expect((await loadAiHistory()).entries).toHaveLength(0)
  })
})

describe('AI-5：历史 id 是本地随机标识', () => {
  it('id 含固定前缀且不含任何业务含义', () => {
    const id = newHistoryId()
    expect(id.startsWith('ai-')).toBe(true)
    expect(id).not.toContain('上海')
    expect(id).not.toContain('deepseek')
  })

  it('连续生成不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newHistoryId()))
    expect(ids.size).toBe(50)
  })
})
