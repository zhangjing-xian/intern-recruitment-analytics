import { STORAGE_BOUNDARY_FACTS, VAULT_EVENT_NOTICE } from './storageBoundary'

/**
 * 存储边界与多标签页协作说明（步骤12，docs/PRD.md 10.5）。
 *
 * 为什么做成**静态面板**而不是再加一组读状态的控件：
 * - 能力本身已经在界面上有入口了：占用读数与「刷新占用 / 申请持久化存储」在
 *   `VaultManagerPanel` 的「存储占用」一节（经 `encryptedVault.estimate` / `requestPersistent`），
 *   跨标签页事件由 `VaultWorkspace` 订阅并展示锁定原因；再加一套控件就会出现两份读数；
 * - 这里补的是**协作边界**：哪一层是即时生效的、哪一层要等到下一次读写、失败时会发生什么。
 *   这些是解释性事实，读状态反而会把它们淹没在数字里。
 *
 * 本组件不读取任何状态、不调用任何存储 API，因此可以安全地被设置页静态渲染。
 */
export default function StorageBoundaryPanel() {
  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-slate-900">存储边界与多标签页协作</h2>
        <p className="text-xs leading-6 text-slate-600">
          存储占用与持久化申请的入口在上面的「存储占用」一节；这一节说明这些能力各自的边界，
          以及多个标签页同时打开时会发生什么。
        </p>
      </div>

      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-6 text-amber-900">
        {VAULT_EVENT_NOTICE}
      </p>

      <dl className="divide-y divide-slate-100">
        {STORAGE_BOUNDARY_FACTS.map((fact) => (
          <div className="space-y-1 py-2" key={fact.id}>
            <dt className="text-xs font-medium text-slate-900">{fact.title}</dt>
            <dd className="text-xs leading-6 text-slate-600">
              {fact.detail}
              <span className="mt-1 block text-slate-400">实现位置：{fact.source}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
