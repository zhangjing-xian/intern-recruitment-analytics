import { useMemo } from 'react'

import {
  SALARY_UNIT_UNKNOWN_LABEL,
  type HousingComparisonResult,
  type MetricAvailability,
  type SalaryDistributionResult,
  type SalaryUnitDistribution,
} from '../../domain'
import { EMPTY_VALUE, formatDecimal, formatInteger } from '../../lib/format'
import EChart from '../dashboard/charts/EChart'
import type { EChartOption } from '../dashboard/charts/echartsLoader'

import GroupSummaryTable from './GroupSummaryTable'
import SectionShell from './SectionShell'
import { MODULE_DISABLED_PREFIX, SECTION_TITLES } from './analysisText'
import { moduleUnavailableReason } from './dimensionViews'

type CompensationSectionProps = {
  readonly distribution: SalaryDistributionResult
  readonly housing: HousingComparisonResult
  readonly availability: readonly MetricAvailability[]
  /** 币种与计薪周期是否已确认；false 时不显示任何金额分位（含现金房补） */
  readonly comparable: boolean
  readonly onDrilldown: (value: string) => void
}

/**
 * 直方图分箱标签的连接符（标签形如 `3900–4200`，不含控制字符，可安全用作分隔符）。
 * 用标量内容键当 memo 依赖，避免「每次渲染新数组 ⇒ memo 永不命中」。
 */
const BIN_LABEL_SEPARATOR = '\u0000'

/**
 * 一个计薪单位的直方图（分箱与计数全部由引擎给出，组件只画）。
 *
 * 依赖用**内容字符串**而不是数组身份：调用方每次渲染都会 `.map()` 出新数组，
 * 用数组身份当依赖会让 memo 永不命中，而 `EChart` 在 option 身份变化时会重新
 * `setOption`（等于每次按键都重画图）。这里只依赖 `binLabelsKey` / `countsKey` 两个标量，
 * 依赖数组与回调真正读取的值一一对应，不需要关闭任何 lint 规则。
 */
