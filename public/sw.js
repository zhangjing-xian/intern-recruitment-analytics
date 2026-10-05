/*
 * Service Worker（步骤13，docs/PRD.md 18.6 与 AGENTS.md §2.1/§2.7）。
 *
 * ## 它只做一件事：把**应用壳**放进缓存，让断网后核心流程仍可打开
 *
 * 缓存范围是**同源静态资源**：导航请求、`/assets/*` 的 JS/CSS、图标、manifest。
 * 明确**不**缓存、不排队、不重发的东西（这几条是发布阻断级约束）：
 *
 * 1. **任何非 GET 请求**：直接 `return`（不拦截、不放到后台队列）。AI 调用是 `POST`，
 *    因此它永远不经过缓存层——不存在「断网时被排队、恢复后自动重发」这条路径；
 * 2. **任何跨源请求**：直接 `return`。AI 端点（DeepSeek 或用户自建的代理）都在别的 origin，
 *    它们的请求与响应都不进缓存，也不被改写；
 * 3. **任何带凭据语义的请求**：`Authorization` 头存在时直接 `return`（双保险：
 *    即使有人把 AI 调用改成了 GET，也不会被缓存）；
 * 4. **blob: / data: / chrome-extension: 等非 http(s) 协议**：直接 `return`
 *    （导出的报告与图片走 Blob / data URL，它们本来就产生不了缓存条目）；
 * 5. **不使用 Background Sync / Periodic Sync / Push / Notification**：本文件里没有这些事件监听，
 *    因此「后台重发」在代码层面不存在。
 *
 * ## 数据在哪
 *
 * 招聘数据只在 IndexedDB（加密仓）里，本文件**从不读写** IndexedDB / localStorage / Cookie，
 * 也不请求 `Cache` 里以外的任何持久化。因此「更新 Service Worker」不会碰到业务数据：
 * 版本更新只删掉**旧版本的静态缓存**，加密仓原封不动（口径见 D-084）。
 *
 * ## 更新策略
 *
 * 新版 SW 装好后**停在那里等**（不自动 `skipWaiting`）：界面收到消息后提示「有新版本」，
 * 由用户点击才 `skipWaiting` + 刷新。这样不会在用户正看着预览、或正等 AI 响应时把页面换掉。
 *
 * ## 为什么是手写的而不是 Workbox
 *
 * 本项目对 SW 的要求是「**白名单式**缓存 + 一条条列出不会做的事」。Workbox 的默认路由
 * （`NetworkFirst` / `StaleWhileRevalidate` 加上运行时缓存）会**自动**把未预缓存但同源的响应
 * 也放进缓存，包括我们不想留的东西；要关掉得逐条配置，反而比手写更难核对。
 * 手写的代价是必须自己处理版本与清理，因此下面把这两件事写得很直白，并有测试逐条钉住。
 */

/* global self, caches, fetch, URL, Response */

