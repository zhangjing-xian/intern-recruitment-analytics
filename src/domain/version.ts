/**
 * 领域契约版本号（唯一来源）。
 *
 * 为什么必须版本化（docs/PRD.md 4.2）：导入、清洗、统计的结论都要能回溯到「当时用的是哪套规则」，
 * 否则规则调整后同名指标无法比较。版本快照随数据集、报告与 AI 历史一起保存。
 *
 * - `SCHEMA_VERSION`：RawRow / NormalizedRecord 等数据结构版本，破坏性变更必须做数据迁移；
 * - `RULES_VERSION`：清洗与口径规则版本（状态字典、城市别名、渠道大小写、房补解析、去重策略）；
 * - `DICTIONARY_VERSION`：枚举字典（可选值集合）版本，用户扩充字典后变化；
 * - `TEMPLATE_VERSION`：标准 21 列表头模板版本。
 *
 * 版本号格式为 `主.次.修订`：主版本变化 = 破坏性变更，必须提示用户迁移或重新导入，
 * 不做「尽力兼容」的静默转换。
 */

export const SCHEMA_VERSION = '1.0.0'
export const RULES_VERSION = '1.0.0'
export const DICTIONARY_VERSION = '1.0.0'
export const TEMPLATE_VERSION = '1.0.0'

/** 一组规则版本快照，随数据集 / 报告 / AI 历史保存，用于回溯与「同配置同结果」核对 */
export type RuleVersion = {
  readonly schemaVersion: string
  readonly rulesVersion: string
  readonly dictionaryVersion: string
  readonly templateVersion: string
  /**
   * 规则**配置摘要**（步骤12）：由影响清洗结果的设置（名单 / 别名 / 去重策略 / 隐藏行…）算出，
   * 见 `configVersion.ts` 的 `buildConfigRevision`。
   *
   * 为什么需要它：`rulesVersion` 只在规则**实现**变化时才动，无法表达「用户改了名单」；
   * 有了配置摘要，改名单会换版本，**而旧数据集与旧报告仍保存它们当时那份摘要**，
   * 因此「旧报告不因新名单改变」是可以被核对的事实，而不是一句承诺。
   *
   * 可选：`CURRENT_RULE_VERSION` 这类「还没有具体配置」的场景可以为空。
   */
  readonly configRevision?: string
}

export const CURRENT_RULE_VERSION: RuleVersion = {
  schemaVersion: SCHEMA_VERSION,
  rulesVersion: RULES_VERSION,
  dictionaryVersion: DICTIONARY_VERSION,
  templateVersion: TEMPLATE_VERSION,
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/

/** 是否为合法的三段式版本号 */
export function isVersionString(value: string): boolean {
  return VERSION_PATTERN.test(value)
}

/** 取主版本号；格式非法返回 null（调用方据此提示「无法判断兼容性」，不静默放行） */
export function majorVersion(version: string): number | null {
  const matched = VERSION_PATTERN.exec(version)
  return matched === null ? null : Number(matched[1])
}

/** 主版本相同即视为可读：次版本 / 修订版本只做增补，不做破坏性变更 */
export function isSchemaCompatible(version: string): boolean {
  const major = majorVersion(version)
  return major !== null && major === majorVersion(SCHEMA_VERSION)
}
