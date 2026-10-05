import { useEffect, useRef, useState } from 'react'

import type { RawSheet } from '../../domain'
import {
  DEFAULT_ENCODING,
  createImportClient,
  isImportTaskCancelled,
  isImportTaskError,
  type ImportClient,
  type ImportInspection,
  type ImportPhase,
  type ImportSourcePayload,
  type ImportTaskId,
  type ParsePayload,
} from '../../importers'
import { setImportSheet } from '../../storage/sessionStore'
import InspectPanel, { type ParseOptions } from './InspectPanel'
import ProgressPanel from './ProgressPanel'
import ResultPanel from './ResultPanel'
import SourcePanel from './SourcePanel'

/**
 * 解析客户端是**整页共享的单例**：
 * React StrictMode 下组件会挂载两次，如果每次挂载都新建 Worker 会白建一个线程；
 * 单例同时保证「上一次解析的过时结果」不会被误当成新结果（见下面的 runId 机制）。
 */
let sharedClient: ImportClient | null = null
function getImportClient(): ImportClient {
  sharedClient ??= createImportClient()
  return sharedClient
}

type SourceChoice = { readonly kind: 'file'; readonly file: File } | { readonly kind: 'paste'; readonly text: string }

type RunningTask = {
  readonly kind: 'inspect' | 'parse'
  readonly taskId: ImportTaskId
  readonly phase: ImportPhase
  readonly ratio: number
}

const INITIAL_OPTIONS: ParseOptions = {
  sheetName: null,
  headerRowNumber: 1,
  encoding: DEFAULT_ENCODING,
  delimiter: 'auto',
  excludeHiddenRows: false,
}

/** 检查完成后的默认选项：编码 / 分隔符用检测结果，工作表用第一张非空表（docs/PRD.md 5.1 默认第一行） */
function optionsFromInspection(inspection: ImportInspection): ParseOptions {
  if (inspection.kind === 'delimited') {
    return { ...INITIAL_OPTIONS, encoding: inspection.encoding, delimiter: inspection.delimiter }
  }
  const firstUsable = inspection.sheets.find((sheet) => !sheet.empty) ?? inspection.sheets[0] ?? null
  return { ...INITIAL_OPTIONS, sheetName: firstUsable?.name ?? null }
}

function toPayload(source: SourceChoice): ImportSourcePayload {
  return source.kind === 'file' ? { kind: 'file', file: source.file } : { kind: 'paste', text: source.text }
}

/**
 * 导入页主体：选择来源 → 检查（工作表 / 编码 / 分隔符预览）→ 解析（Worker、进度、取消）→ 结果概览。
 *
 * 隐私与边界（docs/PRD.md 5.1、10.4）：
 * - 全部在浏览器内完成，不发起任何网络请求；
 * - 解析结果只放在内存里，刷新即清除；
 * - 界面只显示计数、问题与少量行预览，绝不把整份数据写进 console 或日志。
 */
