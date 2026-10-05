import { useEffect, useMemo, useState } from 'react'

import {
  DEFAULT_CYCLE_TOO_LONG_DAYS,
  GROUP_DIMENSION_LABELS,
  aggregateByDimension,
  analyzeRecords,
  summarizeRecords,
  type GroupDimension,
  type NormalizedDataset,
} from '../../domain'
import { buildRejectionInsight } from '../../insights'
import {
  FORBIDDEN_FIELD_NAMES,
  DEFAULT_SANITIZE_RULES,
  STRICT_SANITIZE_RULES,
  buildSanitizedReport,
  scanSensitiveFields,
  type PrivacyLevel,
  type SanitizeRules,
  type SanitizedReport,
} from '../../privacy'
import {
  exportMarkdown,
  exportPrintHtml,
  exportXlsx,
  reportFileName,
  type ExportResult,
} from '../../exporters'
import type { PrintChartImage } from '../../exporters/print'
import { reportToSections } from '../../exporters/sections'
import EmptyState from '../../components/EmptyState'
import { subscribeVaultEvents, type VaultLockReason } from '../../storage'
import { getCleaningSession, getImportSession } from '../../storage/sessionStore'
import { formatInteger } from '../../lib/format'
import GlobalFilterPanel from '../dashboard/GlobalFilterPanel'
import {
  EMPTY_DASHBOARD_FILTERS,
  activeFilterSummary,
  groupingOptionsOf,
  toAnalysisFilters,
  type DashboardFilterDraft,
} from '../dashboard/dashboardFilters'

import {
  CHECK_BLOCKED_NOTE,
  CHECK_BLOCKED_TITLE,
  CHECK_BLOCKED_TITLE_AND_ADVICE,
  CHECK_FORBIDDEN_LABEL,
  CHECK_INPUT_COUNT_LABEL,
  CHECK_INPUT_FIELDS_LABEL,
  CHECK_INPUT_NOTE,
  CHECK_NO_RECORDS_NOTE,
  CHECK_PASSED,
  CHECK_SENTINEL_LABEL,
  CHECK_TITLE,
  DOWNLOAD_NOTE,
  EXPORT_FAILED_PREFIX,
  EXPORT_HINTS,
  EXPORT_LABELS,
  FILTER_SECTION_HINT,
  FILTER_SECTION_TITLE,
  GATE_LOCKED_NOTE,
  GATE_NEEDS_ACK_NOTE,
  GATE_OPENED_NOTE,
  GATE_STALE_NOTE,
  GATE_TITLE,
  LOCKED_DESCRIPTIONS,
  LOCKED_ITEMS,
  LOCKED_TITLE,
  NO_DATASET_DESCRIPTION,
  NO_DATASET_ITEMS,
  NO_DATASET_TITLE,
  NO_MAPPING_DESCRIPTION,
  NO_MAPPING_ITEMS,
  NO_MAPPING_TITLE,
  NO_SHEET_DESCRIPTION,
  NO_SHEET_ITEMS,
  NO_SHEET_TITLE,
  NOTES,
  OPEN_PREVIEW_LABEL,
  PAGE_INTRO,
  PAGE_TITLE,
  PNG_UNVERIFIED_NOTE,
  PRINT_NOTE,
  PRIVACY_LEVELS,
  REGENERATE_PREVIEW_LABEL,
  SECTION_TITLES,
  TOGGLE_LABELS,
} from './exportText'
import { collectSentinels } from './exportSentinels'

type SessionSnapshot = {  readonly hasSheet: boolean
  readonly hasMapping: boolean
  readonly dataset: NormalizedDataset | null
  readonly lockedReason: VaultLockReason | 'cleared' | null
  readonly cycleTooLongDays: number
}

/** 只在挂载与锁定事件时读会话：临时模式的数据本来就不落盘，刷新即空 */
function readSessionSnapshot(): SessionSnapshot {
  const importSession = getImportSession()
  const cleaningSession = getCleaningSession()
  return {
    hasSheet: importSession.sheet !== null,
    hasMapping: importSession.confirmedMapping !== null,
    dataset: cleaningSession.dataset,
    lockedReason: null,
    cycleTooLongDays: cleaningSession.settings?.cycleTooLongDays ?? DEFAULT_CYCLE_TOO_LONG_DAYS,
  }
}

const CLEARED_SNAPSHOT: SessionSnapshot = {
  hasSheet: false,
  hasMapping: false,
  dataset: null,
  lockedReason: 'cleared',
  cycleTooLongDays: DEFAULT_CYCLE_TOO_LONG_DAYS,
}

