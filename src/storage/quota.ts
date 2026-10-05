/**
 * 存储配额与持久化申请（步骤6，纯工具，不依赖 Dexie）。
 *
 * 为什么需要它：加密仓的数据量会随导入与 AI 历史增长，而浏览器可能随时回收存储。
 * 因此界面要能如实回答两件事：**用了多少 / 能有多少**、**是否已申请持久化**。
 * 注意：申请持久化只是降低被回收的概率，不是保证，所以文案里**不能**承诺「绝不会丢」。
 *
 * 全部读取都做了降级：环境没有 `navigator.storage`（Node 测试、隐私模式）时返回
 * `supported: false` 与一组 `null`，界面按「未知」展示，而不是显示 0（0 会误导成「没占用」）。
 */

export type StorageEstimate = {
  readonly supported: boolean
  readonly usageBytes: number | null
  readonly quotaBytes: number | null
  readonly persisted: boolean | null
  /** 已用 / 配额；任一侧未知时为 null，界面不应把它当 0 */
  readonly usageRatio: number | null
}

const UNSUPPORTED: StorageEstimate = {
  supported: false,
  usageBytes: null,
  quotaBytes: null,
  persisted: null,
  usageRatio: null,
}

function storageManager(): StorageManager | null {
  if (typeof navigator === 'undefined') {
    return null
  }
  const storage: StorageManager | undefined = navigator.storage
  return storage ?? null
}

async function readPersisted(storage: StorageManager): Promise<boolean | null> {
  if (typeof storage.persisted !== 'function') {
    return null
  }
  try {
    return await storage.persisted()
  } catch {
    return null
  }
}

export async function readStorageEstimate(): Promise<StorageEstimate> {
  const storage = storageManager()
  if (storage === null) {
    return UNSUPPORTED
  }
  try {
    const estimate = await storage.estimate()
    const usage = typeof estimate.usage === 'number' ? estimate.usage : null
    const quota = typeof estimate.quota === 'number' && estimate.quota > 0 ? estimate.quota : null
    return {
      supported: true,
      usageBytes: usage,
      quotaBytes: quota,
      persisted: await readPersisted(storage),
      usageRatio: usage !== null && quota !== null ? Math.min(1, usage / quota) : null,
    }
  } catch {
    return UNSUPPORTED
  }
}

/** 申请持久化存储；无论浏览器是否同意都返回最新状态（失败**不**抛错，不阻断任何流程） */
export async function requestPersistentStorage(): Promise<StorageEstimate> {
  const storage = storageManager()
  if (storage !== null && typeof storage.persist === 'function') {
    try {
      await storage.persist()
    } catch {
      // 浏览器可能直接拒绝（例如无用户手势、策略限制）：按最新状态如实展示即可
    }
  }
  return readStorageEstimate()
}

/** 字节数的可读展示（界面辅助，不属于业务口径） */
export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return '未知'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  const shown = unitIndex === 0 || value >= 10 ? Math.round(value) : Number(value.toFixed(1))
  return `${shown} ${units[unitIndex]}`
}
