import { describe, expect, it } from 'vitest'

import { errorKindOfCode } from './aiResult'

/**
 * 服务端错误分类的判定顺序（`docs/DECISIONS.md` D-098）。
 *
 * 这一组用例守的是一次**真实误诊**：用户拿一把无效 Key 试了一次，
 * DeepSeek 回的是 `HTTP 401 + code: "invalid_request_error"`（`type: "authentication_error"`），
 * 而旧实现「`code` 优先」把它判成「请求参数被服务端拒绝」——提示语与事实不符，
 * 用户会去反复调模型与参数。因此判定顺序被固定成：
 * **401 / 402 / 429 三个状态优先 → `type` → `code` → 其余状态兜底**。
 */
describe('AI 错误分类：状态 / 类型 / 错误码的判定顺序', () => {
  it('401 一律是认证失败，即使 code 写着 invalid_request_error（真实发生的组合）', () => {
    expect(errorKindOfCode('invalid_request_error', 401, 'authentication_error')).toBe('auth')
    // 有些网关只给 code、不给 type：状态仍必须赢
    expect(errorKindOfCode('invalid_request_error', 401)).toBe('auth')
    expect(errorKindOfCode(null, 401)).toBe('auth')
  })

  it('402 与 429 同理：状态与语义一一对应，不被 code 带偏', () => {
    expect(errorKindOfCode('invalid_request_error', 402)).toBe('balance')
    expect(errorKindOfCode('invalid_request_error', 429)).toBe('rate-limit')
  })

  it('非上述状态时，type 与 code 仍然优先于状态', () => {
    // 官方把个别余额问题放在 422：仍按语义判成余额
    expect(errorKindOfCode('insufficient_balance', 422)).toBe('balance')
    expect(errorKindOfCode(null, 422, 'insufficient_balance')).toBe('balance')
    // 400 + 明确的认证类型：也认
    expect(errorKindOfCode('invalid_request_error', 400, 'authentication_error')).toBe('auth')
    // 只有状态可用时，按状态兜底
    expect(errorKindOfCode(null, 400)).toBe('invalid-params')
    expect(errorKindOfCode(null, 422)).toBe('invalid-params')
    expect(errorKindOfCode(null, 404)).toBe('model-unavailable')
    expect(errorKindOfCode(null, 500)).toBe('server')
    expect(errorKindOfCode(null, 418)).toBe('http')
  })

  it('模型不存在与限速的错误码照旧认得', () => {
    expect(errorKindOfCode('model_not_found', 400)).toBe('model-unavailable')
    expect(errorKindOfCode('rate_limit_exceeded', 400)).toBe('rate-limit')
    expect(errorKindOfCode('server_error', 400)).toBe('server')
  })
})