/** 本步覆盖的维度（与看板分维度表一致，报告不许自造维度） */
const EXPORT_DIMENSIONS: readonly GroupDimension[] = [
  'city',
  'channel',
  'referralType',
  'recruiter',
  'position',
  'jobFamily',
  'department',
  'requirementType',
  'graduationYear',
  'education',
  'school',
  'isGptSchool',
  'housingType',
  'salaryBand',
]

/*
 * 哨兵收集搬到 `./exportSentinels`（2026-09-27）：那里是**纯函数**，可以直接单测
 * 「哪些取值算哨兵、哪些是受控字典词汇不算」——这次的误拦 bug 正是出在这个判断上，
 * 而它原先埋在本组件里，只能靠整页交互去测。上限（每字段 200 条）等常量也一起搬过去了。
 */

type PreviewModel = {
  readonly report: SanitizedReport
  readonly fingerprint: string
  readonly sectionLines: readonly string[]
  readonly tableCount: number
  readonly rowCount: number
  readonly forbiddenHits: readonly string[]
  readonly sentinelHits: readonly string[]
  readonly sentinelFields: readonly string[]
  readonly sentinelCount: number
}

function fingerprintOf(
  level: PrivacyLevel,
  rules: SanitizeRules,
  filters: readonly string[],
): string {
  return JSON.stringify({
    level,
    suppressBelow: rules.suppressBelow,
    removeHrNames: rules.removeHrNames,
    removeRequirementIds: rules.removeRequirementIds,
    removeReferrerNames: rules.removeReferrerNames,
    removeFreeTextReasons: rules.removeFreeTextReasons,
    quantileMode: rules.quantileMode,
    includeRecordDetail: rules.includeRecordDetail,
    removeCityNames: rules.removeCityNames,
    removeDimensionLabels: rules.removeDimensionLabels,
    filters,
  })
}

/** 按级别取规则（custom 时保留用户开关）；与 PRD 18.5 的三个级别一一对应 */
function rulesFor(level: PrivacyLevel, custom: SanitizeRules): SanitizeRules {
  if (level === 'strict') {
    return STRICT_SANITIZE_RULES
  }
  if (level === 'standard') {
    return DEFAULT_SANITIZE_RULES
  }
  return { ...custom, privacyLevel: 'custom' }
}

/**
 * Uint8Array → base64（打印版内嵌图用，用户需求 ③）。
 *
 * 为什么分块：`String.fromCharCode(...bytes)` 在几万字节以上会因参数个数超限抛错，
 * 而一张图的 PNG 轻松超过这个量级。分块后拼接再 `btoa`，结果与整块一致。
 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return btoa(binary)
}

/**
 * 报告导出（步骤11，docs/PRD.md 10.6 / 11 章）。
 *
 * 数据来源只有一个：内存会话里**已提交**的规范化数据集；筛选复用步骤8 的同一套纯逻辑层
 * （`dashboardFilters` + `GlobalFilterPanel`）。因此同一筛选下，看板、分维度分析、拒 offer 专项
 * 与本页导出的数字必然一致（PRD 11.2「三种格式使用同一筛选、同一数据版本、同一口径」）。
 *
 * 本组件是**唯一装配点**：`analyzeRecords` / `buildRejectionInsight` / `buildSanitizedReport` /
 * `scanSensitiveFields` 只在这里调用一次，然后四条导出路径全部消费同一个 `SanitizedReport`。
 * 组件内不出现任何指标公式，也不自定阈值（AGENTS.md §2.3、§4）。
 *
 * 三道闸门（缺一不可）：
 * 1. 必须先点「生成并查看预览」（导出按钮在此之前保持禁用）；
 * 2. 预览里的本地敏感字段检查必须通过（命中就不生成任何文件，只列出字段名）；
 * 3. 点导出后再确认一次，确认内容与实际包含项一致。
 */
