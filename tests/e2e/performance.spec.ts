/**
 * 性能基准（步骤14，A20）。
 *
 * ## 这一条要回答什么
 *
 * PRD 没有给硬性性能指标，但它给了两条**可核查**的要求：首屏不能因为引入图表 / 解析库
 * 而膨胀（步骤7–9 一直用「ECharts 不进首屏」钉着），以及「几万条记录的操作要能在浏览器里完成」。
 * 因此这里记录**实测数字**，只对「明显退化」设上界，不用来宣称「快」。
 *
 * 三个口径刻意分开，避免把不同东西混成一个数字：
 *
 * | 口径 | 怎么来的 | 用途 |
 * |---|---|---|
 * | 首屏脚本字节 | 直接读 `dist/index.html` 引用的 `script` / `modulepreload` 文件大小求和 | 与构建日志、`KNOWN_ISSUES.md` 里的体积债**同一口径**，可复现 |
 * | 首屏 `load` 耗时 / 请求数 | 浏览器 `PerformanceNavigationTiming` | 真实加载体验 |
 * | 本地链路耗时 / 最长长任务 | 墙钟 + `PerformanceObserver('longtask')` | 交互是否被同步计算卡住 |
 *
 * 实测值写进 `test-results/perf-baseline.json`，并抄进 `docs/ACCEPTANCE.md`。
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import {
  E2E_ROOT,
  confirmMappingAndCommit,
  expectNoExternalRequests,
  openApp,
  pasteDemoTable,
  readDashboardN,
  trackRequests,
} from './helpers'

/** 上界：明显退化才失败，不参与「性能宣称」 */
const LIMITS = {
  /** 首屏 load 事件（毫秒）：本地 preview 服务器，给足余量 */
  firstLoadMs: 8_000,
  /** 首屏脚本文件字节数：当前实测约 832 kB，这里留近一倍余量抓「图表/解析库进了首屏」这类退化 */
  firstScreenScriptBytes: 1_600_000,
  /** 整条本地链路（含解析、清洗、看板首算）的墙钟耗时 */
  localFlowMs: 30_000,
  /** 单次长任务时长：超过它说明某一步同步计算把界面卡住了 */
  longestTaskMs: 5_000,
}

type PerfMeasurement = {
  readonly firstLoadMs: number
  readonly firstScreenScriptBytes: number
  readonly firstScreenScriptFiles: number
  readonly firstScreenRequestCount: number
  readonly localFlowMs: number
  readonly longestTaskMs: number
  readonly dashboardN: number
  /**
   * 浏览器报的每个脚本 `encodedBodySize`（步骤14 实测：Chrome 报的是**压缩后**字节数，
   * 因为 `vite preview` 对真实 GET 请求会做 gzip）。只作为旁证记录，不作为断言口径。
   */
  readonly browserReportedScripts: readonly {
    readonly name: string
    readonly initiatorType: string
    readonly encodedBodySize: number
  }[]
}

/**
 * 首屏脚本字节数：从产物 `index.html` 里取 `script[src]` 与 `modulepreload` 的本地文件求和。
 *
 * 为什么不用浏览器报的 `encodedBodySize`：那个值受「有没有命中缓存」「服务器有没有压缩」
 * 影响（本机 `vite preview` 不做压缩，但浏览器判断会不一样），换台机器就不可比；
 * 文件大小是同一份产物里可以逐字节核对的口径。
 */
