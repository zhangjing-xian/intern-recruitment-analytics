import { EMPTY_VALUE, formatDays, formatInteger, formatPercent } from '../../lib/format'
import type { GroupSummary } from '../../domain'

import { COLUMN_LABELS, DRILLDOWN_LABEL, GROUP_COMPOSITION_HINT, SAMPLE_TAG_LABELS } from './analysisText'
import { drilldownValueOf, sampleTagOf } from './dimensionViews'

/**
 * 组内构成两列（步骤10 拒 offer 专项用）：`拒 offer 组（/R）` 与 `入职组（/J）`。
 * 它们插在 `D` 之后、`入职率` 之前——先看「特征内结果」的量与分母，再看「组内构成」的画像，
 * 最后才是率与周期，读表顺序与 PRD 9.1 的两种视角一致。
 */
const GROUP_COMPOSITION_COLUMNS = [
  COLUMN_LABELS.rejectedGroupCount,
  COLUMN_LABELS.joinedGroupCount,
] as const

type GroupSummaryTableProps = {
  readonly caption: string
  /** 首列表头（如「城市」「招聘 HR」） */
  readonly dimensionLabel: string
  readonly groups: readonly GroupSummary[]
  /**
   * 合计行：调用方用引擎的 `summarizeRecords` 算好后传入（本组件**不**把各分组相加，
   * 因为「合计率」必须由合计分子分母重新相除）。
   */
  readonly totalRow?: GroupSummary | null
  readonly totalLabel?: string
  /** 覆盖需求数（HR 效能）：countDistinct(非空需求 ID)，只在分组内去重 */
  readonly showCoverage?: boolean
  /**
   * 组内构成两列（步骤10）：`拒 offer 组（/R）` = `groupComposition.rejectedGroupCount`、
   * `入职组（/J）` = `groupComposition.joinedGroupCount`，**只由引擎计数**。
   *
   * 默认 `false`：既有调用方（步骤9 的 8 个模块）渲染结果保持**逐字节不变**；
   * 打开后额外给出「该取值在两组人数里的占比构成」，并附一句说明——它是**画像构成**，
   * 不是该取值的拒 offer 率（特征内的率仍在同一行的「拒 offer 率」列）。
   */
  readonly showGroupComposition?: boolean
  /** 下钻：把全局筛选设为该分组的取值；合并组不显示按钮 */
  readonly onDrilldown?: (value: string) => void
}

/** 率单元格：值 + 「分子 ÷ 分母」提示（分母 0 时显示「—」，绝不显示 0%） */
function RateCell({
  numerator,
  denominator,
  value,
}: {
  readonly numerator: number
  readonly denominator: number
  readonly value: number | null
}) {
  return (
    <td className="py-2 pr-3 tabular-nums" title={`分子 ${numerator} ÷ 分母 ${denominator}`}>
      {formatPercent(value, 2)}
      <span className="ml-1 text-xs text-slate-400">
        ({formatInteger(numerator)}÷{formatInteger(denominator)})
      </span>
    </td>
  )
}

/**
 * 计数与率列的固定顺序（表头与数据行共用，避免两处各写一遍顺序）。
 *
 * 拆成三段是为了让「组内构成」两列能插在 `D` 之后、`入职率` 之前：
 * 表头与单元格都按 `COUNT_COLUMNS_BEFORE_RATES → 组内构成（可选）→ COUNT_COLUMNS_AFTER_RATES`
 * 的顺序渲染，列数永远一致（本表没有 colspan，错位会直接串行）。
 */
const COUNT_COLUMNS_BEFORE_RATES = [
  COLUMN_LABELS.total,
  COLUMN_LABELS.joined,
  COLUMN_LABELS.pending,
  COLUMN_LABELS.approving,
  COLUMN_LABELS.rejected,
  COLUMN_LABELS.coreDenominator,
] as const

const COUNT_COLUMNS_AFTER_RATES = [
  COLUMN_LABELS.joinedRate,
  COLUMN_LABELS.rejectionRate,
  COLUMN_LABELS.cycle,
] as const

/**
 * `COUNT_COLUMNS_BEFORE_RATES` 各列对应的引擎计数，顺序**必须**与上一个常量逐项对齐。
 * 值全部直接读 `group.counts`，组件不在这里做任何加减。
 */
function countValuesOf(group: GroupSummary): readonly number[] {
  return [
    group.counts.total,
    group.counts.joined,
    group.counts.pending,
    group.counts.approving,
    group.counts.rejected,
    group.counts.coreDenominator,
  ]
}

/** 周期单元格：有效 n / 均值 / 中位数（无有效样本显示「—」，不显示 0 天） */
function CycleCell({ stats }: { readonly stats: GroupSummary['cycles']['actual'] }) {
  return (
    <td className="py-2 pr-3 tabular-nums" title={`${stats.note}（被排除 ${stats.excludedCount} 条）`}>
      {stats.n === 0
        ? EMPTY_VALUE
        : `${formatInteger(stats.n)} / ${formatDays(stats.meanDays)} / ${formatDays(
            stats.medianDays,
          )}`}
    </td>
  )
}

