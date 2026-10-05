import {
  OFFER_STATUSES,
  TIME_BASES,
  TIME_BASIS_LABELS,
  type FilterOutcome,
  type GroupDimension,
  type GroupingOptions,
  type NormalizedRecord,
  type OfferStatus,
} from '../../domain'
import { formatInteger } from '../../lib/format'

import {
  activeFilterSummary,
  clearFilters,
  dimensionLabel,
  dimensionOptions,
  filterableDimensions,
  groupingOptionsOf,
  hasActiveFilters,
  parseSalaryBandEdges,
  setIncludeMissingDate,
  setSalaryBandEdgesText,
  setTimeBasis,
  setTimeRange,
  timeInputIssues,
  toggleDimensionValue,
  toggleStatus,
  type DashboardFilterDraft,
} from './dashboardFilters'
import { UNKNOWN_OPTION_NOTE } from './dashboardText'

type GlobalFilterPanelProps = {
  /** 去重后的全部保留记录：维度选项从这里取，避免选项随筛选「边点边消失」 */
  readonly records: readonly NormalizedRecord[]
  readonly draft: DashboardFilterDraft
  readonly onChange: (next: DashboardFilterDraft) => void
  readonly filterOutcome: FilterOutcome
  /** 状态筛选生效时的子集率提示（由 `analyzeRecords` 给出，组件不自己判断） */
  readonly subsetRateNote: string | null
}

const CHIP_BASE =
  'rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40'
const CHIP_ON = 'border-slate-900 bg-slate-900 text-white'
const CHIP_OFF = 'border-slate-300 text-slate-700 hover:bg-slate-100'

function DimensionFilterSection({
  dimension,
  records,
  draft,
  groupingOptions,
  onChange,
}: {
  readonly dimension: GroupDimension
  readonly records: readonly NormalizedRecord[]
  readonly draft: DashboardFilterDraft
  readonly groupingOptions: GroupingOptions
  readonly onChange: (next: DashboardFilterDraft) => void
}) {
  const options = dimensionOptions(records, dimension, draft, groupingOptions)
  const selectedCount = (draft.dimensions[dimension] ?? []).length

  return (
    <details className="rounded border border-slate-200 bg-white p-2">
      <summary className="cursor-pointer text-xs font-medium text-slate-700">
        {dimensionLabel(dimension)}
        {selectedCount > 0 ? `（已选 ${selectedCount} 项）` : ''}
      </summary>
      {options.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">当前数据集在该维度没有取值</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1">
          {options.map((option) => (
            <button
              aria-pressed={option.selected}
              className={`${CHIP_BASE} ${option.selected ? CHIP_ON : CHIP_OFF}`}
              key={option.value}
              onClick={() => onChange(toggleDimensionValue(draft, dimension, option.value))}
              type="button"
            >
              {option.value}
              <span className="ml-1 tabular-nums opacity-70">{formatInteger(option.count)}</span>
            </button>
          ))}
        </div>
      )}
    </details>
  )
}

function StatusFilterSection({
  draft,
  onChange,
}: {
  readonly draft: DashboardFilterDraft
  readonly onChange: (next: DashboardFilterDraft) => void
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {OFFER_STATUSES.map((status: OfferStatus) => {
        const selected = draft.statuses.includes(status)
        return (
          <button
            aria-pressed={selected}
            className={`${CHIP_BASE} ${selected ? CHIP_ON : CHIP_OFF}`}
            key={status}
            onClick={() => onChange(toggleStatus(draft, status))}
            type="button"
          >
            {status}
          </button>
        )
      })}
    </div>
  )
}

/**
 * 全局筛选面板（步骤8，docs/PRD.md 6.3）。
 *
 * 只负责「收集选择」，不判断业务含义：
 * - 选择状态由 `dashboardFilters.ts`（纯函数、有单测）负责转换，最终只交给引擎的 `applyFilters`；
 * - 维度选项来自**去重后的全部保留记录**，所以其他筛选生效时选项不会边点边消失；
 * - 「未知」与其他取值一样是可点的独立值（不选 = 不过滤，而不是排除未知）；
 * - 时间默认不筛选；选中基准始终显示；日期缺失条数单列，是否纳入由用户决定；
 * - 薪资分档边界由用户显式配置，非法片段原样回显（不静默改成「随便一个分档」）。
 */
