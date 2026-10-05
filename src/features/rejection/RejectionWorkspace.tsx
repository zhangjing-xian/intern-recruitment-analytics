import { useEffect, useMemo, useState } from 'react'

import { DEFAULT_CYCLE_TOO_LONG_DAYS, applyFilters, type NormalizedDataset } from '../../domain'
import { buildRejectionInsight } from '../../insights'
import EmptyState from '../../components/EmptyState'
import { subscribeVaultEvents, type VaultLockReason } from '../../storage'
import { getCleaningSession, getImportSession } from '../../storage/sessionStore'
import { formatDate, formatInteger } from '../../lib/format'
import GlobalFilterPanel from '../dashboard/GlobalFilterPanel'
import { ReturnToAllScope } from '../dashboard/ReturnToAllScope'
import {
  EMPTY_DASHBOARD_FILTERS,
  activeFilterSummary,
  clearFilters,
  groupingOptionsOf,
  hasActiveFilters,
  toAnalysisFilters,
  type DashboardFilterDraft,
} from '../dashboard/dashboardFilters'

import ActionAdvicePanel from './ActionAdvicePanel'
import AnalysisGroupCards from './AnalysisGroupCards'
import AttentionTagsPanel from './AttentionTagsPanel'
import DimensionComparisonPanel from './DimensionComparisonPanel'
import ReasonsPanel from './ReasonsPanel'
import RejectionCharts from './RejectionCharts'
import {
  COLUMN_LABELS,
  DATA_AS_OF_HINT,
  DISCLAIMER_LABEL,
  FILTER_SECTION_HINT,
  FILTER_SECTION_TITLE,
  LOCKED_DESCRIPTIONS,
  LOCKED_ITEMS,
  LOCKED_TITLE,
  NO_DATASET_DESCRIPTION,
  NO_DATASET_ITEMS,
  NO_DATASET_RECORDS_NOTE,
  NO_DATASET_TITLE,
  NO_MAPPING_DESCRIPTION,
  NO_MAPPING_ITEMS,
  NO_MAPPING_TITLE,
  NO_MATCHED_RECORDS_NOTE,
  NO_SHEET_DESCRIPTION,
  NO_SHEET_ITEMS,
  NO_SHEET_TITLE,
  PAGE_INTRO,
  PAGE_TITLE,
  RULE_VERSION_HINT,
  RULE_VERSION_LABEL,
} from './rejectionText'

