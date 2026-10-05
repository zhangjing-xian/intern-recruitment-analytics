/**
 * 本地 / 自有代理的**显式配置边界**（AI-6，docs/PRD.md 18.6）。
 *
 * ## 这一层刻意很小，而且刻意不写代理程序
 *
 * PRD 18.6 对代理的要求只有三条，本模块逐条对应：
 * 1. **不由网站运营方托管代理**：本仓库**不提供**任何代理程序（没有服务端、没有 Worker
 *    中转、没有公共 CORS 代理），本文件只有地址校验与说明文字；
 * 2. **提示代理可见 Key 与摘要**：用户登记的代理是请求的接收方，它能看到
 *    `Authorization` 头里的 Key 与脱敏摘要原文——这一点必须在用户登记**之前**说清；
 * 3. **改地址即撤销原授权、不转发旧 Key**：Key 许可按 origin 绑定（`catalog.ts` 的
 *    `keyPermissionCovers`），换地址后旧许可不覆盖新地址，因此旧 Key 不会被自动转发。
 *    本模块负责把「旧地址」解析出来交给调用方撤销，**不**负责发请求。
 *
 * ## 为什么地址校验必须严格
 *
 * 这一层的输入会变成**请求的目的地**，因此校验本身就是安全边界：
 * - 只接受 `https:`；唯一的例外是回环地址上的 `http:`（本机代理，流量不出机器）；
 * - 不接受带用户名密码、查询串、片段、非根路径的地址——那类写法要么是把凭据塞进 URL，
 *   要么是把「路径」偷偷改了（端点是固定的 `/chat/completions`，见 `aiRequest`）；
 * - 不接受通配符 / 多主机 / 裸主机名以外的灵活写法：**这里不是 URL 模板引擎**。
 *
 * 本模块是纯函数层：不依赖 React / DOM / 网络 / 存储，**不发起任何请求**。
 */

import type { AiDestination } from '../privacy/aiPreview'

/** 官方端点（默认目的地）；登记代理之前一切请求都发往它 */
export const AI_OFFICIAL_ORIGIN = 'https://api.deepseek.com'
/** 请求路径：无论目的地是官方还是代理，路径都是这一个（真实适配器按它拼 URL） */
export const AI_CHAT_PATH = '/chat/completions'

export type AiProxyParseResult =
  | { readonly ok: true; readonly origin: string }
  | { readonly ok: false; readonly problem: string }

/** 回环地址：只有这两种主机名允许用 `http:`（本机代理的流量不出机器） */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
}

/**
 * 解析并校验用户登记的代理地址（唯一入口）。
 *
 * 返回规范化后的 **origin**（协议 + 主机 + 端口），而不是原样回传输入：
 * 回传原样会让 `https://Proxy.Example.com/` 与 `https://proxy.example.com`
 * 被当成两个不同的地址，于是「改了地址要撤销授权」这条规则会被排版差异绕过。
 */
export function parseAiProxyOrigin(raw: string): AiProxyParseResult {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return { ok: false, problem: '请填写代理地址，例如 https://proxy.example.com（可以带端口）。' }
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, problem: '地址里不应包含空格或换行，请检查是否复制多了字符。' }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, problem: '这不是一个合法的网址：需要写成 https://主机名（可带端口）的形式。' }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, problem: '地址里不允许带用户名或密码：凭据只能通过 Authorization 头发送。' }
  }
  const loopback = isLoopbackHost(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    return {
      ok: false,
      problem: '只接受 https 地址；仅本机回环地址（localhost / 127.0.0.1）可以用 http，因为那种流量不出这台机器。',
    }
  }
  if (url.search !== '' || url.hash !== '') {
    return { ok: false, problem: '地址里不允许带查询串或片段：请求路径由本应用固定为 /chat/completions。' }
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    return {
      ok: false,
      problem: '地址里不允许带路径：请只填到主机（可带端口），路径由本应用固定为 /chat/completions。',
    }
  }
  if (url.hostname === '') {
    return { ok: false, problem: '地址缺少主机名。' }
  }
  return { ok: true, origin: url.origin }
}

/** 把登记好的 origin 变成目的地（路径固定，与官方端点同一条） */
export function aiProxyDestinationOf(origin: string): AiDestination {
  return { origin, path: AI_CHAT_PATH }
}

/**
 * 代理的可见范围与边界（**必须整段展示**，不能只给一句「支持自建代理」）。
 *
 * 三条写作纪律：
 * - 说清**代理能看到什么**（Key 与摘要原文），而不是只说「更安全 / 更灵活」；
 * - 说清**本仓库不提供什么**（不提供代理程序、不由运营方托管），避免用户以为登记一下就有代理可用；
 * - 说清**CSP 边界**：本构建只放行官方地址，接入代理需要你自己构建并显式调整 CSP——
 *   这一步**不放开任意域**（否则等于把「只有确认后才发一次」的承诺换成「随便连哪都行」）。
 */
export const AI_PROXY_BOUNDARY_ITEMS: readonly string[] = [
  '代理能看到 API Key 与脱敏摘要原文：请求的 Authorization 头与请求正文都要经过它。因此只应使用你自己控制的、可信的代理，并且它必须遵守与你相同的保密要求。',
  '本仓库不提供任何代理程序，也不由网站运营方托管代理：你需要自己搭建与运维，可用性与合规由你负责。公开的 CORS 代理一律不要用——那等于把 Key 与摘要交给陌生人。',
  '改变登记的地址会立即撤销旧地址上的 Key 许可：许可按 origin 绑定，旧 Key 不会被自动转发到新地址（要发就往新地址重新授权一次）。',
  '这个地址不会被静默使用：本应用只在用户逐次确认的那一次请求里使用当前目的地，且路径固定为 /chat/completions，不做探活、不做预检试连。',
  '生产构建的内容安全策略（CSP）只放行官方地址；要真正把请求发往自建代理，需要你自己构建并在 CSP 的 connect-src 里显式加入该地址。本步骤不放开任意域，也不提供放宽 CSP 的开关。',
  '不配置代理时全部本地功能完全可用：代理只是可选出站路径的替代方案，与导入、清洗、看板、拒 offer 专项与导出无关。',
]

/** 登记代理前必须逐条确认的边界（与上面的清单同一份事实，只是短句形式） */
export const AI_PROXY_ACKNOWLEDGEMENTS: readonly string[] = [
  '我知道代理能看到我的 API Key 与脱敏摘要原文。',
  '我确认这个地址由我自己控制，不由本站运营方托管，也不是公共 CORS 代理。',
  '我知道改地址会撤销旧地址的授权，且本构建的 CSP 只放行官方地址。',
]

export const AI_PROXY_INVALID_NOTE =
  '地址不合法时不会保存，也不会被使用：非法输入在这里被拒绝，而不是等请求失败后才让你猜原因。'
