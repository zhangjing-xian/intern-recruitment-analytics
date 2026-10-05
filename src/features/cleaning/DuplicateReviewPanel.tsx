import { DEDUP_RULES } from '../../cleaning'
import type { DedupStrategy, DuplicateGroup, NormalizedRecord } from '../../domain'
import { formatInteger } from '../../lib/format'

type DuplicateReviewPanelProps = {
  readonly exactGroups: readonly DuplicateGroup[]
  readonly suspectedGroups: readonly DuplicateGroup[]
  readonly duplicateRowCount: number
  readonly records: readonly NormalizedRecord[]
  readonly strategy: DedupStrategy
  readonly confirmed: boolean
  readonly onStrategyChange: (strategy: DedupStrategy) => void
  readonly onConfirmChange: (confirmed: boolean) => void
}

/**
 * 重复对照（docs/PRD.md 5.4）：完全重复与疑似重复**分别展示**，都只作提示，
 * 必须用户显式确认后才按策略减少样本。
 *
 * 分组里只显示分组标识与源文件行号，**不**复制姓名 / 薪酬等整行内容；
 * 想核对具体行时用下面的记录预览（那里有原值与清洗值对照）。
 */
export default function DuplicateReviewPanel({
  exactGroups,
  suspectedGroups,
  duplicateRowCount,
  records,
  strategy,
  confirmed,
  onStrategyChange,
  onConfirmChange,
}: DuplicateReviewPanelProps) {
  const pendingCount = records.filter(
    (record) => record.dedupDecision.action === 'pendingUserConfirmation',
  ).length
  const removedCount = records.filter(
    (record) => record.dedupDecision.action === 'removedAsDuplicate',
  ).length

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">重复记录对照</h2>
        <span className="text-xs text-slate-500">
          参与重复分组 {formatInteger(duplicateRowCount)} 行 · 待确认{' '}
          {formatInteger(pendingCount)} 行 · 已按策略移除 {formatInteger(removedCount)} 行
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-4 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
        <label className="flex items-center gap-2">
          <span className="font-medium text-slate-900">策略</span>
          <select
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            onChange={(event) => {
              onStrategyChange(event.target.value === '保留全部' ? '保留全部' : '确认后每组保留首条')
            }}
            value={strategy}
          >
            <option value="确认后每组保留首条">确认后每组保留首条</option>
            <option value="保留全部">保留全部</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            checked={confirmed}
            onChange={(event) => {
              onConfirmChange(event.target.checked)
            }}
            type="checkbox"
          />
          我已确认按上述策略处理重复行
        </label>
        <span className="text-slate-500">
          {confirmed
            ? '已确认：重复行按策略标记，样本数随之变化'
            : '未确认：重复行全部保留为待确认，样本数不变'}
        </span>
      </div>

      <DuplicateGroupList groups={exactGroups} kind="exact" title="完全重复（原始单元格完全一致）" />
      <DuplicateGroupList
        groups={suspectedGroups}
        kind="suspected"
        title="疑似重复（缺少稳定 offer 唯一 ID 时的提示）"
      />
    </section>
  )
}

type DuplicateGroupListProps = {
  readonly title: string
  readonly kind: 'exact' | 'suspected'
  readonly groups: readonly DuplicateGroup[]
}

function DuplicateGroupList({ title, kind, groups }: DuplicateGroupListProps) {
  return (
    <section className="space-y-1">
      <h3 className="text-xs font-semibold text-slate-900">
        {title} · {formatInteger(groups.length)} 组
      </h3>
      <p className="text-xs text-slate-500">{DEDUP_RULES[kind]}</p>
      {groups.length === 0 ? (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          没有该类重复；未识别为重复的行不会被合并或删除。
        </p>
      ) : (
        <ul className="space-y-1 text-xs text-slate-700">
          {groups.map((group) => (
            <li className="rounded-md bg-slate-50 px-3 py-1.5" key={group.groupKey}>
              <span className="font-medium text-slate-900">{group.groupKey}</span>
              <span className="ml-2 text-slate-600">
                源文件行号：{group.sourceRows.map((row) => formatInteger(row)).join('、')}
              </span>
              <span className="ml-2 text-slate-500">
                （{formatInteger(group.recordIds.length)} 行，建议保留行号最小的那条，其余待你确认）
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
