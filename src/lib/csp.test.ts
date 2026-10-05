/**
 * 生产 CSP 的**契约测试**（步骤13，docs/PRD.md 18.6）。
 *
 * 这一步最容易被悄悄改坏的东西就是 CSP：把 `connect-src 'none'` 改成 `*`、加一个
 * `'unsafe-eval'`、或者忘记容器里的 `frame-ancestors`，代码照常构建、页面照常打开，
 * 而承诺已经没了。因此这里把「承诺」逐条钉住：
 *
 * 1. 本地版**没有任何出站能力**（`connect-src 'none'`）；
 * 2. 含 AI 版**只精确放行官方 origin**，不含通配符 / 协议级 / `https:`；
 * 3. `script-src` 里没有 `'unsafe-inline'` / `'unsafe-eval'`；
 * 4. `style-src` 里的 `'unsafe-inline'` 是**唯一**的宽松项，且必须有注释说明原因；
 * 5. 嵌入 / 被嵌入 / 表单提交 / `base-uri` 全部关紧；
 * 6. 自建代理的覆盖入口**只接受一个精确 https origin**，通配符与 `http:` 一律拒绝；
 * 7. `_headers` 文件（Cloudflare Pages / Netlify）与同一份策略一致，且 `sw.js` / `index.html`
 *    必须是 `no-cache`（否则「部署了新版本用户拿不到」）。
 *
 * 本文件是纯函数测试：不发请求、不读产物。
 */

import { describe, expect, it } from 'vitest'

import {
  AI_ENDPOINT_ORIGIN,
  CACHE_HEADER_RULES,
  CSP_MODES,
  SECURITY_HEADERS,
  buildCsp,
  buildHeadersFile,
  buildMetaCsp,
  connectSrcOf,
  isCspMode,
  normalizeCspConnectSrc,
} from './csp'
import { AI_DEFAULT_DESTINATION } from '../privacy/aiPreview'

/** 取出某个指令的值：`connect-src 'none'` → `'none'` */
function directiveOf(csp: string, name: string): string | null {
  const part = csp
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry === name || entry.startsWith(`${name} `))
  if (part === undefined) {
    return null
  }
  return part.slice(name.length).trim()
}

describe('步骤13：两套 CSP 的承诺', () => {
  it('本地版没有任何出站能力：connect-src 就是 none', () => {
    const csp = buildCsp('local')
    expect(connectSrcOf('local')).toBe("'none'")
    expect(directiveOf(csp, 'connect-src')).toBe("'none'")
    // 通配符与协议级放行一律不许出现
    expect(csp).not.toContain('*')
    expect(csp).not.toMatch(/connect-src[^;]*https?:/)
  })

  it('含 AI 版只精确放行官方 origin（与 AI 层默认目的地同一个来源）', () => {
    const csp = buildCsp('ai')
    expect(connectSrcOf('ai')).toBe(AI_ENDPOINT_ORIGIN)
    expect(AI_ENDPOINT_ORIGIN).toBe(AI_DEFAULT_DESTINATION.origin)
    expect(directiveOf(csp, 'connect-src')).toBe('https://api.deepseek.com')
    // 精确 origin：不是协议级、不是子域通配、不是裸域名
    expect(csp).not.toContain('*')
    expect(directiveOf(csp, 'connect-src')).not.toBe('https:')
    expect(directiveOf(csp, 'connect-src')).not.toContain('deepseek.com ')
  })

  it('脚本严格：没有 unsafe-inline、没有 unsafe-eval', () => {
    for (const mode of CSP_MODES) {
      const csp = buildCsp(mode)
      expect(directiveOf(csp, 'script-src')).toBe("'self'")
      expect(csp).not.toContain('unsafe-eval')
      // 'unsafe-inline' 只允许出现在 style-src 里
      const inlineUsages = csp
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry.includes("'unsafe-inline'"))
      expect(inlineUsages).toEqual(["style-src 'self' 'unsafe-inline'"])
    }
  })

  it('嵌入 / 表单 / base 全部关紧，且默认只允许同源', () => {
    for (const mode of CSP_MODES) {
      const csp = buildCsp(mode)
      expect(directiveOf(csp, 'default-src')).toBe("'self'")
      expect(directiveOf(csp, 'object-src')).toBe("'none'")
      expect(directiveOf(csp, 'frame-src')).toBe("'none'")
      expect(directiveOf(csp, 'frame-ancestors')).toBe("'none'")
      expect(directiveOf(csp, 'form-action')).toBe("'none'")
      expect(directiveOf(csp, 'base-uri')).toBe("'self'")
      // 图片允许 data:/blob:（PNG 导出与报告预览是本机生成的），但没有远程来源
      expect(directiveOf(csp, 'img-src')).toBe("'self' data: blob:")
    }
  })

  it('没有 upgrade-insecure-requests（会打断受支持的回环地址代理）', () => {
    for (const mode of CSP_MODES) {
      expect(buildCsp(mode)).not.toContain('upgrade-insecure-requests')
    }
  })

  it('meta 版只少一条 frame-ancestors，其余与响应头版逐字一致（步骤14 修正）', () => {
    for (const mode of CSP_MODES) {
      const full = buildCsp(mode)
      const meta = buildMetaCsp(mode)
      // 浏览器会在 meta 里忽略 frame-ancestors 并打印一条控制台报错，所以 meta 版不带它
      expect(directiveOf(full, 'frame-ancestors')).toBe("'none'")
      expect(directiveOf(meta, 'frame-ancestors')).toBeNull()
      expect(meta).not.toContain('frame-ancestors')
      // 除它之外逐字相同：把 meta 版加回那一条，必须还原成完整策略
      const parts = meta.split('; ')
      const insertAt = parts.indexOf("frame-src 'none'") + 1
      const restored = [...parts.slice(0, insertAt), "frame-ancestors 'none'", ...parts.slice(insertAt)]
      expect(restored.join('; ')).toBe(full)
      // 覆盖值也要照常进入 meta 版
      expect(directiveOf(buildMetaCsp('ai', 'https://proxy.example.com'), 'connect-src')).toBe(
        'https://proxy.example.com',
      )
    }
  })

  it('模式判定只认 local / ai', () => {
    expect(isCspMode('local')).toBe(true)
    expect(isCspMode('ai')).toBe(true)
    expect(isCspMode('production')).toBe(false)
    expect(isCspMode(undefined)).toBe(false)
  })
})

