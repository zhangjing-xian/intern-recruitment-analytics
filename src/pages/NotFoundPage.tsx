import { Link } from 'react-router-dom'

import { DEFAULT_ROUTE } from '../lib/navigation'

/** 未匹配路线的兜底页（不是业务页面，只用于提示地址写错） */
export default function NotFoundPage() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-slate-900">页面不存在</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
        当前地址没有对应的页面。本项目使用 HashRouter，地址形如
        <code className="mx-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">
          index.html#/import
        </code>
        ，刷新页面或直接分享地址都不会 404。
      </p>
      <Link
        className="mt-5 inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
        to={DEFAULT_ROUTE}
      >
        返回导入页
      </Link>
    </section>
  )
}
