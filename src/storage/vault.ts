/**
 * 加密本地仓（IndexedDB + Web Crypto 信封，**步骤6 的核心**）。
 *
 * 设计要点与出处（docs/PRD.md 10.2–10.5、实施计划步骤6）：
 * 1. **明文零落盘**：所有业务对象只以 AES-GCM-256 信封写入 `objects` 表；
 *    `meta` 表只放非敏感元数据（随机仓 ID、KDF 参数、salt、版本号、加密校验串）。
 * 2. **口径唯一**：加解密一律走 `src/crypto` 的 `sealJson` / `openJson`，
 *    本文件不自己拼 AAD、不自己生成 IV，避免出现「某处漏绑定」。
 * 3. **多标签安全**：每个对象行都记录写入时的仓版本号 `revision`；改密 +1 并整体重加密。
 *    若本标签的密钥版本与库里的元数据不一致（其他标签改密 / 清空过），一律
 *    `stale-session` 并立刻丢弃密钥 —— **绝不允许**用旧密钥覆盖新数据。
 * 4. **改密原子**：先在事务外把全部对象解密并用新密钥重新加密，再用**单个** IndexedDB
 *    事务整体替换；IndexedDB 事务在 `await` 非 IDB 任务时会自动提交，所以加解密不能放在
 *    事务里（也不使用 `Dexie.waitFor()` 长时间拖延事务）。失败时事务不留半成品，
 *    因此不存在「部分数据用新密码」的状态。
 * 5. **秘密槽位分离**：AI Key 用独立密钥（`secretKey`）与独立 AAD 槽位加密，
 *    与业务数据不同表、不同密钥、不同备份口径。
 *
 * 本模块会静态引入 Dexie，因此**界面不要静态 import**：请通过
 * `src/storage/index.ts` 暴露的 `encryptedVault` 懒门面调用（动态 import）。
 */

import {
  activeVaultKeys,
  assertAcceptablePassword,
  createKdfParams,
  DEFAULT_PBKDF2_ITERATIONS,
  deriveVaultKeys,
  dropVaultKeys,
  hasVaultKeys,
  installVaultKeys,
  isCryptoError,
  openJson,
  randomId,
  requireVaultKeys,
  sealJson,
  type EncryptedEnvelope,
  type EnvelopeAadRef,
  type VaultKeyMaterial,
  type VaultKeySet,
} from '../crypto'
import { isSchemaCompatible } from '../domain'
import {
  DATABASE_NAME,
  openVaultDatabase,
  removeVaultDatabase,
  type VaultDatabase,
  type VaultObjectRow,
  type VaultSecretRow,
} from './db'
import { runVaultOperation, VaultError, vaultError } from './errors'
import { emitVaultEvent, type VaultLockReason } from './vaultEvents'
import {
  createVaultMeta,
  DEFAULT_IDLE_LOCK_MINUTES,
  isIdleLockMinutes,
  MAX_IDLE_LOCK_MINUTES,
  MIN_IDLE_LOCK_MINUTES,
  parseVaultMeta,
  VAULT_META_KEY,
  VAULT_VERIFICATION_TEXT,
  type VaultMeta,
  type VaultObjectKind,
  type VaultSecretSlot,
} from './vaultMeta'

export type VaultState = 'absent' | 'locked' | 'unlocked'

export type VaultStatus = {
  readonly state: VaultState
  /** 库名（非敏感常量）；清空本地仓的提示里需要说清清的是哪个库 */
  readonly databaseName: string
  readonly vaultId: string | null
  readonly revision: number | null
  readonly schemaVersion: string | null
  readonly schemaCompatible: boolean
  readonly kdfIterations: number | null
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly idleLockMinutes: number
  /** 对象条数 / 秘密槽位数：只是计数，不含任何内容 */
  readonly objectCount: number
  readonly secretCount: number
}

export type SaveVaultObjectResult = {
  readonly id: string
  readonly kind: VaultObjectKind
  readonly revision: number
}

export type VaultObjectRecord<T> = {
  readonly id: string
  readonly kind: VaultObjectKind
  readonly payload: T
}

const VAULT_CHECK_PURPOSE = 'vault-check'

/** 用途标识只在两处生成：这里与解密时；不一致就会认证失败，不会解出错误内容 */
function objectPurpose(kind: string, id: string): string {
  return `object:${kind}:${id}`
}

