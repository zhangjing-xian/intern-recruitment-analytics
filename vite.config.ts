import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vitest/config'

// 显式带 `.ts` 扩展名：本文件属于 `tsconfig.node.json`（`module: nodenext`），
// 该工程要求相对导入写明扩展名（`allowImportingTsExtensions` 已开启）。
// `src/lib/csp.ts` 刻意不引用应用层模块，因此可以被两个工程同时编译。
import {
  buildHeadersFile,
  buildMetaCsp,
  isCspMode,
  normalizeCspConnectSrc,
  type CspMode,
} from './src/lib/csp.ts'

/*
 * Tailwind CSS v4 的官方 Vite 集成：注册插件 + 在 CSS 中 `@import "tailwindcss";`
 * 不使用 Tailwind v3 的 tailwind.config.js / PostCSS 旧配置。
 *
 * `src/lib/csp.ts` 是**生产 CSP 与服务端安全头的唯一来源**（步骤13）：这份配置只负责把它
 * 注入产物（`index.html` 的 meta + `_headers` 文件），不在这里另写一遍策略字符串。
 * 两套策略与部署方式的关系见 README「部署」一节与 `deploy/`。
 */

/**
 * 从环境变量取构建模式。
 *
 * 两条路径都支持，**都不需要额外依赖**（Windows 下 `VAR=x cmd` 这种写法在 npm script 里不可用，
 * 因此不靠 shell 语法）：
 * - `vite build --mode ai` → `mode === 'ai'`（推荐，跨平台）；
 * - `CSP_MODE=ai` 环境变量（CI 里显式设置时用）。
 */
function cspModeFromEnv(env: NodeJS.ProcessEnv, viteMode: string): CspMode {
  const raw = env.CSP_MODE?.trim()
  if (raw !== undefined && raw !== '') {
    if (!isCspMode(raw)) {
      throw new Error(`CSP_MODE 只能是 local 或 ai，收到的是「${raw}」`)
    }
    return raw
  }
  return viteMode === 'ai' ? 'ai' : 'local'
}

/**
 * 子路径部署用的 base：`BASE_PATH=/repo-name/`。
 *
 * 为什么放在环境变量而不是写死：同一份代码要能部署到域名根，也要能部署到
 * GitHub Pages 的项目子路径（`/repo/`）。HashRouter 让**刷新**不依赖服务端重写，
 * 但静态资源路径仍要带上 base，否则子路径下页面会白屏。
 */
function basePathFromEnv(env: NodeJS.ProcessEnv): string {
  const raw = env.BASE_PATH?.trim()
  if (raw === undefined || raw === '') {
    return '/'
  }
  if (!raw.startsWith('/')) {
    throw new Error(`BASE_PATH 必须以 / 开头（例如 /intern-recruitment/），收到的是「${raw}」`)
  }
  return raw.endsWith('/') ? raw : `${raw}/`
}

