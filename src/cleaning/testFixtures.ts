/**
 * 清洗层测试夹具（与 `src/importers/testFixtures.ts` 同风格）：
 * 只负责造出「契约化的 `RawSheet` + 已确认 `ImportMapping` + 默认 `CleaningSettings`」，
 * 不替测试做任何断言，也不替被测代码做取舍。
 *
 * 所有表头与默认设置都取自 domain 的单一来源（`STANDARD_FIELDS`、`createDefaultCleaningSettings`），
 * 测试里因此不必复制中文表头与枚举字面量（改字段时会随实现一起更新）。
 */

import {
  EMPTY_MAPPING_DECISIONS,
  STANDARD_FIELDS,
  applyMappingDecisions,
  buildImportMapping,
  suggestMapping,
  type CleaningSettings,
  type DataQualityIssue,
  type ExtensionFieldKey,
  type ImportMapping,
  type ImportSourceKind,
  type NormalizedDataset,
  type RawCellValue,
  type RawRow,
  type RawSheet,
  type SkippedSheetInfo,
  type StandardFieldKey,
} from '../domain'

import { cleanSheet, type CleanSheetInput } from './normalize'
import { createDefaultCleaningSettings } from './settings'

export const SHEET_NAME = '名单'
export const DATASET_ID = 'dataset-fixture'
export const BATCH_ID = 'batch-fixture'
export const DATASET_NAME = '夹具数据集'
export const IMPORTED_AT = '2026-05-08T09:30:00.000Z'
export const DATA_AS_OF = '2026-05-08'
export const CONFIRMED_AT = '2026-05-08T09:00:00.000Z'

const HEADER_BY_KEY = new Map<StandardFieldKey, string>(
  STANDARD_FIELDS.map((field): [StandardFieldKey, string] => [field.key, field.header]),
)

/** 21 个标准字段键（顺序即模板顺序） */
export const ALL_FIELD_KEYS: readonly StandardFieldKey[] = STANDARD_FIELDS.map((field) => field.key)

export function headerOf(key: StandardFieldKey): string {
  const header = HEADER_BY_KEY.get(key)
  if (header === undefined) {
    throw new Error(`未登记的标准字段：${key}`)
  }
  return header
}

/** 一行数据：按标准字段键给值；未给的列一律 null（缺失 ≠ 0，未知 ≠ 否） */
export type RowInput = Partial<Record<StandardFieldKey, RawCellValue>>

export type SheetFixtureOptions = {
  /** 源表含哪些标准列（默认全部 21 列）；缺 offer 状态列可用于验证阻断 */
  readonly fieldKeys?: readonly StandardFieldKey[]
  /** 数据行；`null` 表示完全空行（跳过但计数） */
  readonly rows: readonly (RowInput | null)[]
  /** 需要标记为隐藏行的数据行下标（0 起，对应 `rows`） */
  readonly hiddenRowIndexes?: readonly number[]
  readonly hiddenColumnIndexes?: readonly number[]
  readonly sheetHidden?: boolean
  readonly sourceKind?: ImportSourceKind
  readonly sourceFileName?: string | null
  readonly date1904?: boolean | null
  readonly encoding?: string | null
  readonly delimiter?: string | null
  /** 额外列（用于扩展列场景）：表头 + 按行序的取值 */
  readonly extraColumns?: readonly {
    readonly header: string
    readonly values: readonly RawCellValue[]
  }[]
  readonly skippedSheets?: readonly SkippedSheetInfo[]
  readonly issues?: readonly DataQualityIssue[]
  /** 表头物理行号（默认 1），数据行号顺延 */
  readonly headerSourceRow?: number
}

export function buildSheet(options: SheetFixtureOptions): RawSheet {
  const fieldKeys = options.fieldKeys ?? ALL_FIELD_KEYS
  const sourceKind = options.sourceKind ?? 'xlsx'
  const extraColumns = options.extraColumns ?? []
  const headers = [...fieldKeys.map(headerOf), ...extraColumns.map((column) => column.header)]
  const headerSourceRow = options.headerSourceRow ?? 1
  const firstSourceRow = headerSourceRow + 1
  const hiddenRowIndexes = options.hiddenRowIndexes ?? []
  const rows: RawRow[] = options.rows.map((row, index) => ({
    sourceKind,
    sourceSheet: SHEET_NAME,
    sourceRow: firstSourceRow + index,
    cells: [
      ...fieldKeys.map((key): RawCellValue => (row === null ? null : (row[key] ?? null))),
      ...extraColumns.map(
        (column): RawCellValue => (row === null ? null : (column.values[index] ?? null)),
      ),
    ],
    emptyRow: row === null,
    hidden: hiddenRowIndexes.includes(index),
    parseNotes: [],
  }))
  return {
    sourceKind,
    sourceSheet: SHEET_NAME,
    sourceFileName: options.sourceFileName ?? null,
    header: {
      sourceKind,
      sourceSheet: SHEET_NAME,
      sourceRow: headerSourceRow,
      headers,
      hidden: false,
    },
    rows,
    physicalRowCount: firstSourceRow + rows.length,
    columnCount: headers.length,
    emptyRowCount: rows.filter((row) => row.emptyRow).length,
    hiddenRowCount: rows.filter((row) => row.hidden).length,
    hiddenColumnIndexes: options.hiddenColumnIndexes ?? [],
    sheetHidden: options.sheetHidden ?? false,
    formulaWithoutCacheCount: 0,
    skippedSheets: options.skippedSheets ?? [],
    issues: options.issues ?? [],
    date1904: options.date1904 ?? (sourceKind === 'xlsx' ? false : null),
    encoding: options.encoding ?? null,
    delimiter: options.delimiter ?? null,
  }
}