function HistogramChart({
  label,
  countsKey,
  binLabelsKey,
}: {
  readonly label: string
  readonly countsKey: string
  readonly binLabelsKey: string
}) {
  const option = useMemo<EChartOption>(() => {
    const binLabels = binLabelsKey === '' ? [] : binLabelsKey.split(BIN_LABEL_SEPARATOR)
    const counts = countsKey === '' ? [] : countsKey.split(',').map(Number)
    return {
      aria: { enabled: true, label: { description: `${label}薪资分布直方图` } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      grid: { left: 8, right: 16, top: 24, bottom: 40, containLabel: true },
      xAxis: { type: 'category', data: binLabels, name: '区间' },
      yAxis: { type: 'value', name: '记录数' },
      series: [{ name: label, type: 'bar' as const, data: counts }],
    }
  }, [binLabelsKey, countsKey, label])

  const binCount = binLabelsKey === '' ? 0 : binLabelsKey.split(BIN_LABEL_SEPARATOR).length

  return (
    <EChart
      ariaLabel={`${label}薪资分布直方图，共 ${formatInteger(binCount)} 个区间；同数数据表见下方`}
      heightPx={260}
      option={option}
    />
  )
}

/**
 * 薪酬与房补（docs/PRD.md 6.2、8 章「薪酬房补」）。
 *
 * - 不同计薪单位（元/月、元/天、其他、未知）永远并列展示，**不合算**、也不放进同一条分位；
 * - 有效样本 n < 5 只报 n，不出分位与直方图（不打「待遇低」标签）；
 * - 「无补贴」「提供住宿」「未知房补」是三个不同数字，现金房补金额缺失时不填 0；
 * - 未确认币种 / 计薪周期时**不显示任何金额分位**（含现金房补）——质量层同时禁用了
 *   「薪资对比」与「房补对比」（`quality.ts` 的 `SALARY_UNIT_UNCONFIRMED`），
 *   金额本就没有可比口径；房补的**类型分布与各率**不受影响，仍然显示。
 */
export default function CompensationSection({
  distribution,
  housing,
  availability,
  comparable,
  onDrilldown,
}: CompensationSectionProps) {
  const salaryReason = moduleUnavailableReason(availability, '薪资对比')
  const housingReason = moduleUnavailableReason(availability, '房补对比')
  const multiUnit = distribution.unitCount > 1

  return (
    <SectionShell
      notes={[
        distribution.note,
        housing.note,
        ...(multiUnit
          ? ['本次筛选下存在多种可识别计薪单位：各单位只并列展示，任何跨单位平均值都是错的。']
          : []),
        ...(salaryReason === null ? [] : [`${MODULE_DISABLED_PREFIX}（薪资对比）：${salaryReason}`]),
        ...(housingReason === null
          ? []
          : [`${MODULE_DISABLED_PREFIX}（房补对比）：${housingReason}`]),
      ]}
      title={SECTION_TITLES.compensation}
    >
      {distribution.disabledReason !== null && (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          薪资分布已禁用：{distribution.disabledReason}
        </p>
      )}

      {distribution.disabledReason === null && distribution.byUnit.length === 0 && (
        <p className="text-xs leading-5 text-slate-600">
          当前筛选下没有记了计薪单位的记录：不显示 0 元，也不猜测单位。
        </p>
      )}

      {distribution.byUnit.map((unit) => (
        <UnitBlock key={unit.label} unit={unit} />
      ))}

      <GroupSummaryTable
        caption="房补类型对比：类型分布与各率；「提供住宿」「无补贴」「未知」分列，住宿不折现、未知不当 0 元。"
        dimensionLabel="房补类型"
        groups={housing.groups}
        onDrilldown={onDrilldown}
      />

      {comparable ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-xs">
            <caption className="pb-2 text-left text-slate-500">
              现金房补金额按房补周期分列（月 / 天 / 次口径不同，不能合算）；不足 5 条只报 n。
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-3 font-medium" scope="col">
                  房补周期
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  有效 n
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  P25
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  P50
                </th>
                <th className="py-1 pr-3 font-medium" scope="col">
                  P75
                </th>
                <th className="py-1 font-medium" scope="col">
                  金额缺失
                </th>
              </tr>
            </thead>
            <tbody>
              {housing.cashByPeriod.length === 0 && (
                <tr>
                  <td className="py-2 text-slate-500" colSpan={6}>
                    本次筛选下没有「现金房补」记录：不显示 0 元（无补贴与现金房补是两类）。
                  </td>
                </tr>
              )}
              {housing.cashByPeriod.map((stats) => (
                <tr className="border-b border-slate-100 tabular-nums" key={stats.label}>
                  <th className="py-2 pr-3 text-left font-normal" scope="row">
                    {stats.label}
                  </th>
                  <td className="py-2 pr-3">{formatInteger(stats.n)}</td>
                  <td className="py-2 pr-3">
                    {stats.sufficient ? formatDecimal(stats.quantiles.p25, 2) : EMPTY_VALUE}
                  </td>
                  <td className="py-2 pr-3">
                    {stats.sufficient ? formatDecimal(stats.quantiles.p50, 2) : EMPTY_VALUE}
                  </td>
                  <td className="py-2 pr-3">
                    {stats.sufficient ? formatDecimal(stats.quantiles.p75, 2) : EMPTY_VALUE}
                  </td>
                  <td className="py-2">{formatInteger(stats.excludedCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs leading-5 text-slate-600">
          现金房补金额分位已禁用（与薪资分布同一原因：币种或计薪周期未确认，金额口径不可比）；
          上方「房补类型」的分布与各率不受影响。
        </p>
      )}

      <p className="text-xs leading-5 text-slate-600">
        本次筛选下：提供住宿 {formatInteger(housing.accommodationCount)} 条（不折现、也不算无补贴）、
        无补贴 {formatInteger(housing.noSubsidyCount)} 条、房补类型未知或「其他」{' '}
        {formatInteger(housing.unknownOrOtherCount)} 条、现金房补但金额缺失{' '}
        {formatInteger(housing.cashAmountMissingCount)} 条（总额未知，不填 0）。「{SALARY_UNIT_UNKNOWN_LABEL}
        」的记录不与已知单位合算。
      </p>
    </SectionShell>
  )
}

function QuantileRow({ unit }: { readonly unit: SalaryUnitDistribution }) {
  return (
    <tr className="border-b border-slate-100 tabular-nums">
      <td className="py-1 pr-3">{formatDecimal(unit.quantiles.p25, 2)}</td>
      <td className="py-1 pr-3">{formatDecimal(unit.quantiles.p50, 2)}</td>
      <td className="py-1 pr-3">{formatDecimal(unit.quantiles.p75, 2)}</td>
      <td className="py-1 pr-3">{formatDecimal(unit.mean, 2)}</td>
      <td className="py-1 pr-3">{formatDecimal(unit.min, 2)}</td>
      <td className="py-1">{formatDecimal(unit.max, 2)}</td>
    </tr>
  )
}

/**
 * 一个计薪单位的区块：直方图 + 同数数据表 + 分位表。
 *
 * 单独抽成组件（而不是在 `byUnit.map()` 里内联）有两个原因：
 * 1. hooks 必须在组件顶层调用——直方图的 `option` 需要 `useMemo`，不能写在循环回调里；
 * 2. 这里才能用**内容字符串**当 memo 依赖（见 `HistogramChart` 的注释），
 *    既不关闭任何 lint 规则，也不会因为父组件每次渲染都生成新数组而让 memo 失效。
 */
function UnitBlock({ unit }: { readonly unit: SalaryUnitDistribution }) {
  return (
    <div className="space-y-3 rounded border border-slate-200 p-3">
      <h4 className="text-xs font-semibold text-slate-800">
        计薪单位：{unit.label}（记录 {formatInteger(unit.recordCount)} 条，有效薪资 n{' '}
        {formatInteger(unit.n)}，薪资缺失 / 非法 {formatInteger(unit.excludedCount)} 条）
      </h4>

      {/*
        分箱方式必须写在图上（2026-09-27）：同一张图在不同数据上可能是「逐值出箱」也可能是
        「等宽分箱」，而两种方式下标签的含义完全不同（前者是真实取值，后者是区间）。
        文案由引擎给出（`unit.histogramNote`），组件不自己拼。
      */}
      {unit.sufficient && unit.histogramNote !== '' ? (
        <p className="text-xs leading-5 text-slate-600">{unit.histogramNote}</p>
      ) : null}

      {unit.sufficient ? (
        <>
          <HistogramChart
            binLabelsKey={unit.histogram.map((bin) => bin.label).join(BIN_LABEL_SEPARATOR)}
            countsKey={unit.histogram.map((bin) => bin.count).join(',')}
            label={unit.label}
          />

          {/* 直方图的同数数据表：分箱与计数全部来自引擎的 `unit.histogram`，
              保证读屏 / 键盘用户拿到与图完全相同的数字（AGENTS §4）。 */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[24rem] border-collapse text-xs">
              <caption className="pb-2 text-left text-slate-500">
                薪资分布直方图数据表（分箱方式见上方说明；单值箱的「区间」就是该取值本身，各箱计数之和 = 有效样本 n）
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-1 pr-3 font-medium" scope="col">
                    区间
                  </th>
                  <th className="py-1 font-medium" scope="col">
                    记录数
                  </th>
                </tr>
              </thead>
              <tbody>
                {unit.histogram.map((bin) => (
                  <tr className="border-b border-slate-100" key={bin.label}>
                    <th className="py-1 pr-3 text-left font-normal" scope="row">
                      {bin.label}
                    </th>
                    <td className="py-1 tabular-nums">{formatInteger(bin.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-xs">
              <caption className="pb-2 text-left text-slate-500">
                分位与直方图只对本单位的有效薪资样本计算；直方图为等宽分箱（左闭右闭，
                最后一个箱包含最大值）。
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-1 pr-3 font-medium" scope="col">
                    P25
                  </th>
                  <th className="py-1 pr-3 font-medium" scope="col">
                    P50
                  </th>
                  <th className="py-1 pr-3 font-medium" scope="col">
                    P75
                  </th>
                  <th className="py-1 pr-3 font-medium" scope="col">
                    均值
                  </th>
                  <th className="py-1 pr-3 font-medium" scope="col">
                    最小
                  </th>
                  <th className="py-1 font-medium" scope="col">
                    最大
                  </th>
                </tr>
              </thead>
              <tbody>
                <QuantileRow unit={unit} />
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="text-xs leading-5 text-slate-600">
          有效样本 n = {formatInteger(unit.n)} &lt; 5：只报记录数，不出分位与直方图（也不打低薪 /
          高薪标签）。
        </p>
      )}
    </div>
  )
}
