/**
 * 规则**配置版本**（步骤12，docs/PRD.md 4.2 / 10.5）。
 *
 * 为什么需要它：`version.ts` 里的 `RULES_VERSION` 是**语义基线**（规则实现变了才动它），
 * 但它无法表达「用户在界面上改了名单 / 别名 / 去重策略」。于是会出现一个说不清的状态：
 * 两次分析用的是**不同的名单**，记录的 `rulesVersion` 却一模一样——报告无法回溯到底按哪套配置算的。
 *
 * 本模块把**影响清洗结果的配置**（不含截止日、薪资单位这类只影响展示口径的项）压成一个稳定摘要，
 * 与语义基线一起组成 `RuleVersion.configRevision`：
 * - 配置不同 → 摘要不同 → 数据集与报告上的版本不同（可回溯）；
 * - 配置相同 → 摘要相同（同一配置必须得到同一版本，否则「同配置同结果」无法核对）；
 * - **旧报告不会因为改了名单而变化**：旧数据集与旧报告保存的是**它们当时那份**摘要。
 *
 * 摘要只取「与结果有关」的字段并先规范化（排序 / 去重 / 去空白），因此
 * 「同一批学校用不同顺序粘贴」不会产生两个版本——那只是录入顺序差异，不是规则变化。
 */

import type { CleaningSettings, ManualCorrection, SchoolAliasRule } from './types'

/** 影响清洗结果的配置字段（其余字段不参与摘要，避免「改截止日也换版本」这种噪声） */
export const CONFIG_REVISION_FIELDS = [
  'gptListMode',
  'gptListComplete',
  'gptList',
  'schoolAliases',
  'dedupStrategy',
  'includeHiddenRows',
  'dropHeaderEchoRows',
  // 渠道补内推（用户需求 ②，2026-09-27）：它会**改渠道取值**，因此必须进摘要，
  // 否则「同一份数据两次分析渠道分布不同」无法解释（AGENTS §9）。
  'channelFromReferrer',
  // 人工修正（用户需求 ①，2026-09-27）：它改的是清洗结果本身，必须进摘要
  'manualCorrections',
] as const
export type ConfigRevisionField = (typeof CONFIG_REVISION_FIELDS)[number]

/**
 * 稳定 32 位摘要（FNV-1a 变体）。
 *
 * 为什么不用 Web Crypto 的 SHA-256：本函数要在**纯函数层**（不依赖浏览器 API）可用，
 * 且它只需要「同样输入给同样输出、不同输入极大概率不同」，不需要密码学强度——
 * 它用于**回溯与展示**，不是防篡改。真正的完整性由加密仓的 AES-GCM 认证标签负责。
 */
export function stableDigest(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    // FNV 质数 16777619；用 Math.imul 避免 32 位溢出丢精度
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).toUpperCase().padStart(8, '0')
}