export default function GlobalFilterPanel({
  records,
  draft,
  onChange,
  filterOutcome,
  subsetRateNote,
}: GlobalFilterPanelProps) {
  const groupingOptions = groupingOptionsOf(draft)
  const edgesParse = parseSalaryBandEdges(draft.salaryBandEdgesText)
  const timeIssues = timeInputIssues(draft)
  const timeActive = draft.timeFrom.trim() !== '' || draft.timeTo.trim() !== ''
  const summary = activeFilterSummary(draft)

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">全局筛选</h2>
        <button
          className="rounded border border-slate-300 px-3 py-1 text-xs text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!hasActiveFilters(draft)}
          onClick={() => onChange(clearFilters(draft))}
          type="button"
        >
          清空筛选（保留时间基准与薪资分档配置）
        </button>
      </div>

      <p className="text-xs leading-5 text-slate-600">
        规则：不同字段之间取交集（AND），同一字段多选取并集（OR）；某个字段不选就是不过滤。
        {UNKNOWN_OPTION_NOTE}
      </p>

      <div className="space-y-2 rounded border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
          <span className="font-medium">时间筛选（默认不筛选）</span>
          <span className="text-slate-500">基准：</span>
          {TIME_BASES.map((basis) => (
            <button
              aria-pressed={basis === draft.timeBasis}
              className={`${CHIP_BASE} ${basis === draft.timeBasis ? CHIP_ON : CHIP_OFF}`}
              key={basis}
              onClick={() => onChange(setTimeBasis(draft, basis))}
              type="button"
            >
              {TIME_BASIS_LABELS[basis]}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
          <label className="flex items-center gap-1">
            起始日
            <input
              className="rounded border border-slate-300 px-2 py-1 tabular-nums"
              onChange={(event) => onChange(setTimeRange(draft, event.target.value, draft.timeTo))}
              type="date"
              value={draft.timeFrom}
            />
          </label>
          <label className="flex items-center gap-1">
            结束日
            <input
              className="rounded border border-slate-300 px-2 py-1 tabular-nums"
              onChange={(event) => onChange(setTimeRange(draft, draft.timeFrom, event.target.value))}
              type="date"
              value={draft.timeTo}
            />
          </label>
          <label className="flex items-center gap-1">
            <input
              checked={draft.includeMissingDate}
              onChange={(event) => onChange(setIncludeMissingDate(draft, event.target.checked))}
              type="checkbox"
            />
            把「{TIME_BASIS_LABELS[draft.timeBasis]}」缺失的记录也纳入区间
          </label>
        </div>

        {timeIssues.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-xs text-amber-800">
            {timeIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}

        {timeActive && (
          <p className="text-xs tabular-nums text-slate-600">
            区间内匹配 {formatInteger(filterOutcome.matchedCount)} 条（当前生效筛选后的记录）；
            按「{TIME_BASIS_LABELS[draft.timeBasis]}」判定时日期缺失 / 非法{' '}
            {formatInteger(filterOutcome.missingDateCount)} 条
            {draft.includeMissingDate ? '（已按你的选择纳入）' : '（默认不纳入，单独计数）'}。
          </p>
        )}
      </div>

      <div className="space-y-2 rounded border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
          <span className="font-medium">offer 状态</span>
          <span className="text-slate-500">多选取并集；选中后所有率都变成「当前子集率」</span>
        </div>
        <StatusFilterSection draft={draft} onChange={onChange} />
        {subsetRateNote !== null && (
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">{subsetRateNote}</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-700">
          维度筛选（选项与计数来自去重后的全部保留记录）
        </p>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {filterableDimensions().map((dimension) => (
            <DimensionFilterSection
              dimension={dimension}
              draft={draft}
              groupingOptions={groupingOptions}
              key={dimension}
              onChange={onChange}
              records={records}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2 rounded border border-slate-200 p-3">
        <label className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
          <span className="font-medium">薪资区间分档边界</span>
          <input
            className="w-64 rounded border border-slate-300 px-2 py-1 tabular-nums"
            onChange={(event) => onChange(setSalaryBandEdgesText(draft, event.target.value))}
            placeholder="例如 3000,4000,5000（留空 = 不分档）"
            type="text"
            value={draft.salaryBandEdgesText}
          />
        </label>
        <p className="text-xs leading-5 text-slate-500">
          {edgesParse.edges.length === 0
            ? '未配置分档时，「薪资区间」维度的取值全部归「未知」：引擎不会自己发明分档。'
            : `当前分档：${edgesParse.edges.join(' / ')}（区间口径由你决定，界面与报告共用同一份）。`}
        </p>
        {edgesParse.invalidTokens.length > 0 && (
          <p className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
            无法解析的片段：{edgesParse.invalidTokens.join('、')}
            ；为避免出现「半套分档」，本次整份分档边界按未配置处理。
          </p>
        )}
      </div>

      <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-medium text-slate-700">当前生效筛选</p>
        {summary.length === 0 ? (
          <p className="text-xs text-slate-600">未启用任何筛选：以下所有指标为全量口径。</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-700">
            {summary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        <p className="text-xs tabular-nums text-slate-600">
          去重：共 {formatInteger(filterOutcome.totalCount)} 条，按去重策略保留{' '}
          {formatInteger(filterOutcome.retainedCount)} 条
          {filterOutcome.droppedDuplicateCount > 0
            ? `（显式判为重复移除 ${formatInteger(filterOutcome.droppedDuplicateCount)} 条）`
            : ''}
          。
        </p>
      </div>
    </section>
  )
}
