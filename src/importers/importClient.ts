/**
 * 解析客户端：浏览器里走**同源 Worker**，没有 Worker 的环境回退到进程内实现
 * （见 `./inProcessClient`，解析依赖用动态 import 加载，不进首屏包）。
 *
 * 任务治理（docs/PRD.md 10.4）：
 * - 每个请求都有任务 ID，响应按 ID 派发；
 * - 取消或启动新任务后到达的响应一律丢弃（过时结果丢弃），界面不会把上次结果当成这次结果；
 * - 取消只是「这一次解析不生效」，不改动任何已有数据。
 */

import type { RawSheet } from '../domain'
import { createInProcessImportClient } from './inProcessClient'
import {
  ImportTaskCancelled,
  ImportTaskError,
  createImportTaskId,
  type ImportInspection,
  type ImportProgress,
  type ImportRequest,
  type ImportResponse,
  type ImportSourcePayload,
  type ImportTaskId,
  type ParsePayload,
} from './protocol'

export type ImportProgressListener = (progress: ImportProgress) => void

export type ImportClient = {
  /** 是否真的跑在 Worker 里（false = 进程内回退） */
  readonly runsInWorker: boolean
  inspect(payload: ImportSourcePayload, onProgress?: ImportProgressListener): Promise<ImportInspection>
  parse(payload: ParsePayload, onProgress?: ImportProgressListener): Promise<RawSheet>
  cancel(taskId: ImportTaskId): void
  dispose(): void
  /** 最近一次任务的 ID（便于界面展示与排查） */
  readonly lastTaskId: () => ImportTaskId | null
}

type PendingTask =
  | {
      readonly kind: 'inspect'
      readonly onProgress?: ImportProgressListener
      readonly resolve: (result: ImportInspection) => void
      readonly reject: (error: unknown) => void
    }
  | {
      readonly kind: 'parse'
      readonly onProgress?: ImportProgressListener
      readonly resolve: (result: RawSheet) => void
      readonly reject: (error: unknown) => void
    }

const WORKER_FAILED_MESSAGE = '解析 Worker 发生错误，请刷新页面后重试（数据未被改动）'

export function createImportClient(): ImportClient {
  if (typeof Worker === 'undefined') {
    return createInProcessImportClient()
  }
  return createWorkerImportClient()
}

function createWorkerImportClient(): ImportClient {
  let worker: Worker | null = null
  const pending = new Map<ImportTaskId, PendingTask>()
  let lastTaskId: ImportTaskId | null = null

  const failAll = (): void => {
    for (const task of pending.values()) {
      task.reject(new ImportTaskError('UNKNOWN', WORKER_FAILED_MESSAGE))
    }
    pending.clear()
  }

  const handleResponse = (message: ImportResponse): void => {
    const task = pending.get(message.taskId)
    if (task === undefined) {
      // 过时结果（已取消或已有新任务）：直接丢弃
      return
    }
    if (message.type === 'progress') {
      task.onProgress?.(message)
      return
    }
    pending.delete(message.taskId)

    if (message.type === 'cancelled') {
      task.reject(new ImportTaskCancelled(message.taskId))
      return
    }
    if (message.type === 'failed') {
      task.reject(new ImportTaskError(message.code, message.message, message.detail))
      return
    }
    if (message.type === 'inspect-done' && task.kind === 'inspect') {
      task.resolve(message.result)
      return
    }
    if (message.type === 'parse-done' && task.kind === 'parse') {
      task.resolve(message.result)
      return
    }
    task.reject(new ImportTaskError('UNKNOWN', '解析任务返回了与请求不匹配的结果，已丢弃'))
  }

  const ensureWorker = (): Worker => {
    if (worker === null) {
      // 同源 Worker（Vite 打包为独立 chunk），不使用任何远程脚本
      const created = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), {
        type: 'module',
        name: 'parse-worker',
      })
      created.onmessage = (event: MessageEvent<ImportResponse>) => {
        handleResponse(event.data)
      }
      created.onmessageerror = () => {
        failAll()
      }
      worker = created
    }
    return worker
  }

  const start = (request: ImportRequest, task: PendingTask): void => {
    lastTaskId = request.taskId
    pending.set(request.taskId, task)
    ensureWorker().postMessage(request)
  }

  return {
    runsInWorker: true,
    inspect: (payload, onProgress) =>
      new Promise<ImportInspection>((resolve, reject) => {
        const taskId = createImportTaskId('inspect')
        start({ type: 'inspect', taskId, payload }, { kind: 'inspect', onProgress, resolve, reject })
      }),
    parse: (payload, onProgress) =>
      new Promise<RawSheet>((resolve, reject) => {
        const taskId = createImportTaskId('parse')
        start({ type: 'parse', taskId, payload }, { kind: 'parse', onProgress, resolve, reject })
      }),
    cancel: (taskId) => {
      const task = pending.get(taskId)
      if (task === undefined) {
        return
      }
      // 先移除再通知：取消之后到达的任何响应都会被丢弃
      pending.delete(taskId)
      worker?.postMessage({ type: 'cancel', taskId })
      task.reject(new ImportTaskCancelled(taskId))
    },
    dispose: () => {
      failAll()
      worker?.terminate()
      worker = null
    },
    lastTaskId: () => lastTaskId,
  }
}
