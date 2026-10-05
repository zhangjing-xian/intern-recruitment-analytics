/**
 * 领域数据结构契约（字段口径见 docs/PRD.md 4.1 / 4.2，清洗细节见 5.x）。
 *
 * 三条不可退让的约定：
 * 1. 缺失一律用 `null`，**绝不**用 0 / 空字符串代替（薪资未知 ≠ 0 元，房补缺失 ≠ 无补贴）；
 * 2. 原始数据永不被覆盖：原值保留在 `values` / `*Raw` 字段，规范化结论另存并记录规则、来源与版本；
 * 3. 记录的身份是 `recordId`（本地随机 UUID），姓名与需求 ID 都不得作为唯一键（见 ./identity.ts）。
 */

import type {
  Channel,
  City,
  Currency,
  DedupStrategy,
  Education,
  HousingPeriod,
  HousingType,
  ImportMode,
  OfferStatus,
  ReferralType,
  RequirementType,
  SalaryUnit,
  SalaryUnitOption,
  TriState,
} from './enums'
import type {
  ColumnMatchLevel,
  ExtensionFieldKey,
  ExtensionFieldValues,
  StandardFieldKey,
} from './fields'
import type {
  AnalysisModule,
  DataQualityIssue,
  DataQualityIssueCode,
  DataQualitySeverity,
} from './quality'
import type { RuleVersion } from './version'

/** 日历日期字符串，固定 `YYYY-MM-DD`，不含时区（避免 UTC / 夏令时导致差一天） */
export type DateOnly = string

/** 输入来源类型：上传指浏览器读取本地 File，不创建任何网络上传 */
export type ImportSourceKind = 'xlsx' | 'csv' | 'tsv-paste'

/* ------------------------------------------------------------------ 原始数据 */

export type RawCellValue = string | number | boolean | null

/** 原始表头信息；表头行本身不作为数据行 */
export type RawHeaderRow = {
  readonly sourceKind: ImportSourceKind
  readonly sourceSheet: string
  /** 表头行在源文件中的物理行号（1 起） */
  readonly sourceRow: number
  /** 表头原文（保留 BOM / 空格，便于用户核对） */
  readonly headers: readonly string[]
  readonly hidden: boolean
}

/**
 * 原始行：只做「读取」，不做类型转换、不改枚举、不静默去重（docs/PRD.md 5.1）。
 * `cells` 与 `RawHeaderRow.headers` 同序，未映射前不假设任何语义。
 */
export type RawRow = {
  readonly sourceKind: ImportSourceKind
  readonly sourceSheet: string
  /** 源文件中的物理行号（1 起，含表头与空行），用于把问题定位回原始行 */
  readonly sourceRow: number
  readonly cells: readonly RawCellValue[]
  /** 是否为空行：跳过但计数，供质量页显示 */
  readonly emptyRow: boolean
  /** 是否来自隐藏行：**不默默排除**，由用户决定是否包含 */
  readonly hidden: boolean
  /** 读取阶段的提示（公式无缓存、表头文本残留、空表等） */
  readonly parseNotes: readonly DataQualityIssueCode[]
}

/* ------------------------------------------------------------------ 解析结果（步骤3 导入适配器的输出） */

/** 被跳过的空工作表（仅提示，不产生数据行；docs/PRD.md 5.1） */
export type SkippedSheetInfo = {
  readonly name: string
  readonly hidden: boolean
  readonly rowCount: number
  readonly columnCount: number
}

/**
 * 一次解析的完整结果：一个来源 + 一张工作表 / 一次粘贴。
 *
 * 这是字段映射（步骤4）的输入，只描述「读到了什么」：
 * 不做类型转换、不变更枚举、不静默去重、不排除隐藏行 / 列（docs/PRD.md 5.1）。
 */