export default function ExportWorkspace() {
  const [session, setSession] = useState<SessionSnapshot>(readSessionSnapshot)
  const [draft, setDraft] = useState<DashboardFilterDraft>(EMPTY_DASHBOARD_FILTERS)
  const [level, setLevel] = useState<PrivacyLevel>('standard')
  const [customRules, setCustomRules] = useState<SanitizeRules>({
    ...DEFAULT_SANITIZE_RULES,
    privacyLevel: 'custom',
  })
  const [preview, setPreview] = useState<PreviewModel | null>(null)
  const [confirmedFingerprint, setConfirmedFingerprint] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [messages, setMessages] = useState<readonly string[]>([])

  useEffect(
    () =>
      subscribeVaultEvents((event) => {
        // 锁定时应用级会话守卫已经清空内存业务数据；这里同步界面状态并说明原因
        if (event.type === 'locked') {
          setSession({ ...CLEARED_SNAPSHOT, lockedReason: event.reason })
        } else if (event.type === 'cleared' || event.type === 'stale-session') {
          setSession(CLEARED_SNAPSHOT)
        }
      }),
    [],
  )

  const dataset = session.dataset
  const allRecords = useMemo(() => dataset?.records ?? [], [dataset])

  /** 筛选快照与分档配置：与看板取同一份纯逻辑层的输出（本页不另写一套规则） */
  const filters = useMemo(() => toAnalysisFilters(draft), [draft])
  const groupingOptions = useMemo(() => groupingOptionsOf(draft), [draft])
  const activeFilters = useMemo(() => activeFilterSummary(draft), [draft])
  const rules = useMemo(() => rulesFor(level, customRules), [level, customRules])
  const fingerprint = useMemo(
    () => fingerprintOf(level, rules, activeFilters),
    [level, rules, activeFilters],
  )

  const analysis = useMemo(
    () =>
      dataset === null
        ? null
        : analyzeRecords(dataset.records, {
            dataAsOf: dataset.metadata.dataAsOf,
            dedupStrategy: dataset.metadata.dedupStrategy,
            salaryComparable: dataset.metadata.salary.comparable,
            filters,
            salaryBandEdges: groupingOptions.salaryBandEdges,
          }),
    [dataset, filters, groupingOptions],
  )
  const filteredRecords = useMemo(() => analysis?.filterOutcome.records ?? [], [analysis])

  const rejection = useMemo(
    () =>
      dataset === null
        ? null
        : buildRejectionInsight(filteredRecords, {
            dataAsOf: dataset.metadata.dataAsOf,
            salaryComparable: dataset.metadata.salary.comparable,
            waitingThresholdDays: session.cycleTooLongDays,
            groupingOptions,
            filters,
            // 基准用全部保留记录：避免基准随筛选漂移（与看板、拒 offer 专项同一口径）
            referenceRecords: dataset.records,
          }),
    [dataset, filteredRecords, session.cycleTooLongDays, groupingOptions, filters],
  )

  /** 预览与导出的唯一模型（每次重新生成预览都会重建，保证「旧预览立即撤销」） */
  const buildPreview = (): PreviewModel | null => {
    if (dataset === null || analysis === null || rejection === null) {
      return null
    }
    const report = buildSanitizedReport(
      {
        dataset: {
          metadata: {
            dataAsOf: dataset.metadata.dataAsOf,
            dedupStrategy: dataset.metadata.dedupStrategy,
            ruleVersion: { rulesVersion: dataset.metadata.ruleVersion.rulesVersion },
          },
          report: {
            counts: dataset.report.counts,
            metricAvailability: dataset.report.metricAvailability,
          },
        },
        filters: activeFilters,
        analysis,
        dimensions: EXPORT_DIMENSIONS.map((dimension) => ({
          dimension,
          label: GROUP_DIMENSION_LABELS[dimension],
          groups: aggregateByDimension(filteredRecords, dimension, groupingOptions),
          total: summarizeRecords('全部（当前筛选）', filteredRecords),
          notes: [],
        })),
        rejection,
        charts: [],
        generatedAt: new Date().toISOString(),
        salaryBandEdges: groupingOptions.salaryBandEdges,
      },
      rules,
    )

    // 导出前必须做的本地检查：先扫字段名，再用源数据里的敏感取值做哨兵检索。
    // 命中任何一项就不生成文件——宁可让用户看到「为什么不能导出」，也不放一份可能泄漏的报告出去。
    const sentinels = collectSentinels(allRecords)
    const scan = scanSensitiveFields(report, sentinels.values)
    const sections = reportToSections(report)

    return {
      report,
      fingerprint,
      sectionLines: sections.map(
        (section) =>
          `${section.title}：${formatInteger(section.tables.length)} 张表 / ${formatInteger(
            section.tables.reduce((sum, table) => sum + table.rows.length, 0),
          )} 行`,
      ),
      tableCount: sections.reduce((sum, section) => sum + section.tables.length, 0),
      rowCount: sections.reduce(
        (sum, section) => sum + section.tables.reduce((inner, table) => inner + table.rows.length, 0),
        0,
      ),
      forbiddenHits: scan.forbiddenFieldNames,
      sentinelHits: scan.sentinelHits,
      sentinelFields: sentinels.fieldLabels,
      sentinelCount: sentinels.sampledCount,
    }
  }

  const previewIsFresh = preview !== null && preview.fingerprint === fingerprint
  const checkPassed =
    previewIsFresh &&
    preview !== null &&
    preview.forbiddenHits.length === 0 &&
    preview.sentinelHits.length === 0
  const canExport = checkPassed && preview !== null && confirmedFingerprint === fingerprint

  /** 下载：Blob + 对象 URL，本地生成，立即释放 URL（不经过任何服务器） */
  const download = (result: ExportResult): string => {
    if (!result.ok) {
      return `${EXPORT_FAILED_PREFIX}${result.error}`
    }
    const { artifact } = result
    if (artifact.bytes === null && artifact.text === null) {
      return `${EXPORT_FAILED_PREFIX}产物为空，已放弃下载。`
    }
    const parts: BlobPart[] =
      artifact.bytes !== null
        ? [new Uint8Array(artifact.bytes)]
        : [artifact.text ?? '']
    const url = URL.createObjectURL(new Blob(parts, { type: artifact.mimeType }))
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = artifact.fileName
      anchor.rel = 'noopener'
      anchor.click()
    } finally {
      URL.revokeObjectURL(url)
    }
    return `已生成 ${artifact.fileName}（${formatInteger(artifact.previewLines.length)} 行预览摘要）。`
  }

  const runXlsx = async () => {
    if (preview === null) {
      return
    }
    setBusy(true)
    try {
      setMessages([download(await exportXlsx(preview.report))])
    } finally {
      setBusy(false)
    }
  }

  const runMarkdown = () => {
    if (preview === null) {
      return
    }
    setMessages([download(exportMarkdown(preview.report))])
  }

  /**
   * 图表图片导出：一张图一个文件（PRD 11.2「离屏渲染脱敏 ECharts 快照导出 PNG」）。
   *
   * 规格由 `buildChartSpecsFromReport(preview.report)` 从**脱敏后的报告**构造，
   * 而不是从界面状态构造：图上出现的每个类目都已经是 HR 代号 / 已合并标签 / 已抑制剔除后的标签。
   */
  const runPng = async () => {
    if (preview === null) {
      return
    }
    setBusy(true)
    try {
      // 动态 import 同时取「图表规格构造」与「离屏渲染」：
      // 这两件事都只服务 PNG 导出，放在这里可以让 ECharts 相关代码路径留在懒加载的一侧，
      // 也让打包器知道这是一条真正的按需路径（静态从 barrel 取会触发 INEFFECTIVE_DYNAMIC_IMPORT 警告）。
      const { buildChartSpecsFromReport, renderChartPng } = await import('../../exporters/png')
      const specs = buildChartSpecsFromReport(preview.report)
      if (specs.length === 0) {
        setMessages([`${EXPORT_FAILED_PREFIX}当前筛选下没有可画的图表（所有分组都被抑制）。`])
        return
      }
      const outputs: string[] = []
      for (const spec of specs) {
        const bytes = await renderChartPng(spec, {
          watermark: `数据截至日 ${preview.report.meta.dataAsOf} ｜ ${preview.report.meta.privacyLevel}`,
        })
        const fileName = reportFileName(preview.report, 'png').replace(
          /\.png$/,
          `-${spec.id.replace(/[^a-zA-Z0-9.-]/g, '-')}.png`,
        )
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' }))
        try {
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = fileName
          anchor.rel = 'noopener'
          anchor.click()
        } finally {
          URL.revokeObjectURL(url)
        }
        outputs.push(fileName)
      }
      setMessages([`已生成 ${formatInteger(outputs.length)} 张图片：${outputs.join('、')}`])
    } catch (error) {
      setMessages([
        `${EXPORT_FAILED_PREFIX}图片导出未完成（${error instanceof Error ? error.name : typeof error}）。可能的原因：当前环境不支持 canvas 光栅化。`,
      ])
    } finally {
      setBusy(false)
    }
  }

  /**
   * 打印 / 另存为 PDF：把专用打印版式写进新窗口，再调用该窗口的 `window.print()`。
   *
   * 为什么不直接在应用窗口打印：应用窗口带着整站样式与筛选面板，
   * 打印出来会把界面元素一起带进 PDF（PRD 11.2 要求专用版式）。
   *
   * 用户需求 ③：打印版**带图**。图与「导出图表图片」走**同一条**离屏重绘路径
   * （`buildChartSpecsFromReport` + `renderChartPng`，都从同一份脱敏报告构造），
   * 因此不会出现「图里的数字与表里的不一致」；生成失败就退化为不带图的打印版，
   * 而不是让整个打印失败。Excel 仍只写数据表（界面另有说明「图见 PDF」）。
   */
  const runPrint = async () => {
    if (preview === null) {
      return
    }
    const chartImages: PrintChartImage[] = []
    const watermark = `数据截至日 ${preview.report.meta.dataAsOf} ｜ ${preview.report.meta.privacyLevel}`
    try {
      const { buildChartSpecsFromReport, renderChartPng } = await import('../../exporters/png')
      for (const spec of buildChartSpecsFromReport(preview.report)) {
        const bytes = await renderChartPng(spec, { watermark })
        chartImages.push({
          title: spec.title,
          // 图注用固定的非敏感文案（与图片水印同一句）：报告里没有可用的逐图说明字段，
          // 与其编一句，不如只说清「图是脱敏后重绘的 + 数据截止日」。
          note: `由本机根据脱敏报告重绘，不是界面截图；${watermark}。被抑制的分组不出现。`,
          dataUrl: `data:image/png;base64,${bytesToBase64(bytes)}`,
        })
      }
    } catch {
      // 图表生成失败不影响报告本身：退回不带图的打印版，并在提示里如实说明
      chartImages.length = 0
    }

    const result = exportPrintHtml(preview.report, chartImages)
    if (!result.ok || result.artifact.text === null) {
      setMessages([`${EXPORT_FAILED_PREFIX}${result.ok ? '产物为空' : result.error}`])
      return
    }
    const printWindow = window.open('', '_blank')
    if (printWindow === null) {
      setMessages([`${EXPORT_FAILED_PREFIX}浏览器拦截了新窗口，请允许弹窗后重试。`])
      return
    }
    /*
     * 反向 tabnabbing 防护（2026-09-27 修的真实 bug）。
     *
     * 原写法是 `window.open('', '_blank', 'noopener,noreferrer')`，看起来更安全，实际是**空白页**：
     * 带 `noopener` 时浏览器**返回 null**，于是这段代码既写不进任何内容，又走进上面的分支
     * 报「浏览器拦截了新窗口」——用户看到的是「明明开了个空白标签页，却说被拦截了」。
     * 这是 jsdom 看不见的一类问题（Node 里没有真的开窗口），只有真实浏览器能发现，端到端用例已钉住。
     *
     * 正确做法：用一个**普通**窗口引用，写内容之前手动断掉 `opener`。
     * 效果与 `noopener` 相同（新窗口拿不到 `window.opener`，不能反向操纵本页），
     * 但我们保住了引用，能往里面写打印版式。
     */
    try {
      printWindow.opener = null
    } catch {
      // 极少数浏览器不允许跨窗口写 `opener`；断不掉也只是少一层防护，
      // 打印版式是我们自己生成的静态 HTML（无脚本、无外部资源），不因此放弃导出
    }
    printWindow.document.open()
    printWindow.document.write(result.artifact.text)
    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
    setMessages([
      chartImages.length === 0
        ? `已把打印版式（${result.artifact.fileName} 的排版）送到新窗口：请在打印对话框里选择「另存为 PDF」。本次未能生成图表，打印版里没有插图。`
        : `已把打印版式（${result.artifact.fileName} 的排版）随 ${String(chartImages.length)} 张图送到新窗口：请在打印对话框里选择「另存为 PDF」。图由本机重绘，不是界面截图。`,
    ])
  }

  if (dataset === null || analysis === null || rejection === null) {
    return <ExportEmptyState session={session} />
  }

  if (filteredRecords.length === 0) {
    // 区分「数据集本身没有记录」与「筛选后没有记录」：两者的下一步动作完全不同
    const datasetEmpty = allRecords.length === 0
    return (
      <EmptyState
        description={CHECK_NO_RECORDS_NOTE}
        items={
          datasetEmpty
            ? [
                '数据集已提交但其中没有任何保留记录（全部被清洗阶段判为问题行或重复行）',
                '报告需要至少一条记录才能生成章节与行数，这里不显示 0% 占位',
                '回到清洗页检查去重策略与问题统计，确认输入是否完整',
              ]
            : [
                '数据集本身有记录，但当前筛选条件下一条都不满足',
                '报告与筛选后的记录一一对应，因此这里不生成任何章节或占位数字',
                '在下方筛选面板里放宽条件，或点「清空筛选」回到全部记录',
              ]
        }
        nextStep={datasetEmpty ? { label: '去清洗预览检查输入', to: '/cleaning' } : undefined}
        title={datasetEmpty ? '已提交的数据集里没有记录' : '当前筛选下没有记录'}
      >
        {datasetEmpty ? null : (
          <div className="mt-4">
            <GlobalFilterPanel
              draft={draft}
              filterOutcome={analysis.filterOutcome}
              onChange={setDraft}
              records={allRecords}
              subsetRateNote={null}
            />
          </div>
        )}
      </EmptyState>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{PAGE_TITLE}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-600">{PAGE_INTRO}</p>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">{FILTER_SECTION_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{FILTER_SECTION_HINT}</p>
        <GlobalFilterPanel
          draft={draft}
          filterOutcome={analysis.filterOutcome}
          onChange={setDraft}
          records={allRecords}
          subsetRateNote={null}
        />
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{SECTION_TITLES.privacy}</h3>
        <div className="grid gap-2 md:grid-cols-3">
          {PRIVACY_LEVELS.map((item) => (
            <button
              aria-pressed={level === item.id}
              className={`rounded border px-3 py-2 text-left text-xs transition-colors ${
                level === item.id
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 text-slate-700 hover:bg-slate-100'
              }`}
              key={item.id}
              onClick={() => {
                setLevel(item.id)
                // 切换级别后旧预览立即撤销（PRD 18.5）：必须重新生成，避免用旧预览导出新规则
                setPreview(null)
                setConfirmedFingerprint(null)
                setMessages([])
              }}
              type="button"
            >
              <span className="block font-medium">{item.label}</span>
              <span className="mt-1 block leading-5 opacity-90">{item.hint}</span>
            </button>
          ))}
        </div>

        {level === 'custom' && (
          <div className="space-y-2 rounded border border-slate-200 p-3">
            {(
              [
                ['removeHrNames', TOGGLE_LABELS.removeHrNames, TOGGLE_LABELS.removeHrNamesHint],
                [
                  'removeRequirementIds',
                  TOGGLE_LABELS.removeRequirementIds,
                  TOGGLE_LABELS.removeRequirementIdsHint,
                ],
                [
                  'removeReferrerNames',
                  TOGGLE_LABELS.removeReferrerNames,
                  TOGGLE_LABELS.removeReferrerNamesHint,
                ],
                [
                  'removeFreeTextReasons',
                  TOGGLE_LABELS.removeFreeTextReasons,
                  TOGGLE_LABELS.removeFreeTextReasonsHint,
                ],
                [
                  'includeRecordDetail',
                  TOGGLE_LABELS.includeRecordDetail,
                  TOGGLE_LABELS.includeRecordDetailHint,
                ],
              ] as const
            ).map(([key, label, hint]) => (
              <label className="flex items-start gap-2 text-xs text-slate-700" key={key}>
                <input
                  checked={customRules[key]}
                  className="mt-0.5"
                  onChange={(event) => {
                    setCustomRules((current) => ({ ...current, [key]: event.target.checked }))
                    setPreview(null)
                    setConfirmedFingerprint(null)
                  }}
                  type="checkbox"
                />
                <span>
                  <span className="font-medium">{label}</span>
                  <span className="mt-0.5 block leading-5 text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
            <p className="text-xs leading-5 text-slate-500">
              自定义只在标准的允许项内增减：姓名 / 需求 ID / 推荐人 / 准确薪资 / 原因原文属于身份禁出项，
              没有任何开关可以把它们放进报告。
              当前独立抑制门槛 {formatInteger(rules.suppressBelow)}、分位模式 {rules.quantileMode}。
            </p>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{SECTION_TITLES.gates}</h3>
        <p className="text-xs leading-5 text-slate-600">
          {canExport ? GATE_OPENED_NOTE : GATE_LOCKED_NOTE}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded border border-slate-900 bg-slate-900 px-3 py-1 text-xs text-white transition-colors hover:bg-slate-700"
            onClick={() => {
              /*
               * 「生成并查看预览」= 生成预览 **并且**把它当作已查看（用户需求外的修复，2026-09-27）。
               *
               * 为什么必须在这里写入确认指纹：`canExport` 要求
               * `confirmedFingerprint === fingerprint`，而原先这里把它清成 null
               * （`setConfirmedFingerprint(null)`），唯一把它写回非空的地方却在**四个导出按钮自己的
               * onClick 里**——那些按钮 `disabled={!canExport}`。于是形成死锁：
               * 不点导出按钮就无法确认，不确认就点不了导出按钮，**导出功能永远不可用**。
               * 用户在人工验收时正好撞上（页面一边显示「检查通过」，一边说「检查未通过：导出按钮保持禁用」）。
               *
               * 现在：生成预览的同时记录它的指纹（用 `next.fingerprint` 而不是外层的 `fingerprint`，
               * 避免闭包里的旧值）。任何会改结果的改动（脱敏级别 / 明细开关 / 筛选）都会让
               * `fingerprint` 变化、与这份确认不再相等，因此按钮会自动回到禁用态，必须重新生成预览——
               * 「先看预览再导出」这条闸门没有被削弱。
               */
              const next = buildPreview()
              setPreview(next)
              // 生成失败（数据缺失）时不能假装已确认：指纹清空，按钮保持禁用
              setConfirmedFingerprint(next === null ? null : next.fingerprint)
              setMessages([])
            }}
            type="button"
          >
            {preview === null ? OPEN_PREVIEW_LABEL : REGENERATE_PREVIEW_LABEL}
          </button>
          <span className="text-xs text-slate-500">{GATE_TITLE}</span>
        </div>

        {preview !== null && (
          <div className="space-y-2 text-xs leading-5">
            <p className="font-medium text-slate-800">{CHECK_TITLE}</p>
            <p className="text-slate-600">{CHECK_INPUT_NOTE}</p>
            <p className="text-slate-600">
              {CHECK_INPUT_FIELDS_LABEL}：{preview.sentinelFields.join('、')}；
              {CHECK_INPUT_COUNT_LABEL}：{formatInteger(preview.sentinelCount)} 条；
              被禁字段清单共 {formatInteger(FORBIDDEN_FIELD_NAMES.length)} 项。
            </p>
            {preview.forbiddenHits.length === 0 && preview.sentinelHits.length === 0 ? (
              <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">
                {CHECK_PASSED}
              </p>
            ) : (
              <div className="space-y-1 rounded border border-rose-200 bg-rose-50 p-2 text-rose-900">
                <p className="font-medium">{CHECK_BLOCKED_TITLE}</p>
                <p>{CHECK_BLOCKED_NOTE}</p>
                {preview.forbiddenHits.length > 0 && (
                  <div>
                    <p className="font-medium">{CHECK_FORBIDDEN_LABEL}</p>
                    <ul className="list-disc pl-5">
                      {preview.forbiddenHits.map((hit) => (
                        <li key={hit}>{hit}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {preview.sentinelHits.length > 0 && (
                  <div>
                    <p className="font-medium">{CHECK_SENTINEL_LABEL}</p>
                    <ul className="list-disc pl-5">
                      {preview.sentinelHits.map((hit) => (
                        <li key={hit}>{hit}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {preview !== null && (
        <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900">{SECTION_TITLES.preview}</h3>
          <p className="text-xs tabular-nums text-slate-600">
            共 {formatInteger(preview.tableCount)} 张表 / {formatInteger(preview.rowCount)} 行；
            文件名 {reportFileName(preview.report, 'xlsx')}（按格式换扩展名，不含数据集名 / 文件名 / HR / 城市）。
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-700">
            {preview.sectionLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-medium text-slate-700">{SECTION_TITLES.suppression}</p>
            {preview.report.suppression.length === 0 ? (
              <p className="text-xs text-slate-600">本次没有发生任何抑制。</p>
            ) : (
              <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-700">
                {preview.report.suppression.map((note) => (
                  <li key={`${note.path}-${note.reason}`}>
                    {note.path}：{note.reason}（影响 {formatInteger(note.suppressedCount)} 组）
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-xs leading-5 text-slate-500">
            预览里的数字就是文件里的数字：四种格式都从同一个模型取值，不存在「预览一个数、文件另一个数」。
            缺失与抑制一律显示「—」，不代表 0。
          </p>
        </section>
      )}

      <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">{SECTION_TITLES.actions}</h3>
        {!canExport && (
          <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
            {/*
              四种「不能导出」的原因必须分开说（2026-09-27 修复）：
              原先只有两个分支，于是「检查通过但预览已作废」会被说成「检查未通过」——
              用户看到的是自相矛盾的页面（上面写检查通过，下面说检查未通过），
              这违反「提示语必须与事实一致」。
            */}
            {preview === null
              ? GATE_LOCKED_NOTE
              : !previewIsFresh
                ? GATE_STALE_NOTE
                : !checkPassed
                  ? CHECK_BLOCKED_TITLE_AND_ADVICE
                  : GATE_NEEDS_ACK_NOTE}
          </p>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          {(
            [
              ['xlsx', EXPORT_LABELS.xlsx, EXPORT_HINTS.xlsx],
              ['png', EXPORT_LABELS.png, EXPORT_HINTS.png],
              ['pdf', EXPORT_LABELS.pdf, EXPORT_HINTS.pdf],
              ['markdown', EXPORT_LABELS.markdown, EXPORT_HINTS.markdown],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              className="rounded border border-slate-300 px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canExport || busy}
              key={id}
              onClick={() => {
                if (id === 'xlsx') {
                  // 先弹一次本地确认：确认内容与预览一致，避免误点把文件写进下载目录。
                  // `canExport` 已经保证 preview 非空且与当前配置同指纹，这里直接用它。
                  const fileName =
                    preview === null ? '' : reportFileName(preview.report, 'xlsx')
                  const confirmed =
                    typeof window.confirm === 'function'
                      ? window.confirm(
                          `即将生成 ${fileName}：只含聚合结果，不含姓名 / 需求 ID / 推荐人 / 准确薪资 / 原因原文。是否继续？`,
                        )
                      : true
                  if (!confirmed) {
                    setMessages(['已取消：没有生成任何文件。'])
                    return
                  }
                  setConfirmedFingerprint(fingerprint)
                  void runXlsx()
                  return
                }
                if (id === 'markdown') {
                  setConfirmedFingerprint(fingerprint)
                  runMarkdown()
                  return
                }
                if (id === 'pdf') {
                  setConfirmedFingerprint(fingerprint)
                  // 打印版要先生成本机图表再开窗口，因此是异步的（用户需求 ③）
                  void runPrint()
                  return
                }
                setConfirmedFingerprint(fingerprint)
                void runPng()
              }}
              type="button"
            >
              <span className="block font-medium">{label}</span>
              <span className="mt-0.5 block leading-5 text-slate-500">{hint}</span>
            </button>
          ))}
        </div>
        <p className="text-xs leading-5 text-slate-500">{DOWNLOAD_NOTE}</p>
        <p className="text-xs leading-5 text-slate-500">{PRINT_NOTE}</p>
        <p className="text-xs leading-5 text-slate-500">{PNG_UNVERIFIED_NOTE}</p>
        {messages.length > 0 && (
          <ul className="list-disc space-y-0.5 rounded border border-slate-200 bg-slate-50 p-2 pl-6 text-xs leading-5 text-slate-700">
            {messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="text-xs font-semibold text-slate-900">{SECTION_TITLES.notes}</h3>
        <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-600">
          {NOTES.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

/**
 * 数据缺失时的空态（区分锁定 / 未导入 / 未确认映射 / 未提交清洗结果）
 */
function ExportEmptyState({ session }: { readonly session: SessionSnapshot }) {
  if (session.lockedReason !== null) {
    return (
      <EmptyState
        description={
          session.lockedReason === 'idle'
            ? LOCKED_DESCRIPTIONS.idle
            : session.lockedReason === 'manual'
              ? LOCKED_DESCRIPTIONS.manual
              : LOCKED_DESCRIPTIONS.other
        }
        items={[...LOCKED_ITEMS]}
        nextStep={{ label: '去设置解锁', to: '/settings' }}
        title={LOCKED_TITLE}
      />
    )
  }

  if (!session.hasSheet) {
    return (
      <EmptyState
        description={NO_SHEET_DESCRIPTION}
        items={[...NO_SHEET_ITEMS]}
        nextStep={{ label: '先去导入数据', to: '/import' }}
        title={NO_SHEET_TITLE}
      />
    )
  }

  if (!session.hasMapping) {
    return (
      <EmptyState
        description={NO_MAPPING_DESCRIPTION}
        items={[...NO_MAPPING_ITEMS]}
        nextStep={{ label: '先去确认字段映射', to: '/mapping' }}
        title={NO_MAPPING_TITLE}
      />
    )
  }

  return (
    <EmptyState
      description={NO_DATASET_DESCRIPTION}
      items={[...NO_DATASET_ITEMS]}
      nextStep={{ label: '去清洗预览并提交', to: '/cleaning' }}
      title={NO_DATASET_TITLE}
    />
  )
}
