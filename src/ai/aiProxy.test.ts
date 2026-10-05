/**
 * AI-6 单测：代理地址校验与边界（`src/ai/aiProxy.ts`）。
 *
 * 这一层的输入会变成**请求的目的地**，所以校验本身就是安全边界。测试盯三件事：
 * 1. 非法地址一条都不放行（非 https（回环除外）、带凭据、带路径 / 查询串 / 片段）；
 * 2. 合法地址被**规范化**（大小写、末尾斜杠、默认端口），否则「改地址要撤销授权」
 *    会被排版差异绕过；
 * 3. 边界文案里必须出现「代理能看到 Key 与摘要」「本仓库不提供代理程序」
 *    「改地址撤销授权」「不放开任意域」这些事实——它们是对用户的承诺，不能只写在注释里。
 *
 * `src/ai/aiProxy.ts` 是纯函数层：本文件不发任何请求，也不碰存储。
 */

import { describe, expect, it } from 'vitest'

import {
  AI_CHAT_PATH,
  AI_OFFICIAL_ORIGIN,
  AI_PROXY_ACKNOWLEDGEMENTS,
  AI_PROXY_BOUNDARY_ITEMS,
  AI_PROXY_INVALID_NOTE,
  aiProxyDestinationOf,
  isLoopbackHost,
  parseAiProxyOrigin,
} from './aiProxy'

describe('AI-6：代理地址校验', () => {
  it('接受 https 地址并规范化（大小写、末尾斜杠、默认端口都折叠掉）', () => {
    expect(parseAiProxyOrigin('https://proxy.example.com')).toEqual({
      ok: true,
      origin: 'https://proxy.example.com',
    })
    expect(parseAiProxyOrigin('  https://Proxy.Example.com/  ')).toEqual({
      ok: true,
      origin: 'https://proxy.example.com',
    })
    expect(parseAiProxyOrigin('https://proxy.example.com:443')).toEqual({
      ok: true,
      origin: 'https://proxy.example.com',
    })
    expect(parseAiProxyOrigin('https://proxy.example.com:8787')).toEqual({
      ok: true,
      origin: 'https://proxy.example.com:8787',
    })
  })

  it('只有回环地址允许 http（本机代理的流量不出机器）', () => {
    expect(parseAiProxyOrigin('http://127.0.0.1:8787')).toEqual({
      ok: true,
      origin: 'http://127.0.0.1:8787',
    })
    expect(parseAiProxyOrigin('http://localhost:8787')).toEqual({
      ok: true,
      origin: 'http://localhost:8787',
    })
    const external = parseAiProxyOrigin('http://proxy.example.com')
    expect(external.ok).toBe(false)
    if (!external.ok) {
      expect(external.problem).toContain('https')
    }
  })

  it('拒绝带凭据 / 路径 / 查询串 / 片段的地址', () => {
    for (const raw of [
      'https://user:pass@proxy.example.com',
      'https://proxy.example.com/v1',
      'https://proxy.example.com/?target=api.deepseek.com',
      'https://proxy.example.com/#x',
    ]) {
      expect(parseAiProxyOrigin(raw).ok, raw).toBe(false)
    }
  })

  it('拒绝空值、带空白的值与非网址', () => {
    for (const raw of ['', '   ', 'proxy.example.com', 'not a url', 'https://a b c']) {
      expect(parseAiProxyOrigin(raw).ok, JSON.stringify(raw)).toBe(false)
    }
  })

  it('目的地路径固定为 /chat/completions，不由用户填写', () => {
    expect(aiProxyDestinationOf('https://proxy.example.com')).toEqual({
      origin: 'https://proxy.example.com',
      path: AI_CHAT_PATH,
    })
    expect(AI_CHAT_PATH).toBe('/chat/completions')
    expect(AI_OFFICIAL_ORIGIN).toBe('https://api.deepseek.com')
  })

  it('回环判定只认本机写法', () => {
    expect(isLoopbackHost('localhost')).toBe(true)
    expect(isLoopbackHost('127.0.0.1')).toBe(true)
    expect(isLoopbackHost('LocalHost')).toBe(true)
    expect(isLoopbackHost('127.0.0.2')).toBe(false)
    expect(isLoopbackHost('proxy.example.com')).toBe(false)
  })
})

describe('AI-6：代理边界文案（对外承诺，逐条钉住）', () => {
  it('必须写明代理能看到 Key 与摘要、不提供代理程序、改地址撤销授权、不放开任意域', () => {
    const joined = AI_PROXY_BOUNDARY_ITEMS.join('\n')
    expect(joined).toContain('代理能看到 API Key 与脱敏摘要原文')
    expect(joined).toContain('本仓库不提供任何代理程序')
    expect(joined).toContain('不由网站运营方托管代理')
    expect(joined).toContain('公开的 CORS 代理一律不要用')
    expect(joined).toContain('旧 Key 不会被自动转发到新地址')
    expect(joined).toContain('connect-src')
    expect(joined).toContain('不放开任意域')
    expect(joined).toContain('不配置代理时全部本地功能完全可用')
    expect(joined).toContain('不做探活')
  })

  it('确认项覆盖三条关键风险，且都是「我」的主动确认', () => {
    expect(AI_PROXY_ACKNOWLEDGEMENTS.length).toBe(3)
    const joined = AI_PROXY_ACKNOWLEDGEMENTS.join('\n')
    expect(joined).toContain('代理能看到我的 API Key')
    expect(joined).toContain('由我自己控制')
    expect(joined).toContain('公共 CORS 代理')
    expect(joined).toContain('改地址会撤销旧地址的授权')
    expect(joined).toContain('CSP 只放行官方地址')
  })

  it('文案里没有 Markdown 强调标记（会原样渲染成星号）', () => {
    for (const text of [
      ...AI_PROXY_BOUNDARY_ITEMS,
      ...AI_PROXY_ACKNOWLEDGEMENTS,
      AI_PROXY_INVALID_NOTE,
    ]) {
      expect(text).not.toContain('**')
      expect(text).not.toContain('__')
    }
  })
})