export type RawSheet = {
  readonly sourceKind: ImportSourceKind
  /** 工作表名（XLSX）或粘贴来源标识 */
  readonly sourceSheet: string
  /** 源文件名仅用于本机展示，**禁止**写入日志、报告与 AI 摘要 */
  readonly sourceFileName: string | null
  readonly header: RawHeaderRow
  /** 数据行（不含表头行），保持物理顺序与行号 */
  readonly rows: readonly RawRow[]
  /** 物理行数（含表头行与空行） */
  readonly physicalRowCount: number
  readonly columnCount: number
  readonly emptyRowCount: number
  readonly hiddenRowCount: number
  /** 隐藏列下标（0 起）；列数据**不排除**，只提示，由用户决定是否包含 */
  readonly hiddenColumnIndexes: readonly number[]
  /** 表头所在工作表本身是否隐藏 */
  readonly sheetHidden: boolean
  readonly formulaWithoutCacheCount: number
  /** 已跳过并提示的空工作表 */
  readonly skippedSheets: readonly SkippedSheetInfo[]
  /** 文件 / 工作表级问题（解析失败、超限、空表、引号异常等；不含逐行问题） */
  readonly issues: readonly DataQualityIssue[]
  /** 工作簿日期系统；CSV / 粘贴为 null（不涉及 1900/1904） */
  readonly date1904: boolean | null
  /** CSV / 粘贴的解码编码；XLSX 为 null */
  readonly encoding: string | null
  /** CSV / 粘贴使用的分隔符；XLSX 为 null */
  readonly delimiter: string | null
}

/* ------------------------------------------------------------------ 规范化过程记录 */

/** 结论来源，用于「学校 / GPT 来源可追溯」类验收（docs/PRD.md 12.3 A01/A03） */
export type ValueSource =
  | 'raw'
  | 'aliasTable'
  | 'localList'
  | 'derived'
  | 'manual'
  | 'unknown'

/** 一次字段规范化的过程记录：可解释、可回溯、可撤销（docs/PRD.md 5.5） */
export type NormalizationLogEntry = {
  readonly field: StandardFieldKey
  /** 原始单元格文本（单值，禁止整行拼接） */
  readonly rawValue: string | null
  /** 规范化结果的可读文本；null 表示结果为空（缺失或无法识别） */
  readonly normalizedValue: string | null
  /** 命中的规则键，便于回溯，例如 `status.已送审批`、`city.上海青浦` */
  readonly rule: string
  readonly ruleVersion: string
  readonly source: ValueSource
  /** 是否为推断结果：推断项必须可撤销、并要求用户确认 */
  readonly inferred: boolean
  readonly confirmed: boolean
  readonly issueCodes: readonly DataQualityIssueCode[]
  /**
   * 「人工修正」专用（用户需求 ①，2026-09-27）：**修正前**规则算出来的值。
   *
   * 为什么单独一列而不是复用 `normalizedValue`：展开视图要同时给出
   * 原值 / 自动清洗值 / 人工修正值 / 原因 / 时间 五栏，缺任何一栏都会让回溯链断掉
   * （`docs/DECISIONS.md` D-091）。非人工修正的日志条目没有这个字段。
   */
  readonly autoValue?: string | null
  /** 「人工修正」专用：用户填写的原因（必填，界面层保证非空） */
  readonly reason?: string | null
}

/**
 * 一条人工修正（用户需求 ①，2026-09-27）。
 *
 * ## 为什么用「工作表 + 物理行号 + 字段」而不是 `recordId`
 *
 * `NormalizedRecord.recordId` 由 `newRecordId()` 在**每次清洗时重新生成**
 * （`src/domain/identity.ts`），因此任何一次重新清洗（改设置、改修正）都会让 recordId 全部换新，
 * 用它做键会让修正指向一条不存在的记录。物理行号（`RawSheet.rows[].sourceRow`）在
 * 「同一份表 + 同一套映射」下是稳定的，也正好是用户说话的方式（「第 49 行那一格」）。
 *
 * 为防止「换了另一份表却套用旧修正」，修正集合另存一份
 * `CleaningSettings.manualCorrectionsSheetSignature`（表头 + 行数 + 表名的摘要）；
 * 签名不匹配时**一条都不应用**，并在清洗日志与质量提示里如实说明。
 */
