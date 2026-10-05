import type { ActionAdvice } from '../../domain'
import SectionShell from '../dimensions/SectionShell'

import { ADVICE_EMPTY_NOTE, ADVICE_HEADING, COLUMN_LABELS, SECTION_TITLES } from './rejectionText'

type ActionAdvicePanelProps = {
  /** 由观察推导出的规则化建议（`insight.advice`，引擎已按观察去重） */
  readonly advice: readonly ActionAdvice[]
}

/**
 * 行动建议（docs/PRD.md 9.4）。
 *
 * 建议**只**来自已观察到的证据：原因缺失或未分类 → 补充访谈 / 维护字典；低薪规则有命中 →
 * 核查报价与同岗基准；无补贴规则有命中 → 核查住宿需求与补贴资格；等待过长 → 跟进当前节点；
 * 样本不足 → 继续采集。这些映射写在结论层（`insights/rejection.ts` + `ACTION_ADVICE_RULES`），
 * 组件只做「观察 → 建议」两列表格，不新增、不改写任何一条建议
 * （尤其不得把院校 / 学历标签转成录用或淘汰建议）。
 *
 * 一条建议都没有时给明确空态：不能留白让人以为页面坏了，也不能硬凑一条建议。
 */
export default function ActionAdvicePanel({ advice }: ActionAdvicePanelProps) {
  return (
    <SectionShell
      notes={advice.length === 0 ? [ADVICE_EMPTY_NOTE] : []}
      title={SECTION_TITLES.advice}
    >
      <h4 className="text-xs font-medium text-slate-700">{ADVICE_HEADING}</h4>

      {advice.length === 0 ? (
        <p className="text-sm text-slate-600">本次没有可给出的行动建议。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <caption className="pb-2 text-left text-xs text-slate-500">
              每条建议都由一条已观察到的证据触发；建议是待核查事项，不是结论，也不构成对候选人个人的判断。
            </caption>
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                <th className="py-2 pr-3 font-medium" scope="col">
                  {COLUMN_LABELS.observation}
                </th>
                <th className="py-2 pr-3 font-medium" scope="col">
                  {COLUMN_LABELS.advice}
                </th>
              </tr>
            </thead>
            <tbody>
              {advice.map((item) => (
                <tr className="border-b border-slate-100" key={item.id}>
                  <th className="py-2 pr-3 text-left font-normal align-top" scope="row">
                    {item.observation}
                  </th>
                  <td className="py-2 pr-3 align-top">{item.advice}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionShell>
  )
}