/* ------------------------------------------------------------------ 映射与设置 */

/**
 * 走真实映射流程（`suggestMapping` → `applyMappingDecisions` → `buildImportMapping`）造出
 * 已确认的 `ImportMapping`：测试里不手写 `ImportMappingEntry`，避免与映射实现脱节。
 * 注意 `buildImportMapping` 只写契约、不做取舍，因此这里不会「替用户确认」缺列。
 */
export function buildConfirmedMapping(
  sheet: RawSheet,
  input: {
    readonly confirmedAt?: string
    readonly acknowledgedPartialImport?: boolean
  } = {},
): ImportMapping {
  const plan = suggestMapping(sheet.header.headers)
  const state = applyMappingDecisions(plan, {
    ...EMPTY_MAPPING_DECISIONS,
    acknowledgedPartialImport: input.acknowledgedPartialImport ?? false,
  })
  return buildImportMapping({
    state,
    templateName: null,
    confirmedAt: input.confirmedAt ?? CONFIRMED_AT,
  })
}

/** 把某一列改判为扩展列（模拟用户在映射页的下拉里亲自选择，属于 `manual` 级别） */
export function mappingWithExtension(
  sheet: RawSheet,
  input: { readonly columnIndex: number; readonly extension: ExtensionFieldKey },
): ImportMapping {
  const plan = suggestMapping(sheet.header.headers)
  const state = applyMappingDecisions(plan, {
    ...EMPTY_MAPPING_DECISIONS,
    overrides: {
      [input.columnIndex]: { targetField: null, targetExtension: input.extension },
    },
    acknowledgedPartialImport: true,
  })
  return buildImportMapping({ state, templateName: null, confirmedAt: CONFIRMED_AT })
}

/** 默认设置 = 最保守的起点；测试只覆盖关心的那一项 */
export function buildSettings(overrides: Partial<CleaningSettings> = {}): CleaningSettings {
  return { ...createDefaultCleaningSettings({ dataAsOf: DATA_AS_OF }), ...overrides }
}

/* ------------------------------------------------------------------ 清洗入口 */

export type CleaningFixtureOptions = SheetFixtureOptions & {
  readonly settings?: Partial<CleaningSettings>
  /** 传入 `false` 可得到「映射尚未确认」的映射，用于验证阻断 */
  readonly mappingConfirmed?: boolean
  readonly acknowledgePartialImport?: boolean
  /** 需要自定义映射（如把某列改判为扩展列）时覆盖默认的「全部精确匹配并确认」 */
  readonly mappingFor?: (sheet: RawSheet) => ImportMapping
}

export type CleaningParts = {
  readonly sheet: RawSheet
  readonly mapping: ImportMapping
  readonly settings: CleaningSettings
}

export type CleaningFixture = CleaningParts & {
  readonly input: CleanSheetInput
  readonly dataset: NormalizedDataset
}

/** 记录 ID 用确定性实现，避免随机 UUID 让断言不稳定 */
function createDeterministicRecordIds(): () => string {
  let counter = 0
  return () => {
    counter += 1
    return `rec-fixture-${String(counter).padStart(3, '0')}`
  }
}

export function buildCleaningInput(options: CleaningFixtureOptions): CleaningParts {
  const sheet = buildSheet(options)
  const mapping =
    options.mappingFor?.(sheet) ??
    buildConfirmedMapping(sheet, { acknowledgedPartialImport: options.acknowledgePartialImport })
  return {
    sheet,
    mapping: options.mappingConfirmed === false ? { ...mapping, confirmedAt: null } : mapping,
    settings: buildSettings(options.settings),
  }
}

/** 用给定零件直接清洗（测试要自己构造非法映射时用这个） */
export function cleanWith(parts: CleaningParts): NormalizedDataset {
  return cleanSheet({
    sheet: parts.sheet,
    mapping: parts.mapping,
    settings: parts.settings,
    datasetId: DATASET_ID,
    batchId: BATCH_ID,
    datasetName: DATASET_NAME,
    importedAt: IMPORTED_AT,
    createRecordId: createDeterministicRecordIds(),
  })
}

/** 一把梭：造表 → 确认映射 → 默认设置 → 清洗 */
export function cleanFixture(options: CleaningFixtureOptions): CleaningFixture {
  const parts = buildCleaningInput(options)
  return {
    ...parts,
    input: {
      sheet: parts.sheet,
      mapping: parts.mapping,
      settings: parts.settings,
      datasetId: DATASET_ID,
      batchId: BATCH_ID,
      datasetName: DATASET_NAME,
      importedAt: IMPORTED_AT,
      createRecordId: createDeterministicRecordIds(),
    },
    dataset: cleanWith(parts),
  }
}

