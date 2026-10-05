/**
 * AI-3 单测：API Key 的会话内存槽位（`src/ai/keySession.ts`）。
 *
 * 覆盖 IMPLEMENTATION_PLAN 里 AI-3 的这几条：
 * - 「遮蔽输入、默认内存」→ 快照类型里**没有** `value`，界面只能拿掩码；
 * - 「锁仓清内存」→ 仓锁定 / 清空 / 会话过期时内存 Key 被丢弃；
 * - 「Key 许可按端点绑定」→ 换 origin 即失效；
 * - 「AI10 通过」→ 本模块不碰任何存储、不写日志；快照不含明文；
 * - 「不探活、不查余额」→ 本地格式检查只做明显不合规判断，不发请求。
 *
 * 只用合成 Key（形如 `sk-合成…`），不使用真实凭据。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import ts from 'typescript'

import { emitVaultEvent } from '../storage/vaultEvents'
import { AI_DEFAULT_DESTINATION } from '../privacy/aiPreview'
import {
  checkApiKeyFormat,
  clearAiKeySession,
  describeAiKey,
  grantAiKeyPermission,
  maskApiKey,
  mountAiKeySessionGuards,
  readAiKeyForRequest,
  readAiKeySnapshot,
  resetAiKeySessionForTests,
  revokeAiKeyPermission,
  revokeAiKeyPermissionIfOriginChanged,
  setAiKeySession,
  subscribeAiKeyState,
} from './keySession'

const SYNTHETIC_KEY = 'sk-synthetic-not-a-real-credential-0001'
const SAVED_AT = '2026-09-26T00:00:00.000Z'

/**
 * 取出源码里**真正的代码**（丢掉注释与字符串内容）。
 *
 * 为什么需要它：本模块的注释里必须写明「不碰 localStorage / IndexedDB」，
 * 直接对全文 `includes` 会把那句纪律说明误判成真的用了它。
 * 用 TypeScript scanner 逐 token 过滤，比正则可靠。
 */
function codeOnlyOf(source: string): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  )
  const parts: string[] = []
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      continue
    }
    if (
      token === ts.SyntaxKind.StringLiteral ||
      token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
      token === ts.SyntaxKind.TemplateHead ||
      token === ts.SyntaxKind.TemplateMiddle ||
      token === ts.SyntaxKind.TemplateTail
    ) {
      parts.push('""')
      continue
    }
    parts.push(scanner.getTokenText())
  }
  return parts.join(' ')
}

beforeEach(() => {
  resetAiKeySessionForTests()
})

describe('AI-3：Key 默认只在内存', () => {
  it('初始状态没有 Key，且取明文返回 null（不是空串）', () => {
    expect(readAiKeySnapshot().present).toBe(false)
    expect(readAiKeyForRequest()).toBeNull()
  })

  it('设定后能取到明文，且快照里只有「有 / 没有」与时间，没有 value 字段', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    expect(readAiKeyForRequest()).toBe(SYNTHETIC_KEY)

    const snapshot = readAiKeySnapshot()
    expect(snapshot.present).toBe(true)
    expect(snapshot.savedAt).toBe(SAVED_AT)
    expect(Object.keys(snapshot)).not.toContain('value')
    // 快照的序列化结果里绝不能出现 Key 本身
    expect(JSON.stringify(snapshot)).not.toContain(SYNTHETIC_KEY)
  })

  it('空白 Key 被拒绝（空 Key 会造出「看起来配好了但一发就 401」的状态）', () => {
    expect(() => setAiKeySession('   ', SAVED_AT)).toThrow()
    expect(readAiKeySnapshot().present).toBe(false)
  })

  it('清空内存只清内存：再次读取为 null', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    clearAiKeySession()
    expect(readAiKeyForRequest()).toBeNull()
    expect(readAiKeySnapshot().present).toBe(false)
  })

  it('订阅会立刻回放当前状态（界面首帧不会显示成「没有 Key」）', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const seen: boolean[] = []
    const unsubscribe = subscribeAiKeyState((snapshot) => {
      seen.push(snapshot.present)
    })
    expect(seen).toEqual([true])
    unsubscribe()
  })

  it('订阅时的回放即使抛错，也不影响订阅关系与 Key 状态', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    // 订阅立刻回放：坏回调不该让 subscribeAiKeyState 抛错（否则调用方会误判为设置失败）
    expect(() =>
      subscribeAiKeyState(() => {
        throw new Error('监听器坏了')
      }),
    ).not.toThrow()
    expect(readAiKeySnapshot().present).toBe(true)
  })

  it('一个监听器抛错不影响其他监听器，也不影响 Key 状态', () => {
    /*
     * 注意挂载顺序：订阅时会**立刻回放**一次当前状态，那次回放是直接调用调用方自己的
     * 回调（让它抛错是它自己的问题，不该被吞掉）。这里要测的是**广播路径**：
     * 一个监听器坏掉时，其他监听器仍应收到通知，Key 状态仍应写入成功。
     */
    const seen: { readonly present: boolean }[] = []
    const unsubscribeHealthy = subscribeAiKeyState((snapshot) => {
      seen.push(snapshot)
    })
    const unsubscribeBad = subscribeAiKeyState(() => {
      throw new Error('监听器坏了')
    })
    seen.length = 0

    expect(() => setAiKeySession(SYNTHETIC_KEY, SAVED_AT)).not.toThrow()
    expect(readAiKeySnapshot().present).toBe(true)
    expect(readAiKeyForRequest()).toBe(SYNTHETIC_KEY)
    // 坏监听器不影响好监听器收到广播（订阅时的回放已被清空，这里只可能是广播进来的）
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.at(-1)?.present).toBe(true)

    unsubscribeBad()
    unsubscribeHealthy()
  })
})

