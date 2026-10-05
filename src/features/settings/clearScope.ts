/**
 * 清除数据的**分层范围模型**（步骤12，纯函数 + 纯常量，不依赖 React / Dexie / DOM）。
 *
 * 为什么要有这一层：步骤6 已经实现了三个清除动作，但它们各自的「删哪些层、留哪些层」
 * 原本散落在 `VaultManagerPanel.tsx` 的正文里——那是文案，不是可核对的结构。
 * PRD 10.5 要求清除必须**以明确确认列出影响**，而影响清单必须能被单测逐层钉住，
 * 因此这里把「层」变成数据：每一层给出删除项、保留项、是否不可撤销、以及它需要哪句确认短语。
 *
 * 两条硬规则（写进模型，不靠界面自觉）：
 * 1. **不声称能删掉已下载的文件**：`canDeleteDownloadedFiles` 恒为 false，且每个动作都必须
 *    在 `doesNotDelete` 里把这条说清楚。报告与备份一旦落盘就是普通文件，浏览器里的代码没有权限回收；
 * 2. **不碰同源其他应用**：`touchesOtherSameOriginApps` 恒为 false。删除的是本站自己那个
 *    IndexedDB 数据库，不是「清空站点数据」，更不是清空浏览器。
 *
 * 这里的层与动作**严格对应** `storage/vaultFacade.ts` + `storage/vault.ts` 的实际行为：
 * `clearObjects()` = 清空全部业务对象（`db.objects.clear()`，不动 secrets 与 meta）、
 * `deleteSecret('ai-api-key')` = 删除单个秘密槽位、
 * `clearAll()` = 删除整个 IndexedDB 数据库（`removeVaultDatabase()`）。
 * 不新增第四个动作：范围要靠说清，不靠多加按钮。
 */

import type { VaultStatus } from '../../storage'
import {
  CLEAR_OBJECTS_PHRASE,
  CLEAR_VAULT_PHRASE,
  DELETE_SECRET_PHRASE,
  describeSecretSlot,
} from './vaultText'

/** 清除动作的稳定标识；界面用它触发对应的门面方法（不传函数，避免把行为塞进数据模型） */
export type ClearActionId = 'clear-objects' | 'delete-ai-key' | 'clear-vault'

export type ClearLayer = {
  readonly id: ClearActionId
  /** 与界面标题逐字一致（同一条动作不允许出现两种叫法） */
  readonly label: string
  /** 破坏性且不可撤销：模型里恒为 true，界面据此使用危险配色 */
  readonly irreversible: boolean
  /** 本动作会删除的层（逐层列出，不用「全部数据」这种模糊说法） */
  readonly removes: readonly string[]
  /** 本动作明确**不**删除、仍会保留的层（与 `removes` 同等重要） */
  readonly keeps: readonly string[]
  /** 需要逐字输入的确认短语（与 `vaultText.ts` 的常量为同一份值） */
  readonly phrase: string
  /** 本动作做不到的事（两条全局「做不到」之外的补充） */
  readonly doesNotDelete: readonly string[]
}

/** 两条全局「做不到」：所有清除动作共用同一份文字（与隐私页共用常量，两处说法永远一致） */
export const CLEAR_GLOBAL_LIMITS: readonly string[] = [
  '清除不会、也无法删除你已经下载到本机的文件：导出的报告、导出的备份、以及你为核对数据另存的其他文件都不受影响。要删掉它们，只能自己在本机文件管理器里删除。',
  '清除只删除本站自己那个 IndexedDB 数据库及其内容，不会碰同一来源下其他应用或页面的数据，也不会清空整个浏览器的站点数据。',
]

/** 未读取到仓状态（首屏、读取失败）时的占位：一律显示「未知」，不用 0 或空串冒充 */
const UNKNOWN = '未知'

/**
 * 构造清除范围清单。
 *
 * 为什么按「数据库名 / 对象条数」参数化而不是写死：这两个值来自 `encryptedVault.status()`，
 * 写死会在库名或数据量变化后与界面事实脱节；参数化后展示的永远是当前仓的真实构成。
 * 对象**种类**不在这里展开：种类枚举由 `vaultMeta` 固定，展开成清单会让用户以为每种都存在，
 * 而这里能如实给出的只有条数。
 */
