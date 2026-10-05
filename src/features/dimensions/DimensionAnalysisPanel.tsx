import { useMemo, useState } from 'react'

import {
  GROUP_DIMENSION_LABELS,
  actualCycleStats,
  aggregateByDimension,
  crossTabulate,
  housingComparisonOf,
  plannedCycleStats,
  recruiterRankingAvailability,
  salaryDistributionByUnit,
  schoolSourceCounts,
  sortGroupsByDenominator,
  summarizeRecords,
  topNWithOther,
  unsplitRequirementTypeCount,
  gptSourceCounts,
  type GroupDimension,
  type GroupingOptions,
  type MetricAvailability,
  type NormalizedRecord,
} from '../../domain'

import CitySection from './CitySection'
import ChannelSection from './ChannelSection'
import CompensationSection from './CompensationSection'
import EfficiencySection from './EfficiencySection'
import PositionSection from './PositionSection'
import ProfileSection from './ProfileSection'
import RecruiterSection from './RecruiterSection'
import RequirementTypeSection from './RequirementTypeSection'
import ReturnToAllButton from '../dashboard/ReturnToAllButton'
import { NO_RECORDS_NOTE } from './analysisText'
import { DEFAULT_TOP_N, SCHOOL_TOP_N, type RankTableMode } from './dimensionViews'

type DimensionAnalysisPanelProps = {
  /** 当前筛选后的记录（与 KPI 卡片、趋势图同一份读数） */
  readonly records: readonly NormalizedRecord[]
  /** 分组选项（薪资分档边界等），与筛选面板同一份配置 */
  readonly groupingOptions: GroupingOptions
  /** 币种与计薪周期是否已确认（false 时禁用薪资 / 房补对比） */
  readonly comparable: boolean
  /** 清洗阶段给出的模块可用性与有效样本（用于显示「本模块为何不可用」） */
  readonly availability: readonly MetricAvailability[]
  readonly onDrilldown: (dimension: GroupDimension, value: string) => void
  /** 是否有筛选生效（看板用 `hasActiveFilters` 判定后传入，组件不自己判断） */
  readonly filtersActive?: boolean
  /**
   * 清空全部筛选（用户需求 4）。
   *
   * 为什么由看板传进来而不是本组件自己清：本组件**不持有**筛选状态（它只消费 `records`），
   * 清筛选的唯一入口是看板的 `clearFilters`。不传时不渲染按钮。
   */
  readonly onReturnToAll?: () => void
}

/**
 * 分维度分析装配点（步骤9，docs/PRD.md 8 章）。
 *
 * 与总览看板共用同一份筛选快照：`records` 来自 `analyzeRecords` 的 `filterOutcome.records`，
 * 因此本页任何分组的 N / J / P / A / R / D 与 KPI 卡片必然一致。
 *
 * 铁律：**本组件不出现任何指标公式**——分组、率、周期、分位、覆盖需求数、薪资分布全部由
 * `domain/analytics` 计算；这里只决定「取哪些分组、放进哪个 section」。
 */
