import EmptyState from '../components/EmptyState'
import PageShell from '../components/PageShell'

/**
 * AI 结果页（AI-5）。
 *
 * ## 这一页为什么是空态
 *
 * 结果**不在本页产生**：它只出现在看板「AI 深度分析」工作区里——那里才有当前筛选快照、
 * 预览 hash 与一次性的确认令牌，而结果是这三者绑定出来的东西。本页是路由表里的稳定落点
 * （用户可能直接打开 `/ai/result` 或从历史跳转），因此如实说明「去哪里看结果」，
 * 而不是造一个「最近一次结果」的会话副本——那份副本会与工作区里的真身出现两份真相，
 * 而 AI12 的验收对象恰恰是**渲染方式**（只允许一套实现）。
 *
 * 已保存过的结果在 `/ai/history` 里可以随时打开，那里复用同一个结果面板。
 */
export default function AiResultPage() {
  return (
    <PageShell path="/ai/result">
      <EmptyState
        description="本页不保存也不产生结果：一次 AI 分析的结果与「当时那一份预览」绑定，因此它只出现在看板的 AI 深度分析工作区里。这里是稳定落点，方便直接打开或从历史跳转。"
        items={[
          '要看新结果：到看板的「AI 深度分析」生成预览 → 逐次确认 → 结果会在同一个面板里展示',
          '要看已保存的结果：到「AI 历史」里展开任意一条，展示方式与实时结果完全一致',
          '结果正文按白名单 Markdown 渲染成 React 元素：不执行脚本、不加载远程图片、不生成可点链接',
          'AI 的文字不覆盖本地统计；导出前会在本地再跑一次敏感检查，命中即阻断',
        ]}
        nextStep={{ label: '返回看板做一次分析', to: '/dashboard' }}
        title="结果只在分析工作区里产生"
      />
    </PageShell>
  )
}
