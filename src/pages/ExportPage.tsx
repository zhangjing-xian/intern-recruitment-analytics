import PageShell from '../components/PageShell'
import ExportWorkspace from '../features/export/ExportWorkspace'

/**
 * 报告导出页（步骤11，docs/PRD.md 10.6 / 11 章）。
 *
 * 页面只负责套页面外壳与登记路由；所有装配（筛选、报告模型、隐私检查、四条导出路径）
 * 都在 `features/export/ExportWorkspace.tsx` 里完成——那是本步唯一的装配点。
 */
export default function ExportPage() {
  return (
    <PageShell path="/export">
      <ExportWorkspace />
    </PageShell>
  )
}
