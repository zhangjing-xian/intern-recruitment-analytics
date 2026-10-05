/**
 * 在途请求的互斥与生命周期（AI-4，docs/PRD.md 18.2 / 18.3）。
 *
 * ## 它解决两个具体问题
 *
 * 1. **防双击重复计费（AI02）**：确认令牌只能消费一次，这挡住了「同一份确认点两次」；
 *    但「换了参数重新确认后立刻又点一次」在旧请求还没回来时会发生第二次付费请求。
 *    因此需要一个**全局互斥**：同一时刻只允许一次在途请求，第二次直接拒绝（不是排队——
 *    PRD 18.4 明确「不后台排队」）。
 * 2. **锁定 / 清空 / 切换数据集时中止在途请求**（PRD 16.2：中止在途请求并提升任务版本，
 *    迟到响应不得重新写入）。这里把仓事件接到 `cancel()` 上，并让调用方用一个
 *    **单调递增的世代号**判断「我这次请求还算不算数」。
 *
 * ## 为什么世代号而不是「取消标志」
 *
 * `fetch` 的 `abort()` 是**异步**生效的，await 之后仍可能拿到一个已经解析好的响应。
 * 若只清一个布尔量，就存在「先 abort、后响应到达、响应把已取消的结果写进界面」的窗口。
 * 世代号让「迟到响应」在**比较时**就作废，与 abort 的时序无关。
 *
 * 本模块不依赖 React / Dexie；但它是**有状态**的（模块级单例），因此测试必须显式重置。
 */

import { subscribeVaultEvents } from '../storage/vaultEvents'
import {
  aiRequestError,
  isAiRequestError,
  type AiChatResult,
  type AiRequestError,
} from './aiResult'
import { sendSanitizedAiRequest, type AiInFlightRequest, type AiSendRequest } from './client'

/* ------------------------------------------------------------------ 互斥 */

let inFlight: AiInFlightRequest | null = null

/** 当前是否有请求在途（界面据此禁用按钮并显示「进行中」） */
export function hasInFlightAiRequest(): boolean {
  return inFlight !== null
}

/** 取消在途请求；没有在途请求时是空操作。**不承诺**服务端未处理、也不承诺免收费 */
export function cancelInFlightAiRequest(): void {
  const handle = inFlight
  if (handle === null) {
    return
  }
  // 先清空再 cancel：cancel 可能同步触发 catch 分支，那时不应再看到「在途」状态
  inFlight = null
  handle.cancel()
}

/* ------------------------------------------------------------------ 世代号 */

let generation = 0

/** 当前世代号；每次「中止在途请求」都会 +1 */
export function currentAiRequestGeneration(): number {
  return generation
}

/**
 * 中止在途请求并推进世代号。
 *
 * 调用时机：仓锁定 / 清空 / 会话过期 / 切换数据集 / 清除 AI 历史。
 * 推进世代号的效果是：任何**已经在飞**的响应在比较时都会被判为过期，不会写回。
 */
export function abortInFlightAiRequest(): number {
  generation += 1
  cancelInFlightAiRequest()
  return generation
}

/** 本次请求是否仍然有效（世代号没变就有效） */
export function isAiRequestGenerationCurrent(startedGeneration: number): boolean {
  return startedGeneration === generation
}

/* ------------------------------------------------------------------ 唯一发送入口 */

export type AiSendOutcome =
  | {
      readonly ok: true
      /** 结果是否仍属当前世代；false 表示这是**迟到响应**，调用方必须丢弃 */
      readonly current: boolean
      readonly result: AiChatResult
    }
  | {
      readonly ok: false
      readonly current: boolean
      readonly error: AiRequestError
    }

/**
 * 发送一次请求（**界面唯一入口**）。
 *
 * 不变量：
 * - 同一时刻最多一次在途请求：已在途时**立刻返回 `in-flight` 错误**，不发第二次；
 * - 返回的 `current === false` 表示期间发生过锁定 / 清空 / 切换，调用方**必须丢弃**结果；
 * - 任何失败都收敛成 `AiRequestError`，**没有重试路径**。
 *
 * 刻意**不**在这里校验确认令牌：令牌的消费是 `privacy/aiPreview.ts` 的职责
 * （`consumeConfirmation`），界面必须在调用本函数**之前**消费成功。
 * 本函数只负责「发出去」这件事，因此它的类型里根本没有令牌——想在这里绕过确认也做不到。
 */
export async function sendAiRequestOnce(request: AiSendRequest): Promise<AiSendOutcome> {
  const startedGeneration = generation

  if (inFlight !== null) {
    return {
      ok: false,
      current: true,
      error: aiRequestError({
        kind: 'in-flight',
        message: '已经有一次请求正在进行，因此没有发出第二次。',
        advice: '请等待当前请求结束，或先取消它。本应用不会后台排队，也不会自动重试。',
      }),
    }
  }

  try {
    const result = await sendSanitizedAiRequest(request, {
      register: (handle) => {
        inFlight = handle
      },
    })
    return { ok: true, current: isAiRequestGenerationCurrent(startedGeneration), result }
  } catch (cause) {
    return {
      ok: false,
      current: isAiRequestGenerationCurrent(startedGeneration),
      error: isAiRequestErrorLike(cause)
        ? cause
        : aiRequestError({
            kind: 'network',
            message: '请求失败，且失败原因无法从浏览器侧判定。',
            advice: '请查看开发者工具的「网络」面板确认根因。',
          }),
    }
  } finally {
    // 无论成功失败都释放互斥；若期间被取消过（inFlight 已被清空），这里不会误清别人
    if (inFlight !== null) {
      inFlight = null
    }
  }
}

function isAiRequestErrorLike(value: unknown): value is AiRequestError {
  return isAiRequestError(value)
}

/* ------------------------------------------------------------------ 生命周期 */

/**
 * 把「仓锁定 / 清空 / 会话过期 / 连接关闭」接到中止在途请求上。
 *
 * 为什么必须挂：PRD 16.2 要求「切换数据集 / 锁仓 / 清除历史时中止在途请求并提升任务版本，
 * 迟到响应不得重新写入」。**只清内存 Key 是不够的**——请求已经带着 Key 发出去了，
 * 但它的响应绝不能再写进一个已经锁定的界面。
 *
 * 返回卸载函数；应用外壳挂载一次（与 `mountAiKeySessionGuards` 并列）。
 */
export function mountAiRequestGuards(): () => void {
  return subscribeVaultEvents((event) => {
    if (
      event.type === 'locked' ||
      event.type === 'cleared' ||
      event.type === 'stale-session' ||
      event.type === 'connection-closed'
    ) {
      abortInFlightAiRequest()
    }
  })
}

/** 供测试重置模块级状态（避免测试之间互相影响） */
export function resetAiRequestStateForTests(): void {
  inFlight = null
  generation = 0
}