/** 缓存名带版本：升级时只删**本前缀的旧缓存**，不碰同源其他应用的缓存 */
const CACHE_PREFIX = 'intern-recruitment-shell-'
const CACHE_VERSION = 'v1'
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`

/** 同源静态资源白名单：这些在 install 阶段就取好（离线可用） */
const PRECACHE_PATHS = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './icons/icon-192.png', './icons/icon-512.png']

/** 只允许缓存这些扩展名的响应（其余一律不缓存，宁可少缓存也不多留） */
const CACHEABLE_EXTENSIONS = ['.js', '.css', '.svg', '.png', '.webmanifest', '.woff2', '.ico', '.html']

/** 这些路径**永远不进缓存**（即使它们看起来像静态资源） */
const NEVER_CACHE_PATHS = ['/sw.js', '/_headers', '/robots.txt']

/** 给缓存用的键：去掉查询串（本应用的静态资源带内容哈希，查询串只用于调试） */
function cacheKeyOf(url) {
  const key = new URL(url.href)
  key.search = ''
  key.hash = ''
  return key.href
}

function isSameOrigin(url) {
  return url.origin === self.location.origin
}

function isCacheableRequest(request, url) {
  if (!isSameOrigin(url)) {
    return false
  }
  if (NEVER_CACHE_PATHS.some((path) => url.pathname.endsWith(path))) {
    return false
  }
  const pathname = url.pathname.toLowerCase()
  return CACHEABLE_EXTENSIONS.some((extension) => pathname.endsWith(extension))
}

/** 导航请求：网络优先，失败时回退到缓存的应用壳（这样新版本能第一时间被拿到） */
async function handleNavigation(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME)
      await cache.put(cacheKeyOf(new URL(request.url)), response.clone())
    }
    return response
  } catch (error) {
    const cache = await caches.open(CACHE_NAME)
    const cached =
      (await cache.match(cacheKeyOf(new URL(request.url)))) ??
      (await cache.match(new URL('./index.html', self.registration.scope).href))
    if (cached !== undefined && cached !== null) {
      return cached
    }
    throw error
  }
}

/** 静态资源：缓存优先（它们带内容哈希，同名即同内容），缓存没有再去网络并放回缓存 */
async function handleStatic(request, url) {
  const cache = await caches.open(CACHE_NAME)
  const key = cacheKeyOf(url)
  const cached = await cache.match(key)
  if (cached !== undefined && cached !== null) {
    return cached
  }
  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(key, response.clone())
  }
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      // 逐个 add：任何一个 404 都不该让整个安装失败（否则浏览器会一直停在旧版本）
      await Promise.all(
        PRECACHE_PATHS.map(async (path) => {
          const url = new URL(path, self.registration.scope).href
          try {
            const response = await fetch(url, { cache: 'no-store' })
            if (response.ok) {
              await cache.put(cacheKeyOf(new URL(url)), response)
            }
          } catch {
            // 单个资源取不到就跳过：核心壳（index.html）取到即可离线
          }
        }),
      )
      // 顺手把 index.html 里引用的带哈希资源也预缓存（否则首屏离线会缺 chunk）
      try {
        const shell = await cache.match(new URL('./index.html', self.registration.scope).href)
        if (shell !== undefined && shell !== null) {
          const html = await shell.text()
          const matches = html.match(/(?:src|href)="([^"]+)"/g) ?? []
          const assets = matches
            .map((entry) => entry.slice(entry.indexOf('"') + 1, -1))
            .filter((path) => isSameOrigin(new URL(path, self.registration.scope)))
            .filter((path) => !path.startsWith('data:'))
          await Promise.all(
            assets.map(async (path) => {
              const url = new URL(path, self.registration.scope)
              if (!isCacheableRequest(new Request(url.href), url)) {
                return
              }
              try {
                const response = await fetch(url.href, { cache: 'no-store' })
                if (response.ok) {
                  await cache.put(cacheKeyOf(url), response)
                }
              } catch {
                // 同上：单个资源失败不影响安装
              }
            }),
          )
        }
      } catch {
        // 解析失败也不影响安装：导航请求还有网络优先那条路
      }
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      )
      // 不调用 clients.claim()：让新版本在用户点击「刷新」后接管，行为更可预期
    })(),
  )
})

self.addEventListener('message', (event) => {
  // 唯一接受的消息：用户在界面上点了「立即更新」。除此之外不响应任何指令。
  if (event.data !== undefined && event.data !== null && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('fetch', (event) => {
  const request = event.request

  /*
   * 五条「直接放行」的规则（顺序有意义：先排除不可缓存的，再谈缓存策略）。
   * 每一条都对应文件头里的同一编号，改动时两处一起改。
   */
  // 1. 非 GET：AI 调用是 POST，绝不拦截（因此不存在后台排队与自动重发）
  if (request.method !== 'GET') {
    return
  }
  // 3. 带 Authorization：即使被改成 GET 也不缓存
  if (request.headers.get('Authorization') !== null) {
    return
  }
  let url
  try {
    url = new URL(request.url)
  } catch {
    return
  }
  // 4. 非 http(s)：blob / data / 扩展协议一律放行
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return
  }
  // 2. 跨源：AI 端点与任何第三方都不经过缓存层
  if (!isSameOrigin(url)) {
    return
  }
  // 5. 不在白名单扩展名里的同源请求也不缓存（例如未来某个 JSON 接口）
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request))
    return
  }
  if (!isCacheableRequest(request, url)) {
    return
  }
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') {
    // 浏览器偶尔会发这种请求（例如 DevTools），此时返回 undefined 是标准做法
    return
  }
  event.respondWith(handleStatic(request, url))
})
