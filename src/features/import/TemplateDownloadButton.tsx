import { TEMPLATE_FILE_NAME, buildTemplateText } from '../../domain'

/**
 * 下载标准模板：纯文本（制表符分隔 + CRLF），用本地 Blob 生成下载链接，
 * **不发起任何网络请求**，也不把模板内容上传到任何地方。
 */
export default function TemplateDownloadButton() {
  const handleDownload = (): void => {
    const blob = new Blob([buildTemplateText(true)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = TEMPLATE_FILE_NAME
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-900">标准模板</h3>
      <p className="mt-1 text-xs leading-5 text-slate-600">
        21 列标准表头 + 一行占位示例（示例全是「候选人样例」这类文字，不含任何真实数据）。
      </p>
      <button
        className="mt-3 inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        onClick={handleDownload}
        type="button"
      >
        下载标准模板
      </button>
      <p className="mt-2 font-mono text-xs text-slate-500">{TEMPLATE_FILE_NAME}</p>
    </div>
  )
}
