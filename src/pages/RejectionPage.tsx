import PageShell from '../components/PageShell'
import RejectionWorkspace from '../features/rejection/RejectionWorkspace'

/**
 * 拒 offer 专项页（步骤10）。
 *
 * 页面只负责套外壳：所有状态分支（未导入 / 未确认映射 / 未提交清洗结果 / 仓已锁定 / 已提交但无记录）
 * 与全部展示逻辑都在 `features/rejection/RejectionWorkspace`，避免同一套空态在两个地方各写一遍。
 */
export default function RejectionPage() {
  return (
    <PageShell path="/rejection">
      <RejectionWorkspace />
    </PageShell>
  )
}