export type ManualCorrection = {
  /** 源工作表名（`RawSheet.sourceSheet`）；粘贴来源也有标识，因此不为空 */
  readonly sourceSheet: string
  /** 源文件物理行号（1 起，与 `RawSheet.rows[].sourceRow` 一致） */
  readonly sourceRow: number
  readonly field: StandardFieldKey
  /** 修正后的**原文**值；空字符串表示「改成缺失」，清洗时按缺失处理（绝不写 0） */
  readonly correctedValue: string
  /** 修正原因（必填：界面不允许留空） */
  readonly reason: string
  /** 修正时间（ISO 字符串） */
  readonly correctedAt: string
}

/* ------------------------------------------------------------------ 重复与去重 */

export type DuplicateKind = 'none' | 'exact' | 'suspected'

export type DedupAction = 'kept' | 'removedAsDuplicate' | 'pendingUserConfirmation'

export type DedupDecision = {
  readonly duplicateKind: DuplicateKind
  /** 完全重复的分组标识（原始行内容签名）；无重复为 null */
  readonly duplicateGroupKey: string | null
  /** 疑似重复的可读键（`需求ID + 姓名 + 启动日期`），只作提示，**不**作为自动合并主键 */
  readonly suspectedKey: string | null
  readonly action: DedupAction
  readonly decidedBy: 'default' | 'user' | 'none'
}

/* ------------------------------------------------------------------ 派生字段契约 */

/** 同岗薪酬基准（步骤7 计算；此处只定义结构，禁止组件各自实现） */
export type SalaryBenchmarkSummary = {
  /** 严格同组键：城市 + 序列 + 规范化岗位 + 币种 + 计薪周期 */
  readonly groupKey: string
  readonly scope: 'dataset' | 'userDefined'
  /** 参照有效样本数；n < 5 时不出基准 */
  readonly n: number
  readonly p25: number | null
  readonly p50: number | null
  readonly p75: number | null
  readonly sufficient: boolean
}

/**
 * 派生字段（docs/PRD.md 4.2）。步骤2 只定义契约，由步骤5（周期、质量标记）与
 * 步骤7（率、分位、基准）统一填充；组件不得自行计算。
 */
export type DerivedRecordFields = {
  /** 入职日期 − 启动日期（日历日）；日期非法、为负或状态不属于「已入职」时为 null */
  readonly recruitmentCycleDays: number | null
  /** 是否可用于「平均实际招聘周期」样本（仅已入职且日期合法非负） */
  readonly actualCycleEligible: boolean
  /** 是否可用于「待入职计划周期」样本 */
  readonly plannedCycleEligible: boolean
  /** 接受 offer；其他 / 未知状态为 null（不是 false） */
  readonly isAccepted: boolean | null
  readonly isRejected: boolean | null
  /** 是否计入核心分母 D */
  readonly countedInCoreDenominator: boolean
  readonly salaryBenchmark: SalaryBenchmarkSummary | null
  readonly salaryPercentileRank: number | null
  readonly isBelowMedian: boolean | null
  readonly dataQualityFlags: readonly DataQualityIssueCode[]
}

/* ------------------------------------------------------------------ 规范化记录 */

/**
 * 规范化记录：21 列标准字段 + 内部元数据 + 派生字段。
 * `extensions` 只承载用户显式映射的可选扩展列，缺失不影响任何指标。
 */
