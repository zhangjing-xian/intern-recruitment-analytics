/**
 * 「确认并调用」的结果与发送接缝（AI-4）。
 *
 * ## 为什么这三个名字要有独立的模块
 *
 * `AiSubmitOutcome` / `AiSubmitClient` / 默认客户端被**预览面板**与**工作区**同时使用，
 * 而面板本就由工作区渲染。把它们留在任一侧都会造成「A 导 B、B 导 A」的循环，
 * 或者一份定义被复制两遍（两份真相，早晚不一致）。因此放在这个中性模块里。
 *
 * ## 结果为什么有这么多状态
 *
 * 它们对应**用户需要做的不同事**：
 * - `rejected`：你还没确认，或确认已过期 —— 重新看预览即可（**没有请求发生过**）；
 * - `sent`：成功拿到结果；`current === false` 表示这是**迟到响应**，必须丢弃；
 * - `failed`：请求发出过但失败了 —— 按 `error.kind` 决定下一步，且**没有重试按钮**
 *   （要重试只能重新预览并确认，PRD 18.4「不自动重试」）；
 * - `cancelling`：本地已停止等待（可能已产生费用，**不承诺**免收费）。
 *
 * 把它们压成一个错误字符串会丢掉这些差别，而界面上的按钮与提示正是由它们决定的。
 */

import {
  cancelInFlightAiRequest,
  hasInFlightAiRequest,
  sendAiRequestOnce,
  type AiSendOutcome,
} from '../../ai/aiClient'
import type { AiChatResult, AiRequestError } from '../../ai/aiResult'
import type { AiSendRequest } from '../../ai/client'

export type AiSubmitOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'rejected'; readonly reason: string }
  | { readonly kind: 'cancelling' }
  | {
      readonly kind: 'sent'
      readonly result: AiChatResult
      /** 结果是否仍属当前世代；false = 迟到响应，界面必须丢弃并不展示 */
      readonly current: boolean
    }
  | { readonly kind: 'failed'; readonly error: AiRequestError; readonly current: boolean }

/**
 * 发送接缝的接口形态。
 *
 * `cancel` 是独立方法而不是让组件持有 `AbortSignal`：这样组件依然**不含**
 * 任何请求管道字段（守卫测试会检查 `headers` / `credentials` / `AbortController` / `signal`
 * 不出现在 `features/ai/` 里），「取消」这件事的细节全部留在 `src/ai/`。
 * 做成可注入的接口还有一个直接收益：组件测试能**在不发任何请求**的前提下
 * 精确数出「未确认 0 次 / 确认恰好 1 次」以及传进去的正文。
 */
export type AiSubmitClient = {
  readonly sendOnce: (request: AiSendRequest) => Promise<AiSendOutcome>
  readonly cancel: () => void
  readonly isInFlight: () => boolean
}

/**
 * 默认客户端：真实适配器（唯一出站路径所在的模块）。
 *
 * 这是全应用**唯一**把界面接到网络的地方；`features/ai/**` 里的任何文件都不允许
 * 自己写 `fetch`，守卫测试会逐行扫描并在命中时失败。
 */
export const DEFAULT_AI_SUBMIT_CLIENT: AiSubmitClient = {
  sendOnce: sendAiRequestOnce,
  cancel: cancelInFlightAiRequest,
  isInFlight: hasInFlightAiRequest,
}