function secretPurpose(slot: string): string {
  return `secret:${slot}`
}

function aad(vaultId: string, revision: number, purpose: string): EnvelopeAadRef {
  return { vaultId, revision, purpose }
}

function toKeySet(meta: VaultMeta, material: VaultKeyMaterial): VaultKeySet {
  return {
    vaultId: meta.vaultId,
    revision: meta.revision,
    kdfIterations: meta.kdf.iterations,
    unlockedAt: new Date().toISOString(),
    keys: { data: material.dataKey, secret: material.secretKey },
  }
}

async function readStoredMeta(db: VaultDatabase): Promise<VaultMeta | null> {
  const row = await db.meta.get(VAULT_META_KEY)
  if (row === undefined) {
    return null
  }
  const parsed = parseVaultMeta(row.value)
  if (!parsed.ok) {
    throw vaultError(
      'corrupted',
      parsed.reason === 'unsupported-format'
        ? '本地仓格式版本高于当前应用，请升级后再打开'
        : '本地仓元数据不完整',
    )
  }
  return parsed.meta
}

/**
 * 写入 / 读取前的「会话仍然有效」守卫。
 * 其他标签页改密或清空后，仓版本号会变（或仓消失），此时必须丢弃本标签密钥并报
 * `stale-session`，而不是继续用旧密钥写入（那会把数据写成永远解不开的样子）。
 */
async function requireFreshMeta(db: VaultDatabase, keys: VaultKeySet): Promise<VaultMeta> {
  const meta = await readStoredMeta(db)
  if (meta === null) {
    dropVaultKeys()
    throw vaultError('not-found')
  }
  if (meta.vaultId !== keys.vaultId || meta.revision !== keys.revision) {
    dropVaultKeys()
    emitVaultEvent({ type: 'stale-session' })
    throw vaultError('stale-session')
  }
  return meta
}

/** 读状态：不需要密钥（锁定态也能读元数据与计数），是界面判断「有没有仓 / 是否已解锁」的入口 */
export async function readVaultStatus(): Promise<VaultStatus> {
  return runVaultOperation(async () => {
    const db = openVaultDatabase()
    const meta = await readStoredMeta(db)
    if (meta === null) {
      return {
        state: 'absent',
        databaseName: DATABASE_NAME,
        vaultId: null,
        revision: null,
        schemaVersion: null,
        schemaCompatible: true,
        kdfIterations: null,
        createdAt: null,
        updatedAt: null,
        idleLockMinutes: DEFAULT_IDLE_LOCK_MINUTES,
        objectCount: 0,
        secretCount: 0,
      } satisfies VaultStatus
    }
    const keys = activeVaultKeys()
    const unlocked =
      keys !== null && keys.vaultId === meta.vaultId && keys.revision === meta.revision
    return {
      state: unlocked ? 'unlocked' : 'locked',
      databaseName: DATABASE_NAME,
      vaultId: meta.vaultId,
      revision: meta.revision,
      schemaVersion: meta.schemaVersion,
      schemaCompatible: isSchemaCompatible(meta.schemaVersion),
      kdfIterations: meta.kdf.iterations,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
      idleLockMinutes: meta.idleLockMinutes,
      objectCount: await db.objects.count(),
      secretCount: await db.secrets.count(),
    } satisfies VaultStatus
  })
}

/**
 * 创建本地仓：派生密钥 → 写入元数据（含加密校验串）→ 安装内存密钥。
 * 密码只在这里出现一次：写完元数据后本函数不再持有它（也不缓存、不记日志）。
 */
export async function createVault(
  password: string,
  options: { readonly iterations?: number; readonly idleLockMinutes?: number } = {},
): Promise<VaultStatus> {
  return runVaultOperation(async () => {
    assertAcceptablePassword(password)
    const db = openVaultDatabase()
    if ((await readStoredMeta(db)) !== null) {
      throw vaultError('already-exists')
    }
    const kdf = createKdfParams(options.iterations ?? DEFAULT_PBKDF2_ITERATIONS)
    const vaultId = randomId('vault')
    const material = await deriveVaultKeys(password, kdf)
    const revision = 1
    const verification = await sealJson(
      material.dataKey,
      VAULT_VERIFICATION_TEXT,
      aad(vaultId, revision, VAULT_CHECK_PURPOSE),
    )
    const meta = createVaultMeta({
      vaultId,
      kdf,
      revision,
      verification,
      idleLockMinutes: options.idleLockMinutes,
    })
    // 只有一条记录：这一步失败就等于「没有创建」，不会留下半个本地仓
    await db.meta.put({ key: VAULT_META_KEY, value: meta })
    installVaultKeys(toKeySet(meta, material))
    emitVaultEvent({ type: 'unlocked', vaultId, revision: meta.revision })
    return readVaultStatus()
  })
}

