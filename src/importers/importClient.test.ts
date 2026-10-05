import { describe, expect, it } from 'vitest'

import { createImportClient } from './importClient'
import { createInProcessImportClient } from './inProcessClient'
import { isImportTaskCancelled, type ImportProgress } from './protocol'
import { buildFixtureCsv, buildFixtureTsv, makeTextFile } from './testFixtures'

describe('解析客户端', () => {
  it('Node（没有 Worker）时回退到进程内实现，并明确标记 runsInWorker=false', () => {
    const client = createImportClient()
    expect(client.runsInWorker).toBe(false)
    client.dispose()
  })

  it('检查与解析走同一条流水线，进度事件可以收到', async () => {
    const client = createImportClient()
    const progress: ImportProgress[] = []
    const inspection = await client.inspect({ kind: 'paste', text: buildFixtureTsv() }, (event) => {
      progress.push(event)
    })

    expect(inspection.kind).toBe('delimited')
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.every((event) => event.type === 'progress')).toBe(true)
    expect(progress.every((event) => event.ratio >= 0 && event.ratio <= 1)).toBe(true)
  })

  it('解析结果包含原始行与来源信息', async () => {
    const client = createInProcessImportClient()
    const sheet = await client.parse({ source: { kind: 'paste', text: buildFixtureTsv() } })

    expect(sheet.rows).toHaveLength(3)
    expect(sheet.sourceKind).toBe('tsv-paste')
    expect(sheet.header.headers).toEqual(['需求ID', '姓名', 'offer状态', '薪资'])
  })

  it('取消：任务被拒绝为「已取消」，且不改动上一次的成功结果', async () => {
    const client = createInProcessImportClient()
    const first = await client.parse({ source: { kind: 'paste', text: buildFixtureTsv() } })
    const snapshot = JSON.stringify(first.rows)

    const pending = client.parse({
      source: { kind: 'file', file: makeTextFile(buildFixtureCsv(), '名单.csv', 'text/csv') },
    })
    const taskId = client.lastTaskId()
    expect(taskId).not.toBeNull()
    client.cancel(taskId ?? '')

    const error: unknown = await pending.catch((caught: unknown) => caught)
    expect(isImportTaskCancelled(error)).toBe(true)
    expect(JSON.stringify(first.rows)).toBe(snapshot)

    const again = await client.parse({ source: { kind: 'paste', text: buildFixtureTsv() } })
    expect(again.rows).toHaveLength(3)
  })

  it('并发任务：新任务让旧任务作废（过时结果丢弃）', async () => {
    const client = createInProcessImportClient()
    const slow = client.parse({ source: { kind: 'paste', text: `a,b\n${'1,2\n'.repeat(500)}` } })
    const fast = client.parse({ source: { kind: 'paste', text: buildFixtureTsv() } })

    const slowError: unknown = await slow.catch((caught: unknown) => caught)
    expect(isImportTaskCancelled(slowError)).toBe(true)
    const sheet = await fast
    expect(sheet.rows).toHaveLength(3)
  })

  it('dispose 之后在途任务被拒绝为已取消', async () => {
    const client = createInProcessImportClient()
    const pending = client.parse({ source: { kind: 'paste', text: buildFixtureTsv() } })
    client.dispose()

    const error: unknown = await pending.catch((caught: unknown) => caught)
    expect(isImportTaskCancelled(error)).toBe(true)
  })
})
