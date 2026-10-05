import EmptyState from '../components/EmptyState'
import PageShell from '../components/PageShell'
import AiHistoryPanel from '../features/ai/AiHistoryPanel'

/**
 * AI 调用历史页（AI-5，docs/PRD.md 16.5）。
 *
 * 页面只负责摆放：读写全部在 `features/ai/AiHistoryPanel`
 * → `src/ai/aiHistory.ts` → `storage/encryptedVault` 懒门面，
 * 页面自身不接触 IndexedDB，也不持有任何结果内容。
 *
 * 打开本页**不会**发起任何网络请求，也不会自动重发历史内容。
 */
export default function AiHistoryPage() {
  return (
    <PageShell path="/ai/history">
      <div className="space-y-4">
        <AiHistoryPanel />

        <EmptyState
          description="历史与实时结果用的是同一个展示组件：安全 Markdown 渲染、只报位置的敏感检查提示、净化后的复制与导出。这样「同样的内容在两处渲染成不一样的东西」就不会发生——而渲染方式本身就是 AI12 的验收对象。"
          items={[
            '历史只在显式保存后写入加密仓；临时模式没有仓，因此无法保存',
            '删除单条与清空全部是两个独立动作，都不影响招聘源数据与本地仓里的 API Key',
            '本地删除不能撤回已经发给 DeepSeek 的内容：删除只是删掉本机记录',
          ]}
          title="关于历史的两条说明"
        />
      </div>
    </PageShell>
  )
}
