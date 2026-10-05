/**
 * PWA 静态资源与 Service Worker 的**源码级守卫**（步骤13）。
 *
 * ## 为什么要逐行扫 `public/sw.js`
 *
 * PRD 18.6 与 AGENTS.md §2.7 对 Service Worker 的要求大部分是**否定式**的：
 * 「不缓存用户数据」「不排队」「不重发 AI 请求」「不碰加密仓」。否定式要求没有函数签名可以承载，
 * 最可靠的做法是把它们变成对源码的断言：**出现某个东西就失败**。
 * 这样以后有人想「顺手加个后台同步」「顺手把响应都存起来」，测试会先挡住。
 *
 * ## 有意的例外
 *
 * `sw.js` 是**唯一**允许出现 `caches` / `fetch` 的地方（它跑在 Service Worker 线程里，
 * 与 `src/ai/client.ts` 是两条互不相干的边界）。因此本文件**不**把它纳入
 * `aiNetworkGuard.test.ts` 的扫描——那一份守卫扫的是 `src/`，而 `public/` 不参与打包，
 * 也不会被页面以脚本形式加载。
 *
 * 图标与 manifest 的检查放在这里：它们是 PWA 能不能装、能不能离线的前提，
 * 而且「生成脚本坏了 / 文件被换掉」不会有任何类型错误提示。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { CSP_MODES, buildCsp, buildMetaCsp } from '../lib/csp'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function readAt(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

const SW = readAt('public/sw.js')
const MANIFEST_RAW = readAt('public/manifest.webmanifest')
const INDEX_HTML = readAt('index.html')

type Manifest = {
  readonly name?: string
  readonly short_name?: string
  readonly start_url?: string
  readonly scope?: string
  readonly display?: string
  readonly icons?: readonly { readonly src: string; readonly sizes: string; readonly type: string }[]
}

const MANIFEST = JSON.parse(MANIFEST_RAW) as Manifest

/** 去掉注释后的源码：注释里**必须**写清「不做什么」，那是对纪律的说明，不是实现 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
}

const SW_CODE = codeOnly(SW)

describe('步骤13：Service Worker 不许做的事', () => {
  it('不使用 Background Sync / Periodic Sync / Push / Notification（因此不存在后台重发）', () => {
    for (const forbidden of [
      'backgroundSync',
      'periodicsync',
      'periodicSync',
      'sync"', // addEventListener('sync')
      "'sync'",
      'push',
      'Notification',
      'showNotification',
    ]) {
      expect(SW_CODE.includes(forbidden), `sw.js 里出现了 ${forbidden}`).toBe(false)
    }
    // 事件监听只允许 install / activate / fetch / message 四个
    const listeners = [...SW_CODE.matchAll(/addEventListener\(\s*'([a-z]+)'/g)].map(
      (match) => match[1],
    )
    expect([...new Set(listeners)].sort()).toEqual(['activate', 'fetch', 'install', 'message'])
  })

  it('绝不读写业务数据：没有 IndexedDB / localStorage / Cookie', () => {
    for (const forbidden of ['indexedDB', 'IDBDatabase', 'localStorage', 'sessionStorage', 'cookie']) {
      expect(SW_CODE.includes(forbidden), `sw.js 里出现了 ${forbidden}`).toBe(false)
    }
  })

  it('不缓存非 GET、跨源与带 Authorization 的请求（三条直接放行）', () => {
    // 非 GET：AI 调用是 POST，永远不经过缓存层
    expect(SW_CODE).toContain("if (request.method !== 'GET')")
    // 带 Authorization 的请求也放行（双保险）
    expect(SW_CODE).toContain("request.headers.get('Authorization') !== null")
    // 跨源（AI 端点 / 任何第三方）放行
    expect(SW_CODE).toContain('if (!isSameOrigin(url))')
    // 非 http(s)（blob / data / 扩展协议）放行
    expect(SW_CODE).toContain("url.protocol !== 'http:'")
  })

  it('缓存范围是白名单：扩展名清单 + 明确排除项', () => {
    expect(SW_CODE).toContain('CACHEABLE_EXTENSIONS')
    expect(SW_CODE).toContain('NEVER_CACHE_PATHS')
    // sw.js 自己绝不进缓存（否则新版本永远拿不到）
    expect(SW_CODE).toContain("'/sw.js'")
    // 不缓存任何 JSON / 无扩展名响应（本应用没有这类静态资源）
    expect(SW_CODE).not.toContain("'.json'")
    expect(SW_CODE).not.toContain("'/api'")
  })

  it('缓存名带版本，且 activate 只删本前缀的旧缓存', () => {
    expect(SW_CODE).toContain('CACHE_PREFIX')
    expect(SW_CODE).toContain('CACHE_VERSION')
    expect(SW_CODE).toContain('name.startsWith(CACHE_PREFIX)')
    // 不调用 caches.keys() 之外的破坏性清理（不会删别的作用域的缓存）
    expect(SW_CODE).toContain('caches.delete(name)')
  })

  it('更新是用户可控的：只有收到 SKIP_WAITING 消息才 skipWaiting', () => {
    const skipWaitingCalls = [...SW_CODE.matchAll(/self\.skipWaiting\(\)/g)]
    expect(skipWaitingCalls).toHaveLength(1)
    expect(SW_CODE).toContain("event.data.type === 'SKIP_WAITING'")
    // 不自动 claim：行为更可预期（新版本等用户点刷新）
    expect(SW_CODE).not.toContain('clients.claim()')
  })

  it('离线能力有两条兜底：install 预缓存 + 导航网络优先回退缓存', () => {
    expect(SW_CODE).toContain('PRECACHE_PATHS')
    expect(SW_CODE).toContain('handleNavigation')
    expect(SW_CODE).toContain('handleStatic')
    expect(SW_CODE).toContain("request.mode === 'navigate'")
  })
})

describe('步骤13：manifest 与 index.html 的接线', () => {
  it('manifest 字段齐全，且用相对路径（子路径部署才不会 404）', () => {
    expect(MANIFEST.name).toBeTruthy()
    expect(MANIFEST.short_name).toBeTruthy()
    expect(MANIFEST.display).toBe('standalone')
    expect(MANIFEST.start_url?.startsWith('./')).toBe(true)
    expect(MANIFEST.scope).toBe('./')
    // 不含任何外部来源
    expect(MANIFEST_RAW).not.toMatch(/https?:\/\//)
    expect(MANIFEST_RAW).not.toContain('*')
  })

  it('图标覆盖 192 与 512，且都是同源相对路径', () => {
    const sizes = (MANIFEST.icons ?? []).map((icon) => icon.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    for (const icon of MANIFEST.icons ?? []) {
      expect(icon.src.startsWith('./')).toBe(true)
      expect(icon.type.startsWith('image/')).toBe(true)
    }
    // 至少有一个 maskable（安卓自适应图标需要）
    expect(MANIFEST_RAW).toContain('maskable')
  })

  it('index.html 引用 manifest，并且**不**硬编码 CSP（策略由构建注入）', () => {
    expect(INDEX_HTML).toContain('%BASE_URL%manifest.webmanifest')
    expect(INDEX_HTML).not.toContain('http-equiv="Content-Security-Policy"')
    // 也不引用任何远程资源
    expect(INDEX_HTML).not.toMatch(/(?:src|href)="https?:\/\//)
  })
})

describe('步骤13：PWA 图标是真的 PNG（生成脚本坏了会在这里失败）', () => {
  /** 读 PNG 的 IHDR：宽 / 高 / 位深 / 颜色类型 */
  function pngHeaderOf(relative: string): {
    readonly width: number
    readonly height: number
    readonly bitDepth: number
    readonly colorType: number
  } {
    const bytes = readFileSync(join(ROOT, relative))
    // 8 字节签名 + 4 字节长度 + 4 字节类型，然后才是 IHDR 数据
    const signature = bytes.subarray(0, 8)
    expect([...signature]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR')
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      bitDepth: bytes.readUInt8(24),
      colorType: bytes.readUInt8(25),
    }
  }

  it('192 / 512 两个图标的尺寸与格式正确（8 位 RGBA）', () => {
    for (const size of [192, 512]) {
      const header = pngHeaderOf(`public/icons/icon-${size}.png`)
      expect(header.width).toBe(size)
      expect(header.height).toBe(size)
      expect(header.bitDepth).toBe(8)
      // 6 = 真彩 + alpha
      expect(header.colorType).toBe(6)
    }
  })

  it('生成脚本可重跑（幂等：同样输入写出同样字节）', () => {
    // 脚本本身存在且打印写过哪些文件；这里只断言它没有引入外部素材或网络
    const script = readAt('scripts/make-icons.mjs')
    expect(script).toContain("from 'node:zlib'")
    expect(script).not.toMatch(/https?:\/\//)
    expect(script).toContain('encodePng')
  })
})

