import { useMemo, useState } from 'react'

import { UNKNOWN, type DecoratedRecord } from '../../domain'
import { EMPTY_VALUE, formatCurrency, formatDays, formatInteger, formatPercent } from '../../lib/format'

import { STATUS_NOTES } from './dashboardText'

type RecordDetailTableProps = {
  /** 已由引擎补全派生字段的记录（当前筛选后的集合） */
  readonly records: readonly DecoratedRecord[]
}

/** 每页行数：明细只用于核对，不整表铺 DOM（大表拆页） */
const PAGE_SIZE = 25

function salaryText(record: DecoratedRecord): string {
  if (record.currency === null || record.salaryUnit === null) {
    return record.salaryAmount === null ? EMPTY_VALUE : '单位未确认'
  }
  return `${formatCurrency(record.salaryAmount, 'CNY', 0)}／${record.salaryUnit}`
}

function benchmarkText(record: DecoratedRecord): string {
  const benchmark = record.derived.salaryBenchmark
  if (benchmark === null) {
    return '无同岗分组'
  }
  if (!benchmark.sufficient) {
    return `同岗样本不足（n=${formatInteger(benchmark.n)}）`
  }
  return `P50 ${formatCurrency(benchmark.p50, 'CNY', 0)}（n=${formatInteger(benchmark.n)}）`
}

/**
 * 明细表（步骤8：图表下钻后的核对入口，默认显示候选人 ID）。
 *
 * 口径：
 * - 只显示当前筛选后的记录，行数与卡片、图表一致（三处同源：同一份 `AnalysisResult`）；
 * - 周期 / 基准 / 分位 / 「低于中位数」全部取 `decorateRecords` 填好的派生字段，
 *   组件不重算（AGENTS.md §2.3）；缺失一律显示「—」，不用 0 冒充；
 * - 不显示候选人姓名：明细默认用候选人 ID 核对，姓名不进入这张表。
 */
export default function RecordDetailTable({ records }: RecordDetailTableProps) {
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const visible = useMemo(
    () => records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [records, currentPage],
  )

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">
          记录明细（当前筛选后 {formatInteger(records.length)} 条）
        </h2>
        <div className="flex items-center gap-2 text-xs text-slate-600">
          <button
            className="rounded border border-slate-300 px-2 py-1 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={currentPage <= 1}
            onClick={() => setPage(currentPage - 1)}
            type="button"
          >
            上一页
          </button>
          <span className="tabular-nums">
            第 {formatInteger(currentPage)} / {formatInteger(pageCount)} 页
          </span>
          <button
            className="rounded border border-slate-300 px-2 py-1 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={currentPage >= pageCount}
            onClick={() => setPage(currentPage + 1)}
            type="button"
          >
            下一页
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[70rem] border-collapse text-xs">
          <caption className="pb-2 text-left text-slate-500">
            明细默认用候选人 ID 核对；姓名不进入这张表。周期、基准与「低于中位数」都由指标引擎计算，
            基准参照「全部保留记录」，不随筛选漂移。
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-2 pr-3 font-medium">候选人 ID</th>
              <th className="py-2 pr-3 font-medium">offer 状态</th>
              <th className="py-2 pr-3 font-medium">城市</th>
              <th className="py-2 pr-3 font-medium">岗位</th>
              <th className="py-2 pr-3 font-medium">序列</th>
              <th className="py-2 pr-3 font-medium">招聘 HR</th>
              <th className="py-2 pr-3 font-medium">渠道</th>
              <th className="py-2 pr-3 font-medium">推荐类型</th>
              <th className="py-2 pr-3 font-medium">启动招聘日期</th>
              <th className="py-2 pr-3 font-medium">入职日期</th>
              <th className="py-2 pr-3 font-medium">实际周期</th>
              <th className="py-2 pr-3 font-medium">薪资</th>
              <th className="py-2 pr-3 font-medium">同岗基准</th>
              <th className="py-2 pr-3 font-medium">分位排名</th>
              <th className="py-2 pr-3 font-medium">低于中位数</th>
              <th className="py-2 font-medium">需求 ID</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td className="py-3 text-slate-600" colSpan={16}>
                  当前筛选没有匹配记录（不是「0 条业务结果」，而是筛选条件太窄）；可清空筛选或放宽条件。
                </td>
              </tr>
            )}
            {visible.map((record) => (
              <tr className="border-b border-slate-100" key={record.recordId}>
                <th className="py-2 pr-3 text-left font-normal tabular-nums" scope="row">
                  {record.candidateDisplayId}
                </th>
                <td className="py-2 pr-3" title={STATUS_NOTES[record.offerStatus]}>
                  {record.offerStatus}
                </td>
                <td className="py-2 pr-3">{record.city}</td>
                <td className="py-2 pr-3">{record.position ?? EMPTY_VALUE}</td>
                <td className="py-2 pr-3">{record.jobFamily ?? EMPTY_VALUE}</td>
                <td className="py-2 pr-3">{record.recruiter ?? EMPTY_VALUE}</td>
                <td className="py-2 pr-3">{record.channel === UNKNOWN ? UNKNOWN : record.channel}</td>
                <td className="py-2 pr-3">{record.referralType}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {record.recruitmentStartDate ?? EMPTY_VALUE}
                </td>
                <td className="py-2 pr-3 tabular-nums">{record.joiningDate ?? EMPTY_VALUE}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatDays(record.derived.recruitmentCycleDays)}
                </td>
                <td className="py-2 pr-3 tabular-nums">{salaryText(record)}</td>
                <td className="py-2 pr-3">{benchmarkText(record)}</td>
                <td className="py-2 pr-3 tabular-nums">
                  {formatPercent(record.derived.salaryPercentileRank, 1)}
                </td>
                <td className="py-2 pr-3">
                  {record.derived.isBelowMedian === null
                    ? EMPTY_VALUE
                    : record.derived.isBelowMedian
                      ? '低于中位数'
                      : '不低于中位数'}
                </td>
                <td className="py-2 tabular-nums">{record.requirementId ?? EMPTY_VALUE}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