export default function ImportWorkspace() {
  const [source, setSource] = useState<SourceChoice | null>(null)
  const [inspection, setInspection] = useState<ImportInspection | null>(null)
  const [options, setOptions] = useState<ParseOptions>(INITIAL_OPTIONS)
  const [running, setRunning] = useState<RunningTask | null>(null)
  const [result, setResult] = useState<RawSheet | null>(null)
  const [error, setError] = useState<{ readonly message: string; readonly detail: string | null } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** 每次「检查 / 解析」递增；回调只在编号未变时写状态，避免过时结果覆盖新结果 */
  const runIdRef = useRef(0)

  const client = getImportClient()
  const busy = running !== null

  useEffect(() => {
    return () => {
      // 离开页面后到达的结果一律丢弃（不 terminate：Worker 由单例复用）
      runIdRef.current += 1
    }
  }, [])

  const handleFailure = (caught: unknown): void => {
    if (isImportTaskCancelled(caught)) {
      setNotice('已取消本次解析；已有数据没有改变。')
      return
    }
    if (isImportTaskError(caught)) {
      setError({ message: caught.message, detail: caught.detail })
      return
    }
    setError({ message: '解析失败：出现了未预期的错误，请重试或改用 CSV 后导入。', detail: null })
  }

  const startInspect = (nextSource: SourceChoice): void => {
    const runId = (runIdRef.current += 1)
    const payload = toPayload(nextSource)

    setSource(nextSource)
    setInspection(null)
    setResult(null)
    setError(null)
    setNotice(null)

    const pending = client.inspect(payload, (progress) => {
      if (runIdRef.current === runId) {
        setRunning({ kind: 'inspect', taskId: progress.taskId, phase: progress.phase, ratio: progress.ratio })
      }
    })
    // 任务 ID 在调用返回前就已分配，先记下来，保证「取消」按钮在第一个进度消息到达前也可用
    setRunning({ kind: 'inspect', taskId: client.lastTaskId() ?? '', phase: '读取文件', ratio: 0 })

    void pending
      .then((next) => {
        if (runIdRef.current !== runId) {
          return
        }
        setInspection(next)
        setOptions(optionsFromInspection(next))
        setRunning(null)
      })
      .catch((caught: unknown) => {
        if (runIdRef.current !== runId) {
          return
        }
        setRunning(null)
        handleFailure(caught)
      })
  }

  const handleParse = (): void => {
    if (source === null) {
      return
    }
    const runId = (runIdRef.current += 1)
    const payload: ParsePayload =
      inspection?.kind === 'xlsx'
        ? {
            source: toPayload(source),
            sheetName: options.sheetName ?? undefined,
            headerRowNumber: options.headerRowNumber,
            excludeHiddenRows: options.excludeHiddenRows,
          }
        : {
            source: toPayload(source),
            headerRowNumber: options.headerRowNumber,
            encoding: options.encoding,
            delimiter: options.delimiter,
          }

    setError(null)
    setNotice(null)

    const pending = client.parse(payload, (progress) => {
      if (runIdRef.current === runId) {
        setRunning({ kind: 'parse', taskId: progress.taskId, phase: progress.phase, ratio: progress.ratio })
      }
    })
    setRunning({ kind: 'parse', taskId: client.lastTaskId() ?? '', phase: '读取文件', ratio: 0 })

    void pending
      .then((sheet) => {
        if (runIdRef.current !== runId) {
          return
        }
        setResult(sheet)
        setRunning(null)
        // 交给字段映射页（内存会话，不落盘）：换一份新表会清掉旧草稿与旧确认
        setImportSheet(sheet)
      })
      .catch((caught: unknown) => {
        if (runIdRef.current !== runId) {
          return
        }
        setRunning(null)
        handleFailure(caught)
      })
  }

  const handleCancel = (): void => {
    if (running === null) {
      return
    }
    client.cancel(running.taskId)
    runIdRef.current += 1
    setRunning(null)
    setNotice('已取消本次解析；已有数据没有改变。')
  }

  const handleRestart = (): void => {
    runIdRef.current += 1
    setSource(null)
    setInspection(null)
    setResult(null)
    setError(null)
    setNotice(null)
    setOptions(INITIAL_OPTIONS)
    // 「重新选择来源」= 放弃当前解析结果：字段映射草稿与已确认映射一并清除（映射模板保留）
    setImportSheet(null)
  }

  return (
    <div className="space-y-5">
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-xs leading-5 text-slate-600">
        解析全部在你的浏览器里完成：上传只是读取本地文件，不创建任何网络请求，也不写入任何服务器；
        当前为临时内存模式，刷新或关闭页面即清除。读取阶段只取值：不计算公式、不执行宏、不更新外部链接、
        不激活单元格链接；缺失单元格一律记为「缺失」，绝不会用 0 冒充。
      </p>

      <SourcePanel
        busy={busy}
        onFile={(file) => {
          startInspect({ kind: 'file', file })
        }}
        onPaste={(text) => {
          startInspect({ kind: 'paste', text })
        }}
      />

      {error !== null && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-900">{error.message}</p>
          {error.detail !== null && <p className="mt-1 text-xs text-red-800">{error.detail}</p>}
          <p className="mt-2 text-xs text-red-800">
            没有读取到任何行内容，已有数据未改变。修正后可以重新选择来源。
          </p>
        </div>
      )}

      {notice !== null && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">{notice}</p>
      )}

      {running !== null && (
        <ProgressPanel
          onCancel={handleCancel}
          phase={running.phase}
          ratio={running.ratio}
          runsInWorker={client.runsInWorker}
        />
      )}

      {inspection !== null && !busy && (
        <InspectPanel
          busy={busy}
          inspection={inspection}
          onChange={(patch) => {
            setOptions((current) => ({ ...current, ...patch }))
          }}
          onParse={handleParse}
          options={options}
        />
      )}

      {result !== null && <ResultPanel onRestart={handleRestart} sheet={result} />}
    </div>
  )
}
