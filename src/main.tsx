import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

import App from './App'
import ErrorBoundary from './components/ErrorBoundary'
import './index.css'

const container = document.getElementById('root')

if (container === null) {
  throw new Error('未找到 #root 挂载节点，请检查 index.html')
}

// 使用 HashRouter：静态托管下刷新子路由不会 404（见 docs/PRD.md 第 13 章）
createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
)