export type NormalizedRecord = {
  /* 内部元数据（docs/PRD.md 4.2，用户不手填） */
  readonly recordId: string
  readonly datasetId: string
  readonly batchId: string
  readonly sourceSheet: string
  readonly sourceRow: number
  /** 原始单元格值（与源表头同序），保证任何结论都能回到原值 */
  readonly values: readonly RawCellValue[]
  readonly normalizationLog: readonly NormalizationLogEntry[]
  readonly dedupDecision: DedupDecision
  readonly schemaVersion: string
  readonly rulesVersion: string
  readonly importedAt: string
  readonly dataAsOf: DateOnly
  /** 展示与导出的代号，不是全局真实身份 ID */
  readonly candidateDisplayId: string

  /* 21 列标准字段（缺失 = null，姓名允许为空） */
  /** 字符串，**保留前导 0**，绝不按数字或日期解析 */
  readonly requirementId: string | null
  readonly recruiter: string | null
  readonly city: City
  /** 城市原值（额外保留，不丢弃园区 / 区域信息） */
  readonly cityRaw: string | null
  readonly department: string | null
  readonly position: string | null
  readonly jobFamily: string | null
  readonly requirementType: RequirementType
  readonly recruitmentStartDate: DateOnly | null
  readonly joiningDate: DateOnly | null
  readonly expectedEndDate: DateOnly | null
  readonly candidateName: string | null
  readonly graduationYear: number | null
  readonly education: Education
  readonly school: string | null
  /** 学校结论来源（原值 / 别名表 / 本地名单 / 未知） */
  readonly schoolSource: ValueSource
  readonly isGptSchool: TriState
  readonly isGptSchoolSource: ValueSource
  readonly referrer: string | null
  readonly referralType: ReferralType
  readonly channel: Channel
  readonly channelRaw: string | null
  /** 原值金额；币种与计薪周期由批次确认，未确认时为 null（不视为 0） */
  readonly salaryAmount: number | null
  readonly currency: Currency | null
  readonly salaryUnit: SalaryUnit | null
  readonly housingRaw: string | null
  readonly housingType: HousingType
  /** 仅「现金房补」有金额；「无补贴」为 0；「提供住宿 / 未知」为 null（不折现） */
  readonly housingAmount: number | null
  readonly housingPeriod: HousingPeriod | null
  /** 例：无补贴原因「本地院校」；不据此推断候选人户籍 */
  readonly housingReason: string | null
  readonly offerStatus: OfferStatus
  readonly offerStatusRaw: string | null
  /** 仅拒 offer 记录有意义；缺失由展示层显示「未填写」，非拒 offer 为 null */
  readonly rejectionReason: string | null

  readonly extensions: ExtensionFieldValues

  /** 派生字段；未计算阶段为 null，禁止用 0 或 false 冒充 */
  readonly derived: DerivedRecordFields | null
}

/* ------------------------------------------------------------------ 字段映射 */

export type ImportMappingEntry = {
  readonly columnIndex: number
  /** 源表头原文 */
  readonly sourceHeader: string
  /** 目标标准字段；null 表示未映射到标准字段（可能映射到扩展列或被忽略） */
  readonly targetField: StandardFieldKey | null
  /**
   * 目标扩展列（docs/PRD.md 4.3「多余列……可映射到已定义的扩展字段」）。
   * 与 `targetField` **互斥**：两个都为 null 表示该列被忽略，不得意外导出或参与分析。
   */
  readonly targetExtension: ExtensionFieldKey | null
  readonly matchLevel: ColumnMatchLevel
  /** 0–1 的建议置信度；模糊建议 < 1 且必须确认 */
  readonly confidence: number
  /** 是否需要用户确认后才生效（别名、模糊、冲突、手动均为 true） */
  readonly requiresConfirmation: boolean
  /** 冲突组标识：同一目标字段的多个源列属于同一组，必须选择或显式合并 */
  readonly conflictGroupId: string | null
}

/**
 * 显式合并规则（docs/PRD.md 4.3「两个源列竞争一个目标字段时必须选择或显式合并规则」）。
 * 只登记「怎么取值」的规则，**不保存任何单元格内容**；取值本身由清洗阶段执行。
 */
