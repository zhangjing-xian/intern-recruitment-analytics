import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  cleanSheet,
  cleaningPreconditionError,
  cleaningSettingsKey,
  createDefaultCleaningSettings,
  defaultDataAsOf,
  sheetSignatureOf,
} from '../../cleaning'
import {
  getStandardField,
  newRecordId,
  type CleaningSettings,
  type ImportMapping,
  type ManualCorrection,
  type RawSheet,
  type StandardFieldKey,
} from '../../domain'
import { formatInteger } from '../../lib/format'
import {
  commitNormalizedDataset,
  getCleaningSession,
  saveCleaningSettingsDraft,
} from '../../storage/sessionStore'
import CleaningSettingsPanel from './CleaningSettingsPanel'
import DuplicateReviewPanel from './DuplicateReviewPanel'
import IssueWorklistPanel from './IssueWorklistPanel'
import NormalizedPreviewTable from './NormalizedPreviewTable'
import QualityReportPanel from './QualityReportPanel'
import { describeIssue } from './issueText'

type CleaningEditorProps = {
  readonly sheet: RawSheet
  readonly mapping: ImportMapping
  readonly initialSettings: CleaningSettings | null
  readonly datasetName?: string
}

/**
 * 清洗与校验主体（步骤5）。
 *
 * 数据流是单向的：设置 → `cleanSheet(纯函数)` → 质量报告 + 去重对照 + 记录预览 → 用户确认后提交。
 * 三条不可退让的规则：
 * 1. 未确认映射 / 缺 offer 状态列**拒绝清洗**，不产出半成品；
 * 2. 改设置即**整体重算**（可撤销），不保留任何跨设置的缓存结论；
 * 3. 提交是显式动作：只有用户看过质量报告（尤其重复与歧义日期）后才把数据集放进会话。
 */
