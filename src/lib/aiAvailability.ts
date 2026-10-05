/**
 * 「这一份页面能不能用 AI」的唯一判定点（2026-09-27 新增）。
 *
 * ## 为什么需要它
 *
 * 本项目有三种产物，其中**本地版**与**含 AI 版**的差别只有一条 CSP：
 *
 * | 构建 | `connect-src` | 结果 |
 * |---|---|---|
 * | `npm run build`（本地版） | `'none'` | 页面**没有任何出站能力**，AI 请求会被浏览器直接拦下 |
 * | `npm run build:ai`（含 AI 版） | 精确 `https://api.deepseek.com` | AI 可用（仍需逐次确认） |
 *
 * 但界面以前**两版一模一样**：本地版里照样能看到「AI 深度分析」按钮、能打开开关、
 * 能生成预览，直到点下确认才被 CSP 拦下，并收到一句「可能是网络中断、DNS / TLS 问题，
 * 也可能是跨域预检被拒绝」——**这句话在本地版里是错的**：既不是网络问题也不是跨域问题，
 * 是我们自己按不含 AI 构建的。
 *
 * 把公开部署（腾讯云 / EdgeOne 等）的每一位访客都引到这条死路上，是「提示语必须与事实一致」
 * 不允许的。因此这里**读页面自己的 meta CSP**（构建时注入，`src/lib/csp.ts` 是唯一来源），
 * 判断这一份产物到底有没有出站能力。
 *
 * ## 为什么不看构建模式变量
 *
 * `import.meta.env.MODE` 在测试环境里是 `test`、在预览里是别的值，
 * 拿它当判据会让单元测试与真实产物不一致；而 CSP 是**产物里真实存在的那一份**，
 * 读它等于读事实。测试里没有 meta 标签 → 返回 `false`（按「AI 可用」处理，不改变既有用例）。
 *
 * 本模块是纯函数层：只读传入的 `Document`，不发请求、不写存储。
 */
import { CSP_META_SELECTOR } from './csp'

/** 从一段 CSP 文本里取出 `connect-src` 的取值（没有该指令时返回 `null`） */
export function connectSrcOfCspText(csp: string): string | null {
  for (const directive of csp.split(';')) {
    const trimmed = directive.trim()
    if (trimmed.toLowerCase().startsWith('connect-src')) {
      return trimmed.slice('connect-src'.length).trim()
    }
  }
  return null
}

/**
 * 这一份页面是否**因为自身 CSP 而无法**发起 AI 请求。
 *
 * 判据只有一条：`connect-src` 恰好是 `'none'`（本地版构建）。任何其他取值
 * （官方端点、自建代理、指令缺失）都返回 `false`——**不做猜测**：
 * 「能不能真的连上」还取决于网络与对方的 CORS，那是另一件事，由请求层如实报错。
 */
export function aiBlockedByPageCsp(doc?: Document | null): boolean {
  const target = doc ?? (typeof document === 'undefined' ? null : document)
  if (target === null || typeof target.querySelector !== 'function') {
    return false
  }
  const meta = target.querySelector(CSP_META_SELECTOR)
  const content = meta?.getAttribute('content') ?? null
  if (content === null || content.trim() === '') {
    return false
  }
  return connectSrcOfCspText(content) === "'none'"
}

/** 给界面用的一句话（三处共用同一份文案，避免三种说法） */
export const AI_UNAVAILABLE_NOTE =
  '这一份页面是按「不含 AI」构建的：它的安全策略里 connect-src 是 none，' +
  '因此浏览器层面就不具备对外发送能力。本地功能（导入、清洗、看板、拒 offer 专项、导出）全部照常可用，' +
  '数据始终只在你的浏览器里处理。需要用 AI 深度分析，请使用含 AI 的那一份构建。'
