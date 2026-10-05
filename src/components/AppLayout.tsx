import { NavLink, Outlet } from 'react-router-dom'

import { NAV_ITEMS } from '../lib/navigation'
import UpdateNotice from '../pwa/UpdateNotice'

/**
 * 全站布局：顶部导航 + 内容区 + 更新提示 + 页脚隐私说明（无任何外部资源）。
 *
 * 两处文案纪律（AI-7 收尾时修正过）：
 * 1. 页脚**不得**再写「本网站没有任何出站路径」——AI-4 起唯一适配器已交付，
 *    这么说会让用户以为确认后也不会发请求（当时的真话，现在是假话）；
 * 2. 更新提示条挂在页脚上方：它只在真的有新版本等待时出现（见 `pwa/UpdateNotice.tsx`），
 *    并且**不自动刷新**。
 */
function AppLayoutFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-6xl space-y-1 px-4 py-4 text-xs leading-6 text-slate-500">
        <p>
          全部数据只在本机浏览器内处理：导入、清洗、统计、脱敏与导出都不经过服务器。
          默认模式（AI 关闭）下没有任何出站请求；唯一例外是可选 DeepSeek 分析，
          而它只在你查看完整脱敏预览并逐次确认之后，把这一次的聚合摘要发往预览里写明的端点。
        </p>
        <p>
          敏感数据只经加密仓写入（AES-GCM），明文不落盘；加密备份与脱敏报告是两个不同入口。
          边界与清除范围见「隐私说明」页。
        </p>
      </div>
    </footer>
  )
}

export default function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg font-semibold text-slate-900">实习生招聘数据复盘</span>
            <span className="text-xs text-slate-500">
              纯本地分析 · 数据默认不出浏览器 · 无后端 / 无 CDN / 无埋点
            </span>
          </div>

          <nav aria-label="主导航" className="flex flex-wrap gap-2">
            {NAV_ITEMS.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  [
                    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  ].join(' ')
                }
                key={item.path}
                to={item.path}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <UpdateNotice />
      <AppLayoutFooter />
    </div>
  )
}
