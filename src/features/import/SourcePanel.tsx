import { useRef, useState } from 'react'

import {
  IMPORT_LIMITS,
  SYNTHETIC_DEMO_NOTICE,
  buildSyntheticDemoTsv,
  formatByteSize,
} from '../../importers'
import TemplateDownloadButton from './TemplateDownloadButton'

const ACCEPTED_EXTENSIONS = '.xlsx,.xls,.xlsm,.xlsb,.csv,.tsv,.txt'

type SourcePanelProps = {
  /** 正在检查 / 解析：临时禁用按钮，避免并发请求 */
  readonly busy: boolean
  readonly onFile: (file: File) => void
  readonly onPaste: (text: string) => void
}

/**
 * 数据来源区：文件（含拖拽）/ 粘贴 / 纯合成演示数据。
 * 上传只是**浏览器读取本地文件**，不创建任何网络请求（docs/PRD.md 5.1、10.4）。
 */
export default function SourcePanel({ busy, onFile, onPaste }: SourcePanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const pickFile = (file: File | undefined): void => {
    if (file !== undefined && !busy) {
      onFile(file)
    }
  }

  const pasteIsEmpty = pasteText.trim() === ''

  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div
          className={`rounded-lg border-2 border-dashed p-4 transition-colors ${
            dragging ? 'border-slate-900 bg-slate-50' : 'border-slate-300 bg-white'
          }`}
          onDragLeave={() => {
            setDragging(false)
          }}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            pickFile(event.dataTransfer.files[0])
          }}
        >
          <h3 className="text-sm font-semibold text-slate-900">选择文件或拖拽到此处</h3>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            支持 Excel（.xlsx / .xls / .xlsm / .xlsb）与 CSV / TSV（.csv / .tsv / .txt）。
            文件只在你的浏览器里读取，不会上传。
          </p>
          <input
            accept={ACCEPTED_EXTENSIONS}
            className="hidden"
            onChange={(event) => {
              pickFile(event.target.files?.[0])
              if (inputRef.current !== null) {
                inputRef.current.value = ''
              }
            }}
            ref={inputRef}
            type="file"
          />
          <button
            className="mt-3 inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy}
            onClick={() => {
              inputRef.current?.click()
            }}
            type="button"
          >
            选择本地文件
          </button>
          <p className="mt-2 text-xs text-slate-500">
            上限：{formatByteSize(IMPORT_LIMITS.maxFileBytes)} / {IMPORT_LIMITS.maxRows.toLocaleString('zh-CN')} 行 /
            {' '}
            {IMPORT_LIMITS.maxColumns} 列；超限会明确拒绝，不会静默截断。
          </p>
        </div>

        <TemplateDownloadButton />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">直接粘贴表格</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">
          从 Excel / WPS / Numbers 复制后粘贴到这里（制表符分隔，保留引号内的换行）。粘贴只通过这个输入框，
          不后台读取剪贴板。
        </p>
        <textarea
          className="mt-3 h-32 w-full resize-y rounded-md border border-slate-300 p-3 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-slate-500"
          onChange={(event) => {
            setPasteText(event.target.value)
          }}
          placeholder={'需求ID\t姓名\toffer状态\t薪资\nREQ-001\t候选人样例\t待入职\t4000'}
          value={pasteText}
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400"
            disabled={busy || pasteIsEmpty}
            onClick={() => {
              onPaste(pasteText)
            }}
            type="button"
          >
            解析粘贴内容
          </button>
          <button
            className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={busy}
            onClick={() => {
              setPasteText(buildSyntheticDemoTsv())
            }}
            type="button"
          >
            载入纯合成演示数据
          </button>
          <button
            className="inline-flex items-center rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={busy || pasteText === ''}
            onClick={() => {
              setPasteText('')
            }}
            type="button"
          >
            清空
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">{SYNTHETIC_DEMO_NOTICE}</p>
      </div>
    </section>
  )
}
