/**
 * 文本解码、分隔符识别与物理行号换算（CSV / TSV / 粘贴，docs/PRD.md 5.1）。
 *
 * 只做三件事，且都不改数据语义：
 * 1. 按编码把字节解码成文本（BOM 只去掉标记本身）；
 * 2. 在带引号的文本中识别分隔符（引号内的分隔符不算）；
 * 3. 把解析游标换算成源文件的**物理行号**（字段内含换行时行号也不会错位）。
 *
 * 不做 trim、不改写单元格内容、不做类型转换——那些属于清洗（步骤5）。
 */

export const TEXT_ENCODINGS = ['utf-8', 'gb18030', 'utf-16le', 'big5'] as const
export type TextEncoding = (typeof TEXT_ENCODINGS)[number]

export const DEFAULT_ENCODING: TextEncoding = 'utf-8'

/** 编码的中文说明，界面直接使用（不引入 i18n 依赖） */
export const TEXT_ENCODING_LABELS: Readonly<Record<TextEncoding, string>> = {
  'utf-8': 'UTF-8（推荐，带 BOM 也能识别）',
  gb18030: 'GB18030 / GBK（Windows 中文 CSV 常见）',
  'utf-16le': 'UTF-16 LE（部分导出工具）',
  big5: 'Big5（繁体中文）',
}

export const DELIMITERS = ['\t', ',', ';', '|'] as const
export type Delimiter = (typeof DELIMITERS)[number]

export const DELIMITER_LABELS: Readonly<Record<Delimiter, string>> = {
  '\t': '制表符（TSV，从 Excel 直接粘贴）',
  ',': '逗号（CSV）',
  ';': '分号',
  '|': '竖线',
}

/** 分隔符并列时按此顺序取先者（与 PapaParse 的猜测顺序一致，便于解释） */
export const DELIMITER_PRIORITY: readonly Delimiter[] = DELIMITERS

const BYTE_ORDER_MARK = '\uFEFF'
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const
const UTF16LE_BOM = [0xff, 0xfe] as const
const UTF16BE_BOM = [0xfe, 0xff] as const

function startsWithBytes(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false
  }
  return prefix.every((byte, index) => bytes[index] === byte)
}

export function stripBom(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
}

export type EncodingDetection = {
  readonly encoding: TextEncoding
  /** 判断依据：BOM > UTF-8 合法性 > 回退默认值 */
  readonly source: 'bom' | 'utf8-valid' | 'fallback'
  readonly hasBom: boolean
  /** 面向用户的说明，例如「不是合法 UTF-8，已按 GB18030 预览」 */
  readonly hint: string | null
}

/**
 * 猜测文本编码：默认 UTF-8，允许用户在选择区改成 GB18030 等（docs/PRD.md 5.1）。
 * 只给建议，不替用户改数据。
 */
export function detectEncoding(bytes: Uint8Array): EncodingDetection {
  if (startsWithBytes(bytes, UTF8_BOM)) {
    return { encoding: 'utf-8', source: 'bom', hasBom: true, hint: null }
  }
  if (startsWithBytes(bytes, UTF16LE_BOM)) {
    return { encoding: 'utf-16le', source: 'bom', hasBom: true, hint: null }
  }
  if (startsWithBytes(bytes, UTF16BE_BOM)) {
    return {
      encoding: 'utf-16le',
      source: 'bom',
      hasBom: true,
      hint: '检测到 UTF-16 BE 的 BOM；本工具按 UTF-16 LE 解码，若出现乱码请在编码选择处改为实际编码',
    }
  }

  const hasNonAscii = bytes.some((byte) => byte > 0x7f)
  if (!hasNonAscii) {
    return { encoding: 'utf-8', source: 'utf8-valid', hasBom: false, hint: null }
  }

  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { encoding: 'utf-8', source: 'utf8-valid', hasBom: false, hint: null }
  } catch {
    return {
      encoding: 'gb18030',
      source: 'fallback',
      hasBom: false,
      hint: '文件不是合法 UTF-8，已按 GB18030 预览；若中文显示异常，请在选择区更换编码后重新预览',
    }
  }
}

export type DecodeResult =
  | {
      readonly ok: true
      readonly text: string
      readonly encoding: TextEncoding
      readonly hasBom: boolean
      /** 解码产生的替换字符个数（>0 说明编码可能选错） */
      readonly replacementCount: number
    }
  | { readonly ok: false; readonly message: string }

/**
 * 按指定编码解码。失败时返回可读说明，**不返回**任何原文片段，
 * 避免把敏感内容带进错误提示与日志。
 */