/** 丢掉空白与重复，并排序：让「同一集合的不同录入顺序」得到同一摘要 */
function normalizeStrings(values: readonly string[]): readonly string[] {
  const cleaned = values
    .map((value) => value.trim())
    .filter((value) => value !== '')
  return [...new Set(cleaned)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

function normalizeAliases(aliases: readonly SchoolAliasRule[]): readonly string[] {
  return normalizeStrings(
    aliases.map((rule) => `${rule.alias.trim()}=>${rule.canonical.trim()}`),
  )
}

/**
 * 人工修正的规范化形式（用户需求 ①）。
 *
 * 排序后再进摘要：**录入顺序不影响结果**，因此「先改 A 再改 B」与「先改 B 再改 A」
 * 必须是同一个配置摘要。修正值本身要参与（改了值就是改了结果），
 * 但**不**把原因写进摘要——原因只用于回溯展示，改原因不该换版本。
 */
function normalizeCorrections(
  corrections: readonly ManualCorrection[],
): readonly string[] {
  return normalizeStrings(
    corrections.map(
      (item) =>
        `${item.sourceSheet}#${String(item.sourceRow)}#${item.field}=>${item.correctedValue}`,
    ),
  )
}

/**
 * 由清洗设置算出配置摘要。
 *
 * 只读 `CONFIG_REVISION_FIELDS`，且每一项都先规范化（名单去空白去重排序、别名按 `别名=>标准名` 排序）。
 */
export function buildConfigRevision(settings: CleaningSettings): string {
  const payload = {
    gptListMode: settings.gptListMode,
    gptListComplete: settings.gptListComplete,
    gptList: normalizeStrings(settings.gptList),
    schoolAliases: normalizeAliases(settings.schoolAliases),
    dedupStrategy: settings.dedupStrategy,
    includeHiddenRows: settings.includeHiddenRows,
    dropHeaderEchoRows: settings.dropHeaderEchoRows,
    channelFromReferrer: settings.channelFromReferrer,
    manualCorrections: normalizeCorrections(settings.manualCorrections),
    // 表签名决定「这批修正到底会不会被应用」，因此也算进摘要：
    // 换了表导致修正失效时，摘要必须跟着变，否则无法解释结果差异。
    manualCorrectionsSheetSignature: settings.manualCorrectionsSheetSignature,
  }
  return stableDigest(JSON.stringify(payload))
}

/* ------------------------------------------------------------------ 变更影响 */

/** 一条配置变更的可读描述；`before` / `after` 只用于展示，不含敏感内容 */
export type ConfigChange = {
  readonly field: ConfigRevisionField
  readonly label: string
  readonly before: string
  readonly after: string
  /** 该字段变化是否会改变清洗结果（本模块里全为 true，保留字段以便将来区分） */
  readonly affectsResult: boolean
}

const FIELD_LABELS: Readonly<Record<ConfigRevisionField, string>> = {
  gptListMode: 'GPT 名单模式',
  gptListComplete: '是否声明名单完整',
  gptList: '本地 GPT 名单',
  schoolAliases: '学校别名表',
  dedupStrategy: '去重策略',
  includeHiddenRows: '是否包含隐藏行',
  dropHeaderEchoRows: '是否剔除表头回声行',
  channelFromReferrer: '渠道缺失时是否按推荐人补成内推',
  manualCorrections: '人工修正清单',
}

function countLabel(count: number, unit: string): string {
  return `${String(count)} ${unit}`
}

function describeField(settings: CleaningSettings, field: ConfigRevisionField): string {
  switch (field) {
    case 'gptListMode':
      return settings.gptListMode
    case 'gptListComplete':
      return settings.gptListComplete ? '已声明完整（不在名单可判否）' : '未声明完整（不在名单保持未知）'
    case 'gptList':
      return countLabel(normalizeStrings(settings.gptList).length, '所')
    case 'schoolAliases':
      return countLabel(normalizeAliases(settings.schoolAliases).length, '条别名')
    case 'dedupStrategy':
      return settings.dedupStrategy
    case 'includeHiddenRows':
      return settings.includeHiddenRows ? '包含' : '不包含'
    case 'dropHeaderEchoRows':
      return settings.dropHeaderEchoRows ? '剔除' : '只提示不剔除'
    case 'channelFromReferrer':
      return settings.channelFromReferrer ? '已开启（渠道缺失时补成内推）' : '未开启（渠道缺失保持未知）'
    case 'manualCorrections':
      // 只报条数：原因与修正值本身属于业务内容，不适合进这份会被写进报告的描述
      return countLabel(normalizeCorrections(settings.manualCorrections).length, '处人工修正')
  }
}

/**
 * 比较两份配置，列出**影响清洗结果**的变更（PRD 10.5：变更前先展示影响）。
 *
 * 只报真正变化的字段；没有变化时返回空数组（界面据此说明「配置未变化，版本不变」）。
 * 名单 / 别名只报**数量变化**，不回显具体学校名——设置页本身能看到它们，
 * 而这份描述会被写进数据集元信息与报告，不宜携带成串的原始名称。
 */
export function describeConfigChanges(
  before: CleaningSettings,
  after: CleaningSettings,
): readonly ConfigChange[] {
  if (buildConfigRevision(before) === buildConfigRevision(after)) {
    return []
  }
  const changes: ConfigChange[] = []
  for (const field of CONFIG_REVISION_FIELDS) {
    const beforeText = describeField(before, field)
    const afterText = describeField(after, field)
    if (beforeText !== afterText) {
      changes.push({
        field,
        label: FIELD_LABELS[field],
        before: beforeText,
        after: afterText,
        affectsResult: true,
      })
    }
  }
  return changes
}

/** 配置摘要的可读形式（用于数据集元信息与报告：「语义基线 + 配置 3F2A19C4」） */
export function configRevisionLabel(baseVersion: string, revision: string): string {
  return `${baseVersion}+${revision}`
}
