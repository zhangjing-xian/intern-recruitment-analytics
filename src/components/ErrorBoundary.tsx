import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type ErrorBoundaryProps = {
  children: ReactNode
}

type ErrorBoundaryState = {
  error: Error | null
}

/**
 * 全局错误边界。
 * 纯本地应用：错误信息只显示在本机页面并打印到本机控制台，
 * 绝不发送到任何第三方（无埋点 / 无错误上报）。
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[本地错误] 页面渲染失败：', error, errorInfo.componentStack)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  handleBackToImport = (): void => {
    window.location.hash = '#/import'
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state

    if (error === null) {
      return this.props.children
    }

    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <div className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h1 className="text-lg font-semibold text-red-900">页面出现异常，已停止渲染</h1>
          <p className="mt-2 text-sm leading-6 text-red-800">
            你的数据没有发送到任何地方。可以先返回导入页，或刷新页面重试。
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded-md bg-white p-3 font-mono text-xs text-red-900">
            {error.message}
          </pre>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              onClick={this.handleBackToImport}
              type="button"
            >
              返回导入页
            </button>
            <button
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
              onClick={this.handleReload}
              type="button"
            >
              刷新页面
            </button>
          </div>
        </div>
      </div>
    )
  }
}
