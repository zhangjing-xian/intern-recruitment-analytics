import { formatInteger } from '../../lib/format'
import type { VaultStatus } from '../../storage'
import { CLEAR_GLOBAL_LIMITS, buildClearLayers } from './clearScope'

type ClearScopePanelProps = {
  readonly status: Pick<VaultStatus, 'databaseName' | 'objectCount'>
}

/**
 * 清除数据的**范围说明**（步骤12，docs/PRD.md 10.5）。
 *
 * 为什么要把「范围」单独摆在这里，而不是继续写在三个按钮的正文里：
 * - PRD 10.5 要求清除必须以明确确认**列出影响**。影响是「删哪些层 / 留哪些层」的对照，
 *   按钮正文里一句话说不全，而且改一处就容易和事实说岔；
 * - 范围模型在 `clearScope.ts`（纯数据），这里只负责渲染，界面与测试引用同一份清单；
 * - 两条「做不到」（不删已下载文件、不碰同源其他应用）用**高亮块**单独放，避免被扫读漏掉——
 *   它们是用户最容易误解的两点。
 *
 * 本组件不新增任何清除动作，也不调用任何门面方法：三个动作各自带确认短语，见下方的实际按钮。
 */
export default function ClearScopePanel({ status }: ClearScopePanelProps) {
  const layers = buildClearLayers(status)

  return (
    <div className="space-y-3 rounded-md border border-rose-200 bg-white p-3">
      <div className="space-y-1">
        <h3 className="text-xs font-semibold text-slate-900">清除数据的范围（先看清再点下面的按钮）</h3>
        <p className="text-xs leading-6 text-slate-600">
          三个动作互不代替，各自要求逐字输入确认短语；每个动作删掉哪些层、留下哪些层如下。
          清除后无法撤销，也没有云端副本可以恢复。
        </p>
      </div>

      <ul className="space-y-2">
        {layers.map((layer) => (
          <li className="rounded-md bg-slate-50 p-2" key={layer.id}>
            <p className="text-xs font-medium text-slate-900">
              {layer.label}
              {layer.irreversible ? '（不可撤销）' : ''}
              <span className="ml-2 font-normal text-slate-500">
                确认短语：{layer.phrase}
              </span>
            </p>
            <div className="mt-1 space-y-1 text-xs leading-6">
              <div>
                <p className="font-medium text-rose-900">会删除：</p>
                <ul className="list-disc space-y-1 pl-5 text-slate-700">
                  {layer.removes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-emerald-800">会保留：</p>
                <ul className="list-disc space-y-1 pl-5 text-slate-700">
                  {layer.keeps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-slate-900">另外：</p>
                <ul className="list-disc space-y-1 pl-5 text-slate-700">
                  {layer.doesNotDelete.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="space-y-1 rounded-md border border-rose-300 bg-rose-50 p-2">
        <h4 className="text-xs font-semibold text-rose-900">清除做不到的两件事</h4>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-6 text-rose-900">
          {CLEAR_GLOBAL_LIMITS.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </div>

      <p className="text-xs leading-6 text-slate-500">
        当前仓标识为「{status.databaseName}」，其中业务对象 {formatInteger(status.objectCount)} 条。
        清除前的确认短语与用途一一对应：短语写错时按钮保持禁用，不会「点一下就删」。
      </p>
    </div>
  )
}
