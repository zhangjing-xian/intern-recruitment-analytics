/**
 * 解析任务的消息契约与任务错误类型（docs/PRD.md 10.4、15.x）。
 *
 * 约定：
 * - 每条消息都带任务 ID；调用方按任务 ID 丢弃过时结果（取消后到达的结果一律忽略）；
 * - 失败响应只带**问题码 + 可读说明 + 行号 / 上限这类非敏感细节**，绝不带整行数据；
 * - Worker 与主线程只通过 `postMessage` 通信，不使用 `fetch` / `importScripts` / 任何网络。
 */

import type { DataQualityIssue, DataQualityIssueCode, RawSheet } from '../domain'
import type { Delimiter, TextEncoding, TextPreview } from './text'
import type { XlsxSheetInfo } from './xlsx'

export const IMPORT_PHASES = ['读取文件', '解析表格', '生成原始行'] as const
export type ImportPhase = (typeof IMPORT_PHASES)[number]

/** 任务 ID：由调用方生成，Worker 只回填 */
export type ImportTaskId = string

let taskCounter = 0

export function createImportTaskId(prefix = 'import'): ImportTaskId {
  taskCounter += 1
  return `${prefix}-${Date.now().toString(36)}-${taskCounter.toString(36)}`
}

/** 文件来源：浏览器里是真 `File`；测试与 Node 环境用同样形状的对象 */
export type ImportFileLike = {
  readonly name: string
  readonly type: string
  readonly size: number
  arrayBuffer(): Promise<ArrayBuffer>
}

export type ImportSourcePayload =
  | { readonly kind: 'file'; readonly file: ImportFileLike }
  | { readonly kind: 'paste'; readonly text: string }

/* ------------------------------------------------------------------ 检查结果 */

export type DelimitedInspection = {
  readonly kind: 'delimited'
  readonly encoding: TextEncoding
  readonly encodingSource: 'bom' | 'utf8-valid' | 'fallback' | 'user' | 'paste'
  readonly hasBom: boolean
  readonly replacementCount: number
  readonly encodingHint: string | null
  readonly delimiter: Delimiter
  readonly delimiterSource: 'auto' | 'user' | 'fallback'
  readonly delimiterCounts: Readonly<Record<Delimiter, number>>
  readonly linebreak: string | null
  readonly rowCount: number
  readonly columnCount: number
  readonly emptyRowCount: number
  readonly droppedTrailingBlankRow: boolean
  readonly preview: TextPreview
  readonly issues: readonly DataQualityIssue[]
}

export type XlsxInspection = {
  readonly kind: 'xlsx'
  readonly sheets: readonly XlsxSheetInfo[]
  readonly date1904: boolean
  /** 首张非空工作表的前几行（仅用于选择工作表与表头行） */
  readonly previewSheetName: string | null
  readonly previewRows: readonly (readonly string[])[]
  readonly issues: readonly DataQualityIssue[]
}

export type ImportInspection = DelimitedInspection | XlsxInspection

/* ------------------------------------------------------------------ 请求 */

export type ParsePayload = {
  readonly source: ImportSourcePayload
  /** XLSX 工作表名；缺省取第一张非空表 */
  readonly sheetName?: string
  /** 表头所在物理行号（1 起），默认第一行 */
  readonly headerRowNumber?: number
  /** CSV / 粘贴：编码；缺省按 BOM 与 UTF-8 合法性判断 */
  readonly encoding?: TextEncoding
  /** CSV / 粘贴：分隔符；缺省自动识别，无法识别时按来源给默认值 */
  readonly delimiter?: Delimiter | 'auto'
  /** 是否排除隐藏行；默认 false（隐藏行包含在内，只提示） */
  readonly excludeHiddenRows?: boolean
}

export type InspectRequest = {
  readonly type: 'inspect'
  readonly taskId: ImportTaskId
  readonly payload: ImportSourcePayload
}

export type ParseRequest = {
  readonly type: 'parse'
  readonly taskId: ImportTaskId
  readonly payload: ParsePayload
}

export type CancelRequest = {
  readonly type: 'cancel'
  readonly taskId: ImportTaskId
}

export type ImportRequest = InspectRequest | ParseRequest | CancelRequest

/* ------------------------------------------------------------------ 响应 */

export type ImportProgress = {
  readonly type: 'progress'
  readonly taskId: ImportTaskId
  readonly phase: ImportPhase
  /** 0–1 的粗略比例（只用于进度展示，不代表结果完整度） */
  readonly ratio: number
}

export type ImportResponse =
  | ImportProgress
  | { readonly type: 'inspect-done'; readonly taskId: ImportTaskId; readonly result: ImportInspection }
  | { readonly type: 'parse-done'; readonly taskId: ImportTaskId; readonly result: RawSheet }
  | { readonly type: 'cancelled'; readonly taskId: ImportTaskId }
  | {
      readonly type: 'failed'
      readonly taskId: ImportTaskId
      readonly code: DataQualityIssueCode | 'UNKNOWN'
      readonly message: string
      /** 非敏感细节（行号、上限值等），可为 null */
      readonly detail: string | null
    }

/* ------------------------------------------------------------------ 任务上下文与错误 */

export type ImportTaskContext = {
  readonly taskId: ImportTaskId
  readonly report: (phase: ImportPhase, ratio: number) => void
  readonly isCancelled: () => boolean
}

/** 解析失败：只带问题码与可读说明，绝不带整行数据 */
export class ImportTaskError extends Error {
  readonly code: DataQualityIssueCode | 'UNKNOWN'
  readonly detail: string | null

  constructor(code: DataQualityIssueCode | 'UNKNOWN', message: string, detail: string | null = null) {
    super(message)
    this.name = 'ImportTaskError'
    this.code = code
    this.detail = detail
  }
}

/** 用户主动取消：不是错误，调用方按「什么都没发生」处理（已有数据不变） */
export class ImportTaskCancelled extends Error {
  readonly taskId: ImportTaskId

  constructor(taskId: ImportTaskId) {
    super('解析已取消')
    this.name = 'ImportTaskCancelled'
    this.taskId = taskId
  }
}

export function isImportTaskCancelled(error: unknown): error is ImportTaskCancelled {
  return error instanceof ImportTaskCancelled
}

export function isImportTaskError(error: unknown): error is ImportTaskError {
  return error instanceof ImportTaskError
}