/**
 * 密码 → 密钥（含校验）。
 * 任何失败（口令为空、KDF 参数异常、校验串解密失败或内容不符）都归为**同一个**
 * `unlock-failed`：不区分「密码错」与「密文被改」，也不回显底层异常
 * （docs/PRD.md 10.3「密码错误 / 密文被修改均以解锁失败处理，不输出原始敏感内容」）。
 */
async function unlockVaultKeys(password: string, meta: VaultMeta): Promise<VaultKeyMaterial> {
  try {
    if (typeof password !== 'string' || password.length === 0) {
      throw vaultError('unlock-failed')
    }
    const material = await deriveVaultKeys(password, meta.kdf)
    const check = await openJson<string>(
      material.dataKey,
      meta.verification,
      aad(meta.vaultId, meta.revision, VAULT_CHECK_PURPOSE),
    )
    if (check !== VAULT_VERIFICATION_TEXT) {
      throw vaultError('unlock-failed')
    }
    return material
  } catch (error) {
    if (error instanceof VaultError) {
      throw error
    }
    throw vaultError('unlock-failed')
  }
}

export async function unlockVault(password: string): Promise<VaultStatus> {
  return runVaultOperation(async () => {
    const db = openVaultDatabase()
    const meta = await readStoredMeta(db)
    if (meta === null) {
      throw vaultError('not-found')
    }
    const material = await unlockVaultKeys(password, meta)
    installVaultKeys(toKeySet(meta, material))
    emitVaultEvent({ type: 'unlocked', vaultId: meta.vaultId, revision: meta.revision })
    return readVaultStatus()
  })
}

/**
 * 锁定：只丢弃内存密钥并广播事件。
 * 需要清空的界面状态（编辑中的表格、图表缓存、Blob URL）由订阅方处理；
 * 未解锁时调用是空操作（不重复广播）。
 */
export function lockVault(reason: VaultLockReason = 'manual'): void {
  if (!hasVaultKeys()) {
    return
  }
  dropVaultKeys()
  emitVaultEvent({ type: 'locked', reason })
}

/** 读闲置锁定分钟数（不需要解锁）：应用外壳在启动时据此配置计时器 */
export async function readVaultIdleLockMinutes(): Promise<number> {
  return runVaultOperation(async () => {
    const db = openVaultDatabase()
    const meta = await readStoredMeta(db)
    return meta?.idleLockMinutes ?? DEFAULT_IDLE_LOCK_MINUTES
  })
}

/** 修改闲置锁定分钟数（需要解锁）；只改非敏感配置，不需要重加密任何数据 */
export async function updateVaultIdleLockMinutes(minutes: number): Promise<VaultStatus> {
  return runVaultOperation(async () => {
    if (!isIdleLockMinutes(minutes)) {
      throw vaultError(
        'invalid-input',
        `闲置锁定分钟数必须是 ${MIN_IDLE_LOCK_MINUTES}–${MAX_IDLE_LOCK_MINUTES} 之间的整数`,
      )
    }
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    const meta = await requireFreshMeta(db, keys)
    await db.meta.put({
      key: VAULT_META_KEY,
      value: { ...meta, idleLockMinutes: minutes, updatedAt: new Date().toISOString() },
    })
    return readVaultStatus()
  })
}

/**
 * 保存业务对象（不传 `id` 时由仓生成随机 id）。
 * 每次写入都会生成**新的 IV**，因此同一个对象改两次，落盘的密文与 IV 都不同
 * （docs/PRD.md 10.3「敏感持久化状态更新也必须使用新 IV」）。
 */
