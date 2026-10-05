/**
 * 导入上限（docs/PRD.md 5.1、12.3 A02）。
 *
 * 上限只有一个目的：**不冻结界面**、不把浏览器拖进 OOM，而不是表达业务规模。
 * 超限一律「拒绝并说明」，**不做静默截断**——截断会让统计悄悄少数据，比直接报错更危险。
 * 数值是保守的工程判断（浏览器端本地分析场景），记录在 docs/DECISIONS.md（D-020）。
 */

export const IMPORT_LIMITS = {
  /** 单个文件字节数上限（本地 File 读取，不涉及上传） */
  maxFileBytes: 20 * 1024 * 1024,
  /** 粘贴文本字符数上限（按 UTF-16 码元计） */
  maxPasteChars: 2_000_000,
  /** 数据行数上限（含空行） */
  maxRows: 50_000,
  /** 列数上限 */
  maxColumns: 512,
  /** 单元格总数上限（行 × 列） */
  maxCells: 2_000_000,
} as const

export type ImportLimitKind = 'fileBytes' | 'pasteChars' | 'rows' | 'columns' | 'cells'

/** 超限说明：只包含上限与实际值，**不含**任何单元格内容 */
export type LimitViolation = {
  readonly kind: ImportLimitKind
  /** 上限值（字节 / 字符 / 行 / 列 / 单元格） */
  readonly limit: number
  readonly actual: number
  readonly message: string
}

export type LimitCheck = { readonly ok: true } | { readonly ok: false; readonly violation: LimitViolation }

const PASSES: LimitCheck = { ok: true }

/** 字节数格式化为中文可读（本地实现，不引入依赖） */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function checkFileSize(bytes: number): LimitCheck {
  if (bytes > IMPORT_LIMITS.maxFileBytes) {
    return {
      ok: false,
      violation: {
        kind: 'fileBytes',
        limit: IMPORT_LIMITS.maxFileBytes,
        actual: bytes,
        message: `文件为 ${formatByteSize(bytes)}，超过本机解析上限 ${formatByteSize(
          IMPORT_LIMITS.maxFileBytes,
        )}；请先拆分文件后重试`,
      },
    }
  }
  return PASSES
}

export function checkPasteLength(text: string): LimitCheck {
  if (text.length > IMPORT_LIMITS.maxPasteChars) {
    return {
      ok: false,
      violation: {
        kind: 'pasteChars',
        limit: IMPORT_LIMITS.maxPasteChars,
        actual: text.length,
        message: `粘贴内容为 ${text.length} 个字符，超过上限 ${IMPORT_LIMITS.maxPasteChars}；请分批粘贴`,
      },
    }
  }
  return PASSES
}

/** 行 / 列 / 单元格三重检查；`columns` 为已出现的最大列数 */
export function checkGridSize(rows: number, columns: number): LimitCheck {
  if (rows > IMPORT_LIMITS.maxRows) {
    return {
      ok: false,
      violation: {
        kind: 'rows',
        limit: IMPORT_LIMITS.maxRows,
        actual: rows,
        message: `数据行数超过上限 ${IMPORT_LIMITS.maxRows} 行；请先拆分文件后重试`,
      },
    }
  }
  if (columns > IMPORT_LIMITS.maxColumns) {
    return {
      ok: false,
      violation: {
        kind: 'columns',
        limit: IMPORT_LIMITS.maxColumns,
        actual: columns,
        message: `列数超过上限 ${IMPORT_LIMITS.maxColumns} 列；请先删除无关列后重试`,
      },
    }
  }
  const cells = rows * columns
  if (cells > IMPORT_LIMITS.maxCells) {
    return {
      ok: false,
      violation: {
        kind: 'cells',
        limit: IMPORT_LIMITS.maxCells,
        actual: cells,
        message: `单元格总数超过上限 ${IMPORT_LIMITS.maxCells}；请先拆分或裁剪文件后重试`,
      },
    }
  }
  return PASSES
}
