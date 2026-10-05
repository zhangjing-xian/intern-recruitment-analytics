/**
 * 输入类型识别（扩展名 + MIME + 首字节特征）。
 *
 * 只决定「用哪个解析器」，不解释任何内容；无法识别时返回不支持（阻断导入），
 * 不做「猜成 CSV 强行解析」这种会把文件内容错位当数据的事。
 */

import type { Delimiter } from './text'

export const WORKBOOK_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.xlsb'] as const
export const TEXT_EXTENSIONS = ['.csv', '.tsv', '.txt'] as const

export type DetectedInput =
  | { readonly kind: 'workbook'; readonly reason: string }
  | { readonly kind: 'delimited'; readonly reason: string; readonly defaultDelimiter: Delimiter }
  | { readonly kind: 'unsupported'; readonly reason: string }

export type DetectInputOptions = {
  readonly fileName: string | null
  readonly mimeType: string | null
  /** 文件开头若干字节（用于 ZIP / OLE 容器判断），可为 null */
  readonly firstBytes?: Uint8Array | null
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04] as const
const OLE_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0] as const

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  if (bytes.length < prefix.length) {
    return false
  }
  return prefix.every((byte, index) => bytes[index] === byte)
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

/** 按扩展名给出文本类文件的默认分隔符（识别失败时使用） */
function defaultDelimiterFor(extension: string): Delimiter {
  return extension === '.tsv' || extension === '.txt' ? '\t' : ','
}

export function detectInputKind(options: DetectInputOptions): DetectedInput {
  const bytes = options.firstBytes ?? null
  if (bytes !== null && startsWith(bytes, ZIP_SIGNATURE)) {
    return { kind: 'workbook', reason: '文件是 ZIP 容器（xlsx / xlsm / xlsb）' }
  }
  if (bytes !== null && startsWith(bytes, OLE_SIGNATURE)) {
    return { kind: 'workbook', reason: '文件是 OLE 容器（xls）' }
  }

  const fileName = options.fileName ?? ''
  const extension = extensionOf(fileName)
  if ((WORKBOOK_EXTENSIONS as readonly string[]).includes(extension)) {
    return { kind: 'workbook', reason: `按扩展名 ${extension} 判定为 Excel 工作簿` }
  }
  if ((TEXT_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      kind: 'delimited',
      reason: `按扩展名 ${extension} 判定为分隔文本`,
      defaultDelimiter: defaultDelimiterFor(extension),
    }
  }

  const mimeType = (options.mimeType ?? '').toLowerCase()
  if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel') || mimeType.includes('officedocument')) {
    return { kind: 'workbook', reason: '按 MIME 类型判定为 Excel 工作簿' }
  }
  if (mimeType.includes('csv') || mimeType.includes('tab-separated')) {
    return {
      kind: 'delimited',
      reason: '按 MIME 类型判定为分隔文本',
      defaultDelimiter: mimeType.includes('tab-separated') ? '\t' : ',',
    }
  }

  return {
    kind: 'unsupported',
    reason: '仅支持 Excel（.xlsx / .xls / .xlsm / .xlsb）与 CSV / TSV（.csv / .tsv / .txt）；请在 Excel 中另存为这些格式后重试',
  }
}
