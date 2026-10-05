import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  DEFAULT_CYCLE_TOO_LONG_DAYS,
  aggregateByMonth,
  analyzeRecords,
  cycleTooLongCount,
  decorateRecords,
  retainedRecords,
  type NormalizedDataset,
} from '../../domain'
import EmptyState from '../../components/EmptyState'
import { AI_UNAVAILABLE_NOTE, aiBlockedByPageCsp } from '../../lib/aiAvailability'
import { buildAnalysisSummary } from '../../ai/summary'
import { aiDestinationOf, loadAiSettings, type AiSettings } from '../../ai/aiSettings'
import { saveAiHistoryEntry } from '../../ai/aiHistory'
import {
  aiLocalRulesOf,
  isAiSubjectRulesConfirmed,
  subjectRulesFingerprint,
  type AiLocalRuleInput,
} from '../../ai/subjectRules'
import AiAnalysisWorkspace, { type AiWorkspaceData } from '../ai/AiAnalysisWorkspace'
import { toAiWorkspaceData } from '../ai/summaryAdapter'
import DimensionAnalysisPanel from '../dimensions/DimensionAnalysisPanel'
import AiSettingsPanel from '../settings/AiSettingsPanel'
import { encryptedVault, subscribeVaultEvents, type VaultLockReason } from '../../storage'
import { getCleaningSession, getImportSession } from '../../storage/sessionStore'

import AiAnalysisButton from './AiAnalysisButton'
import GlobalFilterPanel from './GlobalFilterPanel'
import KpiCards from './KpiCards'
import QualityHintsPanel from './QualityHintsPanel'
import RecordDetailTable from './RecordDetailTable'
import { ReturnToAllScope } from './ReturnToAllScope'
import SnapshotBar from './SnapshotBar'
import StatusCompositionSection from './StatusCompositionSection'
import TrendSection from './TrendSection'
import {
  EMPTY_DASHBOARD_FILTERS,
  activeFilterSummary,
  clearFilters,
  groupingOptionsOf,
  hasActiveFilters,
  setDimensionValues,
  setStatusValues,
  setTimeBasis,
  setTimeRange,
  timeRangeOfPeriod,
  toAnalysisFilters,
  type DashboardFilterDraft,
} from './dashboardFilters'

