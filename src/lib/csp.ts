/**
 * 生产内容安全策略（CSP）与安全头的**唯一来源**（步骤13，docs/PRD.md 18.6）。
 *
 * ## 为什么这段字符串必须只有一处
 *
 * PRD 18.6 要求「本地版」与「含可选 AI 版」用**不同的** `connect-src`：
 * - 本地版：`connect-src 'none'`——构建产物里**没有任何**出站能力；
 * - 含 AI 版：只精确放行 `https://api.deepseek.com`（**不是**通配符、不是 `*`）。
 *
 * 如果这份策略在 `vite.config.ts`、部署模板、README 里各写一遍，早晚会出现
 * 「文档说 'none'、产物里其实是 `*`」这种**看不出问题**的状态——而那正是这一步要防的事。
 * 因此：字符串在这里构造一次，构建插件与测试都从这里取。
 *
 * ## `style-src` 为什么允许 `'unsafe-inline'`（其余一律不允许）
 *
 * React 与 ECharts 会写**内联 `style` 属性**（图表尺寸、水印定位、进度条宽度）。
 * `style-src-attr` 由 `style-src` 兜底，禁掉内联样式会让图表与部分布局直接坏掉。
 * 这是本项目**唯一**允许的宽松项，且它不涉及脚本执行：
 * `script-src` 里**没有** `'unsafe-inline'`、**没有** `'unsafe-eval'`，
 * 因此「注入脚本」这条路径仍然是关着的（与 AGENTS.md §6 禁止 `dangerouslySetInnerHTML` 配套）。
 *
 * ## 为什么没有 `upgrade-insecure-requests`
 *
 * 它会把子资源请求从 `http:` 强制升到 `https:`，而本项目**有意**允许用户登记**回环地址**上的
 * 本地代理（`http://127.0.0.1:8787`，见 `src/ai/aiProxy.ts`）。加了它，那个受支持的配置会在
 * 浏览器里被静默改写并失败；不加它，我们也没有任何需要升级的资源。
 *
 * ## 运维侧的自建代理怎么办
 *
 * 「不用 `*`、不放宽任意域」是硬约束，因此**默认两种模式的 CSP 都不含任何自定义地址**。
 * 需要自建代理的人只能自己构建，并通过 `CSP_CONNECT_SRC` 显式给出**一个精确的 https origin**
 * （构建插件会校验形状，非法就构建失败）。README 里把这条边界写清楚。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，也不发任何请求。
 */

/** 两种生产构建模式（对应 PRD 18.6 的两列） */
export const CSP_MODES = ['local', 'ai'] as const
export type CspMode = (typeof CSP_MODES)[number]

/**
 * 产物里那条 meta CSP 的**唯一选择器**（2026-09-27 新增）。
 *
 * 为什么要有这个常量：`vite.config.ts` 负责**写**这条 meta，界面侧需要**读**它来判断
 * 「这一份页面到底有没有出站能力」（见 `src/lib/aiAvailability.ts`）。
 * 两处各写一份选择器早晚会漂移（改了属性顺序、加了空格、换成单引号），
 * 而漂移的后果是**界面把「不含 AI 的构建」当成能用 AI**——正是这一步要修的毛病。
 * 因此选择器只写一次：构建侧与运行时侧都用它。
 */
export const CSP_META_SELECTOR = 'meta[http-equiv="Content-Security-Policy"]'

/**
 * 官方端点 origin。
 *
 * 这里**重复写了字面量**而不是从 `privacy/aiPreview.ts` 导入，原因是 TypeScript 的工程边界：
 * `vite.config.ts` 属于 `tsconfig.node.json`（`module: nodenext`，只允许带扩展名的相对导入），
 * 而它必须能读到这份策略；一旦这里导入应用层模块，那个模块的**无扩展名**导入链会整串报错。
 * 因此把「唯一来源」交给测试来保证：`src/lib/csp.test.ts` 断言
 * `AI_ENDPOINT_ORIGIN === AI_DEFAULT_DESTINATION.origin`，两处一旦漂移会立刻失败。
 */
export const AI_ENDPOINT_ORIGIN = 'https://api.deepseek.com'

export function isCspMode(value: unknown): value is CspMode {
  return value === 'local' || value === 'ai'
}

/**
 * `connect-src` 的取值。
 *
 * `'none'` 是**关键字**（必须带引号）；AI 版是一个精确 origin。
 * 两者都不含 `*`、`https:`、`http:` 这类宽松写法——`noWildcardCsp()` 会再断言一次。
 */
export function connectSrcOf(mode: CspMode): string {
  return mode === 'ai' ? AI_ENDPOINT_ORIGIN : "'none'"
}

/**
 * 自建代理地址的**显式覆盖**（只允许一个精确的 https origin）。
 *
 * 为什么允许它存在：PRD 18.6 说「如遇跨域，仅提供自建独立代理说明」，而代理域与官方域不同，
 * 不放行就没法用。为什么必须显式：绝不提供「放开任意域」的开关，因此这里只接受
 * `https://host[:port]` 形式、单条、无通配符、无路径/查询串的地址；不符合就返回 `null`
 * （调用方据此让构建失败，而不是悄悄退回一个更宽的策略）。
 */
export function normalizeCspConnectSrc(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? ''
  if (trimmed === '') {
    return null
  }
  if (trimmed.includes('*') || trimmed.includes(' ')) {
    return null
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.origin === 'null') {
    return null
  }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    return null
  }
  if (url.username !== '' || url.password !== '') {
    return null
  }
  return url.origin
}

