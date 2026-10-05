import { describe, expect, it } from 'vitest'

import type { ImportRequest, ImportResponse } from './protocol'
import { buildFixtureWorkbookBytes, makeFile, makeTextFile } from './testFixtures'
import { createImportWorkerBridge } from './workerBridge'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function createScope(): { messages: ImportResponse[]; bridge: ReturnType<typeof createImportWorkerBridge> } {
  const messages: ImportResponse[] = []
  const bridge = createImportWorkerBridge({ postMessage: (message) => messages.push(message) })
  return { messages, bridge }
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('等待 Worker 消息超时')
    }
    await new Promise((resolve) => setTimeout(resolve, 1))
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function parseRequest(taskId: string, file: ReturnType<typeof makeTextFile>): ImportRequest {
  return { type: 'parse', taskId, payload: { source: { kind: 'file', file } } }
}

describe('Worker 消息桥', () => {
  it('检查请求：先上报进度，再回 inspect-done，跑完后没有活动任务', async () => {
    const { messages, bridge } = createScope()
    bridge.handleMessage({
      type: 'inspect',
      taskId: 't-1',
      payload: { kind: 'file', file: makeTextFile('a,b\n1,2\n', '样例.csv', 'text/csv') },
    })

    await waitFor(() => messages.some((message) => message.type === 'inspect-done'))
    expect(messages.some((message) => message.type === 'progress')).toBe(true)
    expect(bridge.activeTaskId()).toBeNull()
  })

  it('解析请求：回 parse-done，且结果行数与来源匹配', async () => {
    const { messages, bridge } = createScope()
    bridge.handleMessage(parseRequest('t-2', makeTextFile('a,b\n1,2\n', '样例.csv', 'text/csv')))

    await waitFor(() => messages.some((message) => message.type === 'parse-done'))
    const done = messages.find((message) => message.type === 'parse-done')
    expect(done?.type === 'parse-done' && done.result.rows).toHaveLength(1)
  })

  it('取消后只回 cancelled，绝不再回结果', async () => {
    const { messages, bridge } = createScope()
    bridge.handleMessage({
      type: 'parse',
      taskId: 't-3',
      payload: {
        source: { kind: 'file', file: makeFile(buildFixtureWorkbookBytes(), '名单.xlsx', XLSX_MIME) },
      },
    })
    bridge.handleMessage({ type: 'cancel', taskId: 't-3' })

    await waitFor(() => messages.some((message) => message.type === 'cancelled'))
    await sleep(20)
    expect(messages.some((message) => message.type === 'parse-done')).toBe(false)
  })

  it('新任务到达时旧任务被取消，只有新任务的结果回传', async () => {
    const { messages, bridge } = createScope()
    const file = makeFile(buildFixtureWorkbookBytes(), '名单.xlsx', XLSX_MIME)
    bridge.handleMessage({ type: 'parse', taskId: '旧任务', payload: { source: { kind: 'file', file } } })
    bridge.handleMessage({ type: 'parse', taskId: '新任务', payload: { source: { kind: 'file', file } } })

    await waitFor(() => messages.some((message) => message.type === 'parse-done'))
    expect(messages.some((message) => message.type === 'cancelled' && message.taskId === '旧任务')).toBe(true)
    const done = messages.filter((message) => message.type === 'parse-done')
    expect(done).toHaveLength(1)
    expect(done[0]?.taskId).toBe('新任务')
  })

  it('未知请求类型回可读失败；没有任务 ID 的消息被忽略', async () => {
    const { messages, bridge } = createScope()
    bridge.handleMessage({ type: 'bogus', taskId: 't-4' } as unknown as ImportRequest)
    expect(messages[0]).toMatchObject({ type: 'failed', code: 'PARSE_FAILED', taskId: 't-4' })

    const before = messages.length
    bridge.handleMessage({ payload: {} } as unknown as ImportRequest)
    expect(messages).toHaveLength(before)
  })

  it('失败只带问题码与说明：任何回传消息都不含单元格原文', async () => {
    const { messages, bridge } = createScope()
    const sensitive = '候选人真实姓名样本'
    bridge.handleMessage(
      parseRequest('t-5', makeTextFile(`需求ID,姓名\nREQ-001,${sensitive}\n`, '名单.pdf', 'application/pdf')),
    )
    await waitFor(() => messages.some((message) => message.type === 'failed'))
    const failed = messages.find((message) => message.type === 'failed')
    expect(failed?.type === 'failed' && failed.code).toBe('UNSUPPORTED_FILE_TYPE')
    expect(JSON.stringify(messages)).not.toContain(sensitive)
  })

  it('引号异常只体现为行级提示，桥消息里不含该行内容', async () => {
    const { messages, bridge } = createScope()
    bridge.handleMessage({ type: 'parse', taskId: 't-6', payload: { source: { kind: 'paste', text: 'a,b\n"机密内容,是否\n' } } })

    await waitFor(() => messages.some((message) => message.type === 'parse-done'))
    const done = messages.find((message) => message.type === 'parse-done')
    expect(done?.type === 'parse-done' && done.result.rows[0]?.parseNotes).toContain('QUOTE_MISMATCH')
    expect(JSON.stringify(messages.filter((message) => message.type !== 'parse-done'))).not.toContain('机密内容')
  })
})
