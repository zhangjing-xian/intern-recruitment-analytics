/**
 * PWA 与离线行为的浏览器端验收（步骤14）。
 *
 * 步骤13 交付的 Service Worker 有一批只在真实浏览器里才成立的承诺，
 * 它们在这里逐条被验证（Node 里的 `pwaAssets.test.ts` 只能读源码与产物，跑不起来 SW）：
 *
 * | 编号 | 断言 |
 * |---|---|
 * | A19 | SW 能真的装上并 activate；缓存里**只有同源静态资源** |
 * | AI18 | 缓存里没有任何 AI 端点请求（非 GET 与跨源两条规则在真实 fetch 路径上生效） |
 * | A19 | 断网后重载仍能打开应用壳（离线可用是真的） |
 * | A19 | manifest 可被浏览器拿到且指向本机图标 |
 *
 * 前提：`dist/` 是任意一种生产构建（本地版即可；这些用例不需要 AI 版）。
 */

import { expect, test, type Page } from '@playwright/test'

import { expectNoExternalRequests, openApp, trackRequests } from './helpers'

const CACHE_PREFIX = 'intern-recruitment-shell-'

type CacheDump = {
  readonly names: string[]
  readonly urls: string[]
}

/** 读 Cache Storage 里的缓存名与全部 URL（只读键，不读响应体） */
async function dumpCaches(page: Page): Promise<CacheDump> {
  return page.evaluate(async () => {
    const names = await caches.keys()
    const urls: string[] = []
    for (const name of names) {
      const cache = await caches.open(name)
      for (const request of await cache.keys()) {
        urls.push(request.url)
      }
    }
    return { names, urls }
  })
}

/** 等 SW 装好并且缓存里已经有东西（install 阶段的预缓存是异步的） */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    if (!('serviceWorker' in navigator)) {
      return false
    }
    const registration = await navigator.serviceWorker.getRegistration()
    if (registration === undefined || registration.active === null) {
      return false
    }
    const names = await caches.keys()
    if (names.length === 0) {
      return false
    }
    const cache = await caches.open(names[0] as string)
    return (await cache.keys()).length > 0
  })
}

test.describe('PWA：真实安装、缓存边界与离线可用（A19 / AI18）', () => {
  test('SW 装上并接管；缓存里只有同源静态资源，没有任何 AI 端点或非 GET', async ({ page }) => {
    const requests = trackRequests(page)
    await openApp(page)
    await waitForServiceWorker(page)

    const registration = await page.evaluate(async () => {
      const found = await navigator.serviceWorker.getRegistration()
      return {
        scope: found?.scope ?? null,
        active: found?.active?.state ?? null,
      }
    })
    expect(registration.active).toBe('activated')
    expect(registration.scope).toBe('http://127.0.0.1:4173/')

    /*
     * 断网重载前先在线刷新一次：手写的 `sw.js` **刻意不调用 `clients.claim()`**
     * （更新时机交给用户点「立即更新」），因此第一次访问的页面还不受 SW 控制。
     */
    await page.reload()
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

    const dump = await dumpCaches(page)
    expect(dump.names, '缓存名应当是本站自己的版本前缀').toEqual([`${CACHE_PREFIX}v1`])
    expect(dump.urls.length).toBeGreaterThan(0)

    for (const url of dump.urls) {
      // 只缓存同源静态资源：跨源（AI 端点或任何第三方）一条都不许有
      expect(url.startsWith('http://127.0.0.1:4173/'), `缓存里出现了跨源地址：${url}`).toBe(true)
      expect(url).not.toContain('api.deepseek.com')
      expect(url).not.toContain('chat/completions')
    }
    // 应用壳与首屏资源都在缓存里（否则离线打不开）
    expect(dump.urls.some((url) => url.endsWith('/index.html') || url.endsWith('/'))).toBe(true)
    expect(dump.urls.some((url) => url.includes('/assets/'))).toBe(true)

    // 整个流程没有出站请求（本地版：连 AI 端点都不可能发出去）
    expectNoExternalRequests(requests.log)
  })

  test('断网后重新加载仍能打开应用壳，本地流程可用（A19）', async ({ page, context }) => {
    await openApp(page)
    await waitForServiceWorker(page)
    // 先在线刷新一次让 SW 接管当前页面
    await page.reload()
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)

    await context.setOffline(true)
    try {
      await page.reload()
      // 离线：应用壳由 SW 从缓存返回，导航与导入页必须照常出现
      await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
      await expect(page.getByRole('heading', { level: 1, name: '导入' })).toBeVisible()
      // 本地功能本身不依赖网络：页面里也没有跳出去的东西
      expect(await page.locator('a[href^="http"]').count()).toBe(0)
    } finally {
      await context.setOffline(false)
    }
  })

  test('manifest 可被浏览器拿到，且图标指向本机资源（A19）', async ({ page, request }) => {
    await openApp(page)
    const manifestHref = await page
      .locator('link[rel="manifest"]')
      .getAttribute('href')
    expect(manifestHref).not.toBeNull()

    const response = await request.get(new URL(manifestHref ?? '/manifest.webmanifest', page.url()).href)
    expect(response.status()).toBe(200)
    const manifest = (await response.json()) as {
      name?: string
      start_url?: string
      icons?: { src?: string }[]
    }
    expect(manifest.name).toBeTruthy()
    expect(manifest.start_url).toBeTruthy()
    for (const icon of manifest.icons ?? []) {
      expect(icon.src?.startsWith('http')).toBe(false)
    }

    // 图标真的能取到（自己用 Node zlib 生成的 PNG，不经任何 CDN）
    const icon = await request.get('http://127.0.0.1:4173/icons/icon-192.png')
    expect(icon.status()).toBe(200)
    expect(icon.headers()['content-type']).toContain('image/png')
  })
})