type SessionSnapshot = {
  readonly hasSheet: boolean
  readonly hasMapping: boolean
  readonly dataset: NormalizedDataset | null
  /** 非 null 表示「仓被锁定 / 清空后内存业务数据已被清掉」，用于给出准确空态 */
  readonly lockedReason: VaultLockReason | 'cleared' | 'stale' | null
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

/**
 * 本机规则是否已被确认（AI-6）。
 *
 * 判据只有一个：**保存下来的指纹与当前规则算出的指纹相等**（`subjectRulesFingerprint`）。
 * 界面不记「有没有改过规则」——那种记法一旦漏掉一条改动路径，就会把旧同意用在新规则上。
 * 没有已提交数据集时规则版本为 null，设置页与看板两边一致，因此不会因为「没有数据」而误判。
 */
function aiSubjectRulesConfirmedFor(settings: AiSettings, local: AiLocalRuleInput): boolean {
  const confirmation =
    settings.subjectRulesConfirmedAt === null
      ? null
      : {
          fingerprint: settings.subjectRulesFingerprint ?? '',
          confirmedAt: settings.subjectRulesConfirmedAt,
        }
  return isAiSubjectRulesConfirmed(confirmation, {
    ...local,
    positionCategories: settings.positionCategories,
  })
}

/**
 * 总览看板（步骤8，docs/PRD.md 6.1 / 6.3 / 7、8 章「总览」）。
 *
 * 数据来源只有一个：内存会话里**已提交**的规范化数据集（步骤5 的 `commitNormalizedDataset`）。
 * 所有指标只经 `analyzeRecords` / `applyFilters` / `aggregateByMonth` / `decorateRecords` 取得，
 * 本组件与下面的子组件**不出现任何指标公式**（AGENTS.md §2.3、§6）。
 *
 * 状态处理（PRD 7 章「通用状态」）：未导入 / 未确认映射 / 未提交清洗结果 / 仓已锁定 各自空态，
 * 说明「为什么没有数字」，绝不用空白图表或 0 值掩盖。
 */
export default function DashboardWorkspace() {
  const [session, setSession] = useState<SessionSnapshot>(readSessionSnapshot)
  const [draft, setDraft] = useState<DashboardFilterDraft>(EMPTY_DASHBOARD_FILTERS)
  /**
   * AI 预览工作区是否展开。
   *
   * 为什么是一个独立的开合状态：AI 预览需要各维度的分组结果，而那些分组只有在用户
   * 真的要看预览时才算——否则每次看板渲染都会多算 14 次分组聚合，白白拖慢首屏。
   * 这里的开关**只影响渲染**：它不触发任何请求，也不改变任何指标。
   */
  const [aiOpen, setAiOpen] = useState(false)
  /**
   * AI 配置（AI-3）：开关默认关闭，参数来自设置页保存的偏好。
   *
   * 一次性读回后**就地可改**（用户反馈，2026-09-27 晚）：看板的 AI 工作区里内联了
   * 同一个 `AiSettingsPanel`，因此开关 / API Key / 本地规则确认都能在原地完成，
   * 面板每次变更通过 `onSettingsChange` 回传到这里，界面不会出现
   * 「面板里开着、旁边写着已关闭」的矛盾（那正是用户遇到的 bug）。
   * 读不到（没有仓 / 未解锁）时 `loadAiSettings` 回落到默认值或**本会话刚选的那一份**。
   */
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null)
  /** 本地仓是否已解锁：内联设置面板据此决定「加密保存 / 读入 / 删除」是否可用 */
  const [vaultUnlocked, setVaultUnlocked] = useState(false)

  /**
   * 「这一份产物能不能用 AI」：读页面自己的 meta CSP（构建时注入，`src/lib/csp.ts` 是唯一来源）。
   * 本地版 / 公开部署那一份是 `connect-src 'none'` → 不给 AI 入口，只说明事实（见 D-102）。
   * 用 `useState` 而不是每次渲染都读：DOM 里的 meta 在一次会话内不会变。
   */
  const [aiBlockedByCsp] = useState(() => aiBlockedByPageCsp())

  useEffect(() => {
    let cancelled = false
    void loadAiSettings().then((loaded) => {
      if (!cancelled) {
        setAiSettings(loaded)
      }
    })
    void encryptedVault.status().then((status) => {
      if (!cancelled) {
        setVaultUnlocked(status.state === 'unlocked')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

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
  const retained = useMemo(() => retainedRecords(allRecords), [allRecords])
  const filters = useMemo(() => toAnalysisFilters(draft), [draft])
  /**
   * 本机生效的本地规则（AI-6）：学校层次名单 / 别名 / 规则版本来自**已提交数据集**的
   * 设置快照，岗位类别映射来自 AI 偏好。取值口径与设置页共用 `aiLocalRulesOf`，
   * 因此「设置页显示的规则」与「看板算出的指纹」不可能是两份。
   */
  const localRules: AiLocalRuleInput = useMemo(() => aiLocalRulesOf(dataset), [dataset])
  /** 分组与筛选共用同一份分档配置（引擎不发明分档，见 docs/DECISIONS.md D-036） */
  const groupingOptions = useMemo(() => groupingOptionsOf(draft), [draft])

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
  const timeline = useMemo(
    () => aggregateByMonth(filteredRecords, draft.timeBasis),
    [filteredRecords, draft.timeBasis],
  )
  const decorated = useMemo(
    () =>
      dataset === null
        ? []
        : decorateRecords(filteredRecords, { salaryComparable: dataset.metadata.salary.comparable }),
    [dataset, filteredRecords],
  )
  const tooLongCount = useMemo(
    () => cycleTooLongCount(filteredRecords, session.cycleTooLongDays),
    [filteredRecords, session.cycleTooLongDays],
  )

  /**
   * AI 分析摘要（AI-2）：**冻结快照的唯一定义点**。
   *
   * 为什么不再在组件里手拼：那段装配代码住在组件里就不可测、会漂移，而且与
   * PRD 16.2「冻结当前数据版本、去重策略、筛选快照与统计口径，在本地生成
   * AnalysisSummary」的语义不符——组件内的 `useMemo` 不是一份可传阅的契约。
   * 现在装配全部在 `src/ai/summary.ts`（纯函数，有 20+ 条单测），这里只调用它。
   *
   * 仍然只在 `aiOpen` 为真时算：不开预览就不该为它付算力
   * （摘要会对 14 个维度各做一次分组聚合）。
   */
  const aiWorkspaceData = useMemo<AiWorkspaceData | null>(() => {
    if (dataset === null || !aiOpen) {
      return null
    }
    const summary = buildAnalysisSummary({
      records: dataset.records,
      metadata: dataset.metadata,
      report: dataset.report,
      filters,
      timeBasis: draft.timeBasis,
      groupingOptions,
      // 生效筛选的可读描述来自纯逻辑层（`activeFilterSummary`）：组件不另写一份描述规则
      filtersSummary: activeFilterSummary(draft),
      cycleTooLongDays: session.cycleTooLongDays,
    })
    return toAiWorkspaceData(summary)
  }, [
    aiOpen,
    dataset,
    draft,
    filters,
    groupingOptions,
    session.cycleTooLongDays,
  ])

  /**
   * 「返回全部数据」（用户需求 4）用的两个值。
   *
   * 为什么放在这里而不是各 section 里：筛选状态只有这一处（`draft`），
   * 判定与清空也只该有一份实现——`hasActiveFilters` / `clearFilters` 都是 `dashboardFilters.ts`
   * 里的纯函数，与筛选条的「清空筛选」**是同一个动作**，因此不会出现「按钮间口径不一致」。
   */
  const filtersActive = useMemo(() => hasActiveFilters(draft), [draft])
  const returnToAll = useCallback(() => {
    setDraft((current) => clearFilters(current))
  }, [])

  if (dataset === null || analysis === null) {
    return <DashboardEmptyState session={session} />
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">总览看板</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            筛选、KPI 卡片、状态结构、时间趋势、分维度分析与明细表同源同口径：全部由统一指标引擎从同一份筛选快照算出，
            因此数量必然一致。分维度表里的「只看该组」会把全局筛选设为该取值，上方筛选条同步显示。
          </p>
        </div>
        <AiAnalysisButton
          enabled={aiSettings?.enabled ?? false}
          hidden={aiBlockedByCsp}
          onToggle={() => {
            setAiOpen((current) => !current)
          }}
          open={aiOpen}
          recordCount={filteredRecords.length}
        />
      </div>
      {/*
        「这一份产物能不能用 AI」由页面自己的 meta CSP 决定（`src/lib/aiAvailability.ts`）：
        本地版 / 公开部署的那一份是 `connect-src 'none'`，AI 请求会被浏览器直接拦下。
        这种情况下**不给 AI 入口**，而是把事实写清楚——否则用户会点进去、开开关、生成预览，
        最后收到一句「可能是网络或跨域问题」，而那两种都不是（见 D-102）。
      */}
      {aiBlockedByCsp ? (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h3 className="text-sm font-semibold text-slate-900">AI 深度分析（本部署不可用）</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">{AI_UNAVAILABLE_NOTE}</p>
        </section>
      ) : null}

      {/*
        AI 工作区紧跟入口按钮：展开后就能看到「这份摘要对应哪次筛选」。
        它只消费看板已经算好的分组（`aiWorkspaceData`），自己不发请求、不算指标。
      */}
      {!aiBlockedByCsp && aiOpen && aiWorkspaceData !== null ? (
        <AiAnalysisWorkspace
          data={aiWorkspaceData}
          enabled={aiSettings?.enabled ?? false}
          onSaveHistory={saveAiHistoryEntry}
          /*
            用户反馈（2026-09-27 晚）：「把设置里 AI 相关的信息放到分析看板中来」。
            这里内联的就是**设置页正在用的同一个面板**（同一个组件、同一份口径、
            同一个保存路径），因此不会出现两套设置。它默认在 AI 未启用时展开——
            那正是用户需要看到开关与 Key 输入框的时刻。
          */
          settingsSlot={
            <AiSettingsPanel
              localRules={localRules}
              onSettingsChange={(next) => {
                setAiSettings(next)
              }}
              vaultUnlocked={vaultUnlocked}
            />
          }
          {...(aiSettings === null
            ? {}
            : {
                initialParams: aiSettings.params,
                initialPrivacyLevel: aiSettings.privacyLevel,
                initialCustomDimensions: aiSettings.customDimensions,
                initialDestination: aiDestinationOf(aiSettings),
                positionCategories: aiSettings.positionCategories,
                subjectRulesConfirmed: aiSubjectRulesConfirmedFor(aiSettings, localRules),
                subjectRulesFingerprint: subjectRulesFingerprint({
                  ...localRules,
                  positionCategories: aiSettings.positionCategories,
                }),
              })}
        />
      ) : null}

      <SnapshotBar analysis={analysis} dataset={dataset} draft={draft} />

      <GlobalFilterPanel
        draft={draft}
        filterOutcome={analysis.filterOutcome}
        onChange={setDraft}
        records={retained}
        subsetRateNote={analysis.subsetRateNote}
      />

      <KpiCards analysis={analysis} />

      {/*
        用户反馈 ②（2026-09-27 晚）：分维度分析的每个模块（8 个）都要有「返回全部数据」，
        不能只在面板顶部放一个——下钻之后视线停在表格上，用户不想再滚回顶部去找。
        作用域提供一次，`SectionShell` 在每个模块标题栏各渲染一个（见 ReturnToAllScope.tsx）。
      */}
      <ReturnToAllScope filtersActive={filtersActive} onReturnToAll={returnToAll}>
        <StatusCompositionSection
          analysis={analysis}
          filtersActive={filtersActive}
          onDrilldownStatus={(status) => {
            setDraft((current) => setStatusValues(current, [status]))
          }}
          onReturnToAll={returnToAll}
        />

        <TrendSection
          filtersActive={filtersActive}
          onChangeBasis={(basis) => {
            setDraft((current) => setTimeBasis(current, basis))
          }}
          onDrilldownPeriod={(periodKey) => {
            const range = timeRangeOfPeriod(periodKey)
            if (range === null) {
              return
            }
            setDraft((current) => setTimeRange(current, range.from, range.to))
          }}
          onReturnToAll={returnToAll}
          timeline={timeline}
        />

        <DimensionAnalysisPanel
          availability={dataset.report.metricAvailability}
          comparable={dataset.metadata.salary.comparable}
          filtersActive={filtersActive}
          groupingOptions={groupingOptions}
          onDrilldown={(dimension, value) => {
            setDraft((current) => setDimensionValues(current, dimension, [value]))
          }}
          onReturnToAll={returnToAll}
          records={filteredRecords}
        />
      </ReturnToAllScope>

      <QualityHintsPanel
        analysis={analysis}
        cycleTooLongCount={tooLongCount}
        cycleTooLongDays={session.cycleTooLongDays}
        dataset={dataset}
      />

      <RecordDetailTable records={decorated} />

      <p className="text-xs leading-5 text-slate-500">
        本页只做展示与筛选：任何比率、分位、基准都来自统一指标引擎（源码在 src/domain/analytics），
        组件内不复制公式。指标口径变化时先改引擎并补纯函数测试，再回到这里验证界面。
      </p>
    </div>
  )
}

/** 数据缺失时的空态（区分锁定 / 未导入 / 未确认映射 / 未提交清洗） */
function DashboardEmptyState({ session }: { readonly session: SessionSnapshot }) {
  if (session.lockedReason !== null) {
    return (
      <EmptyState
        description={
          session.lockedReason === 'idle'
            ? '闲置超过设定时间，本地仓已自动锁定，内存中的业务数据（解析结果、已提交数据集）已一并清空。'
            : session.lockedReason === 'manual'
              ? '你手动锁定了本地仓，内存中的业务数据已一并清空。'
              : '本地仓被清空或会话已过期，内存中的业务数据已一并清空。'
        }
        items={[
          '这是预期行为：锁定时必须清空可控状态与图表缓存，避免敏感明细留在内存里',
          '解锁后需要重新导入数据，或从加密仓恢复数据集（恢复入口在设置页，后续步骤接入）',
          '临时模式没有加密仓，关闭页面即清除；需要长期保存请使用加密仓',
        ]}
        nextStep={{ label: '去设置解锁', to: '/settings' }}
        title="本地仓已锁定"
      />
    )
  }

  if (!session.hasSheet) {
    return (
      <EmptyState
        description="看板只统计已确认并提交的清洗结果。现在内存会话里没有任何数据集，因此不显示任何示例比例、示例图表或占位数字。"
        items={[
          '读 Excel / CSV / TSV 或直接粘贴表格，生成原始数据集',
          '确认字段映射后进入清洗预览，检查问题、重复与口径',
          '提交清洗结果后回到本页，即可看到 KPI、状态结构、时间趋势与明细',
        ]}
        nextStep={{ label: '先去导入数据', to: '/import' }}
        title="还没有可分析的记录"
      />
    )
  }

  if (!session.hasMapping) {
    return (
      <EmptyState
        description="没有确认字段映射时，无法知道哪个源列是 offer 状态、哪个是日期；任何率都会被算错，所以这里不猜、也不出结论。"
        items={[
          '映射页会给出四级匹配建议与冲突清单，冲突必须显式选择或合并',
          '确认映射后返回清洗预览，再提交数据集',
        ]}
        nextStep={{ label: '先去确认字段映射', to: '/mapping' }}
        title="字段映射尚未确认"
      />
    )
  }

  return (
    <EmptyState
      description="字段映射已确认，但清洗结果还没有提交。看板只消费「已提交的规范化数据集」，这样每个结论都能对应到一份确定的输入。"
      items={[
        '清洗页可预览前 100 行、查看问题统计与城市 / 状态别名',
        '确认去重策略与薪资口径后点击提交，数据集才会进入分析',
        '改清洗设置会作废已提交数据集（结论必须与输入一一对应）',
      ]}
      nextStep={{ label: '去清洗预览并提交', to: '/cleaning' }}
      title="还没有已提交的清洗结果"
    />
  )
}
