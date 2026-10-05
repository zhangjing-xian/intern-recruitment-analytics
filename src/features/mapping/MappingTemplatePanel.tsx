import { formatInteger } from '../../lib/format'
import type { MappingTemplate } from '../../domain'

type MappingTemplatePanelProps = {
  readonly templates: readonly MappingTemplate[]
  readonly name: string
  readonly onNameChange: (name: string) => void
  readonly onSave: () => void
  readonly onApply: (template: MappingTemplate) => void
  readonly onRemove: (key: string) => void
  readonly resolveKey: (template: MappingTemplate) => string
}

/**
 * 映射模板（docs/PRD.md 4.3）：保存「源表头签名 + 字段映射 + 版本」，**不保存任何样例候选人数据**。
 *
 * 当前为临时内存模式：模板只在本机会话内有效，刷新即清除；加密持久化与文件备份在步骤6 / 步骤12 接入
 * （`domain/mapping.ts` 已提供 `serializeMappingTemplate` / `parseMappingTemplate` 结构与版本接口）。
 */
export default function MappingTemplatePanel({
  templates,
  name,
  onNameChange,
  onSave,
  onApply,
  onRemove,
  resolveKey,
}: MappingTemplatePanelProps) {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">映射模板</h2>
        <span className="text-xs text-slate-500">
          模板只含表头与目标字段，不含任何候选人示例值；当前仅在内存中保存。
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs font-medium text-slate-700">
          模板名称
          <input
            className="mt-1 w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-800"
            onChange={(event) => {
              onNameChange(event.target.value)
            }}
            placeholder="例如：8 月名单（新模板）"
            value={name}
          />
        </label>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          onClick={onSave}
          type="button"
        >
          保存当前映射为模板
        </button>
      </div>

      {templates.length === 0 ? (
        <p className="text-xs text-slate-500">本会话还没有保存过模板。</p>
      ) : (
        <ul className="space-y-2">
          {templates.map((template) => (
            <li
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700"
              key={resolveKey(template)}
            >
              <span>
                <span className="font-medium text-slate-800">{template.name}</span> ·{' '}
                {formatInteger(template.headerCount)} 列 · 模板版本 {template.templateVersion} ·
                {template.merges.length === 0 ? ' 无合并规则' : ` ${formatInteger(template.merges.length)} 条合并规则`}
              </span>
              <span className="flex gap-2">
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 transition-colors hover:bg-white"
                  onClick={() => {
                    onApply(template)
                  }}
                  type="button"
                >
                  应用
                </button>
                <button
                  className="rounded-md border border-slate-300 px-2 py-1 transition-colors hover:bg-white"
                  onClick={() => {
                    onRemove(resolveKey(template))
                  }}
                  type="button"
                >
                  删除
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-slate-500">
        应用模板会按表头名（去 BOM / 空格 / 全半角差异）匹配当前表：命中的列记为「模板命中」，
        模板里有、当前表没有的表头会在应用后提示；当前表多出来的列保持四级自动建议。
      </p>
    </section>
  )
}
