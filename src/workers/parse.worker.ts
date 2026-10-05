/**
 * 解析 Worker（同源、随应用打包，docs/PRD.md 10.4）。
 *
 * - 消息全部带任务 ID，支持进度、取消与过时结果丢弃（见 `../importers/workerBridge`）；
 * - 不使用 `fetch` / `importScripts` / 任何远程脚本，加载的资源只有本应用自己的打包产物；
 * - 不把任何单元格内容写进 console 或日志；
 * - 这里只做「接线」：真正逻辑在 `src/importers`，因此 Node 单测能覆盖同一份代码。
 */

import type { ImportRequest, ImportResponse } from '../importers/protocol'
import { createImportWorkerBridge } from '../importers/workerBridge'

type DedicatedWorkerScope = {
  onmessage: ((event: MessageEvent<ImportRequest>) => void) | null
  postMessage: (message: ImportResponse) => void
}

const scope = self as unknown as DedicatedWorkerScope

const bridge = createImportWorkerBridge({
  postMessage: (message) => {
    scope.postMessage(message)
  },
})

scope.onmessage = (event: MessageEvent<ImportRequest>) => {
  bridge.handleMessage(event.data)
}
