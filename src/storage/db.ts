/**
 * Dexie / IndexedDB 表结构（加密仓的**物理层**，步骤6）。
 *
 * 表与索引的取舍（docs/PRD.md 10.3）：
 * - 值的部分全是加密信封：`meta` 存放仓元数据（含 KDF 参数、salt、加密校验串），
 *   `objects` 存放业务对象，`secrets` 存放 AI Key 等秘密槽位；
 * - 可索引字段只有**非敏感**字段：随机 ID、对象种类、写入时的仓版本号、秘密槽位名。
 *   姓名、需求 ID、学校、薪资、HR、文件名一律在密文里，**绝不**建索引，
 *   否则每次查询都会把这些值写进 IndexedDB 的索引键里（等于明文落盘）。
 * - `secrets` 与 `objects` 分表，是为了让备份 / 清除可以按「秘密槽位」整体操作，
 *   普通备份只读 `objects` 表，秘密槽位天然不会被打包（docs/PRD.md 10.5）。
 *
 * 这里刻意不用 `class X extends Dexie { objects!: Table<...> }` 的写法：
 * 本项目 tsconfig 开启 `useDefineForClassFields`，那样编译出来的字段定义会覆盖
 * Dexie 动态挂载的表属性（`declare` 才能避免），所以采用 Dexie 官方文档推荐的
 * 「`new Dexie(name) as Dexie & { ... }`」形态，行为最可预期。
 */

import Dexie, { type Table } from 'dexie'

import { dropVaultKeys, type EncryptedEnvelope } from '../crypto'
import { mapDatabaseError, vaultError } from './errors'
import { emitVaultEvent } from './vaultEvents'

export const DATABASE_NAME = 'intern-recruitment-vault'
export const DATABASE_VERSION = 1

export type VaultMetaRow = {
  readonly key: string
  /** 结构见 storage/vaultMeta.ts 的 VaultMeta（本层只当不透明值存取并校验） */
  readonly value: unknown
}

export type VaultObjectRow = {
  readonly id: string
  readonly kind: string
  /** 写入时的仓版本号；与元数据不一致说明是改密前的旧行（用于识别半途状态） */
  readonly revision: number
  readonly envelope: EncryptedEnvelope
}

export type VaultSecretRow = {
  readonly slot: string
  readonly revision: number
  readonly envelope: EncryptedEnvelope
}

export type VaultDatabase = Dexie & {
  readonly meta: Table<VaultMetaRow, string>
  readonly objects: Table<VaultObjectRow, string>
  readonly secrets: Table<VaultSecretRow, string>
}

let database: VaultDatabase | null = null

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export function vaultDatabase(): VaultDatabase | null {
  return database
}

/**
 * 打开（或复用）本地仓连接。
 * 懒创建：只有真正读写时才连库，临时内存模式（步骤2–5）完全不碰 IndexedDB。
 */
export function openVaultDatabase(): VaultDatabase {
  if (!isIndexedDbAvailable()) {
    throw vaultError('unavailable')
  }
  if (database !== null) {
    return database
  }
  const db = new Dexie(DATABASE_NAME) as VaultDatabase
  db.version(DATABASE_VERSION).stores({
    meta: 'key',
    objects: 'id, kind, revision',
    secrets: 'slot',
  })

  // 其他标签页删除 / 升级本地仓时：立即关闭本标签连接并丢弃密钥，
  // 否则它的删除会被我们阻塞（docs/PRD.md 10.5「先通知并关闭其他标签页连接」）。
  const onConnectionLost = (reason: string): void => {
    dropVaultKeys()
    emitVaultEvent({ type: 'connection-closed', reason })
    /*
     * 同时广播一次**锁定**事件，原因记为 `tab`。
     *
     * 为什么不能只发 `connection-closed`：IndexedDB 的 `versionchange` 其实是**推送式**的
     * ——另一个标签页改密 / 清空时浏览器会主动通知本标签，所以「本页的解锁状态已失效」这件事
     * 确实是即时发生的（密钥已被 `dropVaultKeys` 丢弃，不会再拿旧密钥去写）。
     * 但在此之前只有 `connection-closed` 被发出去，而 `describeLockReason('tab')`
     * 这句面向用户的解释**从来没有机会显示**（`VaultLockReason` 里的 `'tab'` 是个死枚举值），
     * 于是用户会遇到「数据没了但界面不解释为什么」。
     * 补上这一次广播，`vaultText` 里那句既有的、本来就正确的说法才真正可达。
     */
    emitVaultEvent({ type: 'locked', reason: 'tab' })
  }
  db.on('versionchange', () => {
    db.close()
    onConnectionLost('versionchange')
  })
  db.on('close', () => {
    onConnectionLost('close')
  })

  database = db
  return db
}

/** 主动关闭连接（例如清空本地仓之后）；密钥同时丢弃，避免继续用已失效的连接写入 */
export function closeVaultDatabase(): void {
  const db = database
  database = null
  if (db !== null) {
    db.close()
  }
  dropVaultKeys()
}
/**
 * 删除整个本地仓（含元数据）；用于「忘记密码 → 清空重来」。
 * 不需要密钥：这是密码丢失后唯一的自救路径（且必须先由界面完成二次确认）。
 */
export async function removeVaultDatabase(): Promise<void> {
  const db = openVaultDatabase()
  try {
    await db.delete()
  } catch (error) {
    throw mapDatabaseError(error)
  } finally {
    database = null
    dropVaultKeys()
  }
  emitVaultEvent({ type: 'cleared' })
}
