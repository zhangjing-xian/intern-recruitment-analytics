import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import AppLayout from './components/AppLayout'
import { DEFAULT_ROUTE } from './lib/navigation'
import AiHistoryPage from './pages/AiHistoryPage'
import AiResultPage from './pages/AiResultPage'
import CleaningPage from './pages/CleaningPage'
import DashboardPage from './pages/DashboardPage'
import ExportPage from './pages/ExportPage'
import ImportPage from './pages/ImportPage'
import MappingPage from './pages/MappingPage'
import NotFoundPage from './pages/NotFoundPage'
import PrivacyPage from './pages/PrivacyPage'
import RejectionPage from './pages/RejectionPage'
import SettingsPage from './pages/SettingsPage'
import { mountVaultSession } from './storage'
import { mountAiKeySessionGuards } from './ai/keySession'
import { mountAiRequestGuards } from './ai/aiClient'

/**
 * 路由表（HashRouter）。
 * 10 个业务页面全部挂在 AppLayout 下，保证导航与页脚一致；
 * 未匹配路径交给 NotFoundPage，不使用通配重定向以免掩盖拼错的地址。
 *
 * 同时在这里挂载**三个应用级守卫**，各挂一次：
 * - 步骤6 的会话守卫：解锁即开始闲置计时、闲置到点自动锁定、锁定后清空内存中的业务数据；
 * - AI-3 的 Key 守卫：仓锁定 / 清空 / 会话过期时丢掉内存里的 AI Key
 *   （**不删**加密仓里的那一份——删 Key 是用户的独立操作）；
 * - AI-4 的请求守卫：同样的时机**中止在途请求并推进世代号**。只清内存 Key 是不够的：
 *   请求可能已经带着 Key 发出去了，但它的响应绝不能再写进一个已经锁定的界面
 *   （PRD 16.2：迟到响应不得重新写入）。
 * 各页面不得自己再建计时器或订阅，否则会出现两份真相。
 */
export default function App() {
  useEffect(() => {
    const unmountVaultSession = mountVaultSession()
    const unmountAiKeyGuards = mountAiKeySessionGuards()
    const unmountAiRequestGuards = mountAiRequestGuards()
    return () => {
      unmountAiRequestGuards()
      unmountAiKeyGuards()
      unmountVaultSession()
    }
  }, [])

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route element={<Navigate replace to={DEFAULT_ROUTE} />} index />
        <Route element={<ImportPage />} path="/import" />
        <Route element={<MappingPage />} path="/mapping" />
        <Route element={<CleaningPage />} path="/cleaning" />
        <Route element={<DashboardPage />} path="/dashboard" />
        <Route element={<RejectionPage />} path="/rejection" />
        <Route element={<ExportPage />} path="/export" />
        <Route element={<SettingsPage />} path="/settings" />
        <Route element={<PrivacyPage />} path="/privacy" />
        <Route element={<AiResultPage />} path="/ai/result" />
        <Route element={<AiHistoryPage />} path="/ai/history" />
        <Route element={<NotFoundPage />} path="*" />
      </Route>
    </Routes>
  )
}
