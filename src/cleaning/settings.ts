/**
 * 清洗默认设置（docs/PRD.md 5.2 / 5.3 / 5.4）。
 *
 * 默认值只提供**最保守的起点**，不替用户做业务结论：
 * - 薪资口径默认**人民币元/月**（用户反馈 ①，2026-09-27 晚改；口径与理由见 `docs/DECISIONS.md` D-095）：
 *   这是仓库里已经写明的「建议默认值」，只是过去没有真的当默认；
 *   它**不换算**任何金额、也不猜单条记录的单位，只是在清洗时给「币种 / 计薪周期」这两列一个值，
 *   因此待遇对比与低薪标签不再默认被禁用。名单里有按天计薪或外币的行时，
 *   用户必须自己在清洗口径里改成「人民币元/天」「其他」或「暂不确定」；
 * - 日月顺序默认未确认 → `01/02/2026` 这类歧义日期不转换，只提示；
 * - 隐藏行默认**包含**、表头回声行默认**保留**（不默默排除、不自动删除）；
 * - 去重默认「确认后每组保留首条」，但必须用户确认后才生效。
 */

import {
  buildSalarySetting,
  type CleaningSettings,
  type DateOnly,
  type ImportMode,
} from '../domain'

/** 招聘周期超过 180 天即提示核实（**不**自动截尾、不删除，docs/PRD.md 5.1 长周期提示） */
export const DEFAULT_CYCLE_TOO_LONG_DAYS = 180

/** 设置项的中文说明（设置面板与决策日志共用，避免同一口径写两遍） */
export const CLEANING_SETTING_HELP = {
  dataAsOf: '分析截止日默认导入当日；「已入职」但入职日期晚于截止日会提示状态与日期矛盾，状态不自动修改',
  salary:
    '默认按「人民币元/月」计算（只给币种与计薪周期这两列取值，不做任何汇率或周期换算）。' +
    '名单里若有按天计薪或外币的行，请改成对应口径；选「暂不确定」则禁用待遇对比与低薪标签',
  ambiguousDateOrder: '`01/02/2026` 这类写法必须指定日月顺序，未指定时不转换、只提示',
  dedupStrategy: '完全重复与疑似重复分别展示；默认建议每组保留首条，必须确认后才生效',
  includeHiddenRows: '隐藏行默认包含：隐藏不等于无效，排除会让统计与原始文件不一致',
  dropHeaderEchoRows: '表头回声行默认只提示不删除（附件第 2 行的同名字段行不得被静默消费）',
  gptListMode: '原值优先；仅在缺失时可用本地名单补，且只有声明「名单完整」时才能把不在名单判为否',
  schoolAliases: '别名只做写法归一（如「上交」→「上海交通大学」），语义不相同的学校不合并',
  cycleTooLongDays: '超过该天数只提示核实，不自动截尾、不删除记录',
  channelFromReferrer:
    '只有渠道是空或「-」且推荐人写着「内推」时才补成内推（来源标为推断、可撤销）；渠道已经有具体值时绝不覆盖，只提示两列不一致。默认关闭：开启这件事必须由你决定',
  importMode: '追加 = 与当前数据集合并；新建快照 = 独立版本；替换 = 覆盖当前数据集',
} as const

/** 本地日历日期（分析截止日默认值；不用 UTC，避免跨时区差一天） */
export function defaultDataAsOf(now: Date): DateOnly {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createDefaultCleaningSettings(input: {
  readonly dataAsOf: DateOnly
  readonly importMode?: ImportMode
}): CleaningSettings {
  return {
    dataAsOf: input.dataAsOf,
    salary: buildSalarySetting('人民币元/月'),
    ambiguousDateOrder: null,
    dedupStrategy: '确认后每组保留首条',
    dedupConfirmed: false,
    importMode: input.importMode ?? '新建快照',
    includeHiddenRows: true,
    dropHeaderEchoRows: false,
    gptListMode: 'raw-first',
    gptListComplete: false,
    gptList: [],
    schoolAliases: [],
    cycleTooLongDays: DEFAULT_CYCLE_TOO_LONG_DAYS,
    // 默认关闭：AGENTS §6 禁止「自动把 `-` 渠道判为内推」，开启必须由用户显式决定
    channelFromReferrer: false,
    // 人工修正默认空：没有任何修正时，清洗结果与以前逐字节一致
    manualCorrections: [],
    manualCorrectionsSheetSignature: null,
  }
}

/** 设置指纹：设置变化即需要重新计算清洗结果（幂等缓存键，不含任何行数据） */
export function cleaningSettingsKey(settings: CleaningSettings): string {
  return JSON.stringify(settings)
}
