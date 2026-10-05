import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  EMPTY_MAPPING_DECISIONS,
  applyMappingDecisions,
  applyMappingTemplate,
  buildImportMapping,
  buildMappingTemplate,
  summarizeColumns,
  suggestHeaderTarget,
  suggestMapping,
  type ConflictResolution,
  type ImportMapping,
  type MappingCounts,
  type MappingDecisions,
  type MappingState,
  type MappingTargetChoice,
  type MappingTemplate,
  type RawSheet,
} from '../../domain'
import { formatInteger } from '../../lib/format'
import {
  confirmImportMapping,
  getImportSession,
  mappingTemplateKey,
  removeMappingTemplate,
  saveMappingDraft,
  saveMappingTemplate,
  type MappingSessionDraft,
} from '../../storage/sessionStore'
import ConflictPanel from './ConflictPanel'
import MappingTable from './MappingTable'
import MappingTemplatePanel from './MappingTemplatePanel'
import MissingFieldsPanel from './MissingFieldsPanel'
import RowPreviewPanel from './RowPreviewPanel'

const SOURCE_KIND_LABELS: Readonly<Record<string, string>> = {
  xlsx: 'Excel 工作簿',
  csv: 'CSV / TSV 文件',
  'tsv-paste': '粘贴内容',
}

type MappingEditorProps = {
  readonly sheet: RawSheet
  readonly initialDraft: MappingSessionDraft | null
  readonly initialMapping: ImportMapping | null
}

/**
 * 字段映射主体（步骤4）：四级自动建议 → 人工改写 → 冲突处置 → 缺列确认 → 提交映射。
 *
 * 三条不可退让的规则：
 * 1. 自动识别只是**建议**：别名与模糊建议必须逐列确认，模糊建议永不自动提交；
 * 2. 冲突不静默覆盖：必须选择一列或显式登记合并规则，未处置前阻断提交；
 * 3. 缺 offer 状态列阻断；缺其他列要逐项告知并确认「部分分析导入」（说明被禁用的模块）。
 *
 * 所有状态都由 `domain/mapping.ts` 的纯函数推导，组件内不重复实现任何口径。
 */