export type MappingMergeRule = {
  /** 合并结果写入哪个标准字段（与 `targetExtension` 互斥） */
  readonly targetField: StandardFieldKey | null
  readonly targetExtension: ExtensionFieldKey | null
  /** 目前只支持「按列顺序取第一个非空值」：不拼接、不换算、缺值不填 0 */
  readonly strategy: 'first-non-empty'
  /** 参与合并的源列下标，顺序即取值优先级 */
  readonly columnIndexes: readonly number[]
}

export type ImportMapping = {
  /** 映射模板版本，对应 RuleVersion.templateVersion */
  readonly templateVersion: string
  readonly templateName: string | null
  /** 源表头签名（规范化表头排序后拼接），用于复用模板，**不含**任何单元格数据 */
  readonly sourceHeaderSignature: string
  readonly entries: readonly ImportMappingEntry[]
  /** 用户登记的显式合并规则；未登记的冲突组不在此列（必须逐组解决） */
  readonly merges: readonly MappingMergeRule[]
  /** 尚未映射的必需字段（缺 offer 状态列即阻断导入） */
  readonly missingRequiredFields: readonly StandardFieldKey[]
  readonly ignoredColumns: readonly string[]
  /** 用户确认时间；未确认为 null（未确认不得进入清洗） */
  readonly confirmedAt: string | null
}

/* ------------------------------------------------------------------ 数据集元数据 */

export type DatasetCounts = {
  readonly rawRowCount: number
  readonly emptyRowCount: number
  /** 保留行数（含尚未确认去重的行） */
  readonly keptRowCount: number
  readonly removedDuplicateCount: number
  readonly issueRowCount: number
  /** 名单覆盖需求数：countDistinct(非空需求ID)，不等于公司全部在招需求 */
  readonly distinctRequirementCount: number
}

/** 薪资币种 / 计薪周期设置：未确认时禁用待遇对比与低薪标签（docs/PRD.md 5.3） */
export type SalarySetting = {
  readonly option: SalaryUnitOption
  readonly currency: Currency | null
  readonly salaryUnit: SalaryUnit | null
  /** 只有确认了币种且不是「其他 / 暂不确定」才为 true */
  readonly comparable: boolean
  readonly confirmedAt: string | null
}

export type DatasetMetadata = {
  readonly datasetId: string
  readonly datasetName: string
  readonly batchId: string
  readonly ruleVersion: RuleVersion
  readonly sourceKind: ImportSourceKind
  /** 源文件名仅用于本机展示，**禁止**写入日志、报告与 AI 摘要 */
  readonly sourceFileName: string | null
  readonly sourceSheet: string | null
  readonly headerRowIndex: number
  readonly encoding: string | null
  readonly importedAt: string
  /** 分析截止日，由用户确认，默认导入当日 */
  readonly dataAsOf: DateOnly
  readonly importMode: ImportMode
  readonly dedupStrategy: DedupStrategy
  readonly salary: SalarySetting
  readonly counts: DatasetCounts
  /** 「部分分析导入」时被禁用的模块；空数组表示全部分析可用 */
  readonly disabledModules: readonly AnalysisModule[]
  /**
   * 本次清洗**实际使用的那份完整设置**（步骤12 补上的契约缺口）。
   *
   * 为什么必须存下来：`ruleVersion.configRevision` 只是一个摘要，能回答「两次分析是不是同一套配置」，
   * 但**不能回答「当时到底用的是哪套配置」**。元数据里原本只冗余了 `dedupStrategy` / `salary` /
   * `dataAsOf` / `importMode` 这几项，`gptList` / `gptListMode` / `gptListComplete` /
   * `schoolAliases` / `includeHiddenRows` / `dropHeaderEchoRows` 全部丢失，
   * 因此界面无法把「当前草稿」与「已提交设置」做差、也就无法在改动前展示影响（PRD 10.5）。
   *
   * 可选：步骤12 之前产生的数据集没有这份快照，调用方必须处理 `undefined`
   * （不得据缺失就假设「设置没变」）。
   */
  readonly cleaningSettings?: CleaningSettings
  /** 其他事实记录（日期系统、隐藏行处理选择等） */
  readonly notes: readonly string[]
}