type SessionSnapshot = {
  readonly hasSheet: boolean
  readonly hasMapping: boolean
  readonly dataset: NormalizedDataset | null
  /** 非 null 表示「仓被锁定 / 清空后内存业务数据已被清掉」，用于给出准确空态 */
  readonly lockedReason: VaultLockReason | 'cleared' | null
  /** 清洗设置里的招聘周期阈值（等待时长阈值与看板共用同一份用户口径） */
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
 * 拒 offer 专项（步骤10，docs/PRD.md 9 章）。
 *
 * 数据来源只有一个：内存会话里**已提交**的规范化数据集（步骤5 的 `commitNormalizedDataset`）。
 * 筛选复用步骤8 的**同一套**筛选快照与纯逻辑层（`dashboardFilters` + `GlobalFilterPanel`），
 * 因此「筛选后看板 / 分维度分析 / 拒 offer 专项」三处读数必然一致；本页不自建筛选状态，
 * 也不自造分档配置（`groupingOptionsOf` 与看板取同一份）。
 *
 * 结论只有一个来源：`insights/rejection.ts` 的 `buildRejectionInsight`——它内部调用
 * `domain/analytics` 的 `summarizeRecords` / `aggregateByDimension` / `rejectionReasonDistribution` /
 * `evaluateRejectionRules`。**本组件与下面的面板都不出现任何指标公式**
 * （AGENTS.md §2.3、§6），也不判断任何阈值（门槛由 `insight.thresholds` 给，界面只展示）。
 *
 * 状态处理（PRD 7 章「通用状态」）：未导入 / 未确认字段映射 / 未提交清洗结果 / 仓已锁定
 * 各自空态，说明「为什么没有数字」，绝不用空白图表或 0 值掩盖。
 */
export default function RejectionWorkspace() {
  const [session, setSession] = useState<SessionSnapshot>(readSessionSnapshot)
  const [draft, setDraft] = useState<DashboardFilterDraft>(EMPTY_DASHBOARD_FILTERS)

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
  /** 筛选结果（含去重与日期缺失统计）；口径与看板 `analyzeRecords` 内部完全一致 */
  const filterOutcome = useMemo(
    () => applyFilters(allRecords, filters, { salaryBandEdges: groupingOptions.salaryBandEdges }),
    [allRecords, filters, groupingOptions],
  )
  const records = filterOutcome.records
  const activeFilters = useMemo(() => activeFilterSummary(draft), [draft])
  /*
   * 用户反馈 ②：本页每个模块的「返回全部数据」。
   * 判定与清空都取看板同一份纯函数（`hasActiveFilters` / `clearFilters`），
   * 因此它和筛选条上的「清空筛选」是**同一个动作**，不会出现两套口径。
   */
  const filtersActive = useMemo(() => hasActiveFilters(draft), [draft])
  const returnToAll = useMemo(
    () => () => {
      setDraft((current) => clearFilters(current))
    },
    [],
  )

  const insight = useMemo(
    () =>
      dataset === null
        ? null
        : buildRejectionInsight(records, {
            dataAsOf: dataset.metadata.dataAsOf,
            salaryComparable: dataset.metadata.salary.comparable,
            // 阈值取清洗设置里用户确认过的招聘周期阈值，与看板「周期偏长」用同一个数；
            // 其余门槛由结论层默认值给出，界面不得自定阈值（AGENTS.md §4 步骤10 条目）。
            waitingThresholdDays: session.cycleTooLongDays,
            // 分档边界与筛选面板共用同一份配置：本页改分档，看板也会看到同一套边界。
            groupingOptions,
            // 把筛选快照冻结进结论，报告里才能说明「这份结论对应哪次筛选」。
            filters,
          }),
    [dataset, records, session.cycleTooLongDays, groupingOptions, filters],
  )

  if (dataset === null || insight === null) {
    return <RejectionEmptyState session={session} />
  }

  if (records.length === 0) {
    // 区分「数据集本身没有记录」与「筛选后没有记录」：前者要去查清洗，后者只要放宽筛选，
    // 因此给不同的说明与下一步；两者都不显示 0% 占位。
    const datasetEmpty = allRecords.length === 0
    return (
      <EmptyState
        description={datasetEmpty ? NO_DATASET_RECORDS_NOTE : NO_MATCHED_RECORDS_NOTE}
        items={
          datasetEmpty
            ? [
                '数据集已提交但其中没有任何保留记录（全部被清洗阶段判为问题行或重复行）',
                '拒 offer 率、原因分布与关注标签都需要至少一条记录，这里不显示 0% 占位',
                '回到清洗页检查去重策略与问题统计，确认输入是否完整',
              ]
            : [
                '数据集本身有记录，但当前筛选条件下一条都不满足',
                '拒 offer 率、原因分布与关注标签都依赖至少一条记录，因此这里不显示 0% 占位',
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
              filterOutcome={filterOutcome}
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

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">{RULE_VERSION_LABEL}</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-900">{insight.ruleVersion}</dd>
            <p className="mt-0.5 text-xs text-slate-500">{RULE_VERSION_HINT}</p>
          </div>
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">{COLUMN_LABELS.dataAsOf}</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-900">
              {formatDate(insight.dataAsOf)}
            </dd>
            <p className="mt-0.5 text-xs text-slate-500">{DATA_AS_OF_HINT}</p>
          </div>
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <dt className="text-xs text-slate-500">当前口径的记录数</dt>
            <dd className="mt-0.5 text-sm font-medium text-slate-900">
              {formatInteger(records.length)} 条（N，含审批中）
            </dd>
            <p className="mt-0.5 text-xs text-slate-500">
              {activeFilters.length === 0
                ? '未启用任何筛选：等于全部已提交记录'
                : `已启用 ${formatInteger(activeFilters.length)} 项筛选：结论只对当前筛选范围成立`}
            </p>
          </div>
        </dl>
        {/* 生效筛选逐条列出：结论要能说明「对应哪一份范围」 */}
        {activeFilters.length > 0 && (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-600">
            {activeFilters.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        {/* 免责声明放在最前面：先看边界，再看数字 */}
        <p className="mt-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          <span className="font-medium">{DISCLAIMER_LABEL}：</span>
          {insight.disclaimer}
        </p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">{FILTER_SECTION_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{FILTER_SECTION_HINT}</p>
        <GlobalFilterPanel
          draft={draft}
          filterOutcome={filterOutcome}
          onChange={setDraft}
          records={allRecords}
          subsetRateNote={null}
        />
      </section>

      <AnalysisGroupCards
        comparison={insight.comparison}
        comparisonNote={insight.comparisonNote}
        overall={insight.overall}
      />

      {/*
        用户反馈 ②：本页有标题栏的模块（原因 / 维度对比 / 关注标签 / 行动建议）各给一个
        「返回全部数据」——与看板同一个作用域、同一个按钮组件、同一个清筛选纯函数。
        `AnalysisGroupCards` 不是标题栏模块，所以它上面不会多出按钮。
      */}
      <ReturnToAllScope filtersActive={filtersActive} onReturnToAll={returnToAll}>
        <ReasonsPanel reasons={insight.reasons} />

        {/*
          用户需求 ③：本页此前一张图都没有。两张图分别放在它们各自的数据表上方：
          原因分布图紧跟原因表，维度对比图紧跟「拒 offer 率与入职率」的对比表。
          图用的分组取对比维度列表里**第一个**维度的分组（与下方对比面板同一份引擎结果）。
        */}
        <RejectionCharts
          dimensionLabel={insight.dimensions[0]?.label ?? '对比维度'}
          groups={insight.dimensions[0]?.groups ?? []}
          reasons={insight.reasons}
        />

        <DimensionComparisonPanel dimensions={insight.dimensions} recordCount={records.length} />

        <AttentionTagsPanel
          disclaimer={insight.disclaimer}
          evaluations={insight.evaluations}
          recordCount={records.length}
          thresholds={insight.thresholds}
          waitingThresholdDays={insight.waitingThresholdDays}
        />

        <ActionAdvicePanel advice={insight.advice} />
      </ReturnToAllScope>

      <p className="text-xs leading-5 text-slate-500">
        本页只做展示：拒 offer 率、原因分布、规则命中与门槛判定全部来自统一指标引擎与结论层
        （源码在 src/domain/analytics 与 src/insights），组件内不复制公式、不判断阈值。
        口径变化时先改引擎并补纯函数测试，再回到这里验证界面。
      </p>
    </div>
  )
}

/** 数据缺失时的空态（区分锁定 / 未导入 / 未确认映射 / 未提交清洗结果） */
function RejectionEmptyState({ session }: { readonly session: SessionSnapshot }) {
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
