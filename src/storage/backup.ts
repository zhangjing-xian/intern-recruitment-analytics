/**
 * 加密备份：导出 / 解析 / 恢复（步骤6 只提供**接口与口径**，界面接入在步骤12）。
 *
 * 口径（docs/PRD.md 10.5）：
 * - 备份文件本身**没有明文业务数据**，但文件名、创建时间、schema 版本等非敏感元信息是明文，
 *   用于解密前就能提示「这份备份是什么时候、什么版本、能不能导入」；
 * - 普通备份**不含** AI Key 等秘密槽位：`includesSecrets` 恒为 `false`，恢复后必须重新填写 Key；
 * - 备份用**独立的 KDF 参数与独立 salt**（备份密码可与本地仓密码不同），
 *   AAD 绑定备份自身的随机 ID 与固定版本号，所以被替换、拼接、截断都会解密失败；
 * - 恢复前先整份校验结构（含未知对象种类、缺少 ID、缺少内容），任何一条不合法就**整份拒绝**，
 *   不做部分导入；`merge` 模式遇到 ID 冲突会换新 ID，绝不覆盖已有对象；
 * - 导出仍受 **「导出先脱敏」** 约束：这里导出的是对象级工作区备份，
 *   报告 / 明细的脱敏确认在步骤11–12 的导出流程里完成，本模块不放宽这条规则。
 */

import {
  assertAcceptablePassword,
  createKdfParams,
  deriveVaultKeys,
  openJson,
  parseEncryptedEnvelope,
  parseKdfParams,
  randomId,
  sealJson,
  type EncryptedEnvelope,
  type KdfParams,
} from '../crypto'
import { isSchemaCompatible, type RuleVersion } from '../domain'
import { openVaultDatabase, type VaultObjectRow } from './db'
import { runVaultOperation, vaultError } from './errors'
import { requireActiveVault, vaultObjectPurpose } from './vault'
import { isRuleVersion, isVaultObjectKind, type VaultObjectKind } from './vaultMeta'

export const BACKUP_FILE_KIND = 'intern-recruitment-encrypted-backup'
export const BACKUP_FORMAT_VERSION = 1
/** 备份信封的固定版本号：备份不参与改密版本推进，所以恒为 1 */
const BACKUP_REVISION = 1
const BACKUP_PURPOSE = 'backup'

export const BACKUP_NOTICE =
  '加密工作区备份：仅含导出的对象与配置，不含 AI Key；导入需要备份密码。'

export type EncryptedBackupFile = {
  readonly kind: string
  readonly formatVersion: number
  readonly createdAt: string
  /** 备份自身的随机标识（非敏感），也是信封 AAD 的一部分 */
  readonly vaultId: string
  readonly schemaVersion: string
  readonly ruleVersion: RuleVersion
  readonly kdf: KdfParams
  readonly envelope: EncryptedEnvelope
  readonly includesSecrets: false
  readonly notice: string
}

export type BackupObjectRecord = {
  readonly id: string
  readonly kind: string
  readonly payload: unknown
}

export type BackupContent = {
  readonly objects: readonly BackupObjectRecord[]
}

export type BackupCreateResult = {
  readonly fileName: string
  readonly file: EncryptedBackupFile
  readonly text: string
  readonly objectCount: number
}

export type BackupRestoreMode = 'merge' | 'replace'

export type BackupRestoreResult = {
  readonly mode: BackupRestoreMode
  readonly restoredCount: number
  readonly schemaVersion: string
}

export type BackupParseResult =
  | { readonly ok: true; readonly file: EncryptedBackupFile }
  | { readonly ok: false; readonly reason: string }

/** 文件名只含导出时间：不含数据集名、不含姓名等任何业务信息 */
export function backupFileName(createdAt: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp =
    `${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}` +
    `-${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}`
  return `intern-recruitment-backup-${stamp}.json`
}

/**
 * 导出加密备份（需要解锁）。
 * `kinds` 可选：只备份指定对象种类；不传则备份全部业务对象。
 * 秘密槽位从不参与备份（`includesSecrets: false` 是常量断言，不是运行时开关）。
 */
export async function createEncryptedBackup(
  password: string,
  options: { readonly kdfIterations?: number; readonly kinds?: readonly VaultObjectKind[] } = {},
): Promise<BackupCreateResult> {
  return runVaultOperation(async () => {
    assertAcceptablePassword(password)
    const { meta, keys } = await requireActiveVault()
    const db = openVaultDatabase()
    const rows = await db.objects.toArray()
    const allowed = options.kinds === undefined ? null : new Set<string>(options.kinds)

    const objects: BackupObjectRecord[] = []
    for (const row of rows) {
      if (allowed !== null && !allowed.has(row.kind)) {
        continue
      }
      const payload = await openJson<unknown>(keys.keys.data, row.envelope, {
        vaultId: meta.vaultId,
        revision: row.revision,
        purpose: vaultObjectPurpose(row.kind, row.id),
      })
      objects.push({ id: row.id, kind: row.kind, payload })
    }

    // 独立 salt + 独立派生：即使备份密码与本地仓密码相同，两者密文也互不可用
    const kdf = createKdfParams(options.kdfIterations ?? meta.kdf.iterations)
    const backupId = randomId('backup')
    const backupKeys = await deriveVaultKeys(password, kdf)
    const envelope = await sealJson(
      backupKeys.dataKey,
      { objects } satisfies BackupContent,
      { vaultId: backupId, revision: BACKUP_REVISION, purpose: BACKUP_PURPOSE },
    )
    const createdAt = new Date()
    const file: EncryptedBackupFile = {
      kind: BACKUP_FILE_KIND,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: createdAt.toISOString(),
      vaultId: backupId,
      schemaVersion: meta.schemaVersion,
      ruleVersion: meta.ruleVersion,
      kdf,
      envelope,
      includesSecrets: false,
      notice: BACKUP_NOTICE,
    }
    return {
      fileName: backupFileName(createdAt),
      file,
      text: JSON.stringify(file, null, 2),
      objectCount: objects.length,
    }
  })
}