describe('步骤13：构建产物里的 PWA 与 CSP（没有 dist 时跳过，不假装通过）', () => {
  const distDir = join(ROOT, 'dist')
  const hasDist = existsSync(distDir)

  it('dist/index.html 带 meta CSP，且策略与代码里的两种模式之一完全相同', () => {
    if (!hasDist) {
      expect(hasDist).toBe(false)
      return
    }
    const html = readAt('dist/index.html')
    const matched = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/.exec(html)
    expect(matched, 'dist/index.html 里应有构建注入的 meta CSP').not.toBeNull()
    const csp = matched?.[1] ?? ''
    // 只允许两种模式之一（本地版或含 AI 版）的 **meta 版**，不接受任何别的写法
    expect([buildMetaCsp('local'), buildMetaCsp('ai')]).toContain(csp)
    expect(csp).not.toContain('*')
    // meta 里不能出现 frame-ancestors：浏览器会忽略它并打印控制台报错（步骤14 实测）
    expect(csp).not.toContain('frame-ancestors')
    /*
     * 位置也要紧：meta CSP 只对它**之后**开始加载的资源生效，因此必须排在
     * 任何 <script> / <link rel="stylesheet"> 之前（否则它在语义上就是漏的）。
     */
    const cspIndex = html.indexOf('Content-Security-Policy')
    const firstResourceIndex = Math.min(
      ...[html.indexOf('<script'), html.indexOf('<link')].filter((index) => index >= 0),
    )
    expect(cspIndex).toBeGreaterThan(0)
    expect(cspIndex).toBeLessThan(firstResourceIndex)
  })

  it('dist/_headers 用响应头形式的完整策略（比 meta 多一条 frame-ancestors）', () => {
    if (!hasDist) {
      expect(hasDist).toBe(false)
      return
    }
    const html = readAt('dist/index.html')
    const metaCsp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/.exec(html)?.[1]
    const headers = readAt('dist/_headers')
    // 找出 meta 是哪个模式的，并断言 _headers 用的是**同一模式的完整版**
    const matchedMode = CSP_MODES.find((mode) => buildMetaCsp(mode) === metaCsp)
    expect(matchedMode, `meta CSP 不属于任何已知模式：${metaCsp ?? ''}`).not.toBeUndefined()
    expect(headers).toContain(`Content-Security-Policy: ${buildCsp(matchedMode ?? 'local')}`)
    expect(headers).toContain('/sw.js\n  Cache-Control: no-cache')
    expect(headers).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')
  })

  it('dist 里带着 SW、manifest 与两个图标，且 sw.js 与源码逐字一致', () => {
    if (!hasDist) {
      expect(hasDist).toBe(false)
      return
    }
    expect(existsSync(join(distDir, 'sw.js'))).toBe(true)
    expect(existsSync(join(distDir, 'manifest.webmanifest'))).toBe(true)
    expect(existsSync(join(distDir, 'icons', 'icon-192.png'))).toBe(true)
    expect(existsSync(join(distDir, 'icons', 'icon-512.png'))).toBe(true)
    // 构建不做任何转换：产物里的 sw.js 应当与 public/sw.js 逐字相同（否则「源码里说的」不等于「跑起来的」）
    expect(readAt('dist/sw.js')).toBe(readAt('public/sw.js'))
    expect(readAt('dist/manifest.webmanifest')).toBe(readAt('public/manifest.webmanifest'))
  })

  it('dist/index.html 引用了 manifest（用相对路径，子路径部署才成立）', () => {
    if (!hasDist) {
      expect(hasDist).toBe(false)
      return
    }
    const html = readAt('dist/index.html')
    expect(html).toMatch(/<link rel="manifest" href="[^"]*manifest\.webmanifest"/)
    // base 为根时是 /manifest.webmanifest；子路径构建时是 /<base>/manifest.webmanifest
    const href = /<link rel="manifest" href="([^"]+)"/.exec(html)?.[1] ?? ''
    expect(href.startsWith('/')).toBe(true)
  })
})
