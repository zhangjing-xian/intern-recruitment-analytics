import PageShell from '../components/PageShell'
import DashboardWorkspace from '../features/dashboard/DashboardWorkspace'

/**
 * 分析看板页（步骤8 起接入统一指标引擎）。
 * 页面壳继续负责标题与职责说明（文案来自 `src/lib/navigation.ts` 的唯一来源），
 * 业务逻辑全部在 `features/dashboard/` 内，页面本身不持有任何状态。
 */
export default function DashboardPage() {
  return (
    <PageShell path="/dashboard">
      <DashboardWorkspace />
    </PageShell>
  )
}
