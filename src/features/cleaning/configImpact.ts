/**
 * 规则**配置版本**与变更影响预览的展示层工具（步骤12，docs/PRD.md 4.2 / 10.5）。
 *
 * 为什么需要它：`RULES_VERSION` 只在规则实现变化时才动，它无法表达「用户改了名单 / 别名 / 去重策略」。
 * 于是会出现一个说不清的状态：两次分析用的是不同的名单，数据集与报告上的版本却一模一样。
 * `domain/configVersion.ts` 已经把影响清洗结果的设置压成稳定摘要（唯一实现），界面这一层要做的是
 * **把它展示出来，并在提交前说清这次改动会带来什么**。
 *
 * 三条硬规则：
 * 1. 本模块与组件**不得自己算摘要**：`currentConfigVersion` 只是 `buildConfigRevision` 的调用点，
 *    摘要算法只有一处实现（否则界面显示一个版本、数据集里存另一个版本）；
 * 2. 变更清单**不得自己比字段**：逐字段的中文描述与「是否影响结果」由 `describeConfigChanges` 给，
 *    这里只把引擎的 `ConfigChange` 拼成一行；
 * 3. 「旧报告不变」必须写出来：旧数据集与旧报告保存的是**它们当时那份摘要**，
 *    改名单只会产生新版本，不会回头改写任何已提交的数据集或已导出的报告。
 */

import {
  RULES_VERSION,
  buildConfigRevision,
  configRevisionLabel,
  type CleaningSettings,
  type ConfigChange,
} from '../../domain'

/** 配置版本的可读形式（数据集与报告上显示的就是它，如 `1.0.0+3F2A19C4`） */
export type ConfigVersionSummary = {
  /** 配置摘要本身（如 `3F2A19C4`） */
  readonly revision: string
  /** 语义基线 + 摘要 */
  readonly label: string
}

/**
 * 当前配置的版本信息。
 * 内部两次调用都在引擎里：`buildConfigRevision` 出摘要、`configRevisionLabel` 出可读形式，
 * 本模块不参与任何摘要计算（名单规范化、排序、去重都在引擎里）。
 */
export function currentConfigVersion(settings: CleaningSettings): ConfigVersionSummary {
  const revision = buildConfigRevision(settings)
  return { revision, label: configRevisionLabel(RULES_VERSION, revision) }
}

/**
 * 引擎给的逐字段变更 → 一行中文。
 * 格式（`标签：旧值 → 新值`）在这里定死，界面与测试引用同一份实现，避免两处排版不一致。
 */
export function formatChange(change: ConfigChange): string {
  return `${change.label}：${change.before} → ${change.after}`
}

/** 版本行的固定文案（测试引用同一份常量，避免改文案时测试悄悄失效） */
export const CONFIG_VERSION_LABEL = '规则配置版本'
export const CONFIG_VERSION_STALE_NOTICE = '（与已提交数据集不同）'
/** 已提交版本的提示：两行并排才能看出「换了哪一份摘要」，只给一句「不同」等于没说 */
export const CONFIG_COMMITTED_VERSION_LABEL = '已提交数据集的配置版本'
export const CONFIG_CHANGE_HEADING = '提交前的影响预览：配置已变更'
export const CONFIG_CHANGE_NEW_VERSION_NOTICE =
  '提交后会生成一个新版本的数据集：版本号由上面的配置摘要决定，改了名单或别名就会换一个版本。'
export const CONFIG_OLD_REPORTS_NOTICE =
  '旧报告不会改变：已经提交的数据集与已经导出的报告保存的是它们当时那份配置摘要，本次改动不会回头改写它们，也不会让旧的数字变化。'
export const CONFIG_UNCHANGED_NOTICE =
  '当前草稿与已提交数据集的配置一致，提交不会产生新的配置版本。'
export const NO_COMMITTED_DATASET_NOTE =
  '还没有已提交的数据集：先提交一次，之后的设置改动会在这里显示影响预览。'