function firstScreenScriptBytes(): { readonly bytes: number; readonly files: number } {
  const html = readFileSync(join(E2E_ROOT, 'dist', 'index.html'), 'utf8')
  const paths = new Set<string>()
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    paths.add(match[1] as string)
  }
  for (const match of html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)) {
    paths.add(match[1] as string)
  }
  let bytes = 0
  let files = 0
  for (const path of paths) {
    const file = join(E2E_ROOT, 'dist', path.replace(/^\//, ''))
    bytes += statSync(file).size
    files += 1
  }
  return { bytes, files }
}

test.describe('性能基准（A20）', () => {
  test('首屏与整条本地链路的实测数字，并记录到 test-results/perf-baseline.json', async ({
    page,
  }) => {
    const requests = trackRequests(page)

    // 主线程长任务：页面一打开就开始观察（晚于首屏的脚本无法统计，这里只覆盖链路部分）
    await page.addInitScript(() => {
      const target = window as unknown as { __longTasks: number[] }
      target.__longTasks = []
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            target.__longTasks.push(entry.duration)
          }
        })
        observer.observe({ entryTypes: ['longtask'] })
      } catch {
        // 不支持 longtask 的浏览器：留空数组，断言按 0 处理（并在报告里写明未观测到）
      }
    })

    await openApp(page)
    const navigation = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0] as
        | PerformanceNavigationTiming
        | undefined
      const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
      return {
        loadMs: entry === undefined ? 0 : Math.round(entry.loadEventEnd - entry.startTime),
        resourceCount: resources.length,
        resourceOrigins: [...new Set(resources.map((resource) => new URL(resource.name).origin))],
        scripts: resources
          .filter((resource) => resource.initiatorType === 'script')
          .map((resource) => ({
            name: new URL(resource.name).pathname,
            initiatorType: resource.initiatorType,
            encodedBodySize: Math.round(resource.encodedBodySize || 0),
          })),
      }
    })
    expect(navigation.loadMs).toBeGreaterThan(0)
    expect(navigation.loadMs).toBeLessThan(LIMITS.firstLoadMs)
    // 首屏资源**全部同源**：没有 CDN、没有在线字体、没有第三方脚本
    expect(navigation.resourceOrigins).toEqual(['http://127.0.0.1:4173'])

    const scriptBytes = firstScreenScriptBytes()
    expect(scriptBytes.bytes).toBeGreaterThan(100_000)
    expect(scriptBytes.bytes).toBeLessThan(LIMITS.firstScreenScriptBytes)
    // 首屏脚本里不能出现 ECharts / 解析库（它们必须在懒加载的另一侧）
    const html = readFileSync(join(E2E_ROOT, 'dist', 'index.html'), 'utf8')
    const entryScript = /<script[^>]+src="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(entryScript).toContain('/assets/index-')
    for (const lazyOnly of ['echartsRegister', 'xlsx', 'parse.worker', 'vault-']) {
      expect(entryScript, `首屏入口脚本不该是 ${lazyOnly}`).not.toContain(lazyOnly)
    }

    // 整条本地链路：粘贴 → 映射 → 清洗提交 → 看板出数字
    const startedAt = Date.now()
    await pasteDemoTable(page)
    await confirmMappingAndCommit(page)
    const dashboardN = await readDashboardN(page)
    const localFlowMs = Date.now() - startedAt
    expect(dashboardN).toBeGreaterThan(0)
    expect(localFlowMs).toBeLessThan(LIMITS.localFlowMs)

    const longTasks = await page.evaluate(
      () => (window as unknown as { __longTasks?: number[] }).__longTasks ?? [],
    )
    const longestTaskMs = longTasks.length === 0 ? 0 : Math.round(Math.max(...longTasks))
    expect(longestTaskMs).toBeLessThan(LIMITS.longestTaskMs)

    expectNoExternalRequests(requests.log)

    const measurement: PerfMeasurement = {
      firstLoadMs: navigation.loadMs,
      firstScreenScriptBytes: scriptBytes.bytes,
      firstScreenScriptFiles: scriptBytes.files,
      firstScreenRequestCount: navigation.resourceCount,
      localFlowMs,
      longestTaskMs,
      dashboardN,
      browserReportedScripts: navigation.scripts,
    }
    const outputDir = join(E2E_ROOT, 'test-results')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(
      join(outputDir, 'perf-baseline.json'),
      `${JSON.stringify(measurement, null, 2)}\n`,
      'utf8',
    )

    // 数字必须落在合理区间：0 说明没测到，超大说明断言写错了口径
    expect(measurement.firstScreenScriptFiles).toBeGreaterThan(0)
    expect(measurement.firstScreenRequestCount).toBeGreaterThan(0)
  })
})