/** 只读解析备份文件的明文元信息（不解密）：界面据此在导入前给出提示或直接拒绝 */
export function parseEncryptedBackup(text: string): BackupParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, reason: '不是合法的 JSON 文件' }
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, reason: '备份内容不是对象' }
  }
  const record = raw as Record<string, unknown>
  if (record.kind !== BACKUP_FILE_KIND) {
    return { ok: false, reason: '不是本站导出的加密备份' }
  }
  if (record.formatVersion !== BACKUP_FORMAT_VERSION) {
    return { ok: false, reason: '备份格式版本不受支持，请用对应版本的应用导入' }
  }
  if (
    typeof record.createdAt !== 'string' ||
    typeof record.vaultId !== 'string' ||
    record.vaultId.length === 0 ||
    typeof record.schemaVersion !== 'string' ||
    !isRuleVersion(record.ruleVersion)
  ) {
    return { ok: false, reason: '备份元信息不完整' }
  }
  if (record.includesSecrets !== false) {
    return { ok: false, reason: '该备份声明包含秘密槽位，本版本拒绝导入（避免 AI Key 混入业务备份）' }
  }
  let kdf: KdfParams
  let envelope: EncryptedEnvelope
  try {
    kdf = parseKdfParams(record.kdf)
    envelope = parseEncryptedEnvelope(record.envelope)
  } catch {
    return { ok: false, reason: '备份的解密参数非法' }
  }
  return {
    ok: true,
    file: {
      kind: BACKUP_FILE_KIND,
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: record.createdAt,
      vaultId: record.vaultId,
      schemaVersion: record.schemaVersion,
      ruleVersion: record.ruleVersion,
      kdf,
      envelope,
      includesSecrets: false,
      notice: typeof record.notice === 'string' ? record.notice : BACKUP_NOTICE,
    },
  }
}

/**
 * 解密备份内容。
 * 密码错误、文件被改动、内容结构非法都归为同一个 `backup-password`
 * （「密码错」与「被篡改」不区分，避免给出可利用的反馈）。
 */
export async function decryptEncryptedBackup(
  file: EncryptedBackupFile,
  password: string,
): Promise<BackupContent> {
  try {
    const keys = await deriveVaultKeys(password, file.kdf)
    const content = await openJson<BackupContent>(keys.dataKey, file.envelope, {
      vaultId: file.vaultId,
      revision: BACKUP_REVISION,
      purpose: BACKUP_PURPOSE,
    })
    if (typeof content !== 'object' || content === null || !Array.isArray(content.objects)) {
      throw vaultError('backup-password')
    }
    return content
  } catch {
    throw vaultError('backup-password')
  }
}

/**
 * 恢复到当前（已解锁的）本地仓。
 * - `merge`（默认）：保留已有对象，ID 冲突时给导入项换新 ID；
 * - `replace`：先清空业务对象再导入（**不动**秘密槽位与仓元数据）。
 * 全过程在写入前完成校验与重加密，写入用一个事务；失败则库里保持原样。
 */
export async function restoreEncryptedBackup(
  text: string,
  password: string,
  options: { readonly mode?: BackupRestoreMode } = {},
): Promise<BackupRestoreResult> {
  const parsed = parseEncryptedBackup(text)
  if (!parsed.ok) {
    throw vaultError('invalid-backup', parsed.reason)
  }
  const file = parsed.file
  if (!isSchemaCompatible(file.schemaVersion)) {
    throw vaultError(
      'invalid-backup',
      `备份的数据结构版本 ${file.schemaVersion} 与当前应用不兼容，请用对应版本的应用导入`,
    )
  }
  const content = await decryptEncryptedBackup(file, password)

  // 结构校验必须全部在写入之前完成：绝不「导入一半再说」
  const records: { id: string; kind: VaultObjectKind; payload: unknown }[] = []
  for (const item of content.objects) {
    if (typeof item !== 'object' || item === null) {
      throw vaultError('invalid-backup', '备份中存在结构非法的条目')
    }
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw vaultError('invalid-backup', '备份中存在缺少 ID 的条目')
    }
    if (!isVaultObjectKind(record.kind)) {
      throw vaultError(
        'invalid-backup',
        `备份中存在当前版本不认识的对象种类：${String(record.kind)}`,
      )
    }
    if (!Object.hasOwn(record, 'payload')) {
      throw vaultError('invalid-backup', '备份中的条目缺少内容')
    }
    records.push({ id: record.id, kind: record.kind, payload: record.payload })
  }

  return runVaultOperation(async () => {
    const { meta, keys } = await requireActiveVault()
    const db = openVaultDatabase()
    const mode = options.mode ?? 'merge'

    const rows: VaultObjectRow[] = []
    for (const record of records) {
      let id = record.id
      if (mode === 'merge' && (await db.objects.get(id)) !== undefined) {
        id = randomId(record.kind)
      }
      rows.push({
        id,
        kind: record.kind,
        revision: meta.revision,
        envelope: await sealJson(keys.keys.data, record.payload, {
          vaultId: meta.vaultId,
          revision: meta.revision,
          purpose: vaultObjectPurpose(record.kind, id),
        }),
      })
    }

    await db.transaction('rw', db.objects, async () => {
      if (mode === 'replace') {
        await db.objects.clear()
      }
      if (rows.length > 0) {
        await db.objects.bulkPut(rows)
      }
    })
    return { mode, restoredCount: rows.length, schemaVersion: file.schemaVersion }
  })
}