/** 把 CSP 注入产物：`index.html` 的 meta 标签 + `_headers` 文件（Cloudflare Pages / Netlify） */
function cspPlugin(mode: CspMode, connectSrcOverride: string | undefined): Plugin {
  const csp = buildMetaCsp(mode, connectSrcOverride)
  return {
    name: 'dsh:csp',
    // 只在生产构建注入：dev server 需要 inline/eval 才能热更新，注入会让开发环境直接坏掉
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      /*
       * 注入位置在 `<meta charset>` **之后**、任何会加载资源的标签之前。
       *
       * 两个约束同时要满足：
       * - meta CSP 只对它**之后**开始加载的资源生效，所以必须排在 `<script>` / `<link>` 之前
       *   （插在 `</head>` 前等于漏掉前面已经发起的请求——这正是 PRD 18.6 说「meta 不等价于
       *   响应头」的原因之一）；
       * - `<meta charset>` 必须保持在最前面（HTML 规范要求它落在文档前 1024 字节内），
       *   所以不能简单粗暴地插在 `<head>` 之后。
       */
      handler: (html) => {
        // 属性顺序与选择器必须与 `CSP_META_SELECTOR` 一致：界面侧靠它判断这一份产物能否用 AI
        const tag = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
        const charsetLine = /(\s*<meta charset="[^"]*"\s*\/?>)/
        if (charsetLine.test(html)) {
          return html.replace(charsetLine, `$1\n    ${tag}`)
        }
        return html.replace(/<head>/, `<head>\n    ${tag}`)
      },
    },
    writeBundle: (options) => {
      const outDir = options.dir ?? 'dist'
      /*
       * `_headers` 是 Cloudflare Pages / Netlify 的响应头约定。必须由**构建**产出而不是仓库根写死：
       * 两种 CSP 模式共用同一份配置，只有构建时才确定用哪一套。
       *
       * 注意 PRD 18.6 的原话：GitHub Pages 的 meta CSP **不等于**完整的响应头策略——
       * 因此产物同时带 meta（弱，但 GitHub Pages 只能这样）与 `_headers`（强），
       * 平台差异写在 `deploy/` 的三份说明里。
       */
      writeFileSync(join(outDir, '_headers'), buildHeadersFile(mode, connectSrcOverride), 'utf8')
    },
  }
}

export default defineConfig(({ command, mode: viteMode }) => {
  const env = process.env
  const mode = cspModeFromEnv(env, viteMode)
  const override = normalizeCspConnectSrc(env.CSP_CONNECT_SRC)
  if (
    env.CSP_CONNECT_SRC !== undefined &&
    env.CSP_CONNECT_SRC.trim() !== '' &&
    override === null
  ) {
    throw new Error(
      'CSP_CONNECT_SRC 只接受一个精确的 https origin（例如 https://proxy.example.com），不接受通配符 / 路径 / http',
    )
  }
  if (override !== null && mode !== 'ai') {
    throw new Error("CSP_CONNECT_SRC 只在 CSP_MODE=ai 时有意义：本地版必须是 connect-src 'none'")
  }

  return {
    // 子路径部署见 `basePathFromEnv`；dev server 一律用根路径
    base: command === 'build' ? basePathFromEnv(env) : '/',
    plugins: [react(), tailwindcss(), cspPlugin(mode, override ?? undefined)],
    server: {
      watch: {
        /*
         * 忽略测试运行期产生的临时目录。
         *
         * 为什么需要：vitest 会在**被测试文件旁边**建形如
         * `.PrivacyPage.test.tsx.<pid>.<hash>.tmpdir/` 的临时目录用于写临时副本，
         * 而 Vite 的 watcher 默认只忽略 `node_modules` 与 `.git`，于是它会去 watch 这个
         * 转瞬即逝的目录；在 Windows 上文件已被删掉/占用时 `fs.watch` 抛 `EBUSY`，
         * 该错误是**未捕获**的，会直接把 `npm run dev` 进程打死
         * （本项目实际发生过一次，调试信息见该次 stderr 的 UVException/EBUSY）。
         *
         * 用正则而不是 `**\/*.tmpdir/**`：chokidar 各版本对 glob 的处理有差异，
         * 这里只需要匹配「以点开头、以 .tmpdir 结尾」的目录名，正则最稳。
         */
        ignored: [/(^|[\\/])\.[^\\/]*\.tmpdir([\\/]|$)/, '**/node_modules/**', '**/.git/**'],
      },
    },
    build: {
      // 不注入 module preload polyfill：现代浏览器原生支持 <link rel="modulepreload">，
      // 而该 polyfill 会调用 fetch 预取本地资源，既无必要，又与 CSP connect-src 'none' 冲突。
      modulePreload: { polyfill: false },
    },
    test: {
      // 单测只覆盖纯函数（src/lib、domain/analytics 等），不需要 DOM 环境；
      // 组件级测试（jsdom + Testing Library）与端到端测试在步骤14 引入。
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
  }
})