export default function MappingEditor({ sheet, initialDraft, initialMapping }: MappingEditorProps) {
  const plan = useMemo(() => suggestMapping(sheet.header.headers), [sheet])
  const summaries = useMemo(() => summarizeColumns(sheet), [sheet])
  const suggestions = useMemo(
    () => sheet.header.headers.map((header) => suggestHeaderTarget(header)),
    [sheet],
  )

  const [decisions, setDecisions] = useState<MappingDecisions>(() =>
    initialDraft !== null && initialDraft.headerSignature === plan.sourceHeaderSignature
      ? initialDraft.decisions
      : EMPTY_MAPPING_DECISIONS,
  )
  const [templates, setTemplates] = useState<readonly MappingTemplate[]>(
    () => getImportSession().templates,
  )
  const [templateName, setTemplateName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{
    readonly mapping: ImportMapping
    readonly key: string
  } | null>(() => {
    if (initialMapping === null || initialDraft === null) {
      return null
    }
    return { mapping: initialMapping, key: JSON.stringify(initialDraft.decisions) }
  })

  const state = useMemo(() => applyMappingDecisions(plan, decisions), [plan, decisions])
  const decisionsKey = useMemo(() => JSON.stringify(decisions), [decisions])
  const confirmedNow = confirmation !== null && confirmation.key === decisionsKey

  /** 编辑即写回会话草稿：返回导入页再回来不丢编辑（内存，不落盘） */
  useEffect(() => {
    saveMappingDraft({ headerSignature: plan.sourceHeaderSignature, decisions })
  }, [decisions, plan.sourceHeaderSignature])

  const updateColumn = (columnIndex: number, choice: MappingTargetChoice | null): void => {
    setDecisions((current) => ({
      ...current,
      overrides: { ...current.overrides, [columnIndex]: choice },
      confirmedColumns: current.confirmedColumns.filter((index) => index !== columnIndex),
    }))
    setNotice(null)
  }

  const updateConfirmation = (columnIndex: number, confirmed: boolean): void => {
    setDecisions((current) => {
      const next = new Set(current.confirmedColumns)
      if (confirmed) {
        next.add(columnIndex)
      } else {
        next.delete(columnIndex)
      }
      return { ...current, confirmedColumns: [...next].sort((left, right) => left - right) }
    })
    setNotice(null)
  }

  const resolveConflict = (groupId: string, resolution: ConflictResolution): void => {
    setDecisions((current) => ({
      ...current,
      conflictResolutions: { ...current.conflictResolutions, [groupId]: resolution },
    }))
    setNotice(null)
  }

  const acknowledgePartialImport = (acknowledged: boolean): void => {
    setDecisions((current) => ({ ...current, acknowledgedPartialImport: acknowledged }))
    setNotice(null)
  }

  const resetDecisions = (): void => {
    setDecisions(EMPTY_MAPPING_DECISIONS)
    setNotice('已恢复四级自动识别结果（人工改写、冲突处置与逐列确认都已清除）。')
  }

  const handleSaveTemplate = (): void => {
    const template = buildMappingTemplate({
      name: templateName,
      state,
      createdAt: new Date().toISOString(),
    })
    saveMappingTemplate(template)
    setTemplates(getImportSession().templates)
    setTemplateName('')
    setNotice(`已保存映射模板「${template.name}」：只含表头与目标字段，不含任何样例值。`)
  }

  const handleApplyTemplate = (template: MappingTemplate): void => {
    const application = applyMappingTemplate(template, sheet.header.headers)
    setDecisions({
      ...EMPTY_MAPPING_DECISIONS,
      templateOverrides: application.templateOverrides,
      conflictResolutions: application.conflictResolutions,
      appliedTemplateName: template.name,
    })
    setNotice(
      `已应用模板「${template.name}」：命中 ${formatInteger(application.matchedColumnCount)} 列，` +
        `${formatInteger(application.untouchedColumnCount)} 列保持四级自动建议。` +
        (application.unmatchedHeaders.length === 0
          ? ''
          : `模板中的 ${application.unmatchedHeaders.join('、')} 未出现在本次导入中。`),
    )
  }

  const handleRemoveTemplate = (key: string): void => {
    removeMappingTemplate(key)
    setTemplates(getImportSession().templates)
    setNotice('已删除该映射模板（只影响本机会话，不影响当前映射）。')
  }

  const handleConfirm = (): void => {
    const mapping = buildImportMapping({
      state,
      templateName: decisions.appliedTemplateName,
      confirmedAt: new Date().toISOString(),
    })
    confirmImportMapping(mapping)
    setConfirmation({ mapping, key: decisionsKey })
    setNotice('字段映射已确认。确认结果只保存在内存中，清洗预览将在下一步（步骤5）实现。')
  }

  const counts = state.counts
  const confirmedMapping = confirmation?.mapping ?? null

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
        自动识别只是建议：精确与规范化匹配可以直接使用，别名与模糊建议必须逐列确认；
        两个源列指向同一目标时必须选择其中一列或显式登记合并规则，系统不会静默覆盖。
        解析结果与映射草稿都只保存在本机内存中，刷新或关闭页面即清除。
      </p>

      <MappingHeader counts={counts} sheet={sheet} state={state} />
      <BlockingReasons reasons={state.reasons} />

      {notice !== null && (
        <p className="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">{notice}</p>
      )}

      <ConflictPanel
        conflicts={state.conflicts}
        onResolve={resolveConflict}
        resolutions={decisions.conflictResolutions}
      />

      <MappingTable
        conflicts={state.conflicts}
        entries={state.entries}
        onChange={updateColumn}
        onConfirmColumn={updateConfirmation}
        suggestions={suggestions}
        summaries={summaries}
      />

      <RowPreviewPanel entries={state.entries} sheet={sheet} />

      <MissingFieldsPanel
        acknowledged={decisions.acknowledgedPartialImport}
        disabledModules={state.disabledModules}
        missingFields={state.missingStandardFields}
        onAcknowledge={acknowledgePartialImport}
      />

      <MappingTemplatePanel
        name={templateName}
        onApply={handleApplyTemplate}
        onNameChange={setTemplateName}
        onRemove={handleRemoveTemplate}
        onSave={handleSaveTemplate}
        resolveKey={mappingTemplateKey}
        templates={templates}
      />

      <section className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          onClick={resetDecisions}
          type="button"
        >
          恢复四级自动识别
        </button>
        <button
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          disabled={!state.canConfirm}
          onClick={handleConfirm}
          type="button"
        >
          确认字段映射
        </button>

        {confirmedNow ? (
          <Link
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
            to="/cleaning"
          >
            下一步：清洗预览
          </Link>
        ) : (
          <span className="text-xs text-slate-500">
            清洗预览（步骤5）只在确认映射之后接收这份配置；未确认时不会进入清洗。
          </span>
        )}

        {confirmation !== null && !confirmedNow && (
          <span className="text-xs text-amber-700">映射已修改，请重新确认后再进入清洗。</span>
        )}

        {confirmedNow && confirmedMapping !== null && (
          <span className="text-xs text-slate-500">
            已确认 · 忽略列 {formatInteger(confirmedMapping.ignoredColumns.length)} 个 · 合并规则{' '}
            {formatInteger(confirmedMapping.merges.length)} 条 · 模板{' '}
            {confirmedMapping.templateName ?? '未使用'}
          </span>
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

type MappingHeaderProps = {
  readonly sheet: RawSheet
  readonly state: MappingState
  readonly counts: MappingCounts
}

/** 来源信息与映射进度概览（来源、行数、列数与 7 个映射计数） */
function MappingHeader({ sheet, state, counts }: MappingHeaderProps) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">本次解析结果的表头</h2>
          <p className="mt-1 text-xs text-slate-600">
            来源：{SOURCE_KIND_LABELS[sheet.sourceKind] ?? sheet.sourceKind} · {sheet.sourceSheet} · 表头第{' '}
            {formatInteger(sheet.header.sourceRow)} 行 · 数据 {formatInteger(sheet.rows.length)} 行 · 共{' '}
            {formatInteger(counts.columnCount)} 列
            {sheet.sourceFileName === null ? '' : '（文件名只在界面上显示，不写入日志、报告或导出）'}
          </p>
        </div>
        <Link className="text-xs text-slate-600 underline" to="/import">
          回到导入页
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="标准字段已映射" value={`${formatInteger(counts.mappedStandardCount)} / 21`} />
        <Stat label="扩展列" value={formatInteger(counts.mappedExtensionCount)} />
        <Stat label="忽略列" value={formatInteger(counts.ignoredCount)} />
        <Stat label="自动识别" value={formatInteger(counts.autoMatchedCount)} />
        <Stat label="待确认建议" value={formatInteger(counts.pendingConfirmationCount)} />
        <Stat label="未解决冲突" value={formatInteger(counts.conflictCount)} />
        <Stat label="缺失标准列" value={formatInteger(state.missingStandardFields.length)} />
      </dl>
    </section>
  )
}

type BlockingReasonsProps = { readonly reasons: readonly string[] }

/** 逐条说明为什么还不能提交（阻断 → 待确认建议 → 缺列确认） */
function BlockingReasons({ reasons }: BlockingReasonsProps) {
  if (reasons.length === 0) {
    return null
  }
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <h2 className="text-sm font-semibold text-slate-900">还不能提交的原因</h2>
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
        {reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
    </section>
  )
}