export default function CleaningEditor({
  sheet,
  mapping,
  initialSettings,
  datasetName: initialDatasetName,
}: CleaningEditorProps) {
  /** 数据集身份：一次进入本页固定不变，重算不会让结论「换一个数据集」 */
  const [identity] = useState(() => ({
    datasetId: newRecordId(),
    batchId: newRecordId(),
    importedAt: new Date().toISOString(),
  }))
  const [datasetName, setDatasetName] = useState(
    () => initialDatasetName ?? `清洗结果 ${defaultDataAsOf(new Date())}`,
  )
  const [settings, setSettings] = useState<CleaningSettings>(
    () => initialSettings ?? createDefaultCleaningSettings({ dataAsOf: defaultDataAsOf(new Date()) }),
  )
  const [committed, setCommitted] = useState(() => getCleaningSession().dataset)
  const [committedKey, setCommittedKey] = useState<string | null>(null)
  /**
   * 已提交数据集清洗时用的**那份设置快照**（步骤12）。
   *
   * 来源是数据集元信息里的 `cleaningSettings`——`cleanSheet` 在提交那一刻就把完整设置存进去了。
   * 为什么不能靠组件自己记：组件状态只活在这一次访问里，用户离开清洗页再回来、或换一页提交过数据集，
   * 本地记的那份就丢了；而「旧报告按哪套设置算的」必须随数据集一起长期可查。
   * 旧数据集（步骤12 之前产生）没有这份快照，此时为 `undefined`，
   * 界面按「无法比较」处理，**不**假设配置没变。
   */
  const committedSettings = committed?.metadata.cleaningSettings ?? null
  const [notice, setNotice] = useState<string | null>(null)

  /**
   * 编辑即写回会话草稿：返回其他页面再回来不丢设置（仅内存，不落盘）。
   *
   * ## 为什么不能写成「一个依赖 settings 的 effect 直接写回」（2026-09-27 晚修的真实 bug）
   *
   * `saveCleaningSettingsDraft` 的语义是「设置变了 → 已提交的结论作废」
   * （数据集必须与产生它的那份设置一一对应，见 `sessionStore.ts`）。
   * 而 effect **在挂载时也会跑一次**，于是以前只要**打开（或只是回到）清洗预览页**，
   * 哪怕一个字都没改，也会把用户刚提交的数据集作废——用户看到的现象是
   * 「我明明上传过数据，重新进看板却又要我重新确认清洗预览」。
   *
   * 现在的写法有两道门：
   * 1. **首帧只记基线、不写回**（挂载本身不是一次编辑）；
   * 2. 之后只有与基线**确实不同**才写回，比较用清洗层的规范键 `cleaningSettingsKey`。
   * 于是数据集的作废条件回到它本来的语义：**改了设置才作废**。
   */
  const lastWrittenSettings = useRef(settings)
  const settingsWriteArmed = useRef(false)
  useEffect(() => {
    if (!settingsWriteArmed.current) {
      settingsWriteArmed.current = true
      lastWrittenSettings.current = settings
      return
    }
    if (cleaningSettingsKey(lastWrittenSettings.current) === cleaningSettingsKey(settings)) {
      return
    }
    lastWrittenSettings.current = settings
    saveCleaningSettingsDraft(settings)
  }, [settings])

  const outcome = useMemo(() => {
    const precondition = cleaningPreconditionError(mapping)
    if (precondition !== null) {
      return { dataset: null, error: precondition }
    }
    try {
      return {
        dataset: cleanSheet({
          sheet,
          mapping,
          settings,
          datasetId: identity.datasetId,
          batchId: identity.batchId,
          datasetName,
          importedAt: identity.importedAt,
        }),
        error: null,
      }
    } catch (error) {
      return {
        dataset: null,
        error: error instanceof Error ? error.message : '清洗失败：未知错误',
      }
    }
  }, [sheet, mapping, settings, identity, datasetName])

  const dataset = outcome.dataset
  const currentKey = cleaningSettingsKey(settings)
  const committedIsCurrent = committed !== null && committedKey === currentKey

  const updateSettings = (patch: Partial<CleaningSettings>): void => {
    setSettings((current) => ({ ...current, ...patch }))
    setNotice(null)
  }

  /**
   * 当前表的签名（用户需求 ①）：人工修正按「物理行号 + 字段」定位，
   * 因此保存修正时必须记下「这是哪一份表」；换表后清洗层会拒绝套用。
   */
  const sheetSignature = useMemo(() => sheetSignatureOf(sheet), [sheet])

  /**
   * 保存一处人工修正（用户需求 ①）。
   *
   * 只改**清洗设置**里的修正清单，不改任何记录：清算是 `settings → cleanSheet` 的单向流，
   * 因此这里一 setState，整份数据集、问题码、质量统计与看板数字都会跟着重算
   * （见 `docs/DECISIONS.md` D-091：修正是清洗输入，不是界面状态）。
   * 同一行同一字段重复修改时**替换**旧的那一条，不叠加。
   */
  const applyCorrection = (input: {
    readonly sourceRow: number
    readonly field: StandardFieldKey
    readonly correctedValue: string
    readonly reason: string
  }): void => {
    const next: ManualCorrection = {
      sourceSheet: sheet.sourceSheet,
      sourceRow: input.sourceRow,
      field: input.field,
      correctedValue: input.correctedValue,
      reason: input.reason,
      correctedAt: new Date().toISOString(),
    }
    updateSettings({
      manualCorrections: [
        ...settings.manualCorrections.filter(
          (item) => !(item.sourceRow === input.sourceRow && item.field === input.field),
        ),
        next,
      ],
      // 记下这一份表：签名变了（换表）修正就不会被套用
      manualCorrectionsSheetSignature: sheetSignature,
    })
    setNotice(
      `已保存一处人工修改（第 ${formatInteger(input.sourceRow)} 行 · ${getStandardField(input.field).header}）：数据集已按新值重新清洗，报告与导出会注明「含人工修改」。`,
    )
  }

  /** 撤销一处人工修正：从清单里移除即可，重新清洗后该格回到规则算出的值 */
  const removeCorrection = (correction: ManualCorrection): void => {
    const remaining = settings.manualCorrections.filter(
      (item) => !(item.sourceRow === correction.sourceRow && item.field === correction.field),
    )
    updateSettings({
      manualCorrections: remaining,
      manualCorrectionsSheetSignature: remaining.length === 0 ? null : sheetSignature,
    })
    setNotice(
      `已撤销第 ${formatInteger(correction.sourceRow)} 行「${getStandardField(correction.field).header}」的人工修改：该格已回到规则算出的值。`,
    )
  }

  const resetSettings = (): void => {
    setSettings(
      createDefaultCleaningSettings({ dataAsOf: defaultDataAsOf(new Date()), importMode: '新建快照' }),
    )
    setNotice('已恢复最保守默认值：薪资「暂不确定」、日月顺序未确认、隐藏行包含、表头回声行保留、去重未确认。')
  }

  const handleCommit = (): void => {
    if (dataset === null) {
      setNotice('清洗结果不可用：请先按下面的提示处理阻断原因。')
      return
    }
    commitNormalizedDataset(dataset)
    setCommitted(dataset)
    setCommittedKey(currentKey)
    // 不需要再单独记设置快照：`dataset.metadata.cleaningSettings` 就是提交那一刻的完整设置
    // （见 `cleanSheet`），因此换成读元信息后，这份快照还会跟着数据集一起进加密仓与报告。
    setNotice(
      `已将数据集「${dataset.metadata.datasetName}」放入本机会话（仅内存，刷新即清除）；持久化与加密由下一步的本地仓接管。`,
    )
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">清洗输入</h2>
            <p className="mt-1 text-xs text-slate-600">
              源表 {sheet.sourceSheet} 的表头第 {formatInteger(sheet.header.sourceRow)} 行 · 数据{' '}
              {formatInteger(sheet.rows.length)} 行 · 映射确认于 {mapping.confirmedAt ?? '未确认'} ·
              规则版本 {dataset?.metadata.ruleVersion.rulesVersion ?? '—'}
            </p>
          </div>
          <Link className="text-xs text-slate-600 underline" to="/mapping">
            回到字段映射
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Stat label="保留行" value={dataset === null ? '—' : formatInteger(dataset.records.length)} />
          <Stat
            label="问题行"
            value={dataset === null ? '—' : formatInteger(dataset.report.counts.issueRowCount)}
          />
          <Stat
            label="禁用模块"
            value={dataset === null ? '—' : formatInteger(dataset.metadata.disabledModules.length)}
          />
          <Stat
            label="覆盖需求数"
            value={
              dataset === null ? '—' : formatInteger(dataset.metadata.counts.distinctRequirementCount)
            }
          />
        </div>
      </section>

      {outcome.error !== null && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          无法清洗：{outcome.error}
        </p>
      )}

      <CleaningSettingsPanel
        committedSettings={committedSettings}
        onChange={updateSettings}
        onReset={resetSettings}
        settings={settings}
      />

      {dataset !== null && dataset.report.issues.some((issue) => issue.sourceRow === null) && (
        <section className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <h2 className="text-sm font-semibold">数据集级问题（不属于某一行）</h2>
          <ul className="list-disc space-y-1 pl-5">
            {dataset.report.issues
              .filter((issue) => issue.sourceRow === null)
              .map((issue, index) => (
                <li key={`${issue.code}-${String(index)}`}>
                  {describeIssue(issue)}：{issue.message}
                </li>
              ))}
          </ul>
        </section>
      )}

      {dataset !== null && (
        <DuplicateReviewPanel
          confirmed={settings.dedupConfirmed}
          duplicateRowCount={dataset.report.duplicateRowCount}
          exactGroups={dataset.report.exactDuplicateGroups}
          onConfirmChange={(confirmed) => {
            updateSettings({ dedupConfirmed: confirmed })
          }}
          onStrategyChange={(strategy) => {
            updateSettings({ dedupStrategy: strategy })
          }}
          records={dataset.records}
          strategy={settings.dedupStrategy}
          suspectedGroups={dataset.report.suspectedDuplicateGroups}
        />
      )}

      {dataset !== null && <QualityReportPanel report={dataset.report} />}

      {/*
        异常行清单与人工修正（用户需求 ①）：放在质量报告之后、逐行预览之前——
        用户的动作顺序是「先看哪里有问题 → 再去改 → 最后逐行核对」。
      */}
      {dataset !== null && (
        <IssueWorklistPanel
          corrections={settings.manualCorrections}
          datasetName={datasetName}
          onApply={(input) => {
            applyCorrection(input)
          }}
          onRemove={(correction) => {
            removeCorrection(correction)
          }}
          records={dataset.records}
          report={dataset.report}
          sheetSignature={sheetSignature}
        />
      )}

      {dataset !== null && <NormalizedPreviewTable records={dataset.records} />}

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-900">提交数据集</h2>
        <p className="text-xs text-slate-600">
          提交后本会话才持有这份规范化数据集（仅内存，不写 IndexedDB / localStorage / Cookie）。
          重新导入表格或放弃当前表会作废该数据集，但保留上面的设置草稿，便于比较不同口径。
        </p>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            数据集名称
            <input
              className="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900"
              onChange={(event) => {
                setDatasetName(event.target.value)
                setNotice(null)
              }}
              type="text"
              value={datasetName}
            />
          </label>
          <button
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
            disabled={dataset === null}
            onClick={handleCommit}
            type="button"
          >
            提交为规范化数据集
          </button>
          {committed !== null && (
            <span className="text-xs text-slate-600">
              会话中现有数据集：{committed.metadata.datasetName} ·{' '}
              {formatInteger(committed.records.length)} 行 · 规则版本{' '}
              {committed.metadata.ruleVersion.rulesVersion}
              {committedIsCurrent ? ' · 与当前设置一致' : ' · 当前设置已变化，需重新提交'}
            </span>
          )}
        </div>

        {notice !== null && (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">{notice}</p>
        )}
      </section>
    </div>
  )
}

type StatProps = { readonly label: string; readonly value: string }

function Stat({ label, value }: StatProps) {
  return (
    <div className="rounded-md bg-slate-50 px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold text-slate-900">{value}</dd>
    </div>
  )
}
