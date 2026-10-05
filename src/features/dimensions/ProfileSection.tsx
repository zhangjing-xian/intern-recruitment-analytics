import {
  PROFILE_NOTE,
  SCHOOL_SOURCE_NOTE,
  VALUE_SOURCES,
  VALUE_SOURCE_LABELS,
  type GroupDimension,
  type GroupSummary,
  type ValueSource,
} from '../../domain'
import { formatInteger } from '../../lib/format'

import GroupBarChart from './GroupBarChart'
import GroupSummaryTable from './GroupSummaryTable'
import SectionShell from './SectionShell'
import { CHART_HINT, SECTION_TITLES } from './analysisText'
import { isMergedGroupKey } from './dimensionViews'

type DimensionBlock = {
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
}

type ProfileSectionProps = {
  readonly graduationYear: DimensionBlock
  readonly education: DimensionBlock
  /** 学校：TopN + 其他（长尾合并） */
  readonly school: DimensionBlock
  /** 学校完整分组（「全表」展开用） */
  readonly schoolAll: readonly GroupSummary[]
  readonly gpt: DimensionBlock
  readonly schoolSources: Readonly<Record<ValueSource, number>>
  readonly gptSources: Readonly<Record<ValueSource, number>>
  /** 每张表下钻自己的维度（年级 / 学历 / 学校 / GPT），不能共用一个维度 */
  readonly onDrilldown: (dimension: GroupDimension, value: string) => void
}

/** 结论来源计数（学校别名归一 / GPT 名单补全是否发生，必须可见） */
function SourceTable({
  counts,
  caption,
}: {
  readonly counts: Readonly<Record<ValueSource, number>>
  readonly caption: string
}) {
  return (
    <table className="w-full min-w-[24rem] border-collapse text-xs">
      <caption className="pb-2 text-left text-slate-500">{caption}</caption>
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-500">
          <th className="py-1 pr-3 font-medium" scope="col">
            结论来源
          </th>
          <th className="py-1 font-medium" scope="col">
            记录数
          </th>
        </tr>
      </thead>
      <tbody>
        {VALUE_SOURCES.map((source) => (
          <tr className="border-b border-slate-100" key={source}>
            <th className="py-1 pr-3 text-left font-normal" scope="row">
              {VALUE_SOURCE_LABELS[source]}
            </th>
            <td className="py-1 tabular-nums">{formatInteger(counts[source])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * 候选人画像（docs/PRD.md 8 章「候选人画像」）。
 *
 * 年级 / 学历 / 学校 / GPT 四个分布与分组率并排展示；学校长尾取 Top 10 + 其他并附全表；
 * 「学校别名命中数」「GPT 判定来源」单列，便于核对归一与名单补全是否合理。
 * 本模块**不**推断个人能力，也不提供录用 / 淘汰建议（文案来自引擎的 `PROFILE_NOTE`）。
 */
export default function ProfileSection({
  graduationYear,
  education,
  school,
  schoolAll,
  gpt,
  schoolSources,
  gptSources,
  onDrilldown,
}: ProfileSectionProps) {
  return (
    <SectionShell
      notes={[PROFILE_NOTE, SCHOOL_SOURCE_NOTE, CHART_HINT]}
      title={SECTION_TITLES.profile}
    >
      {/*
        用户需求 ③：画像四张图（年级 / 学历 / 学校 / GPT）都放在各自表格**之前**——
        先看形状再看数字。图全部由 `GroupBarChart` 画，数据仍来自引擎的分组结果。
      */}
      <GroupBarChart
        ariaDescription="各毕业年级的记录数"
        groups={graduationYear.groups}
        metric="total"
        onSelectCategory={(value) => onDrilldown('graduationYear', value)}
        xAxisName="毕业年级"
      />

      <GroupSummaryTable
        caption="毕业年级分布：年级缺失或不可识别的记录归「未知」并保留展示。"
        dimensionLabel="毕业年级"
        groups={graduationYear.groups}
        onDrilldown={(value) => onDrilldown('graduationYear', value)}
        totalRow={graduationYear.total}
      />

      <GroupBarChart
        ariaDescription="各学历的记录数"
        groups={education.groups}
        metric="total"
        onSelectCategory={(value) => onDrilldown('education', value)}
        xAxisName="学历"
      />

      <GroupSummaryTable
        caption="学历分布：学历缺失或不可识别归「未知」，不在界面里猜学历。"
        dimensionLabel="学历"
        groups={education.groups}
        onDrilldown={(value) => onDrilldown('education', value)}
        totalRow={education.total}
      />

      <GroupBarChart
        ariaDescription="各学校（Top 10）的记录数；长尾合并分组不进图"
        groups={school.groups.filter((group) => !isMergedGroupKey(group.key))}
        // 学校名普遍很长（10 字以上）→ 横向条形图，类目在左侧完整可读
        layout="horizontal"
        metric="total"
        onSelectCategory={(value) => onDrilldown('school', value)}
        xAxisName="学校"
      />

      <GroupSummaryTable
        caption="学校分布（Top 10 + 其他）：长尾合并行不可下钻，完整学校清单见下方「全表」。"
        dimensionLabel="学校"
        groups={school.groups}
        onDrilldown={(value) => onDrilldown('school', value)}
        totalRow={school.total}
      />

      <details className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          学校全表（未合并任何分组，共 {formatInteger(schoolAll.length)} 个取值）+ 结论来源
        </summary>
        <div className="mt-2 space-y-3">
          <SourceTable caption="学校结论来源计数（别名归一命中越多，越需要核对别名规则）" counts={schoolSources} />
          <GroupSummaryTable
            caption="学校完整分组：分组值即清洗后的学校名；「未知」表示原值缺失或无法识别。"
            dimensionLabel="学校"
            groups={schoolAll}
            totalRow={school.total}
          />
        </div>
      </details>

      <GroupBarChart
        ariaDescription="GPT 院校三值（是 / 否 / 未知）的记录数"
        groups={gpt.groups}
        metric="total"
        onSelectCategory={(value) => onDrilldown('isGptSchool', value)}
        xAxisName="GPT 院校"
      />

      <GroupSummaryTable
        caption="GPT 院校分布：「是 / 否 / 未知」三值分开；「否」只在用户声明名单完整时才可能成立。"
        dimensionLabel="GPT"
        groups={gpt.groups}
        onDrilldown={(value) => onDrilldown('isGptSchool', value)}
        totalRow={gpt.total}
      />

      <details className="rounded border border-slate-200 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-700">
          GPT 判定来源计数
        </summary>
        <div className="mt-2">
          <SourceTable caption="GPT 结论来源（原值优先；本地名单补全的条数单列）" counts={gptSources} />
        </div>
      </details>
    </SectionShell>
  )
}
