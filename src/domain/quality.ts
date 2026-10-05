/**
 * 数据质量分级、问题代码与受影响模块（docs/PRD.md 5.5 / 12.3 A02/A06）。
 *
 * 分级只决定「怎么处理」，不决定「是否保留记录」：
 * - `阻断`：停止导入，不破坏原有数据；
 * - `字段错误`：保留记录，只把受影响的指标排除在样本之外；
 * - `警告`：保留并提示，由用户在清洗预览中决定是否修正。
 *
 * 问题只记录**单个单元格**的原值（`rawValue`），禁止把整行或多列敏感数据写进日志、报告和 AI 摘要。
 */

export const DATA_QUALITY_SEVERITIES = ['阻断', '字段错误', '警告'] as const
export type DataQualitySeverity = (typeof DATA_QUALITY_SEVERITIES)[number]

export const DATA_QUALITY_ISSUE_CODES = [
  'PARSE_FAILED',
  'UNSUPPORTED_FILE_TYPE',
  'ENCODING_FAILED',
  'EMPTY_DATASET',
  'MISSING_OFFER_STATUS_COLUMN',
  'FIELD_CONFLICT',
  'LIMIT_EXCEEDED',
  'INVALID_DATE',
  'NEGATIVE_CYCLE',
  'INVALID_SALARY',
  'VALUE_RANGE_UNCERTAIN',
  'HOUSING_VALUE_UNCERTAIN',
  'DATE_NOT_CONVERTED',
  'FORMULA_WITHOUT_CACHE',
  'QUOTE_MISMATCH',
  'UNKNOWN_ENUM_VALUE',
  'MISSING_REQUIRED_VALUE',
  'CYCLE_TOO_LONG',
  'EXACT_DUPLICATE',
  'SUSPECTED_DUPLICATE',
  'HEADER_ECHO_CELL',
  'PLANNED_DATE_UNCERTAIN',
  'SALARY_UNIT_UNCONFIRMED',
  'GPT_SOURCE_CONFLICT',
  // 渠道与推荐人（用户需求 ②，2026-09-27）：一条是「补出来了」，一条是「不一致所以没动」
  'CHANNEL_INFERRED_FROM_REFERRER',
  'CHANNEL_REFERRER_CONFLICT',
  // 人工修正（用户需求 ①，2026-09-27）：这一格的值是用户手动改的，不是规则算出来的
  'MANUAL_CORRECTION_APPLIED',
  'EMPTY_SHEET_SKIPPED',
  'EMPTY_ROW_SKIPPED',
] as const
export type DataQualityIssueCode = (typeof DATA_QUALITY_ISSUE_CODES)[number]

export const ISSUE_SEVERITY: Readonly<Record<DataQualityIssueCode, DataQualitySeverity>> = {
  PARSE_FAILED: '阻断',
  UNSUPPORTED_FILE_TYPE: '阻断',
  ENCODING_FAILED: '阻断',
  EMPTY_DATASET: '阻断',
  MISSING_OFFER_STATUS_COLUMN: '阻断',
  FIELD_CONFLICT: '阻断',
  LIMIT_EXCEEDED: '阻断',
  INVALID_DATE: '字段错误',
  NEGATIVE_CYCLE: '字段错误',
  INVALID_SALARY: '字段错误',
  VALUE_RANGE_UNCERTAIN: '警告',
  HOUSING_VALUE_UNCERTAIN: '警告',
  DATE_NOT_CONVERTED: '警告',
  FORMULA_WITHOUT_CACHE: '警告',
  QUOTE_MISMATCH: '警告',
  UNKNOWN_ENUM_VALUE: '警告',
  MISSING_REQUIRED_VALUE: '警告',
  CYCLE_TOO_LONG: '警告',
  EXACT_DUPLICATE: '警告',
  SUSPECTED_DUPLICATE: '警告',
  HEADER_ECHO_CELL: '警告',
  PLANNED_DATE_UNCERTAIN: '警告',
  SALARY_UNIT_UNCONFIRMED: '警告',
  GPT_SOURCE_CONFLICT: '警告',
  // 两条都是「保留并提示」：一条说明该值是按规则补出来的，一条说明两列不一致、值保持原样。
  // 它们**不禁用任何模块**——渠道取值本身仍然可用，只是需要人工核对。
  CHANNEL_INFERRED_FROM_REFERRER: '警告',
  CHANNEL_REFERRER_CONFLICT: '警告',
  // 人工修正也是「保留并提示」：值是可用的，但读报告的人必须知道这一格是人改过的。
  // 它**不禁用任何模块**（用户确认过的修正不该反过来把整块分析关掉）。
  MANUAL_CORRECTION_APPLIED: '警告',
  EMPTY_SHEET_SKIPPED: '警告',
  EMPTY_ROW_SKIPPED: '警告',
}

