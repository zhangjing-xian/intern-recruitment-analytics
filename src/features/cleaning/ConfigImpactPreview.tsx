import { useMemo } from 'react'

import { describeConfigChanges, type CleaningSettings, type ConfigChange } from '../../domain'
import {
  CONFIG_CHANGE_HEADING,
  CONFIG_CHANGE_NEW_VERSION_NOTICE,
  CONFIG_COMMITTED_VERSION_LABEL,
  CONFIG_OLD_REPORTS_NOTICE,
  CONFIG_UNCHANGED_NOTICE,
  CONFIG_VERSION_LABEL,
  CONFIG_VERSION_STALE_NOTICE,
  NO_COMMITTED_DATASET_NOTE,
  currentConfigVersion,
  formatChange,
} from './configImpact'

type ConfigImpactPreviewProps = {
  /** 当前草稿设置（用户正在编辑的那一份） */
  readonly settings: CleaningSettings
  /**
   * 已提交数据集清洗时用的设置；没有已提交数据集、或数据集产生于步骤12 之前（没有快照）时为 null。
   *
   * 由调用方从 `dataset.metadata.cleaningSettings` 传进来——那份快照是 `cleanSheet` 在提交那一刻
   * 存进元信息的，因此它跟着数据集一起可回溯（加密仓、备份、报告都能带上），
   * 而不是只活在某个组件的 state 里。
   */
  readonly committedSettings: CleaningSettings | null
}

const SECTION = 'space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3'
const ROW = 'text-xs leading-6 text-slate-700'

/**
 * 规则配置版本 + 变更影响预览（步骤12）。
 *
 * 位置：清洗口径面板顶部，紧挨着设置项——用户在改设置的地方就能看到「改了会怎样」，
 * 而不是提交之后才发现版本变了。
 *
 * 职责与边界：
 * - **不自己算摘要、不自己比字段**：摘要经 `configImpact` → `buildConfigRevision`，
 *   逐字段变更用引擎的 `describeConfigChanges`，这里只做展示；
 * - 配置没变时明确说「提交不会产生新的配置版本」，避免用户以为每次提交都会换版本；
 * - 配置变了时必写两条：提交会生成**新版本**、**旧报告不会改变**（PRD 10.5 的可回溯要求）。
 */
export default function ConfigImpactPreview({
  settings,
  committedSettings,
}: ConfigImpactPreviewProps) {
  /**
   * 逐字段变更只在两份设置都存在时算一次。
   * `describeConfigChanges` 内部会先比一次摘要再逐字段描述，属于「每次渲染都做也无害」的纯计算，
   * 但成本随名单长度增长，因此跟着两份设置的引用做缓存（改设置才会重算）。
   */
  const changes = useMemo<readonly ConfigChange[]>(
    () => (committedSettings === null ? [] : describeConfigChanges(committedSettings, settings)),
    [committedSettings, settings],
  )

  const version = currentConfigVersion(settings)
  const showCommitted = committedSettings !== null
  const committedVersion = committedSettings === null ? null : currentConfigVersion(committedSettings)
  const changed = showCommitted && changes.length > 0

  return (
    <div className={SECTION}>
      <p className={ROW}>
        <span className="font-medium text-slate-900">{CONFIG_VERSION_LABEL}：</span>
        <code>{version.label}</code>
        {changed ? <span className="text-amber-800"> {CONFIG_VERSION_STALE_NOTICE}</span> : null}
      </p>

      {committedVersion === null ? null : (
        <p className={ROW}>
          <span className="font-medium text-slate-900">{CONFIG_COMMITTED_VERSION_LABEL}：</span>
          <code>{committedVersion.label}</code>
        </p>
      )}

      {showCommitted ? null : <p className={ROW}>{NO_COMMITTED_DATASET_NOTE}</p>}

      {changed ? (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-900">{CONFIG_CHANGE_HEADING}</p>
          <ul className="list-disc space-y-1 pl-5">
            {changes.map((change) => (
              <li className={ROW} key={change.field}>
                {formatChange(change)}
              </li>
            ))}
          </ul>
          <p className={ROW}>{CONFIG_CHANGE_NEW_VERSION_NOTICE}</p>
          <p className={ROW}>{CONFIG_OLD_REPORTS_NOTICE}</p>
        </div>
      ) : null}

      {showCommitted && changes.length === 0 ? (
        <p className={ROW}>{CONFIG_UNCHANGED_NOTICE}</p>
      ) : null}
    </div>
  )
}

/**
 * 只显示当前配置版本的只读行（任何时候都成立的事实：草稿也有版本）。
 *
 * 为什么与影响预览分开：影响预览需要一份已提交配置做比较，没有数据集时无法给出；
 * 而版本号与「用户是否提交过」无关，因此在没有数据集时也必须在场。
 */
export function ConfigVersionLine({ settings }: { readonly settings: CleaningSettings }) {
  return (
    <p className={ROW}>
      <span className="font-medium text-slate-900">{CONFIG_VERSION_LABEL}：</span>
      <code>{currentConfigVersion(settings).label}</code>
    </p>
  )
}
