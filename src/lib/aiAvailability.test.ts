// @vitest-environment jsdom
/**
 * 「这一份产物能不能用 AI」的判定（2026-09-27 新增）。
 *
 * 守的是一条**提示语与事实一致**的要求：本地版（`connect-src 'none'`）的界面
 * 不该出现一个点下去必然失败的 AI 入口，更不该在被拦下时说
 * 「可能是网络中断 / DNS / 跨域被拒绝」——那三种都不是，是我们自己按不含 AI 构建的。
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  AI_UNAVAILABLE_NOTE,
  aiBlockedByPageCsp,
  connectSrcOfCspText,
} from './aiAvailability'
import { buildMetaCsp } from './csp'

afterEach(() => {
  document.head.innerHTML = ''
})

function withMetaCsp(content: string): void {
  const meta = document.createElement('meta')
  meta.setAttribute('http-equiv', 'Content-Security-Policy')
  meta.setAttribute('content', content)
  document.head.append(meta)
}

describe('AI 可用性：读页面自己的 meta CSP', () => {
  it('本地版（connect-src \'none\'）判定为「AI 不可用」', () => {
    withMetaCsp(buildMetaCsp('local'))
    expect(aiBlockedByPageCsp(document)).toBe(true)
  })

  it('含 AI 版（精确官方 origin）判定为可用——不做超出事实的猜测', () => {
    withMetaCsp(buildMetaCsp('ai'))
    expect(aiBlockedByPageCsp(document)).toBe(false)
  })

  it('没有 meta CSP（开发服务器 / 测试环境）时按可用处理，不改变既有行为', () => {
    expect(aiBlockedByPageCsp(document)).toBe(false)
    expect(aiBlockedByPageCsp(null)).toBe(false)
  })

  it('只认 connect-src 这一条指令：其他指令里出现 none 不算', () => {
    // 只有 object-src 'none'、没有 connect-src：不能因此判定「AI 不可用」
    expect(connectSrcOfCspText("default-src 'self'; object-src 'none'")).toBeNull()
    expect(connectSrcOfCspText("default-src 'self'; connect-src 'none'")).toBe("'none'")
    expect(connectSrcOfCspText("default-src 'self'")).toBeNull()
    // 自建代理那一档也照实判成「可用」（连不连得上由请求层如实报错）
    withMetaCsp("default-src 'self'; connect-src https://proxy.example.com")
    expect(aiBlockedByPageCsp(document)).toBe(false)
  })

  it('给用户的那句话必须同时说清「为什么不能用」与「本地功能照常」', () => {
    expect(AI_UNAVAILABLE_NOTE).toContain('不含 AI')
    expect(AI_UNAVAILABLE_NOTE).toContain('connect-src')
    expect(AI_UNAVAILABLE_NOTE).toContain('本地功能')
  })
})
