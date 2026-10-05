/**
 * 进程内回退客户端：没有 Web Worker 的环境（Node 单测、极旧浏览器）在当前线程解析。
 *
 * 解析依赖（SheetJS / PapaParse，约 400 kB）用**动态 import** 加载：
 * 常规浏览器走 Worker，这条回退路径不会把解析库带进首屏包。
 */

import {
  createImportTaskId,
  type ImportInspection,
  type ImportSourcePayload,
  type ImportTaskContext,
  type ImportTaskId,
  type ParsePayload,
} from './protocol'
import type { ImportClient, ImportProgressListener } from './importClient'

export function createInProcessImportClient(): ImportClient {
  const cancelledTasks = new Set<ImportTaskId>()
  let currentTaskId: ImportTaskId | null = null

  const isCancelled = (taskId: ImportTaskId): boolean =>
    cancelledTasks.has(taskId) || currentTaskId !== taskId

  const contextOf = (taskId: ImportTaskId, onProgress?: ImportProgressListener): ImportTaskContext => ({
    taskId,
    report: (phase, ratio) => {
      if (!isCancelled(taskId)) {
        onProgress?.({ type: 'progress', taskId, phase, ratio })
      }
    },
    isCancelled: () => isCancelled(taskId),
  })

  return {
    runsInWorker: false,
    inspect: async (payload: ImportSourcePayload, onProgress?: ImportProgressListener): Promise<ImportInspection> => {
      const taskId = createImportTaskId('inspect')
      currentTaskId = taskId
      const context = contextOf(taskId, onProgress)
      const { inspectSource } = await import('./pipeline')
      return inspectSource(payload, context)
    },
    parse: async (payload: ParsePayload, onProgress?: ImportProgressListener) => {
      const taskId = createImportTaskId('parse')
      currentTaskId = taskId
      const context = contextOf(taskId, onProgress)
      const { parseRawSheet } = await import('./pipeline')
      return parseRawSheet(payload, context)
    },
    cancel: (taskId) => {
      cancelledTasks.add(taskId)
    },
    dispose: () => {
      // 让在途任务作废：任何后续检查都会看到「已取消」
      currentTaskId = null
      cancelledTasks.clear()
    },
    lastTaskId: () => currentTaskId,
  }
}