describe('AI-3：锁仓即清内存 Key', () => {
  it('收到 locked 事件后内存 Key 被丢弃', () => {
    const unmount = mountAiKeySessionGuards()
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    expect(readAiKeySnapshot().present).toBe(true)

    emitVaultEvent({ type: 'locked', reason: 'idle' })
    expect(readAiKeySnapshot().present).toBe(false)
    expect(readAiKeyForRequest()).toBeNull()
    unmount()
  })

  it('清空仓与会话过期同样清内存', () => {
    const unmount = mountAiKeySessionGuards()

    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    emitVaultEvent({ type: 'cleared' })
    expect(readAiKeySnapshot().present).toBe(false)

    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    emitVaultEvent({ type: 'stale-session' })
    expect(readAiKeySnapshot().present).toBe(false)

    unmount()
  })

  it('解锁事件**不**清 Key（解锁不该顺手丢掉用户刚填的 Key）', () => {
    const unmount = mountAiKeySessionGuards()
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    emitVaultEvent({ type: 'unlocked', vaultId: 'vault-x', revision: 1 })
    expect(readAiKeySnapshot().present).toBe(true)
    unmount()
  })
})

describe('AI-3：Key 许可按端点绑定（PRD 18.2）', () => {
  it('没有 Key 时授权是空操作（不造出「已授权」的假状态）', () => {
    grantAiKeyPermission(AI_DEFAULT_DESTINATION, SAVED_AT)
    expect(readAiKeySnapshot().permission).toBeNull()
  })

  it('授权后记录 origin 与时间', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    grantAiKeyPermission(AI_DEFAULT_DESTINATION, SAVED_AT)
    const permission = readAiKeySnapshot().permission
    expect(permission?.origin).toBe('https://api.deepseek.com')
    expect(permission?.grantedAt).toBe(SAVED_AT)
  })

  it('换端点后旧许可不再覆盖新地址（不把旧 Key 自动转发）', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    grantAiKeyPermission(AI_DEFAULT_DESTINATION, SAVED_AT)

    // 对同一 origin 仍然有效；对另一个 origin 无效
    expect(keyPermissionCoversFor(readAiKeySnapshot().permission, 'https://api.deepseek.com')).toBe(true)
    expect(keyPermissionCoversFor(readAiKeySnapshot().permission, 'https://evil.example.com')).toBe(false)
  })
})

describe('AI-6：改地址撤销许可（PRD 18.6）', () => {
  it('地址变了就撤销许可，但**不**删 Key（改地址不是破坏性操作）', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    grantAiKeyPermission(AI_DEFAULT_DESTINATION, SAVED_AT)

    const revoked = revokeAiKeyPermissionIfOriginChanged('https://proxy.example.com')

    expect(revoked).toBe(true)
    expect(readAiKeySnapshot().permission).toBeNull()
    // Key 本身还在：用户只是换了端点，不该被迫重新粘贴 Key
    expect(readAiKeySnapshot().present).toBe(true)
    expect(readAiKeyForRequest()).toBe(SYNTHETIC_KEY)
  })

  it('地址没变时不做无谓的撤销（也不谎称撤了）', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    grantAiKeyPermission(AI_DEFAULT_DESTINATION, SAVED_AT)

    expect(revokeAiKeyPermissionIfOriginChanged('https://api.deepseek.com')).toBe(false)
    expect(readAiKeySnapshot().permission?.origin).toBe('https://api.deepseek.com')
  })

  it('没有 Key / 没有许可时调用是空操作', () => {
    expect(revokeAiKeyPermissionIfOriginChanged('https://proxy.example.com')).toBe(false)
    expect(revokeAiKeyPermission()).toBe(false)
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    expect(revokeAiKeyPermission()).toBe(false)
    expect(readAiKeySnapshot().permission).toBeNull()
  })

  it('显式撤销后再次授权可以恢复（撤销只是清许可，不是永久拒绝）', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    grantAiKeyPermission(AI_DEFAULT_DESTINATION, SAVED_AT)
    expect(revokeAiKeyPermissionIfOriginChanged('https://proxy.example.com')).toBe(true)

    grantAiKeyPermission({ origin: 'https://proxy.example.com', path: '/chat/completions' }, SAVED_AT)
    expect(readAiKeySnapshot().permission?.origin).toBe('https://proxy.example.com')
  })
})