export async function saveVaultObject<T>(
  kind: VaultObjectKind,
  payload: T,
  options: { readonly id?: string } = {},
): Promise<SaveVaultObjectResult> {
  return runVaultOperation(async () => {
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    const meta = await requireFreshMeta(db, keys)
    const id = options.id ?? randomId(kind)
    let envelope: EncryptedEnvelope
    try {
      envelope = await sealJson(
        keys.keys.data,
        payload,
        aad(meta.vaultId, meta.revision, objectPurpose(kind, id)),
      )
    } catch (error) {
      if (isCryptoError(error) && error.code === 'invalid-params') {
        throw vaultError('unsupported-payload')
      }
      throw error
    }
    // 单行 put 在 IndexedDB 事务内是原子的：失败时旧行保持不变，不会留下写坏的对象
    await db.objects.put({ id, kind, revision: meta.revision, envelope })
    return { id, kind, revision: meta.revision }
  })
}

/**
 * **追加**一个业务对象（每次调用都产生新的 id，绝不覆盖已有对象）。
 *
 * 为什么需要它（AI-5）：`saveVaultObject` 的语义是「按键写入」，传同一个 id 会**覆盖**。
 * AI 历史是「一次调用一条记录、只增不改」的列表，用 `saveVaultObject` 必须由调用方
 * 自己保证 id 不重复——而调用方（界面层）恰恰是最不该依赖「我记得生成唯一 id」的地方。
 * 因此把「生成唯一 id + 不覆盖」变成仓的能力。
 *
 * id 形态：`<kind>-<时间戳基数36>-<随机后缀>`。时间戳让同一次会话内**天然按时间有序**
 * （IndexedDB 按主键排序时即时间序），随机后缀保证同一毫秒内的两次追加也不会撞。
 * id 只含随机标识与时间，**不含任何业务含义**（与 `vaultMeta` 的元数据纪律一致）。
 */
