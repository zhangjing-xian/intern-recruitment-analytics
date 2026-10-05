/**
 * AI API Key 的**会话内存槽位**（AI-3，docs/PRD.md 18.2）。
 *
 * ## 为什么是模块级单例 + 订阅，而不是 React state
 *
 * Key 有**四个**地方要用它：设置页（输入 / 显示状态）、看板 AI 工作区（判断「有没有 Key」）、
 * 预览面板（显示「Key 将只在 Authorization 头里发送」）、以及 AI-4 的网络适配器（真正取值）。
 * 如果各处自己 `useState`，就会出现「设置页删了 Key，看板还以为有」这种两份真相。
 * 因此内存里只有**一份**，界面通过订阅读取；`clearAiKeySession()` 是唯一的清空点
 * （锁定、删 Key、清全部都会调它）。
 *
 * ## 五条硬纪律（AI10 / AI11 的基础）
 *
 * 1. **默认只在内存**：本模块**不碰任何存储**（无 IndexedDB / localStorage / sessionStorage /
 *    Cookie / Cache），也不写日志、不写 `VITE_*`、不进 URL；
 * 2. **加密保存是另一条路**：把 Key 持久化必须由设置页显式勾选，并走加密仓的秘密槽位
 *    （`encryptedVault.saveSecret`），密钥与业务数据密钥不同；
 * 3. **锁仓即清内存**：`subscribeKeyState` 的既有机制在锁定时丢弃 `CryptoKey`；
 *    本模块同样在收到锁定 / 清空 / 会话过期事件时清掉内存 Key，**但不动加密仓里的那一份**
 *    （那由用户显式「删除 Key」负责）；
 * 4. **绝不回显完整 Key**：界面只能拿 `maskApiKey` 的结果（前 3 后 4），
 *    连预览面板、错误信息、导出报告都只能用它；
 * 5. **许可按端点绑定**：记住「用户同意把 Key 发到哪个 origin」，换地址即失效（PRD 18.2）。
 *
 * 本模块不依赖 React / Dexie / 网络，可被界面与（未来的）网络适配器安全引用。
 */

import { subscribeVaultEvents } from '../storage/vaultEvents'
import { type AiDestination, type AiKeyPermission } from './catalog'

/** 内存中的一份 Key（`value` 是唯一持有明文的地方） */
export type AiKeySession = {
  readonly value: string
  readonly savedAt: string
  /** 用户授权把 Key 发往哪个端点；null = 尚未授权（此时不允许发送，AI-4 会拒绝） */
  readonly permission: AiKeyPermission | null
}

/**
 * 对外只读快照：**没有 `value` 字段**。
 *
 * 这是刻意的类型设计：界面拿到的类型里根本没有明文 Key 的位置，
 * 因此「不小心把 Key 渲染出来」会变成**类型错误**，而不是靠代码审查发现。
 * 只有 `readAiKeyForRequest()` 能取到明文，且它的名字就写明用途。
 */
export type AiKeySnapshot = {
  readonly present: boolean
  readonly savedAt: string | null
  readonly permission: AiKeyPermission | null
}

const EMPTY_SNAPSHOT: AiKeySnapshot = { present: false, savedAt: null, permission: null }

let session: AiKeySession | null = null
const listeners = new Set<(snapshot: AiKeySnapshot) => void>()

function snapshotOf(value: AiKeySession | null): AiKeySnapshot {
  return value === null
    ? EMPTY_SNAPSHOT
    : { present: true, savedAt: value.savedAt, permission: value.permission }
}

function broadcast(): void {
  const snapshot = snapshotOf(session)
  for (const listener of [...listeners]) {
    try {
      listener(snapshot)
    } catch {
      // 监听器异常不能影响 Key 状态本身（与 vaultEvents 的处理一致）
    }
  }
}

/* ------------------------------------------------------------------ 读取 */

/** 当前快照（界面用；**不含明文**） */
export function readAiKeySnapshot(): AiKeySnapshot {
  return snapshotOf(session)
}

