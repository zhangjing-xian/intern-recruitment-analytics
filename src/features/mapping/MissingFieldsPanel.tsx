import { getStandardField, type AnalysisModule, type StandardFieldKey } from '../../domain'
import { formatInteger } from '../../lib/format'

type MissingFieldsPanelProps = {
  readonly missingFields: readonly StandardFieldKey[]
  readonly disabledModules: readonly AnalysisModule[]
  readonly acknowledged: boolean
  readonly onAcknowledge: (acknowledged: boolean) => void
}

/**
 * 缺失标准列清单（docs/PRD.md 4.1）：
 * 缺 offer 状态列由上层按阻断处理；其余缺列要**逐项告知**、说明被禁用的模块，
 * 并在用户确认「部分分析导入」之后才允许提交。
 * 「该列缺失后如何替代」直接取自 `STANDARD_FIELDS[].missingHandling`，与领域口径同源。
 */
export default function MissingFieldsPanel({
  missingFields,
  disabledModules,
  acknowledged,
  onAcknowledge,
}: MissingFieldsPanelProps) {
  if (missingFields.length === 0) {
    return null
  }

  return (
    <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-amber-900">
          缺少 {formatInteger(missingFields.length)} 个标准列
        </h2>
        <span className="text-xs text-amber-800">
          这些列不会被推断或补齐；缺失一律保留为未知（绝不用 0 或「无」代替）。
        </span>
      </div>

      <ul className="space-y-1 text-xs text-amber-900">
        {missingFields.map((field) => (
          <li key={field}>
            <span className="font-medium">{getStandardField(field).header}</span>：
            {getStandardField(field).missingHandling}
          </li>
        ))}
      </ul>

      {disabledModules.length > 0 && (
        <p className="rounded-md bg-white px-3 py-2 text-xs text-amber-900">
          因缺列而不可用的分析模块：{disabledModules.join('、')}
          （其余指标仍会正常计算，并在报告中标注有效样本与排除数）。
        </p>
      )}

      <label className="flex items-center gap-2 text-xs font-medium text-amber-900">
        <input
          checked={acknowledged}
          onChange={(event) => {
            onAcknowledge(event.target.checked)
          }}
          type="checkbox"
        />
        我确认按「部分分析导入」继续（缺列导致的禁用模块已在上面列出）
      </label>
    </section>
  )
}