/* ------------------------------------------------------------------ 清洗设置与清洗结果（步骤5） */

/**
 * 歧义日期的日月顺序（docs/PRD.md 5.2）：`01/02/2026` 这类写法**必须**由用户确认，
 * **不**按系统区域猜测；未确认（null）时该单元格不转换，只提示，绝不猜一个。
 */
export type AmbiguousDateOrder = 'day-first' | 'month-first'

/**
 * 「是否GPT院校」的判定方式（docs/PRD.md 5.3）：
 * - `raw-first`：原值优先，缺失保持未知，不查名单；
 * - `list-mode`：原值优先，缺失时用本地名单补；只有用户声明名单完整时，才把「不在名单」判为否。
 */
export type GptListMode = 'raw-first' | 'list-mode'

/** 学校别名规则：只做写法归一，语义不相同的学校**不**合并（docs/PRD.md 5.1） */
export type SchoolAliasRule = {
  readonly alias: string
  readonly canonical: string
}

/**
 * 清洗设置：用户在清洗页确认的全部口径。这些是**业务口径**而非数据结构，
 * 随数据集版本一起保存，便于回溯「当时用的是哪套口径」。
 */
export type CleaningSettings = {
  /** 分析截止日，默认导入当日，由用户确认（docs/PRD.md 5.2） */
  readonly dataAsOf: DateOnly
  /** 薪资币种与计薪周期：未确认时禁用待遇对比与低薪标签（docs/PRD.md 5.3） */
  readonly salary: SalarySetting
  /** 歧义日期的日月顺序；null = 未确认（此时歧义值不转换，只保留原值） */
  readonly ambiguousDateOrder: AmbiguousDateOrder | null
  readonly dedupStrategy: DedupStrategy
  /** 用户是否已对重复处理做出选择；未确认时重复行保持 `pendingUserConfirmation` */
  readonly dedupConfirmed: boolean
  readonly importMode: ImportMode
  /** 是否包含隐藏行：默认包含，**不默默排除**（docs/PRD.md 5.1） */
  readonly includeHiddenRows: boolean
  /** 是否剔除表头回声行：默认 false，只提示、**不自动删除**（docs/PRD.md 0.1） */
  readonly dropHeaderEchoRows: boolean
  readonly gptListMode: GptListMode
  /** 用户是否声明本地 GPT 名单完整；只有列表模式 + 声明完整时「不在名单」才判否 */
  readonly gptListComplete: boolean
  readonly gptList: readonly string[]
  readonly schoolAliases: readonly SchoolAliasRule[]
  /** 招聘周期超过该天数提示核实（默认 180 天，**不**自动截尾或删除） */
  readonly cycleTooLongDays: number
  /**
   * 渠道缺失（空或 `-`）且「简历推荐人 = 内推」时，是否把渠道补成「内推」（用户需求 ②，2026-09-27）。
   *
   * 三条口径（用户确认，详见 `docs/DECISIONS.md` D-092 与 `docs/PRD.md` 5.2）：
   * 1. **默认关闭**：AGENTS §6 禁止「自动把 `-` 渠道判为内推」，因此必须由用户在清洗页显式开启；
   * 2. **只补缺失**：渠道已经有具体值（含 `其他` / 显式「未知」）时**绝不覆盖**，
   *    改为在该行标 `CHANNEL_REFERRER_CONFLICT`「渠道与推荐人不一致，请核对」；
   * 3. **留痕**：补出来的值来源标记为「推断」，原缺失值仍记录在日志里，随时可撤销。
   */
  readonly channelFromReferrer: boolean
  /**
   * 人工修正清单（用户需求 ①，2026-09-27）。它属于**清洗输入**：
   * 由 `cleanSheet` 在解析该行前替换对应字段的源值，因此问题码、各率、质量报告都会跟着重算
   * （见 `docs/DECISIONS.md` D-091）。
   */
  readonly manualCorrections: readonly ManualCorrection[]
  /**
   * 上面那份修正清单对应的**表签名**（表名 + 表头 + 行数 + 列数的摘要）。
   *
   * 为什么需要它：修正按「物理行号 + 字段」定位，换一份表就可能指到别的数据上。
   * 签名不一致时一条修正都不应用，并如实提示——绝不把旧修正静默套到新表上。
   */
  readonly manualCorrectionsSheetSignature: string | null
}

