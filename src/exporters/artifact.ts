/**
 * 导出格式契约（步骤11，docs/PRD.md 11.2 / 11.4）。
 *
 * 为什么契约单独一层：四种格式（XLSX / Markdown / 打印 HTML / PNG）必须给出**同一套**
 * 结果形状，界面才能用一段代码处理成功 / 失败 / 预览行数，也不会出现「某种格式导出失败但界面
 * 以为成功」。文件名规则同时放这里，因为它是「不含敏感信息」这条要求的唯一落点
 * （PRD 10.6：tooltip、图注、**文件名**、PDF 元信息、导出日志同样不包含敏感字段）。
 *
 * 本层是纯函数：不依赖 React / 网络 / 存储；XLSX 与 ECharts 都只经**动态 import** 进入。
 */

import type { SanitizedReport } from '../privacy'

export type ExportFormat = 'xlsx' | 'png' | 'pdf' | 'markdown'

/**
 * 一次导出的产物。
 *
 * `bytes` 与 `text` 至多有一个非空：
 * - XLSX / PNG 是二进制 → `bytes`；
 * - Markdown / 打印 HTML 是文本 → `text`。
 * 两种都给 `previewLines`：界面必须能先给用户看「这份文件里到底有哪些行」，
 * 而不是让用户先下载再判断（PRD 11.2「导出前均提供预览」）。
 */
export type ExportArtifact = {
  readonly format: ExportFormat
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array | null
  readonly text: string | null
  readonly previewLines: readonly string[]
}

export type ExportResult =
  | { readonly ok: true; readonly artifact: ExportArtifact }
  | { readonly ok: false; readonly error: string }

/** 各格式的扩展名与 MIME 类型（唯一来源，避免界面与导出各自写一份） */
export const EXPORT_FORMAT_INFO: Readonly<
  Record<
    ExportFormat,
    { readonly extension: string; readonly mimeType: string; readonly label: string }
  >
> = {
  xlsx: {
    extension: 'xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel（.xlsx）',
  },
  png: { extension: 'png', mimeType: 'image/png', label: '图片（.png）' },
  pdf: { extension: 'pdf', mimeType: 'text/html', label: '打印 / 另存为 PDF' },
  markdown: { extension: 'md', mimeType: 'text/markdown', label: 'Markdown（.md）' },
}

/** 文件名里绝不允许出现的字符：路径分隔符、通配符、引号（会造成路径穿越或写盘异常） */
const UNSAFE_FILE_NAME_PATTERN = /[\\/:*?"<>|]/g

/**
 * 去掉控制字符（0x00–0x1F）。
 *
 * 为什么用逐字符判断而不是把它们写进正则：正则里的控制字符转义在 lint 规则看来是「匹配控制字符」
 * 的可疑写法，而这里本来就是有意要删掉它们。逐字符判断既表达了意图，也不需要任何规则豁免
 * （AGENTS.md 要求 0 warning，且不允许加 lint-disable）。
 */
function stripControlChars(text: string): string {
  let result = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) {
      result += char
    }
  }
  return result
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 从报告的「数据截至日」取 `YYYYMMDD`；取不到就退回生成时间，再取不到就用「无日期」。
 *
 * 为什么用**数据截至日**而不是当前时间做默认：同一份数据在不同时间导出应当得到同一个文件名，
 * 否则「同一筛选、同一数据版本」会产出看起来不同的文件（PRD 11.2 要求三种格式同口径）。
 */
function dateTokenOf(report: SanitizedReport, at?: Date): string {
  const source: string =
    typeof report.meta.dataAsOf === 'string' && report.meta.dataAsOf !== ''
      ? report.meta.dataAsOf
      : report.meta.generatedAt
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(source)
  if (matched !== null) {
    return `${matched[1]}${matched[2]}${matched[3]}`
  }
  if (at !== undefined && Number.isFinite(at.getTime())) {
    return `${String(at.getFullYear())}${pad2(at.getMonth() + 1)}${pad2(at.getDate())}`
  }
  return '无日期'
}

/**
 * 文件名 = 报告标题 + 数据截至日 + 扩展名，例如 `实习生招聘复盘报告-20260926.xlsx`。
 *
 * 硬规则（PRD 10.6 / 11.4）：**不得**包含数据集名、源文件名、HR 姓名、城市或任何分组取值。
 * 因此这里只允许标题（来自脱敏规则，由代码决定）、日期与扩展名三样东西拼起来——
 * 没有任何一处可以插入数据里的字符串。
 */
export function reportFileName(
  report: SanitizedReport,
  format: ExportFormat,
  at?: Date,
): string {
  const info = EXPORT_FORMAT_INFO[format]
  // 标题里可能有括号（例如「（严格脱敏）」）与全角字符：只清掉真正会破坏文件名的字符，
  // 不做拼音化或截断，避免出现用户认不出来的文件名。
  const title = stripControlChars(report.meta.title.replace(UNSAFE_FILE_NAME_PATTERN, '')).trim()
  const safeTitle = title === '' ? '实习生招聘复盘报告' : title
  return `${safeTitle}-${dateTokenOf(report, at)}.${info.extension}`
}

/**
 * 文件名是否不含敏感 token。
 *
 * 界面在下载前调用它：文件名是唯一会「离开报告模型」的字符串之一，必须也能被同一套检查覆盖。
 * 传入的 token 一般是数据集名、源文件名、HR 姓名等**本机已知**的敏感值。
 */
export function fileNameIsSafe(
  fileName: string,
  sensitiveTokens: readonly string[] = [],
): boolean {
  const tokens = sensitiveTokens.map((token) => token.trim()).filter((token) => token !== '')
  return !tokens.some((token) => fileName.includes(token))
}

/** 构造成功结果（统一 previewLines 截断到 20 行，避免把整份报表塞进界面状态） */
export function artifactOf(input: {
  readonly format: ExportFormat
  readonly fileName: string
  readonly bytes?: Uint8Array | null
  readonly text?: string | null
  readonly previewLines: readonly string[]
}): ExportResult {
  return {
    ok: true,
    artifact: {
      format: input.format,
      fileName: input.fileName,
      mimeType: EXPORT_FORMAT_INFO[input.format].mimeType,
      bytes: input.bytes ?? null,
      text: input.text ?? null,
      previewLines: input.previewLines.slice(0, 20),
    },
  }
}

/**
 * 失败结果：错误文案必须是**固定说明 + 本地异常的安全摘要**。
 *
 * 为什么不直接回显 `error.message`：SheetJS / 浏览器抛出的异常里可能带文件路径、工作表名
 * 甚至单元格内容（都是敏感信息）。这里只保留错误类型与一段与业务无关的短文本。
 */
export function exportFailure(action: string, error: unknown): ExportResult {
  const kind = error instanceof Error ? error.name : typeof error
  return {
    ok: false,
    error: `${action}失败（${kind}）。没有生成任何文件，也没有发起任何网络请求。`,
  }
}