export function buildClearLayers(
  status: Pick<VaultStatus, 'databaseName' | 'objectCount'> | null,
): readonly ClearLayer[] {
  const databaseName = status === null ? UNKNOWN : status.databaseName
  const objectCount = status === null ? UNKNOWN : String(status.objectCount)

  return [
    {
      id: 'clear-objects',
      label: '1. 清空业务数据',
      irreversible: true,
      removes: [
        `本地仓 objects 表里的全部业务对象（当前 ${objectCount} 条）：数据集、清洗设置、映射模板、偏好、AI 历史与分析缓存`,
        '这些对象在 IndexedDB 中对应的全部密文行（含按对象种类建立的非敏感索引）',
      ],
      keeps: [
        '本地仓密码与解密密钥派生参数（salt / 迭代次数）：仓仍然可以解锁，不用重建',
        'AI Key 所在的秘密槽位（secrets 表）：有独立生命周期，不会被顺手删掉',
        '其他已打开的标签页：它们的界面不会立刻变空，而是在下一次读写时才发现业务数据已清空',
      ],
      phrase: CLEAR_OBJECTS_PHRASE,
      doesNotDelete: [
        '不会缩小数据库文件本身，也不会重置存储配额统计',
        '不会删除你已经下载到本机的报告或备份文件：那些文件不在浏览器存储里，代码没有权限回收它们',
      ],
    },
    {
      id: 'delete-ai-key',
      label: '2. 删除 AI Key',
      irreversible: true,
      removes: [
        `秘密槽位 ${describeSecretSlot('ai-api-key')} 的密文行（secrets 表）`,
        '该 Key 的可用性：删除后需要重新填写才能使用 AI 功能',
      ],
      keeps: [
        '全部业务对象（数据集、清洗设置、映射模板、AI 历史）不受影响',
        '本地仓密码与仓元数据不变，仓继续可用',
      ],
      phrase: DELETE_SECRET_PHRASE,
      doesNotDelete: [
        '不会删除 AI 历史里已有的记录（那是业务对象，属于动作 1）',
        '不会删除你已经下载到本机的报告或备份文件',
      ],
    },
    {
      id: 'clear-vault',
      label: '3. 清空整个本地仓（忘记密码时的自救路径）',
      irreversible: true,
      removes: [
        `整个 IndexedDB 数据库「${databaseName}」：元数据（密码派生参数与校验串）、全部业务对象与全部秘密槽位`,
        '内存中的解密密钥与解锁会话：立即回到「未创建本地仓」状态',
        '其他标签页的读写能力：它们在下次读写时会发现仓已不存在（数据库被删除）',
      ],
      keeps: [
        '已经下载到本机的报告与备份文件（见下面的「做不到」）',
        '同一来源下其他应用或页面的数据（各自的数据库互不相干）',
        '浏览器里与本站无关的缓存、Cookie 与站点设置',
      ],
      phrase: CLEAR_VAULT_PHRASE,
      doesNotDelete: [
        '无法删除你已经下载到本机的报告或备份文件：它们由你控制，只能自己在本机删除',
        '无法代替操作系统级的擦除：已经写入磁盘的密文所在空间由浏览器与文件系统回收，代码无法保证物理级覆写',
      ],
    },
  ]
}

/** 本模型覆盖的清除动作 id（界面与测试据此核对「动作数没有被悄悄改掉」） */
export const CLEAR_ACTION_IDS: readonly ClearActionId[] = buildClearLayers(null).map(
  (layer) => layer.id,
)

/**
 * 秘密槽位是否参与某个清除动作。动作 2 只处理秘密槽位，动作 1 只处理业务对象，动作 3 两者都清。
 * 抽成函数是为了让「删除 AI Key 不会顺手删数据集、清空业务数据也不会顺手删 Key」这条
 * 双向往来的约束能被测试直接断言，而不是只写在文案里。
 */
export function clearActionTouchesSecret(id: ClearActionId): boolean {
  return id !== 'clear-objects'
}

/** 该动作是否会牵入业务对象（`objects` 表） */
export function clearActionTouchesObjects(id: ClearActionId): boolean {
  return id !== 'delete-ai-key'
}

/**
 * 找到某条动作对应的门面方法名（`encryptedVault` 上的键）。
 * 为什么返回方法名而不是函数：模型保持可序列化、可快照，界面负责调用门面——
 * 组件不得绕过 `encryptedVault` 去碰 IndexedDB（AGENTS.md §4）。
 */
export function clearActionFacadeMethod(
  id: ClearActionId,
): 'clearObjects' | 'deleteSecret' | 'clearAll' {
  switch (id) {
    case 'clear-objects':
      return 'clearObjects'
    case 'delete-ai-key':
      return 'deleteSecret'
    case 'clear-vault':
      return 'clearAll'
  }
}