/**
 * 完整 CSP 字符串。
 *
 * 三条阅读要点：
 * - `default-src 'self'` 兜底：任何没列出的资源类型都只能同源；
 * - `object-src 'none'` / `frame-ancestors 'none'` / `frame-src 'none'` / `form-action 'none'`：
 *   嵌入、被嵌入、提交表单三条路都关掉（本应用都不需要）；
 * - `img-src` 允许 `data:` 与 `blob:`：PNG 导出与报告预览用的是本机生成的数据 URL / Blob，
 *   它们**不产生网络请求**，但 CSP 会拦。
 *
 * 这是**响应头形式**的完整策略（`_headers` 用这一份）。写进 `index.html` 的 meta 版请用
 * `buildMetaCsp`：它逐字相同，只去掉在 meta 里会被忽略的 `frame-ancestors`（见下面说明）。
 */
export function buildCsp(mode: CspMode, connectSrcOverride?: string): string {
  const connectSrc = connectSrcOverride ?? connectSrcOf(mode)
  return [
    "default-src 'self'",
    // 没有 'unsafe-inline'、没有 'unsafe-eval'：注入脚本这条路是关着的
    "script-src 'self'",
    // 唯一宽松项：React / ECharts 会写内联 style 属性（见文件头说明）
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    // 解析在 Worker 里执行（同源模块 Worker）；blob: 供无 Worker 环境的回退路径
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}

/**
 * 放进 `index.html` 的 meta 版策略（步骤14 修正）。
 *
 * ## 为什么 meta 版必须比 `buildCsp` 少一条 `frame-ancestors`
 *
 * 这不是取舍，是浏览器的规定：`frame-ancestors` 通过 meta 下发时**不生效**，
 * Chromium 会打印
 * `The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.`
 * 并忽略它。步骤14 的 Playwright 用例在真实浏览器里抓到了这条控制台报错。
 *
 * 留着它的坏处不只是「多一条无用指令」：控制台里常驻一条红色报错，会把真正的问题淹掉；
 * 而且它给人一种「meta 也防住了点击劫持」的错觉。点击劫持防护由两处真正生效的地方负责：
 * `_headers` 里的完整 CSP（响应头形式）与 `X-Frame-Options: DENY`（`SECURITY_HEADERS`）。
 * 这也正是 PRD 18.6 / `deploy/github-pages.md` 已经写明的那句话——
 * meta CSP **不等价于**响应头策略，能配响应头的平台才能拿到 `frame-ancestors`。
 */
export function buildMetaCsp(mode: CspMode, connectSrcOverride?: string): string {
  return buildCsp(mode, connectSrcOverride)
    .split('; ')
    .filter((directive) => !directive.startsWith('frame-ancestors '))
    .join('; ')
}

/**
 * 安全头（响应头形式；`_headers` 文件与各平台文档共用这一份）。
 *
 * 两个刻意的取舍：
 * - **不设 `Cross-Origin-Embedder-Policy`**：它会要求所有跨源子资源带 CORP 头，与托管平台的
 *   默认行为容易冲突；本应用没有跨源子资源，因此不必付这个代价；
 * - `clipboard-write=(self)`：界面的「复制预览内容」要用剪贴板 API，禁掉会让该功能失效。
 */
export const SECURITY_HEADERS: readonly { readonly name: string; readonly value: string }[] = [
  { name: 'X-Content-Type-Options', value: 'nosniff' },
  { name: 'Referrer-Policy', value: 'no-referrer' },
  { name: 'X-Frame-Options', value: 'DENY' },
  { name: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { name: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  {
    name: 'Permissions-Policy',
    value:
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), display-capture=(), idle-detection=(), local-fonts=(), accelerometer=(), gyroscope=(), magnetometer=(), encrypted-media=(), picture-in-picture=(), clipboard-write=(self)',
  },
]

/**
 * 静态资源的缓存策略（响应头形式）。
 *
 * 三条都要紧：
 * - 带内容哈希的 `/assets/*` 可以长缓存 + `immutable`；
 * - `index.html` 与 `sw.js` **必须**可重新校验，否则「部署了新版本但用户永远拿到旧的」；
 * - Service Worker 的更新检查依赖 `sw.js` 不被长缓存缓存。
 */
export const CACHE_HEADER_RULES: readonly {
  readonly path: string
  readonly value: string
}[] = [
  { path: '/assets/*', value: 'public, max-age=31536000, immutable' },
  { path: '/index.html', value: 'no-cache' },
  { path: '/', value: 'no-cache' },
  { path: '/sw.js', value: 'no-cache' },
  { path: '/manifest.webmanifest', value: 'no-cache' },
  { path: '/icons/*', value: 'public, max-age=604800' },
  { path: '/favicon.svg', value: 'public, max-age=604800' },
]

/** `_headers` 文件（Cloudflare Pages / Netlify 格式）：安全头 + 缓存规则 */
export function buildHeadersFile(mode: CspMode, connectSrcOverride?: string): string {
  const lines: string[] = ['/*']
  lines.push(`  Content-Security-Policy: ${buildCsp(mode, connectSrcOverride)}`)
  for (const header of SECURITY_HEADERS) {
    lines.push(`  ${header.name}: ${header.value}`)
  }
  lines.push('')
  for (const rule of CACHE_HEADER_RULES) {
    lines.push(rule.path)
    lines.push(`  Cache-Control: ${rule.value}`)
  }
  return `${lines.join('\n')}\n`
}
