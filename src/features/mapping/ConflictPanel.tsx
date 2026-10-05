import type { ConflictResolution, MappingConflict } from '../../domain'
import { formatInteger } from '../../lib/format'

type ConflictPanelProps = {
  readonly conflicts: readonly MappingConflict[]
  readonly resolutions: Readonly<Record<string, ConflictResolution>>
  readonly onResolve: (groupId: string, resolution: ConflictResolution) => void
}

/**
 * 目标列冲突处置（docs/PRD.md 4.3 / 5.5）：
 * 多个源列竞争同一目标时必须由用户**选择一列**或**显式登记合并规则**，系统不会静默覆盖。
 * 未处置前导入被阻断（`state.blocking`），确认按钮保持禁用。
 */
export default function ConflictPanel({ conflicts, resolutions, onResolve }: ConflictPanelProps) {
  if (conflicts.length === 0) {
    return null
  }

  return (
    <section className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-red-900">
          目标列冲突（阻断）：{formatInteger(conflicts.length)} 组
        </h2>
        <span className="text-xs text-red-800">处置完成前不能提交映射。</span>
      </div>

      {conflicts.map((conflict) => {
        const resolution = resolutions[conflict.groupId]
        return (
          <div className="rounded-md border border-red-200 bg-white p-3" key={conflict.groupId}>
            <p className="text-xs text-red-900">{conflict.reason}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {conflict.columnIndexes.map((columnIndex, index) => {
                const selected = resolution?.kind === 'keep' && resolution.columnIndex === columnIndex
                return (
                  <button
                    className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                      selected
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                    key={columnIndex}
                    onClick={() => {
                      onResolve(conflict.groupId, { kind: 'keep', columnIndex })
                    }}
                    type="button"
                  >
                    {selected ? '已保留：' : '保留：'}
                    {conflict.sourceHeaders[index]}（第 {formatInteger(columnIndex + 1)} 列）
                  </button>
                )
              })}
              <button
                className={`rounded-md border px-3 py-1.5 text-xs transition-colors ${
                  resolution?.kind === 'merge'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
                onClick={() => {
                  onResolve(conflict.groupId, { kind: 'merge', strategy: 'first-non-empty' })
                }}
                type="button"
              >
                {resolution?.kind === 'merge' ? '已选择合并：' : '合并：'}
                按列顺序取第一个非空值
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              合并只登记取值规则（第{' '}
              {conflict.columnIndexes.map((columnIndex) => formatInteger(columnIndex + 1)).join(' → ')}{' '}
              列依次取第一个非空值），不拼接、不换算；未填写的值仍然记为缺失，不会用 0 补齐。
            </p>
          </div>
        )
      })}
    </section>
  )
}