export function decodeText(bytes: Uint8Array, encoding: TextEncoding): DecodeResult {
  let decoder: TextDecoder
  try {
    decoder = new TextDecoder(encoding)
  } catch {
    return { ok: false, message: `当前浏览器不支持所选编码「${encoding}」，请改用 UTF-8 或 GB18030` }
  }

  let text: string
  try {
    text = decoder.decode(bytes)
  } catch {
    return { ok: false, message: `按「${encoding}」解码失败，请更换编码后重试` }
  }

  const hasBom =
    startsWithBytes(bytes, UTF8_BOM) ||
    startsWithBytes(bytes, UTF16LE_BOM) ||
    startsWithBytes(bytes, UTF16BE_BOM)
  const withoutBom = stripBom(text)
  let replacementCount = 0
  for (const char of withoutBom) {
    if (char === '\uFFFD') {
      replacementCount += 1
    }
  }

  return { ok: true, text: withoutBom, encoding, hasBom, replacementCount }
}

/* ------------------------------------------------------------------ 分隔符识别 */

export type DelimiterDetection = {
  /** 无法识别时为 null（单列文本），由调用方按来源给默认值 */
  readonly delimiter: Delimiter | null
  readonly counts: Readonly<Record<Delimiter, number>>
  /** 参与统计的字符数（首个换行前的采样长度） */
  readonly sampleLength: number
}

/**
 * 在**首个有内容的一行**内统计各候选分隔符出现次数（引号内的不计入），取出现最多的一个。
 * 只在首行统计，避免字段内换行 / 长文本把统计带偏；并列时按 `DELIMITER_PRIORITY` 取先者。
 */
export function detectDelimiter(text: string, sampleChars = 4096): DelimiterDetection {
  const counts: Record<Delimiter, number> = { '\t': 0, ',': 0, ';': 0, '|': 0 }
  let inQuotes = false
  let sampleLength = 0

  const limit = Math.min(text.length, sampleChars)
  for (let index = 0; index < limit; index += 1) {
    const char = text[index]
    if (char === '"') {
      inQuotes = !inQuotes
      sampleLength = index + 1
      continue
    }
    if (char === '\n' || char === '\r') {
      if (!inQuotes && sampleLength > 0) {
        break
      }
      continue
    }
    if (!inQuotes && char in counts) {
      counts[char as Delimiter] += 1
    }
    sampleLength = index + 1
  }

  let best: Delimiter | null = null
  for (const candidate of DELIMITER_PRIORITY) {
    if (counts[candidate] > 0 && (best === null || counts[candidate] > counts[best])) {
      best = candidate
    }
  }

  return { delimiter: best, counts, sampleLength }
}

/* ------------------------------------------------------------------ 物理行号 */

/**
 * 物理行号计数器：按解析游标累加换行符，正确处理 `\r\n` / `\n` / `\r`
 * 以及**字段内换行**（引号里的换行也占一行，Excel 里看到的行号才不会错位）。
 */
export class LineCounter {
  private readonly text: string
  private index = 0
  private lineBreakCount = 0
  private pendingCarriageReturn = false

  constructor(text: string) {
    this.text = text
  }

  /** 移动到 `cursor` 之后，返回该位置所在物理行号（1 起）；游标只增不减 */
  lineNumberAt(cursor: number): number {
    const target = Math.max(this.index, Math.min(cursor, this.text.length))
    while (this.index < target) {
      const code = this.text.charCodeAt(this.index)
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false
        if (code === 10) {
          this.index += 1
          continue
        }
      }
      if (code === 13) {
        this.lineBreakCount += 1
        this.pendingCarriageReturn = true
      } else if (code === 10) {
        this.lineBreakCount += 1
      }
      this.index += 1
    }
    return this.lineBreakCount + 1
  }
}

/* ------------------------------------------------------------------ 原文预览 */

/** 统计文本里的换行次数（用于进度估算；与 LineCounter 的口径一致） */
export function countLineBreaks(text: string): number {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code === 10) {
      count += 1
    } else if (code === 13) {
      count += 1
      if (text.charCodeAt(index + 1) === 10) {
        index += 1
      }
    }
  }
  return count
}

export type TextPreview = {
  /** 前若干行原文（未解析、未 trim），仅供用户核对编码与分隔符 */
  readonly lines: readonly string[]
  readonly truncatedLines: boolean
  readonly truncatedChars: boolean
}

/**
 * 生成原文预览：只取前若干行、每行截断到固定字符数。
 * 预览仅在本机界面显示，不写日志、不导出、不进入 AI 摘要。
 */
export function buildTextPreview(text: string, maxLines = 8, maxLineChars = 160): TextPreview {
  const rawLines = text.split(/\r\n|\n|\r/)
  const truncatedLines = rawLines.length > maxLines
  let truncatedChars = false
  const lines = rawLines.slice(0, maxLines).map((line) => {
    if (line.length <= maxLineChars) {
      return line
    }
    truncatedChars = true
    return `${line.slice(0, maxLineChars)}…`
  })
  return { lines, truncatedLines, truncatedChars }
}
