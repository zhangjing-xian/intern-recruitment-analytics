/**
 * 本地版一键启动用的**零依赖**静态服务器（2026-09-27 新增，用户需求 1）。
 *
 * ## 为什么不用 `vite preview`
 *
 * `vite preview` 要跑在装了 node_modules 的目录里（依赖 Vite），而交付给使用者的
 * 往往只有构建产物（`dist/`，或在归档里叫 `site/`）。这个脚本只用 Node 内置模块，
 * 因此在**任何有 Node 的机器**上、对着**一份静态产物**就能起服务。
 *
 * ## 三条纪律（与整个项目的安全口径一致）
 *
 * 1. **只监听回环地址**（默认 `127.0.0.1`）：这是本地工具，不对外网开放；
 * 2. **只读**：只提供被请求目录里的静态文件，不写任何东西、不记录请求内容；
 * 3. **零第三方**：只用 `node:http` / `node:fs` / `node:path`，不连任何外部服务，
 *    因此「数据不出浏览器」的承诺在这条路径上依然成立。
 *
 * ## 为什么必须用 `http://127.0.0.1` 而不是 `http://<本机 IP>`
 *
 * 浏览器只把「安全上下文」才给的 Web Crypto（`crypto.subtle`）暴露出来，
 * 而 `127.0.0.1` / `localhost` 属于可信来源、本机 IP **不属于**。
 * 用 IP 打开时「创建加密本地仓」会直接失效——所以这里绑定 127.0.0.1 并打印这个地址。
 *
 * 用法：
 *   node scripts/serve-dist.mjs                # 自动找 dist/（找不到就找 site/）
 *   node scripts/serve-dist.mjs dist 4173      # 指定目录与端口
 */

import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'

const HOST = '127.0.0.1'
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

/** 交付归档里构建产物叫 `site/`，仓库里叫 `dist/`——两个都认，少一次「路径不对」的求助 */
function pickRootDir(explicit) {
  const candidates = explicit === undefined ? ['dist', 'site'] : [explicit]
  for (const candidate of candidates) {
    const full = resolve(process.cwd(), candidate)
    if (existsSync(full) && statSync(full).isDirectory()) {
      return full
    }
  }
  return null
}

const [, , dirArg, portArg] = process.argv
const rootDir = pickRootDir(dirArg === undefined || dirArg === '' ? undefined : dirArg)
if (rootDir === null) {
  console.error('找不到构建产物目录：既没有 dist/ 也没有 site/。')
  console.error('请先在项目根目录执行一次构建（例如 npm run build），或把本脚本放到产物旁边运行。')
  process.exit(1)
}

const port = Number(portArg ?? 4173)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`端口不合法：${String(portArg)}`)
  process.exit(1)
}

const server = createServer((request, response) => {
  const urlPath = decodeURIComponent((request.url ?? '/').split('?')[0])
  /** 目录穿越防护：解析后必须仍在 rootDir 内，否则一律 403（不泄露任何目录信息） */
  const target = normalize(join(rootDir, urlPath))
  if (target !== rootDir && !target.startsWith(rootDir + sep)) {
    response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    response.end('拒绝访问')
    return
  }

  let filePath = target
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html')
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    /*
     * 单页应用的回落：**只对「看起来像页面」的请求**回落到首页。
     * 带扩展名的请求（`.js` / `.css` / `.png` …）找不到就老实回 404——
     * 否则浏览器会拿到一份 HTML 却按脚本去解析，报出一句与真实原因无关的 MIME 错误。
     * 本项目用 HashRouter，正常情况下连页面级回落都用不到。
     */
    const looksLikeAsset = extname(urlPath) !== ''
    if (looksLikeAsset) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('没有这个文件')
      return
    }
    filePath = join(rootDir, 'index.html')
    if (!existsSync(filePath)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('没有找到 index.html')
      return
    }
  }

  const name = filePath.split(sep).pop() ?? ''
  const headers = {
    'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // 本地工具：一律不强缓存，避免「改了文件却看到旧页面」
    'Cache-Control': name === 'sw.js' ? 'no-store' : 'no-cache',
  }
  response.writeHead(200, headers)
  createReadStream(filePath).pipe(response)
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`端口 ${String(port)} 已被占用。`)
    console.error('可能是本地版已经在运行了——直接打开下面的地址即可；')
    console.error('或者换一个端口再启动：node scripts/serve-dist.mjs dist 4174')
    process.exit(1)
  }
  console.error(`启动失败：${error.message}`)
  process.exit(1)
})

server.listen(port, HOST, () => {
  console.log('实习生招聘数据复盘工具（本地版）已启动')
  console.log(`  目录：${rootDir}`)
  console.log(`  地址：http://${HOST}:${String(port)}/`)
  console.log('')
  console.log('使用要点：')
  console.log('  · 数据只在这个浏览器里处理，关闭这个窗口后服务就停了（页面也打不开了）。')
  console.log('  · 请用这个 127.0.0.1 地址打开；换成 http://<你的IP> 会让「创建加密本地仓」失效。')
  console.log('  · 按 Ctrl + C 或直接关闭本窗口即可停止。')
})