/** 重复分组：完全重复与清洗后疑似重复**分别展示**，都必须用户确认（docs/PRD.md 5.4） */
export type DuplicateGroup = {
  readonly kind: Exclude<DuplicateKind, 'none'>
  /**
   * 分组标识：稳定序号（`exact#1` / `suspected#1`）。
   * **不**使用原始行内容签名，避免把整行内容复制到标识、报告与日志里。
   */
  readonly groupKey: string
  readonly recordIds: readonly string[]
  readonly sourceRows: readonly number[]
  /** 建议保留的记录（每组首条，按源文件行号顺序） */
  readonly suggestedKeepRecordId: string
  readonly suggestedRemoveRecordIds: readonly string[]
}

/** 各分析模块的可用性与有效样本数（docs/PRD.md 5.5：质量页必须能按指标看样本） */
export type MetricAvailability = {
  readonly module: AnalysisModule
  readonly available: boolean
  /** 有效样本数；该模块口径不适用时为 null（**不用 0 冒充**） */
  readonly validSampleCount: number | null
  readonly reason: string | null
}

/** 清洗过程中的一条关键决策（关键决策写入清洗日志；改设置即重新计算，可撤销） */
export type CleaningDecision = {
  readonly id: string
  readonly label: string
  readonly detail: string
  readonly ruleVersion: string
  /** 该决策是否已由用户确认（未确认为 false，不得当作结论） */
  readonly confirmed: boolean
}

/** 清洗与质量报告（docs/PRD.md 5.5） */
export type CleaningReport = {
  readonly counts: DatasetCounts
  readonly issues: readonly DataQualityIssue[]
  readonly issueCountsByCode: Readonly<Partial<Record<DataQualityIssueCode, number>>>
  readonly issueCountsBySeverity: Readonly<Record<DataQualitySeverity, number>>
  readonly exactDuplicateGroups: readonly DuplicateGroup[]
  readonly suspectedDuplicateGroups: readonly DuplicateGroup[]
  /** 参与重复分组的记录数（含每组首条） */
  readonly duplicateRowCount: number
  /** 尚未确认日月顺序的歧义日期数（> 0 时提交前必须处理） */
  readonly ambiguousDateCount: number
  /** 歧义日期的少量原值样例（只在本机展示，便于用户判断日月顺序） */
  readonly ambiguousDateSamples: readonly string[]
  readonly cycleTooLongCount: number
  readonly negativeCycleCount: number
  readonly headerEchoRowCount: number
  /** 被显式剔除的行数（当前只可能来自用户勾选「剔除表头回声行」） */
  readonly droppedRowCount: number
  readonly hiddenRowExcludedCount: number
  readonly metricAvailability: readonly MetricAvailability[]
  readonly decisionLog: readonly CleaningDecision[]
  readonly notes: readonly string[]
}

/** 清洗后的数据集：分析层只消费该结构（记录 + 元数据 + 质量报告） */
export type NormalizedDataset = {
  readonly metadata: DatasetMetadata
  readonly records: readonly NormalizedRecord[]
  readonly report: CleaningReport
}