/** 一行分组（数据行与合计行共用同一套单元格，避免列错位） */
function GroupRow({
  group,
  showCoverage,
  showGroupComposition,
  onDrilldown,
  isTotal = false,
  label,
  withDrilldown = false,
}: {
  readonly group: GroupSummary
  readonly showCoverage: boolean
  readonly showGroupComposition: boolean
  readonly onDrilldown?: (value: string) => void
  readonly isTotal?: boolean
  readonly label?: string
  readonly withDrilldown?: boolean
}) {
  const drilldownValue = isTotal ? null : drilldownValueOf(group)
  const rowClass = isTotal
    ? 'border-b border-slate-200 bg-slate-50 font-medium'
    : 'border-b border-slate-100'

  return (
    <tr className={rowClass}>
      <th className="py-2 pr-3 text-left font-normal" scope="row">
        {label ?? group.key}
        {drilldownValue === null && !isTotal && (
          <span className="ml-1 text-xs text-slate-400">（合并行，不可下钻）</span>
        )}
      </th>
      {COUNT_COLUMNS_BEFORE_RATES.map((columnLabel, index) => (
        <td className="py-2 pr-3 tabular-nums" key={columnLabel}>
          {formatInteger(countValuesOf(group)[index] ?? 0)}
        </td>
      ))}
      {showGroupComposition && (
        <>
          {/* 组内构成只由引擎计数：拒 offer 组人数 / 入职组人数；两者之和 = comparedCount */}
          <td className="py-2 pr-3 tabular-nums">
            {formatInteger(group.groupComposition.rejectedGroupCount)}
          </td>
          <td className="py-2 pr-3 tabular-nums">
            {formatInteger(group.groupComposition.joinedGroupCount)}
          </td>
        </>
      )}
      {COUNT_COLUMNS_AFTER_RATES.map((label, index) => {
        if (index === 0) {
          return (
            <RateCell
              denominator={group.rates.joinedRate.denominator}
              key={label}
              numerator={group.rates.joinedRate.numerator}
              value={group.rates.joinedRate.value}
            />
          )
        }
        if (index === 1) {
          return (
            <RateCell
              denominator={group.rates.rejectionRate.denominator}
              key={label}
              numerator={group.rates.rejectionRate.numerator}
              value={group.rates.rejectionRate.value}
            />
          )
        }
        return <CycleCell key={label} stats={group.cycles.actual} />
      })}
      {showCoverage && (
        <td className="py-2 pr-3 tabular-nums">
          {formatInteger(group.coverage.distinctRequirementCount)}
          <span className="ml-1 text-xs text-slate-400">
            （缺需求 ID {formatInteger(group.coverage.missingRequirementIdCount)}）
          </span>
        </td>
      )}
      <td className="py-2 pr-3 text-xs text-slate-600">{SAMPLE_TAG_LABELS[sampleTagOf(group)]}</td>
      {withDrilldown && (
        <td className="py-2">
          {drilldownValue === null || onDrilldown === undefined ? (
            <span className="text-xs text-slate-400">{EMPTY_VALUE}</span>
          ) : (
            <button
              className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100"
              onClick={() => onDrilldown(drilldownValue)}
              type="button"
            >
              {DRILLDOWN_LABEL}
            </button>
          )}
        </td>
      )}
    </tr>
  )
}

/**
 * 通用分组表（步骤9；步骤10 追加「组内构成」两列，默认关闭）。
 *
 * 所有列都直接读 `GroupSummary`（引擎的 `aggregateByDimension` / `topNWithOther` / `summarizeRecords` 产出）：
 * N / J / P / A / R / D、入职率、拒 offer 率、实际周期（n / 均值 / 中位数）、覆盖需求数、样本门槛；
 * 打开 `showGroupComposition` 时在 `D` 与 `入职率` 之间再插两列组内构成。
 * 组件内没有任何公式，也不把各分组的率相加求平均。
 */
export default function GroupSummaryTable({
  caption,
  dimensionLabel,
  groups,
  totalRow = null,
  totalLabel = '合计（引擎对同一批记录重新汇总）',
  showCoverage = false,
  showGroupComposition = false,
  onDrilldown,
}: GroupSummaryTableProps) {
  const withDrilldown = onDrilldown !== undefined

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[64rem] border-collapse text-sm">
        <caption className="pb-2 text-left text-xs text-slate-500">{caption}</caption>
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
            <th className="py-2 pr-3 font-medium" scope="col">
              {dimensionLabel}
            </th>
            {COUNT_COLUMNS_BEFORE_RATES.map((label) => (
              <th className="py-2 pr-3 font-medium" key={label} scope="col">
                {label}
              </th>
            ))}
            {showGroupComposition &&
              GROUP_COMPOSITION_COLUMNS.map((label) => (
                <th className="py-2 pr-3 font-medium" key={label} scope="col">
                  {label}
                </th>
              ))}
            {COUNT_COLUMNS_AFTER_RATES.map((label) => (
              <th className="py-2 pr-3 font-medium" key={label} scope="col">
                {label}
              </th>
            ))}
            {showCoverage && (
              <th className="py-2 pr-3 font-medium" scope="col">
                {COLUMN_LABELS.coverage}
              </th>
            )}
            <th className="py-2 pr-3 font-medium" scope="col">
              {COLUMN_LABELS.sample}
            </th>
            {withDrilldown && (
              <th className="py-2 font-medium" scope="col">
                {COLUMN_LABELS.drilldown}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <GroupRow
              group={group}
              key={group.key}
              onDrilldown={onDrilldown}
              showCoverage={showCoverage}
              showGroupComposition={showGroupComposition}
              withDrilldown={withDrilldown}
            />
          ))}
          {totalRow !== null && (
            <GroupRow
              group={totalRow}
              isTotal
              label={totalLabel}
              showCoverage={showCoverage}
              showGroupComposition={showGroupComposition}
              withDrilldown={withDrilldown}
            />
          )}
        </tbody>
      </table>
      {/*
        组内构成的额外说明只在这一列真的渲染时出现：
        它避免读者把「某取值在拒 offer 组里有几条」读成「该取值的拒 offer 率」——
        两者分子相同、分母完全不同（R 对 D）。
      */}
      {showGroupComposition && (
        <p className="pt-2 text-xs leading-5 text-slate-500">{GROUP_COMPOSITION_HINT}</p>
      )}
    </div>
  )
}