export default function DimensionAnalysisPanel({
  records,
  groupingOptions,
  comparable,
  availability,
  onDrilldown,
  filtersActive = false,
  onReturnToAll,
}: DimensionAnalysisPanelProps) {
  const [structureDimension, setStructureDimension] = useState<GroupDimension>('position')
  const [structureMode, setStructureMode] = useState<RankTableMode>('topN')

  // 各维度的合计都是同一批记录，因此只需要一份（引擎对同一批记录重新汇总）
  const total = useMemo(() => summarizeRecords('全部（当前筛选）', records), [records])
  const city = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'city', groupingOptions)),
    [records, groupingOptions],
  )
  const channel = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'channel', groupingOptions)),
    [records, groupingOptions],
  )
  const channelCross = useMemo(
    () => crossTabulate(records, 'channel', 'referralType', groupingOptions),
    [records, groupingOptions],
  )
  const recruiter = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'recruiter', groupingOptions)),
    [records, groupingOptions],
  )
  const recruiterStructure = useMemo(
    () => crossTabulate(records, 'recruiter', 'position', groupingOptions),
    [records, groupingOptions],
  )
  const recruiterRanking = useMemo(() => recruiterRankingAvailability(recruiter), [recruiter])

  const structureAll = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, structureDimension, groupingOptions)),
    [records, structureDimension, groupingOptions],
  )
  const structureGroups = useMemo(
    () => topNWithOther(structureAll, DEFAULT_TOP_N),
    [structureAll],
  )

  const requirementType = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'requirementType', groupingOptions)),
    [records, groupingOptions],
  )
  const unsplitCount = useMemo(() => unsplitRequirementTypeCount(records), [records])

  const graduationYear = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'graduationYear', groupingOptions)),
    [records, groupingOptions],
  )
  const education = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'education', groupingOptions)),
    [records, groupingOptions],
  )
  const gpt = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'isGptSchool', groupingOptions)),
    [records, groupingOptions],
  )
  const schoolAll = useMemo(
    () => sortGroupsByDenominator(aggregateByDimension(records, 'school', groupingOptions)),
    [records, groupingOptions],
  )
  const schoolTop = useMemo(() => topNWithOther(schoolAll, SCHOOL_TOP_N), [schoolAll])
  const schoolSources = useMemo(() => schoolSourceCounts(records), [records])
  const gptSources = useMemo(() => gptSourceCounts(records), [records])

  const distribution = useMemo(
    () => salaryDistributionByUnit(records, { comparable }),
    [records, comparable],
  )
  const housing = useMemo(() => housingComparisonOf(records), [records])

  const actual = useMemo(() => actualCycleStats(records), [records])
  const planned = useMemo(() => plannedCycleStats(records), [records])

  if (records.length === 0) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">分维度分析</h3>
        <p className="mt-2 text-xs leading-6 text-slate-600">{NO_RECORDS_NOTE}</p>
      </section>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">分维度分析</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            以下 8 个模块与 KPI 卡片、状态结构共用同一份筛选快照与同一个指标引擎：
            每个分组的 N / J / P / A / R / D、各率、有效周期 n 都由引擎的通用分组聚合与交叉表算出
            （源码在 src/domain/analytics），界面不复制公式；表内「只看该组」会把全局筛选设为该取值。
          </p>
        </div>
        {/*
          用户需求 4：表里的「只看该组」会把全局筛选改掉，而筛选条在页面顶部——
          下钻之后视线停在表格上，容易找不到回到全部数据的入口。这里给出同一个出口。
        */}
        {onReturnToAll === undefined ? null : (
          <ReturnToAllButton filtersActive={filtersActive} onReturnToAll={onReturnToAll} />
        )}
      </div>

      <CitySection
        groups={city}
        onDrilldown={(value) => onDrilldown('city', value)}
        records={records}
        total={total}
      />

      <ChannelSection
        availability={availability}
        crossTab={channelCross}
        groups={channel}
        onDrilldown={(value) => onDrilldown('channel', value)}
        total={total}
      />

      <RecruiterSection
        availability={availability}
        groups={recruiter}
        onDrilldown={(value) => onDrilldown('recruiter', value)}
        ranking={recruiterRanking}
        structure={recruiterStructure}
        total={total}
      />

      <PositionSection
        allGroups={structureAll}
        dimension={structureDimension}
        groups={structureGroups}
        mode={structureMode}
        onChangeDimension={setStructureDimension}
        onChangeMode={setStructureMode}
        onDrilldown={(value) => onDrilldown(structureDimension, value)}
        total={total}
      />

      <RequirementTypeSection
        groups={requirementType}
        onDrilldown={(value) => onDrilldown('requirementType', value)}
        total={total}
        unsplitCount={unsplitCount}
      />

      <ProfileSection
        education={{ groups: education, total }}
        gpt={{ groups: gpt, total }}
        gptSources={gptSources}
        graduationYear={{ groups: graduationYear, total }}
        onDrilldown={(value) => onDrilldown('graduationYear', value)}
        school={{ groups: schoolTop, total }}
        schoolAll={schoolAll}
        schoolSources={schoolSources}
      />

      <CompensationSection
        availability={availability}
        comparable={comparable}
        distribution={distribution}
        housing={housing}
        onDrilldown={(value) => onDrilldown('housingType', value)}
      />

      <EfficiencySection
        actual={actual}
        dimensionLabel={GROUP_DIMENSION_LABELS[structureDimension]}
        planned={planned}
        positions={structureGroups}
      />
    </div>
  )
}