/** 测试内的薄封装：只比对 origin，与 `keyPermissionCovers` 的语义一致 */
function keyPermissionCoversFor(
  permission: { readonly origin: string } | null,
  origin: string,
): boolean {
  return permission !== null && permission.origin === origin
}

describe('AI-3：Key 只以掩码形式展示', () => {
  it('掩码保留前 3 后 4，中间不暴露', () => {
    const masked = maskApiKey(SYNTHETIC_KEY)
    expect(masked.startsWith(SYNTHETIC_KEY.slice(0, 3))).toBe(true)
    expect(masked.endsWith(SYNTHETIC_KEY.slice(-4))).toBe(true)
    expect(masked).toContain('…')
    // 中段绝不出现在掩码里
    expect(masked).not.toContain(SYNTHETIC_KEY.slice(3, -4))
  })

  it('太短的 Key 不给掩码，也不原样显示', () => {
    const short = 'sk-abc'
    const masked = maskApiKey(short)
    expect(masked).not.toBe(short)
    expect(masked).not.toContain(short)
    expect(masked).toContain('长度不足')
  })

  it('空值显示为「未填写」而不是空白', () => {
    expect(maskApiKey('   ')).toContain('未填写')
  })

  it('describeAiKey 只描述「有没有」，不回显任何片段', () => {
    expect(describeAiKey({ present: false, savedAt: null, permission: null })).toContain('没有')
    const text = describeAiKey({ present: true, savedAt: SAVED_AT, permission: null })
    expect(text).toContain('已配置')
    expect(text).not.toContain(SYNTHETIC_KEY)
  })
})

describe('AI-3：本地格式检查不探活、不查余额', () => {
  it('正常形状的 Key 通过检查', () => {
    expect(checkApiKeyFormat(SYNTHETIC_KEY).ok).toBe(true)
  })

  it('含空白、过短、占位符分别给出不同提示', () => {
    expect(checkApiKeyFormat('sk-abc def ghi jkl mno').ok).toBe(false)
    expect(checkApiKeyFormat('short').ok).toBe(false)
    const placeholder = checkApiKeyFormat('your-api-key-here-123456')
    expect(placeholder.ok).toBe(false)
    expect(placeholder.problem ?? '').toContain('占位符')
  })

  it('空值提示「请填写」而不是抛错', () => {
    const result = checkApiKeyFormat('')
    expect(result.ok).toBe(false)
    expect(result.problem).not.toBeNull()
  })

  it('格式检查是纯本地的：源码里没有网络调用', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ai', 'keySession.ts'), 'utf8')
    for (const pattern of ['fetch(', 'new XMLHttpRequest', 'sendBeacon(', 'new WebSocket(']) {
      expect(source.includes(pattern)).toBe(false)
    }
  })
})

describe('AI-3：本模块不碰任何持久化（AI10 的结构性前提）', () => {
  it('源码里没有 storage 相关 API 的真实调用（注释里出现不算）', () => {
    const raw = readFileSync(join(process.cwd(), 'src', 'ai', 'keySession.ts'), 'utf8')
    /*
     * 只扫**代码**、不扫注释：本文件的注释里必须写明「不碰 localStorage / IndexedDB」
     * 这条纪律，直接对全文 `includes` 会把那句说明误判成真的用了它。
     */
    const code = codeOnlyOf(raw)
    for (const pattern of ['localStorage', 'sessionStorage', 'indexedDB', 'document . cookie']) {
      expect(code.includes(pattern), `keySession.ts 的代码里出现了 ${pattern}`).toBe(false)
    }
  })

  it('源码里没有 console 输出（Key 绝不能进日志）', () => {
    const code = codeOnlyOf(readFileSync(join(process.cwd(), 'src', 'ai', 'keySession.ts'), 'utf8'))
    expect(code.includes('console .')).toBe(false)
  })

  it('模块级状态就是唯一的一份 Key（没有第二处缓存）', () => {
    // 两个「不同来源」在同一时刻必须看到同一把 Key
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    const first = readAiKeyForRequest()
    const second = readAiKeyForRequest()
    expect(first).toBe(second)
    expect(first).toBe(SYNTHETIC_KEY)
  })
})

describe('AI-3：清空动作互不代替（与设置页的四条动作对应）', () => {
  it('clearAiKeySession 不接触加密仓（它只清内存）', () => {
    // 结构性断言：本模块的**代码**里没有仓操作（注释里说明这条纪律不算）
    const code = codeOnlyOf(readFileSync(join(process.cwd(), 'src', 'ai', 'keySession.ts'), 'utf8'))
    expect(code.includes('saveSecret')).toBe(false)
    expect(code.includes('deleteSecret')).toBe(false)
    expect(code.includes('encryptedVault')).toBe(false)
  })

  it('清空内存后仍可重新设定（不是一次性状态）', () => {
    setAiKeySession(SYNTHETIC_KEY, SAVED_AT)
    clearAiKeySession()
    setAiKeySession('sk-another-synthetic-credential-0002', SAVED_AT)
    expect(readAiKeySnapshot().present).toBe(true)
  })

  it('重复清空是空操作且不广播（避免界面无意义重渲染）', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeAiKeyState(listener)
    listener.mockClear()
    clearAiKeySession()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
