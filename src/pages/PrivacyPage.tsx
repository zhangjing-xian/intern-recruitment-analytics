import PageShell from '../components/PageShell'
import PrivacyWorkspace from '../features/privacy/PrivacyWorkspace'

/**
 * 隐私页（步骤12）。
 *
 * 页面壳提供标题与职责说明（唯一来源是 `lib/navigation.ts` 的 `NAV_ITEMS`），
 * 内容全部由 `features/privacy/PrivacyWorkspace` 摆放，页面自身不写任何文案、不接触任何存储。
 */
export default function PrivacyPage() {
  return (
    <PageShell path="/privacy">
      <PrivacyWorkspace />
    </PageShell>
  )
}