describe('步骤13：自建代理的显式覆盖入口', () => {
  it('只接受一个精确的 https origin（规范化后再比较）', () => {
    expect(normalizeCspConnectSrc('https://proxy.example.com')).toBe('https://proxy.example.com')
    expect(normalizeCspConnectSrc('  https://Proxy.Example.com:8443/  ')).toBe(
      'https://proxy.example.com:8443',
    )
  })

  it('通配符 / 协议级 / http / 带路径的一律拒绝（返回 null，让构建失败）', () => {
    for (const raw of [
      '*',
      'https://*',
      'https://*.example.com',
      'https:',
      'http://proxy.example.com',
      'https://proxy.example.com/chat',
      'https://proxy.example.com?a=1',
      'https://user:pass@proxy.example.com',
      'https://a.example.com https://b.example.com',
      '不是网址',
    ]) {
      expect(normalizeCspConnectSrc(raw), raw).toBeNull()
    }
    expect(normalizeCspConnectSrc(undefined)).toBeNull()
    expect(normalizeCspConnectSrc('   ')).toBeNull()
  })

  it('覆盖值确实进入策略，且仍然没有通配符', () => {
    const csp = buildCsp('ai', 'https://proxy.example.com')
    expect(directiveOf(csp, 'connect-src')).toBe('https://proxy.example.com')
    expect(csp).not.toContain('*')
  })
})

describe('步骤13：_headers 文件（Cloudflare Pages / Netlify）', () => {
  it('包含与代码一致的 CSP 与服务端安全头', () => {
    const file = buildHeadersFile('ai')
    expect(file).toContain('/*')
    expect(file).toContain(`Content-Security-Policy: ${buildCsp('ai')}`)
    for (const header of SECURITY_HEADERS) {
      expect(file).toContain(`${header.name}: ${header.value}`)
    }
    // 本地版的 _headers 同样必须是 none
    expect(buildHeadersFile('local')).toContain(`Content-Security-Policy: ${buildCsp('local')}`)
  })

  it('sw.js 与 index.html 必须不缓存，assets 必须长缓存', () => {
    const file = buildHeadersFile('local')
    const noCachePaths = ['/index.html', '/', '/sw.js', '/manifest.webmanifest']
    for (const path of noCachePaths) {
      expect(file).toContain(`${path}\n  Cache-Control: no-cache`)
    }
    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable')
    // 缓存规则表本身也要与文件一致（唯一的来源）
    expect(CACHE_HEADER_RULES.some((rule) => rule.path === '/sw.js' && rule.value === 'no-cache')).toBe(
      true,
    )
  })

  it('安全头里没有会破坏功能的项（剪贴板写入必须允许 self）', () => {
    const policy = SECURITY_HEADERS.find((header) => header.name === 'Permissions-Policy')
    expect(policy?.value).toContain('clipboard-write=(self)')
    expect(policy?.value).not.toContain('clipboard-write=()')
    expect(policy?.value).not.toContain('*')
    // 不启用 COEP：它会要求所有跨源子资源带 CORP，与托管平台默认值容易冲突
    expect(SECURITY_HEADERS.some((header) => header.name === 'Cross-Origin-Embedder-Policy')).toBe(
      false,
    )
  })
})
