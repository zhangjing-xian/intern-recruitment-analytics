/**
 * 临时内存会话（docs/PRD.md 10.2「临时模式」）：解析结果、映射草稿、已确认映射、映射模板
 * 以及清洗设置草稿与已提交数据集的**唯一持有者**。
 *
 * 为什么需要它：步骤3 的解析结果是内存数据，跨页面（导入页 → 字段映射页 → 清洗页）传递既不能走 URL，
 * 也不能落明文盘（docs/PRD.md 4.3「返回导入页可保留临时映射但不得落明文盘」）。
 *
 * 硬约束：
 * - **只在内存**：不触碰 IndexedDB / localStorage / sessionStorage / Cache / Cookie，刷新或关闭页面即清除；
 * - 不打印、不写日志（无 `console`），也不把内容挂到 `window` 上；
 * - 每次变更都替换整份快照对象，调用方读到的都是不可变引用（React 可安全比较引用）；
 * - 错误密码、加密、配额与迁移都由步骤6 的加密仓负责；本模块不是持久层，也**不冒充**持久层。
 *
 * 生命周期：
 * - `setImportSheet(表)` = 新的解析结果，会清空旧的映射草稿与已确认映射（旧映射针对旧表，不得张冠李戴），
 *   并作废旧的清洗结论（结论必须与输入一一对应）；
 * - `clearImportSession()` = 放弃当前数据集（草稿与已确认映射一起清除），但**保留**映射模板与清洗设置草稿；
 * - 映射模板与清洗设置属于用户配置而非业务数据，只在内存中保留，加密持久化在步骤6 / 步骤12 接入。
 */

import type {
  CleaningSettings,
  ImportMapping,
  MappingDecisions,
  MappingTemplate,
  NormalizedDataset,
  RawSheet,
} from '../domain'

/** 映射草稿：只在签名与当前表头一致时复用，避免把 A 表的编辑套到 B 表上 */
export type MappingSessionDraft = {
  readonly headerSignature: string
  readonly decisions: MappingDecisions
}

export type ImportSessionSnapshot = {
  /** 当前解析结果（步骤3 的输出）；未导入时为 null */
  readonly sheet: RawSheet | null
  /** 映射页的编辑草稿（未确认前可随时改写） */
  readonly draft: MappingSessionDraft | null
  /** 用户已确认的字段映射；未确认时为 null（未确认不得进入清洗） */
  readonly confirmedMapping: ImportMapping | null
  /** 本机会话内的映射模板（不含任何样例数据） */
  readonly templates: readonly MappingTemplate[]
}

const EMPTY_SNAPSHOT: ImportSessionSnapshot = {
  sheet: null,
  draft: null,
  confirmedMapping: null,
  templates: [],
}

let session: ImportSessionSnapshot = EMPTY_SNAPSHOT

/**
 * 清洗会话（步骤5）：设置草稿 + 已提交数据集，同样**只在内存**。
 *
 * - 设置属于用户口径（分析截止日、去重策略、名单），换一份表也保留，避免每次重设；
 * - 已提交数据集属于结论，依赖当时的「已确认映射」，换表 / 放弃数据集时一起清除，
 *   避免把旧结论当成新数据的结论（结论与输入必须一一对应）。
 */
export type CleaningSessionSnapshot = {
  /** 清洗设置草稿；未进入清洗页时为 null（此时按默认设置创建） */
  readonly settings: CleaningSettings | null
  /** 用户已提交的规范化数据集（步骤5 输出，也是步骤6 持久化的输入） */
  readonly dataset: NormalizedDataset | null
}

const EMPTY_CLEANING_SNAPSHOT: CleaningSessionSnapshot = { settings: null, dataset: null }

let cleaning: CleaningSessionSnapshot = EMPTY_CLEANING_SNAPSHOT

/** 读取清洗会话（不可变引用） */
export function getCleaningSession(): CleaningSessionSnapshot {
  return cleaning
}

/** 保存清洗设置草稿（清洗页每次改设置后调用；改设置即重新计算，可撤销） */
export function saveCleaningSettingsDraft(settings: CleaningSettings): void {
  cleaning = { ...cleaning, settings, dataset: null }
}

/** 放弃清洗设置草稿（回到最保守默认值），同时作废已提交数据集 */
export function clearCleaningSettingsDraft(): void {
  cleaning = EMPTY_CLEANING_SNAPSHOT
}

/** 提交规范化数据集（用户确认质量报告与去重结果之后才调用） */
export function commitNormalizedDataset(dataset: NormalizedDataset): void {
  cleaning = { ...cleaning, dataset }
}

/** 作废已提交数据集（回到清洗预览，不改变设置草稿） */
export function clearCommittedDataset(): void {
  cleaning = { ...cleaning, dataset: null }
}

/** 读取当前快照（返回不可变引用，不做任何拷贝或序列化） */
export function getImportSession(): ImportSessionSnapshot {
  return session
}

/** 当前是否存在可映射的表 */
export function hasImportSheet(): boolean {
  return session.sheet !== null
}

/**
 * 写入新的解析结果（解析成功时调用）。
 * 传 null 等价于放弃当前数据集：草稿与已确认映射一并清除，映射模板保留。
 */
export function setImportSheet(sheet: RawSheet | null): void {
  // 换表 / 放弃数据集后，旧的清洗结论必然失效：一起作废（设置草稿属于用户口径，保留）
  cleaning = { ...cleaning, dataset: null }
  session = sheet === null ? { ...session, sheet: null, draft: null, confirmedMapping: null } : {
    ...session,
    sheet,
    draft: null,
    confirmedMapping: null,
  }
}

/** 保存映射草稿（映射页每次编辑后调用；没有表时忽略，避免悬空草稿） */
export function saveMappingDraft(draft: MappingSessionDraft): void {
  if (session.sheet === null) {
    return
  }
  session = { ...session, draft }
}

/** 放弃映射草稿（回到四级自动建议的结果） */
export function clearMappingDraft(): void {
  session = { ...session, draft: null }
}

/** 记录用户确认后的映射（步骤5 清洗的输入） */
export function confirmImportMapping(mapping: ImportMapping): void {
  session = { ...session, confirmedMapping: mapping }
}

/** 模板唯一键：名称 + 创建时间（同名模板按创建时间区分） */
export function mappingTemplateKey(template: MappingTemplate): string {
  return `${template.name}\u0000${template.createdAt}`
}

/** 保存映射模板（同名同时间视为同一份，直接覆盖，不做静默追加） */
export function saveMappingTemplate(template: MappingTemplate): void {
  const key = mappingTemplateKey(template)
  const others = session.templates.filter((item) => mappingTemplateKey(item) !== key)
  session = { ...session, templates: [...others, template] }
}

export function removeMappingTemplate(key: string): void {
  session = {
    ...session,
    templates: session.templates.filter((item) => mappingTemplateKey(item) !== key),
  }
}

/** 放弃当前数据集（草稿与已确认映射一起清除）；映射模板属于配置，保留 */
export function clearImportSession(): void {
  cleaning = { ...cleaning, dataset: null }
  session = { ...session, sheet: null, draft: null, confirmedMapping: null }
}
