/**
 * Worker 侧的消息处理：把 `postMessage` 契约与解析流水线接起来。
 *
 * 策略：
 * - 同一时刻只跑一个任务；新任务到达时把旧任务标记为取消并立刻回 `cancelled`（最新请求优先，不排队）；
 * - 取消后到达的结果一律不回传（过时结果丢弃）；
 * - 失败只回问题码 + 可读说明 + 非敏感细节，绝不回整行数据。
 */

import { inspectSource, parseRawSheet } from './pipeline'
import {
  ImportTaskError,
  isImportTaskCancelled,
  type ImportRequest,
  type ImportResponse,
  type ImportTaskContext,
  type InspectRequest,
  type ParseRequest,
} from './protocol'

export type ImportWorkerScope = {
  readonly postMessage: (message: ImportResponse) => void
}

export type ImportWorkerBridge = {
  readonly handleMessage: (message: ImportRequest) => void
  /** 当前正在跑的任务 ID（无任务为 null） */
  readonly activeTaskId: () => string | null
}

type ActiveTask = {
  readonly taskId: string
  cancelled: boolean
}

export function createImportWorkerBridge(scope: ImportWorkerScope): ImportWorkerBridge {
  let active: ActiveTask | null = null

  /** 启动新任务：把仍在跑的旧任务标记为取消并立即回报（不等待它结束） */
  const startTask = (taskId: string): ActiveTask => {
    if (active !== null && !active.cancelled) {
      active.cancelled = true
      scope.postMessage({ type: 'cancelled', taskId: active.taskId })
    }
    const task: ActiveTask = { taskId, cancelled: false }
    active = task
    return task
  }

  const contextOf = (task: ActiveTask): ImportTaskContext => ({
    taskId: task.taskId,
    report: (phase, ratio) => {
      if (!task.cancelled) {
        scope.postMessage({ type: 'progress', taskId: task.taskId, phase, ratio })
      }
    },
    isCancelled: () => task.cancelled,
  })

  const run = async (task: ActiveTask, request: InspectRequest | ParseRequest): Promise<void> => {
    try {
      if (request.type === 'inspect') {
        const result = await inspectSource(request.payload, contextOf(task))
        if (!task.cancelled) {
          scope.postMessage({ type: 'inspect-done', taskId: task.taskId, result })
        }
        return
      }
      const result = await parseRawSheet(request.payload, contextOf(task))
      if (!task.cancelled) {
        scope.postMessage({ type: 'parse-done', taskId: task.taskId, result })
      }
    } catch (error) {
      if (task.cancelled) {
        return
      }
      if (isImportTaskCancelled(error)) {
        scope.postMessage({ type: 'cancelled', taskId: task.taskId })
        return
      }
      if (error instanceof ImportTaskError) {
        scope.postMessage({
          type: 'failed',
          taskId: task.taskId,
          code: error.code,
          message: error.message,
          detail: error.detail,
        })
        return
      }
      // 未知错误：只回通用说明 + 错误类型名，绝不把错误里的原始内容带出去
      scope.postMessage({
        type: 'failed',
        taskId: task.taskId,
        code: 'PARSE_FAILED',
        message: '解析过程中出现未预期的错误；请重试，或先在 Excel 中另存为 CSV 再导入',
        detail: error instanceof Error ? error.name : null,
      })
    } finally {
      if (active === task) {
        active = null
      }
    }
  }

  const handleMessage = (message: ImportRequest): void => {
    if (typeof message !== 'object' || message === null) {
      return
    }
    const taskId: unknown = message.taskId
    if (typeof taskId !== 'string' || taskId === '') {
      return
    }
    if (message.type === 'cancel') {
      if (active !== null && active.taskId === taskId) {
        active.cancelled = true
        scope.postMessage({ type: 'cancelled', taskId })
      }
      return
    }
    if (message.type !== 'inspect' && message.type !== 'parse') {
      scope.postMessage({
        type: 'failed',
        taskId,
        code: 'PARSE_FAILED',
        message: '未知的解析请求类型，已忽略',
        detail: null,
      })
      return
    }
    const task = startTask(taskId)
    void run(task, message)
  }

  return {
    handleMessage,
    activeTaskId: () => active?.taskId ?? null,
  }
}
