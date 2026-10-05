/**
 * 21 列标准模板元数据与生成（docs/PRD.md 4.1 / 12.3 A07「导出模板可导入」）。
 *
 * 边界：本文件只生成**纯文本**模板（制表符分隔），不引入 xlsx 依赖（二进制模板由步骤3 负责）。
 * 模板列顺序严格等于 `STANDARD_FIELDS` 顺序，模板版本来自 `TEMPLATE_VERSION`。
 */

import { STANDARD_FIELDS, type StandardFieldKey, type StandardFieldKind } from './fields'
import { TEMPLATE_VERSION } from './version'

/** 制表符分隔：粘贴进 Excel 会自动分列，无需 xlsx 依赖 */
export const TEMPLATE_SEPARATOR = '\t'
/** 使用 CRLF 行尾，Excel / 记事本粘贴时不会串行 */
export const TEMPLATE_LINE_ENDING = '\r\n'
export const TEMPLATE_FILE_STEM = '实习生招聘分析_标准模板'
export const TEMPLATE_FILE_EXTENSION = '.txt'
export const TEMPLATE_FILE_NAME = `${TEMPLATE_FILE_STEM}_v${TEMPLATE_VERSION}${TEMPLATE_FILE_EXTENSION}`

/** 模板列说明（供下载页与「模板字段说明」表格使用） */
export type TemplateColumn = {
  /** 从 1 开始的列序号，与 PRD 4.1 表格顺序一致 */
  readonly order: number
  readonly key: StandardFieldKey
  readonly header: string
  readonly kind: StandardFieldKind
  readonly sensitive: boolean
  readonly missingHandling: string
}

export const TEMPLATE_COLUMNS: readonly TemplateColumn[] = STANDARD_FIELDS.map((field, index) => ({
  order: index + 1,
  key: field.key,
  header: field.header,
  kind: field.kind,
  sensitive: field.sensitive,
  missingHandling: field.missingHandling,
}))

/**
 * 合成示例行（**不是**真实数据，仅为说明填法；姓名等均为明显的占位文字）。
 * 顺序与 `TEMPLATE_COLUMNS` 一一对应，共 21 列。
 */
export const TEMPLATE_SAMPLE_ROW: readonly string[] = [
  'REQ-0001',
  'HR样例',
  '上海',
  '示例事业部',
  '数据分析实习生',
  '数据',
  '新增招聘',
  '2026-05-08',
  '2026-08-03',
  '2026-12-06',
  '候选人样例',
  '2027',
  '本科',
  '样例大学',
  '否',
  '内推',
  'Boss',
  '4000',
  '无（本地院校）',
  '待入职',
  '',
]

/** 表头行文本（21 列，顺序固定） */
export function buildTemplateHeaderLine(): string {
  return TEMPLATE_COLUMNS.map((column) => column.header).join(TEMPLATE_SEPARATOR)
}

/** 生成表头模板文本；`withSample` 为 true 时追加一行合成示例 */
export function buildTemplateText(withSample = false): string {
  const lines = [buildTemplateHeaderLine()]
  if (withSample) {
    lines.push(TEMPLATE_SAMPLE_ROW.join(TEMPLATE_SEPARATOR))
  }
  return `${lines.join(TEMPLATE_LINE_ENDING)}${TEMPLATE_LINE_ENDING}`
}

/* ------------------------------------------------------------------ 模板校验 */

export type TemplateCheckResult = {
  /** 表头是否与标准模板完全一致（含顺序） */
  readonly ok: boolean
  /** 缺少的标准表头（按标准顺序） */
  readonly missingHeaders: readonly string[]
  /** 标准模板中没有的额外表头（按出现顺序） */
  readonly unexpectedHeaders: readonly string[]
  /** 表头集合齐全但顺序不同 */
  readonly misordered: boolean
}

/**
 * 校验第一行是否就是标准模板：顺序不一致只提示（导入仍是合法的，映射阶段会处理），
 * 「缺少 offer 状态列」才是阻断条件（由 `REQUIRED_STANDARD_FIELDS` 决定）。
 */
export function checkStandardHeaderRow(headers: readonly string[]): TemplateCheckResult {
  const standardHeaders = TEMPLATE_COLUMNS.map((column) => column.header)
  const missingHeaders = standardHeaders.filter((header) => !headers.includes(header))
  const unexpectedHeaders = headers.filter((header) => !standardHeaders.includes(header))
  const orderedHeaders = headers.filter((header) => standardHeaders.includes(header))
  return {
    ok: missingHeaders.length === 0 && unexpectedHeaders.length === 0 &&
      orderedHeaders.every((header, index) => header === standardHeaders[index]),
    missingHeaders,
    unexpectedHeaders,
    misordered: orderedHeaders.some((header, index) => header !== standardHeaders[index]),
  }
}