/** 面向用户的中文短标题（质量页与导出报告使用同一份文案） */
export const ISSUE_TITLES: Readonly<Record<DataQualityIssueCode, string>> = {
  PARSE_FAILED: '文件无法解析',
  UNSUPPORTED_FILE_TYPE: '不支持的文件类型',
  ENCODING_FAILED: '文本编码无法解码',
  EMPTY_DATASET: '没有可用的数据行',
  MISSING_OFFER_STATUS_COLUMN: '缺少 offer 状态映射',
  FIELD_CONFLICT: '多个源列指向同一目标字段',
  LIMIT_EXCEEDED: '超出文件 / 行数 / 单元格限制',
  INVALID_DATE: '日期非法',
  NEGATIVE_CYCLE: '周期为负（入职早于启动或离职早于入职）',
  INVALID_SALARY: '薪资非法（负数、无穷或无法解析）',
  VALUE_RANGE_UNCERTAIN: '出现区间值，需用户确认（不取中点）',
  HOUSING_VALUE_UNCERTAIN: '房补为实物（住宿）或原文同时含金额，未折算为现金',
  DATE_NOT_CONVERTED: '日期未转换',
  FORMULA_WITHOUT_CACHE: '公式没有缓存结果',
  QUOTE_MISMATCH: '该行引号不配对，字段可能错位',
  UNKNOWN_ENUM_VALUE: '未识别的枚举值（已保留原值）',
  MISSING_REQUIRED_VALUE: '必填字段缺失',
  CYCLE_TOO_LONG: '招聘周期超长，需核实',
  EXACT_DUPLICATE: '完全重复记录',
  SUSPECTED_DUPLICATE: '疑似重复记录',
  HEADER_ECHO_CELL: '单元格为表头文本残留',
  PLANNED_DATE_UNCERTAIN: '计划日期语义待确认',
  SALARY_UNIT_UNCONFIRMED: '薪资币种 / 计薪周期未确认',
  GPT_SOURCE_CONFLICT: 'GPT 名单与原值冲突',
  CHANNEL_INFERRED_FROM_REFERRER: '渠道按推荐人补为内推（来源：推断，可撤销）',
  CHANNEL_REFERRER_CONFLICT: '渠道与推荐人不一致，请核对（渠道值未被改动）',
  MANUAL_CORRECTION_APPLIED: '这一格是人工修改的（报告中会注明处数）',
  EMPTY_SHEET_SKIPPED: '空工作表已跳过',
  EMPTY_ROW_SKIPPED: '空行已跳过',
}

/** 分析模块，用于「部分分析导入」时说明哪些模块被禁用（docs/PRD.md 4.1） */
export const ANALYSIS_MODULES = [
  '核心率',
  '审批中占比',
  '招聘周期',
  '薪资对比',
  '房补对比',
  '拒offer原因',
  '城市对比',
  '渠道对比',
  'HR效能',
  '画像分析',
  '需求分析',
] as const
export type AnalysisModule = (typeof ANALYSIS_MODULES)[number]

/** 某类问题会导致哪些模块不可用；未列出的问题不影响模块可用性 */
export const ISSUE_DISABLED_MODULES: Readonly<
  Partial<Record<DataQualityIssueCode, readonly AnalysisModule[]>>
> = {
  MISSING_OFFER_STATUS_COLUMN: ANALYSIS_MODULES,
  SALARY_UNIT_UNCONFIRMED: ['薪资对比', '房补对比'],
  INVALID_SALARY: ['薪资对比'],
  VALUE_RANGE_UNCERTAIN: ['薪资对比'],
  UNKNOWN_ENUM_VALUE: ['房补对比', '渠道对比'],
}

export type DataQualityIssue = {
  readonly code: DataQualityIssueCode
  readonly severity: DataQualitySeverity
  /** 面向用户的中文说明，使用 ISSUE_TITLES 并补充具体值 */
  readonly message: string
  readonly field: string | null
  readonly sourceSheet: string | null
  /** 源文件物理行号（1 起），用于把问题定位回原始行 */
  readonly sourceRow: number | null
  /** 触发问题的单个单元格原值（禁止整行拼接） */
  readonly rawValue: string | null
  /** 用户是否已确认该问题（确认后仍保留在质量报告中） */
  readonly confirmed: boolean
}

export type QualityIssueInput = {
  readonly code: DataQualityIssueCode
  readonly message?: string
  readonly field?: string | null
  readonly sourceSheet?: string | null
  readonly sourceRow?: number | null
  readonly rawValue?: string | null
  readonly confirmed?: boolean
}

/** 严重度由代码唯一决定，避免调用方各自判断导致口径不一致 */
export function createQualityIssue(input: QualityIssueInput): DataQualityIssue {
  return {
    code: input.code,
    severity: ISSUE_SEVERITY[input.code],
    message: input.message ?? ISSUE_TITLES[input.code],
    field: input.field ?? null,
    sourceSheet: input.sourceSheet ?? null,
    sourceRow: input.sourceRow ?? null,
    rawValue: input.rawValue ?? null,
    confirmed: input.confirmed ?? false,
  }
}

export function isBlockingIssue(issue: DataQualityIssue): boolean {
  return issue.severity === '阻断'
}

/** 是否存在阻断级问题（存在则不得进入分析链路） */
export function hasBlockingIssue(issues: readonly DataQualityIssue[]): boolean {
  return issues.some(isBlockingIssue)
}

export function summarizeIssues(
  issues: readonly DataQualityIssue[],
): Readonly<Record<DataQualitySeverity, number>> {
  const summary: Record<DataQualitySeverity, number> = { 阻断: 0, 字段错误: 0, 警告: 0 }
  for (const issue of issues) {
    summary[issue.severity] += 1
  }
  return summary
}

/** 汇总被禁用模块（去重、保持 ANALYSIS_MODULES 的固定顺序，便于界面与报告稳定展示） */
export function disabledModulesFor(issues: readonly DataQualityIssue[]): readonly AnalysisModule[] {
  const disabled = new Set<AnalysisModule>()
  for (const issue of issues) {
    const modules = ISSUE_DISABLED_MODULES[issue.code]
    if (modules !== undefined) {
      for (const module of modules) {
        disabled.add(module)
      }
    }
  }
  return ANALYSIS_MODULES.filter((module) => disabled.has(module))
}
