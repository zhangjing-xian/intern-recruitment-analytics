/**
 * 部署模板与文档的一致性守卫（步骤13）。
 *
 * ## 为什么值得一个测试
 *
 * `deploy/vercel.json` 与 `deploy/*.md` 是**手写**的（平台配置文件没法由构建生成），
 * 而其中最关键的一条是 CSP ——它必须与 `src/lib/csp.ts` 里的字符串**逐字一致**。
 * 这类「两处抄同一段策略」的漂移不会有任何编译错误：Vercel 上的策略悄悄比代码宽一格，
 * 而本地构建仍然是对的。因此这里把模板与代码钉在一起。
 *
 * 同时检查三份平台说明各自写清了「能不能设响应头」这个差别（PRD 18.6 的核心提醒），
 * 以及共同的红线（不建 Functions、关闭托管平台统计）。
 *
 * 本文件只读文件、不发请求。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { SECURITY_HEADERS, buildCsp } from '../lib/csp'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function readAt(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

type VercelConfig = {
  readonly headers?: readonly {
    readonly source: string
    readonly headers: readonly { readonly key: string; readonly value: string }[]
  }[]
}

const VERCEL = JSON.parse(readAt('deploy/vercel.json')) as VercelConfig
const DEPLOY_INDEX = readAt('deploy/README.md')
const GITHUB_PAGES = readAt('deploy/github-pages.md')
const CLOUDFLARE = readAt('deploy/cloudflare-pages.md')
const VERCEL_DOC = readAt('deploy/vercel.md')

function headerValueOf(source: string, key: string): string | null {
  for (const rule of VERCEL.headers ?? []) {
    if (rule.source !== source) {
      continue
    }
    const found = rule.headers.find((header) => header.key === key)
    if (found !== undefined) {
      return found.value
    }
  }
  return null
}

describe('步骤13：deploy/vercel.json 与代码里的 CSP 一致', () => {
  it('全局响应头里的 CSP 逐字等于含 AI 版策略', () => {
    const csp = headerValueOf('/(.*)', 'Content-Security-Policy')
    expect(csp).not.toBeNull()
    expect(csp).toBe(buildCsp('ai'))
    expect(csp).not.toContain('*')
  })

  it('安全头与 SECURITY_HEADERS 逐项一致', () => {
    for (const header of SECURITY_HEADERS) {
      expect(headerValueOf('/(.*)', header.name), header.name).toBe(header.value)
    }
  })

  it('缓存规则包含 assets 长缓存与 sw.js / index.html 不缓存', () => {
    expect(headerValueOf('/assets/(.*)', 'Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(headerValueOf('/sw.js', 'Cache-Control')).toBe('no-cache')
    expect(headerValueOf('/index.html', 'Cache-Control')).toBe('no-cache')
    expect(headerValueOf('/manifest.webmanifest', 'Cache-Control')).toBe('no-cache')
  })
})

describe('步骤13：三份平台说明各自写清差别', () => {
  it('GitHub Pages：写明**不能**设响应头、只能靠 meta，并给了子路径构建命令', () => {
    expect(GITHUB_PAGES).toContain('不能')
    expect(GITHUB_PAGES).toContain('meta CSP')
    expect(GITHUB_PAGES).toContain('不等于完整的响应头策略')
    expect(GITHUB_PAGES).toContain('--base=/')
    // HashRouter ⇒ 刷新子路由不会 404
    expect(GITHUB_PAGES).toContain('HashRouter')
  })

  it('Cloudflare Pages：写明用产物里的 _headers，并要求关闭自动优化与统计', () => {
    expect(CLOUDFLARE).toContain('_headers')
    expect(CLOUDFLARE).toContain('Rocket Loader')
    expect(CLOUDFLARE).toContain('Web Analytics')
    expect(CLOUDFLARE).toContain('不要创建')
  })

  it('Vercel：写明用 vercel.json、不要建 Functions、预览与生产策略一致', () => {
    expect(VERCEL_DOC).toContain('vercel.json')
    expect(VERCEL_DOC).toContain('不要创建')
    expect(VERCEL_DOC).toContain('Preview')
    expect(VERCEL_DOC).toContain('实际验证')
  })

  it('索引页写清两套构建命令、代理覆盖入口与三条共同红线', () => {
    expect(DEPLOY_INDEX).toContain('npm run build:ai')
    // 两套 CSP 的对照表：本地版必须是 'none'，AI 版必须是官方 origin
    expect(DEPLOY_INDEX).toContain("`'none'`")
    expect(DEPLOY_INDEX).toContain('https://api.deepseek.com')
    expect(DEPLOY_INDEX).toContain('CSP_CONNECT_SRC')
    expect(DEPLOY_INDEX).toContain('不建 Functions')
    expect(DEPLOY_INDEX).toContain('Service Worker 不得缓存、排队或重发 AI 请求')
  })

  it('文档里没有把「任意域」写成可行做法', () => {
    for (const [name, text] of [
      ['deploy/README.md', DEPLOY_INDEX],
      ['deploy/github-pages.md', GITHUB_PAGES],
      ['deploy/cloudflare-pages.md', CLOUDFLARE],
      ['deploy/vercel.md', VERCEL_DOC],
    ] as const) {
      // `*` 只能作为「通配符」被讨论时出现，不能出现在任何指令里
      expect(text.includes("connect-src *"), name).toBe(false)
      expect(text.includes('connect-src https:'), name).toBe(false)
    }
  })
})