/**
 * 取明文 Key 供**请求认证**使用（AI-4 的唯一入口）。
 *
 * 名字刻意写全 `ForRequest`：让人在 code review 时一眼看出这是「要发出去的」那条路，
 * 而不是一个随便能调的 `getKey()`。返回 `null` 表示没有可用 Key，
 * 调用方应提示「先配置 Key」，而**不是**发一个空 Authorization。
 */
export function readAiKeyForRequest(): string | null {
  return session === null ? null : session.value
}

/* ------------------------------------------------------------------ 写入 */

/**
 * 设定内存 Key。
 *
 * 空白值拒绝（与 `saveVaultSecret` 的 `invalid-input` 一致）：空 Key 会造出
 * 「看起来配好了但一发就 401」的状态，不如直接拒绝。
 */
export function setAiKeySession(
  value: string,
  savedAt: string,
  permission: AiKeyPermission | null = null,
): void {
  const trimmed = value.trim()
  if (trimmed === '') {
    throw new Error('API Key 不能为空')
  }
  session = { value: trimmed, savedAt, permission }
  broadcast()
}

/**
 * 授权把当前 Key 发往某个端点（PRD 18.2 的「Key 许可按端点绑定」）。
 *
 * 没有 Key 时是空操作：授权一个不存在的 Key 没有意义，也不该造出「已授权」的假状态。
 */
export function grantAiKeyPermission(destination: AiDestination, grantedAt: string): void {
  if (session === null) {
    return
  }
  session = { ...session, permission: { origin: destination.origin, grantedAt } }
  broadcast()
}

/**
 * 撤销 Key 许可（AI-6）：把许可清成 `null`，Key 本身**不动**。
 *
 * 什么时候用：用户改了代理地址，旧地址的授权必须失效（PRD 18.6「改地址即撤销原授权」）。
 * 只清许可、不清 Key 是刻意的——用户可能只是想换个端点继续用同一把 Key，
 * 顺手丢掉 Key 会让「改个地址」变成破坏性操作（与「关闭 AI 不删 Key」同一口径）。
 *
 * 返回是否真的撤销了（界面据此决定要不要提示「旧许可已失效」）。
 */
export function revokeAiKeyPermission(): boolean {
  if (session === null || session.permission === null) {
    return false
  }
  session = { ...session, permission: null }
  broadcast()
  return true
}

/**
 * 地址变更时撤销许可：**当前许可指向的 origin 与新地址不同**才撤销。
 *
 * 为什么按 origin 比而不是按整个地址串：许可本来就按 origin 绑定
 * （`catalog.ts` 的 `keyPermissionCovers`），路径是固定常量；把路径算进比较会让
 * 「同一个服务方换个路径」也被当成换地址，那不是用户能感知的边界。
 */
export function revokeAiKeyPermissionIfOriginChanged(origin: string): boolean {
  if (session === null || session.permission === null) {
    return false
  }
  if (session.permission.origin === origin) {
    return false
  }
  return revokeAiKeyPermission()
}

/* ------------------------------------------------------------------ 清空 */

/**
 * 清空内存 Key（**唯一清空点**）。
 *
 * 调用时机：用户点「删除内存中的 Key」、锁定、清空本地仓、删 Key。
 * 它**不碰**加密仓里的那一份——那是 `deleteAiKeyEverywhere()` 的职责，
 * 这样「锁定」不会顺手把用户加密保存的 Key 删掉（PRD 18.2：删 Key 是独立操作）。
 */
export function clearAiKeySession(): void {
  if (session === null) {
    return
  }
  session = null
  broadcast()
}

/**
 * 订阅快照变化。
 *
 * 订阅时**立刻回放一次当前状态**（避免界面首帧显示成「没有 Key」），
 * 且这一次回放与后续广播一样**对回调异常免疫**：一个坏掉的订阅者不该让
 * `subscribeAiKeyState` / `setAiKeySession` 抛错——否则调用方会以为「设置 Key 失败」，
 * 而实际上 Key 已经写进去了。这条与 `vaultEvents` 的处理保持一致。
 */
