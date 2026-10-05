/**
 * 文本清洗（docs/PRD.md 5.1、12.3 A02/A03）：
 * - 只做**写法归一**（去首尾空白、压连续空白、去零宽字符、NFKC、空白 / `-` / `N/A` 视为缺失）；
 * - 不做任何业务猜测：不拆「替补/替换」、不把小写 boss 之外的渠道自动归类、不模糊匹配学校；
 * - 需求 ID 等标识列一律按**文本**保留，绝不按数字或日期解析（前导 0 不失真）。
 */

import {
  isNullToken,
  normalizeCellText,
  normalizeHeader,
  type DataQualityIssueCode,
  type RawCellValue,
  type SchoolAliasRule,
  type ValueSource,
} from '../domain'

export type TextCellResolution = {
  readonly value: string | null
  /** 与原文相比是否发生了变化（用于「单元格映射可撤销」的回溯展示） */
  readonly changed: boolean
  readonly rule: string
  readonly issueCodes: readonly DataQualityIssueCode[]
}

/**
 * 清洗文本单元格。`preserveLeadingZeros` 用于需求 ID：数字单元格只能按原样字符串保留，
 * 无法恢复解析阶段就已丢失的前导 0（因此解析/清洗都不再把 ID 转成数字）。
 */
export function cleanTextCell(
  raw: RawCellValue,
  options: { readonly preserveLeadingZeros?: boolean } = {},
): TextCellResolution {
  if (raw === null) {
    return { value: null, changed: false, rule: 'text.missing', issueCodes: [] }
  }
  if (typeof raw === 'boolean') {
    return {
      value: raw ? 'true' : 'false',
      changed: true,
      rule: 'text.boolean',
      issueCodes: ['UNKNOWN_ENUM_VALUE'],
    }
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return { value: null, changed: true, rule: 'text.invalidNumber', issueCodes: ['INVALID_SALARY'] }
    }
    return {
      value: String(raw),
      changed: true,
      rule: options.preserveLeadingZeros === true ? 'text.numericId' : 'text.numeric',
      issueCodes: [],
    }
  }

  const value = normalizeCellText(raw)
  const changed = value !== raw
  if (value === '' || isNullToken(value)) {
    return { value: null, changed, rule: 'text.nullToken', issueCodes: [] }
  }
  return { value, changed, rule: 'text.trimmed', issueCodes: [] }
}

export type SchoolNameResolution = {
  readonly school: string | null
  readonly rule: string
  readonly source: ValueSource
  /** 命中别名规则时必须由用户确认后才算结论 */
  readonly requiresConfirmation: boolean
  readonly issueCodes: readonly DataQualityIssueCode[]
}

/**
 * 学校名归一：只应用用户显式配置的**等价别名**（如「上交」→「上海交通大学」）。
 * 大小写与全半角差异由 `normalizeHeader` 消化；**不**做包含 / 模糊匹配，
 * 避免把“语义不相同的学校合并”（docs/PRD.md 5.1）。
 */
export function resolveSchoolName(
  raw: RawCellValue,
  aliases: readonly SchoolAliasRule[],
): SchoolNameResolution {
  const cleaned = cleanTextCell(raw)
  if (cleaned.value === null) {
    return {
      school: null,
      rule: 'school.missing',
      source: 'raw',
      requiresConfirmation: false,
      issueCodes: [],
    }
  }
  const key = normalizeHeader(cleaned.value)
  const rule = aliases.find((candidate) => normalizeHeader(candidate.alias) === key)
  if (rule === undefined) {
    return {
      school: cleaned.value,
      rule: 'school.raw',
      source: 'raw',
      requiresConfirmation: false,
      issueCodes: [],
    }
  }
  return {
    school: normalizeCellText(rule.canonical),
    rule: 'school.alias',
    source: 'aliasTable',
    requiresConfirmation: true,
    issueCodes: [],
  }
}