export async function appendVaultObject<T>(
  kind: VaultObjectKind,
  payload: T,
): Promise<SaveVaultObjectResult> {
  const existing = await listVaultObjects<T>(kind)
  const used = new Set(existing.map((record) => record.id))
  let id = ''
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${kind}-${Date.now().toString(36)}-${randomId('x').slice(-8)}`
    if (!used.has(candidate)) {
      id = candidate
      break
    }
  }
  if (id === '') {
    // 8 次都没拿到未被占用的 id：这是极不可能的异常，**明确失败**而不是覆盖已有历史
    throw vaultError('invalid-input', '无法生成未被占用的对象标识，已拒绝写入以保护已有历史')
  }
  return saveVaultObject(kind, payload, { id })
}

/** 读取单个对象；不存在返回 `null`（不用空对象冒充，避免界面把缺失当 0） */export async function loadVaultObject<T>(kind: VaultObjectKind, id: string): Promise<T | null> {
  return runVaultOperation(async () => {
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    const meta = await requireFreshMeta(db, keys)
    const row = await db.objects.get(id)
    if (row === undefined) {
      return null
    }
    if (row.kind !== kind) {
      throw vaultError('corrupted', '对象种类与请求不一致，已拒绝解密')
    }
    if (row.revision !== meta.revision) {
      throw vaultError('corrupted', '对象写入版本与本地仓不一致')
    }
    return await openJson<T>(
      keys.keys.data,
      row.envelope,
      aad(meta.vaultId, row.revision, objectPurpose(row.kind, row.id)),
    )
  })
}

/**
 * 列出某一类对象（用于「读取历史」类功能）。
 * 顺序是 IndexedDB 索引顺序，不承诺业务顺序；界面需要排序时应显式排序。
 */
export async function listVaultObjects<T>(
  kind: VaultObjectKind,
): Promise<readonly VaultObjectRecord<T>[]> {
  return runVaultOperation(async () => {
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    const meta = await requireFreshMeta(db, keys)
    const rows = await db.objects.where('kind').equals(kind).toArray()
    const records: VaultObjectRecord<T>[] = []
    for (const row of rows) {
      if (row.revision !== meta.revision) {
        throw vaultError('corrupted', '对象写入版本与本地仓不一致')
      }
      records.push({
        id: row.id,
        kind,
        payload: await openJson<T>(
          keys.keys.data,
          row.envelope,
          aad(meta.vaultId, row.revision, objectPurpose(row.kind, row.id)),
        ),
      })
    }
    return records
  })
}

/** 删除单个对象；返回删除条数（0 表示本来就不存在） */
export async function deleteVaultObject(kind: VaultObjectKind, id: string): Promise<number> {
  return runVaultOperation(async () => {
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    await requireFreshMeta(db, keys)
    const row = await db.objects.get(id)
    if (row === undefined) {
      return 0
    }
    if (row.kind !== kind) {
      throw vaultError('invalid-input', '对象种类与请求不一致，未删除任何内容')
    }
    await db.objects.delete(id)
    return 1
  })
}

/**
 * 清空业务对象；不传 `kind` 时清空全部。
 * **不动**秘密槽位（AI Key 有独立生命周期，清除 AI 历史不得连带删 Key）与仓元数据。
 */
export async function clearVaultObjects(kind?: VaultObjectKind): Promise<number> {
  return runVaultOperation(async () => {
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    await requireFreshMeta(db, keys)
    if (kind === undefined) {
      const count = await db.objects.count()
      await db.objects.clear()
      return count
    }
    return await db.objects.where('kind').equals(kind).delete()
  })
}

/**
 * 秘密槽位 —— 与业务数据**不同表、不同密钥、不同备份口径**（docs/PRD.md 10.3、10.5）：
 * 保存 / 读取 / 删除 / 清空都走这里，界面拿到的永远是明文值，落盘永远是密文。
 */

/** 只看有没有，**不解密**：设置页显示「已保存 / 未保存」时不必接触密钥内容 */
export async function hasVaultSecret(slot: VaultSecretSlot): Promise<boolean> {
  return runVaultOperation(async () => {
    requireVaultKeys()
    const db = openVaultDatabase()
    const row = await db.secrets.get(slot)
    return row !== undefined
  })
}

export async function saveVaultSecret(
  slot: VaultSecretSlot,
  value: string,
): Promise<{ readonly slot: VaultSecretSlot; readonly revision: number }> {
  return runVaultOperation(async () => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw vaultError('invalid-input', '秘密内容不能为空；如需清除请使用删除操作')
    }
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    const meta = await requireFreshMeta(db, keys)
    const envelope = await sealJson(
      keys.keys.secret,
      value,
      aad(meta.vaultId, meta.revision, secretPurpose(slot)),
    )
    await db.secrets.put({ slot, revision: meta.revision, envelope })
    return { slot, revision: meta.revision }
  })
}

export async function loadVaultSecret(slot: VaultSecretSlot): Promise<string | null> {
  return runVaultOperation(async () => {
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    const meta = await requireFreshMeta(db, keys)
    const row = await db.secrets.get(slot)
    if (row === undefined) {
      return null
    }
    if (row.revision !== meta.revision) {
      throw vaultError('corrupted', '秘密槽位写入版本与本地仓不一致')
    }
    return await openJson<string>(
      keys.keys.secret,
      row.envelope,
      aad(meta.vaultId, row.revision, secretPurpose(row.slot)),
    )
  })
}

export async function deleteVaultSecret(slot: VaultSecretSlot): Promise<number> {
  return runVaultOperation(async () => {
    requireVaultKeys()
    const db = openVaultDatabase()
    const row = await db.secrets.get(slot)
    if (row === undefined) {
      return 0
    }
    await db.secrets.delete(slot)
    return 1
  })
}

/** 清空全部秘密槽位（AI Key 单独清除用；业务对象与分析缓存不受影响） */
export async function clearVaultSecrets(): Promise<number> {
  return runVaultOperation(async () => {
    requireVaultKeys()
    const db = openVaultDatabase()
    const count = await db.secrets.count()
    await db.secrets.clear()
    return count
  })
}

/**
 * 改密：校验旧密码 → 事务外解密并重加密全部对象与秘密槽位（新 salt、新密钥、新 IV、新版本号）
 * → 单个事务整体替换元数据与两类密文 → 安装新密钥。
 *
 * 为什么「解密重加密放在事务外」：IndexedDB 事务在 `await` 非 IDB 任务（这里是 Web Crypto）
 * 时会自动提交，把 PBKDF2 + AES 放进事务里等于事务随时失效；也不要使用 `Dexie.waitFor()`
 * 去拖延事务（Dexie 官方说明它只能撑住约 1000 次空查询 / 100 ms）。所以：**先把新密文全部
 * 算好，再在一个事务里整体写入**，失败时不会出现「一部分用新密码、一部分用旧密码」。
 */
export async function changeVaultPassword(
  oldPassword: string,
  newPassword: string,
  options: { readonly iterations?: number } = {},
): Promise<VaultStatus> {
  return runVaultOperation(async () => {
    assertAcceptablePassword(newPassword)
    const db = openVaultDatabase()
    const meta = await readStoredMeta(db)
    if (meta === null) {
      throw vaultError('not-found')
    }
    // 先校验旧密码：即使当前处于解锁状态，也不允许未经校验就改密
    const oldKeys = await unlockVaultKeys(oldPassword, meta)
    const nextRevision = meta.revision + 1
    const nextKdf = createKdfParams(options.iterations ?? meta.kdf.iterations)
    const nextKeys = await deriveVaultKeys(newPassword, nextKdf)

    const objectRows = await db.objects.toArray()
    const secretRows = await db.secrets.toArray()
    const nextObjects: VaultObjectRow[] = []
    for (const row of objectRows) {
      const payload = await openJson<unknown>(
        oldKeys.dataKey,
        row.envelope,
        aad(meta.vaultId, row.revision, objectPurpose(row.kind, row.id)),
      )
      nextObjects.push({
        id: row.id,
        kind: row.kind,
        revision: nextRevision,
        envelope: await sealJson(
          nextKeys.dataKey,
          payload,
          aad(meta.vaultId, nextRevision, objectPurpose(row.kind, row.id)),
        ),
      })
    }
    const nextSecrets: VaultSecretRow[] = []
    for (const row of secretRows) {
      const payload = await openJson<unknown>(
        oldKeys.secretKey,
        row.envelope,
        aad(meta.vaultId, row.revision, secretPurpose(row.slot)),
      )
      nextSecrets.push({
        slot: row.slot,
        revision: nextRevision,
        envelope: await sealJson(
          nextKeys.secretKey,
          payload,
          aad(meta.vaultId, nextRevision, secretPurpose(row.slot)),
        ),
      })
    }
    const verification = await sealJson(
      nextKeys.dataKey,
      VAULT_VERIFICATION_TEXT,
      aad(meta.vaultId, nextRevision, VAULT_CHECK_PURPOSE),
    )
    const nextMeta: VaultMeta = {
      ...meta,
      kdf: nextKdf,
      revision: nextRevision,
      updatedAt: new Date().toISOString(),
      verification,
    }

    await db.transaction('rw', db.meta, db.objects, db.secrets, async () => {
      await db.meta.put({ key: VAULT_META_KEY, value: nextMeta })
      if (nextObjects.length > 0) {
        await db.objects.bulkPut(nextObjects)
      }
      if (nextSecrets.length > 0) {
        await db.secrets.bulkPut(nextSecrets)
      }
    })

    installVaultKeys(toKeySet(nextMeta, nextKeys))
    emitVaultEvent({ type: 'revision-changed', vaultId: nextMeta.vaultId, revision: nextMeta.revision })
    return readVaultStatus()
  })
}

/**
 * 清空本地仓：删除整个 IndexedDB 库（元数据 + 对象 + 秘密槽位）并丢弃内存密钥。
 * 这是「忘记密码」后唯一的自救路径（界面必须先做二次确认）；**不需要**密码，
 * 因为密码已无从校验，而数据本来就要全部丢弃。
 */
export async function clearVault(): Promise<void> {
  return runVaultOperation(async () => {
    await removeVaultDatabase()
  })
}

/**
 * 同层复用出口（备份 / 迁移用）：
 * `vaultObjectPurpose` 让备份模块用**完全一致**的用途标识去解密对象，
 * 避免复制一份拼装逻辑后出现「备份能导出、恢复却解不开」的错配。
 */
export function vaultObjectPurpose(kind: string, id: string): string {
  return objectPurpose(kind, id)
}

/** 取当前解锁会话并确认版本一致（对象 / 备份操作前的统一守卫） */
export async function requireActiveVault(): Promise<{
  readonly meta: VaultMeta
  readonly keys: VaultKeySet
}> {
  return runVaultOperation(async () => {
    const keys = requireVaultKeys()
    const db = openVaultDatabase()
    const meta = await requireFreshMeta(db, keys)
    return { meta, keys }
  })
}