export function subscribeAiKeyState(listener: (snapshot: AiKeySnapshot) => void): () => void {
  listeners.add(listener)
  try {
    listener(snapshotOf(session))
  } catch {
    // 订阅者自身的问题：不影响订阅关系，也不影响 Key 状态
  }
  return () => {
    listeners.delete(listener)
  }
}

/* ------------------------------------------------------------------ 锁定联动 */

/**
 * 把「仓锁定 / 清空」接到清内存 Key 上（应用外壳挂载时调一次）。
 *
 * 为什么需要它：`crypto` 的密钥槽位有自己的锁定通知，但**AI Key 与仓密钥是两条独立的
 * 生命周期**（PRD 18.2），所以这里显式订阅仓事件。返回卸载函数。
 */
export function mountAiKeySessionGuards(): () => void {
  return subscribeVaultEvents((event) => {
    if (
      event.type === 'locked' ||
      event.type === 'cleared' ||
      event.type === 'stale-session' ||
      event.type === 'connection-closed'
    ) {
      clearAiKeySession()
    }
  })
}

/* ------------------------------------------------------------------ 安全展示 */

/** 掩码 Key 的最短可显示长度：太短就完全不显示（只回一个占位符） */
const MASK_PREFIX = 3
const MASK_SUFFIX = 4
const MASK_MIN_LENGTH = MASK_PREFIX + MASK_SUFFIX + 1

/**
 * 掩码：`sk-abc…wxyz` 形式，只保留前 3 后 4。
 *
 * 为什么这么短：掩码的目的是让用户确认「填的是哪一把」，不是方便核对内容。
 * 露出更多字符只会增加肩窥与日志泄漏的风险。长度不足时返回固定占位符，
 * **绝不**因为「太短就全显示」而把短 Key 原样输出。
 */
export function maskApiKey(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    return '（未填写）'
  }
  if (trimmed.length < MASK_MIN_LENGTH) {
    return '（已填写，长度不足以安全显示掩码）'
  }
  return `${trimmed.slice(0, MASK_PREFIX)}…${trimmed.slice(-MASK_SUFFIX)}`
}

/** 快照 → 掩码后的展示文本（**界面唯一的显示入口**，快照本身不含明文） */
export function describeAiKey(snapshot: AiKeySnapshot): string {
  if (!snapshot.present) {
    return '当前没有可用的 API Key'
  }
  return `已配置 Key（${snapshot.savedAt === null ? '保存时间未知' : snapshot.savedAt}）`
}

/**
 * Key 的**本地**格式检查（AI-3 允许做的唯一校验；**不探活**）。
 *
 * 三条规则都是「明显不像 Key」的情形，命中即在界面提示，但不阻断保存
 * （官方没有公布 Key 的固定格式，按格式拒绝会误伤合法 Key）：
 * 含空白、过短、明显是占位符。
 *
 * 明确**不做**的事：不发任何请求验证有效性、不查余额、不查模型列表（PRD 18.1 / AI01）。
 */
export type AiKeyFormatCheck = {
  readonly ok: boolean
  readonly problem: string | null
}

export function checkApiKeyFormat(value: string): AiKeyFormatCheck {
  const trimmed = value.trim()
  if (trimmed === '') {
    return { ok: false, problem: '请填写 API Key。' }
  }
  if (/\s/.test(trimmed)) {
    return { ok: false, problem: 'API Key 里不应包含空格或换行，请检查是否复制多了字符。' }
  }
  if (trimmed.length < 16) {
    return { ok: false, problem: '这个值明显偏短，不像一个 API Key；请确认复制完整。' }
  }
  const placeholder = /^(your|test|demo|example|placeholder|xxx|abc)/i
  if (placeholder.test(trimmed)) {
    return {
      ok: false,
      problem: '这个值看起来是占位符而不是真实 Key。本应用不会用示例 Key 做任何请求，请填你自己的 Key。',
    }
  }
  return { ok: true, problem: null }
}

/** 供测试与「清空全部」使用：把广播机制也重置（避免测试之间互相影响） */
export function resetAiKeySessionForTests(): void {
  session = null
  listeners.clear()
}
