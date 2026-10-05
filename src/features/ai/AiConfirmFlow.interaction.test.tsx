// @vitest-environment jsdom
/**
 * AI 工作区的**真实 DOM 交互**测试（步骤14，docs/PRD.md 12.4「Testing Library」）。
 *
 * ## 为什么这一步必须补上
 *
 * AI01 / AI02 的验收原文是「**未点击确认时零网络请求**；点击确认后恰好 1 次」与
 * 「双击确认按钮不产生第二次付费请求」。AI-4 当时用静态渲染 + 注入客户端验的是**顺序契约**
 * （令牌先消费、再调用客户端），并在交付状态里如实写了「点按钮真的会发请求」未验证。
 * 本文件用 jsdom + Testing Library **真的去点按钮**，把这两条补成行为级证据。
 *
 * 三条断言的分工（都在真实 DOM 上）：
 * 1. **没有预览就没有确认按钮**（先确认后看内容是不允许的）；
 * 2. 第一次点 = 建立令牌（**不发请求**）；第二次点 = 消费令牌 + **恰好一次** sendOnce；
 * 3. 第三次点（已消费）→ 引擎拒绝，**不再发请求**；本机规则未确认时同样一次都不发。
 *
 * 测试不发任何真实请求：`client` 是注入的假实现，它只记录调用与正文。
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AI_DEFAULT_PARAMS, buildAiPreview, type AiPreview } from '../../privacy/aiPreview'
import { buildSanitizedAiPayload } from '../../privacy/aiSummary'
import type { AiChatResult } from '../../ai/aiResult'
import type { AiSendOutcome } from '../../ai/aiClient'
import type { AiSendRequest } from '../../ai/client'

import AiAnalysisWorkspace from './AiAnalysisWorkspace'
import AiPreviewPanel from './AiPreviewPanel'
import { aiWorkspaceDataOf } from './aiWorkspaceFixture'
import type { AiSubmitClient } from './aiSubmit'
import {
  AI_CONFIRM_LABEL,
  AI_COPY_LABEL,
  AI_GENERATE_LABEL,
  AI_REGENERATE_LABEL,
  AI_SUBJECT_RULES_BLOCK_TITLE,
} from './aiText'

/*
 * 显式 cleanup：vitest 没有开 `globals`，Testing Library 的自动清理不会注册，
 * 而本文件有多个 `render` —— 不清理会让 `screen` 同时看到上一个用例的 DOM
 * （表现为「找到多个同名按钮」）。这是真实踩到的一次，写在这里避免下一个人重蹈。
 */
afterEach(() => {
  cleanup()
})

/** 与工作区同一条构造链的预览（用于断言「发送的正文等于预览里的正文」） */
function previewOf(): AiPreview {
  const data = aiWorkspaceDataOf()
  const payload = buildSanitizedAiPayload({
    privacyLevel: 'standard',
    scope: {
      rowCount: data.scope.rowCount,
      dedupPolicy: data.scope.dedupPolicy,
      filters: data.scope.filters,
      ruleVersion: data.scope.ruleVersion,
      dataAsOf: data.scope.dataAsOf,
    },
    kpi: data.kpi,
    cells: data.cells,
    reasons: data.reasons.map((item) => ({ category: item.category, count: item.count })),
    quality: data.quality,
    caliberNotes: data.caliberNotes,
    generatedAt: '',
  })
  return buildAiPreview({
    payload,
    caliberNotes: data.caliberNotes,
    params: AI_DEFAULT_PARAMS,
    generatedAt: '',
  })
}

/** 一次成功的合成结果（字段与真实响应一致，内容全是合成文本） */
function syntheticResult(request: AiSendRequest): AiChatResult {
  return {
    requestHash: request.previewHash,
    requestedModel: request.requestedModel,
    responseModel: 'deepseek-flash',
    content: '# 合成结论\n\n这是一段**合成**文本。',
    finishReason: 'stop',
    usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, promptCacheHitTokens: null },
    responseId: 'synthetic-response-1',
  }
}

/** 记录调用的假客户端：绝不发网络请求 */
function fakeClient(): { readonly client: AiSubmitClient; readonly calls: AiSendRequest[] } {
  const calls: AiSendRequest[] = []
  return {
    calls,
    client: {
      sendOnce: (request) => {
        calls.push(request)
        // 返回形状与真实适配器一致（`AiSendOutcome`），只是不经过网络
        return Promise.resolve<AiSendOutcome>({
          ok: true,
          result: syntheticResult(request),
          current: true,
        })
      },
      cancel: () => undefined,
      isInFlight: () => false,
    },
  }
}

/** 页面上那份「逐字节等于将要发送的文本」的载荷：按内容找到 <pre> 并读它的原始 textContent */
function displayedPayloadJson(): string {
  const pres = [...document.querySelectorAll('pre')]
  const payload = pres.find((pre) => (pre.textContent ?? '').includes('"schemaVersion"'))
  expect(payload, '页面上应有一份逐字展示的载荷 JSON').toBeDefined()
  return payload?.textContent ?? ''
}

describe('步骤14：AI 确认流程的真实 DOM 行为（AI01 / AI02）', () => {
  it('没有预览时不存在确认按钮：先确认后看内容是不允许的', () => {
    render(<AiAnalysisWorkspace data={aiWorkspaceDataOf()} client={fakeClient().client} />)

    expect(screen.getByRole('button', { name: AI_GENERATE_LABEL })).toBeTruthy()
    expect(screen.queryByRole('button', { name: AI_CONFIRM_LABEL })).toBeNull()
  })

  it('未点确认 → 零请求；点两次 → 恰好一次请求，且正文里嵌的载荷与预览逐字一致', async () => {
    const user = userEvent.setup()
    const { client, calls } = fakeClient()
    render(<AiAnalysisWorkspace data={aiWorkspaceDataOf()} client={client} />)

    await user.click(screen.getByRole('button', { name: AI_GENERATE_LABEL }))
    // 预览已经在页面上（逐字展示：完整 JSON 就在 <pre> 里）
    expect(screen.getByText('完整 JSON 载荷（payloadJson，逐字节等于将要发送的文本）')).toBeTruthy()
    const approved = displayedPayloadJson()

    // 第一次点：只建立令牌，不发请求
    await user.click(screen.getByRole('button', { name: AI_CONFIRM_LABEL }))
    expect(calls).toHaveLength(0)

    // 第二次点：消费令牌并发出这一次请求
    await user.click(screen.getByRole('button', { name: AI_CONFIRM_LABEL }))
    await waitFor(() => {
      expect(calls).toHaveLength(1)
    })

    /*
     * AI01 的后半句是「正文与预览完全一致」。请求正文是一个 JSON 对象
     * （model / messages / stream / max_tokens），**载荷逐字嵌在 user 消息里**。
     *
     * 注意必须**先解析外层 JSON 再比较**：外层序列化会把换行转义成 `\n`、引号转义成 `\"`，
     * 因此「原始正文字符串里包含那段载荷」永远不成立（本文件第一版就写错过一次）。
     * 解析后比较才是「逐字节一致」的正确说法。
     */
    const body = calls[0]?.body ?? ''
    const parsed = JSON.parse(body) as {
      readonly messages: readonly { readonly role: string; readonly content: string }[]
      readonly stream: boolean
    }
    expect(parsed.stream).toBe(false)
    expect(parsed.messages[0]?.role).toBe('system')
    expect(parsed.messages[1]?.role).toBe('user')
    expect(parsed.messages[1]?.content).toContain(approved)
    expect(calls[0]?.previewHash).toHaveLength(8)
    // 结果渲染出来后确认按钮不该再能发第二次
    expect(screen.getByText('已收到这一次的结果')).toBeTruthy()
  })

  it('令牌已消费后再点确认 → 不再发第二次请求（双击不双付费）', async () => {
    const user = userEvent.setup()
    const { client, calls } = fakeClient()
    render(<AiAnalysisWorkspace data={aiWorkspaceDataOf()} client={client} />)

    await user.click(screen.getByRole('button', { name: AI_GENERATE_LABEL }))
    const confirm = screen.getByRole('button', { name: AI_CONFIRM_LABEL })
    await user.click(confirm)
    await user.click(confirm)
    await waitFor(() => {
      expect(calls).toHaveLength(1)
    })

    // 第三次点击：按钮已禁用（`canConfirm` 为 false），因此既不消费也不发送
    const after = screen.getByRole('button', { name: AI_CONFIRM_LABEL })
    expect(after.hasAttribute('disabled')).toBe(true)
    fireEvent.click(after)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toHaveLength(1)
  })

  it('本机规则未确认时：可以生成预览，但一次都不发（并且如实说明原因）', async () => {
    const user = userEvent.setup()
    const { client, calls } = fakeClient()
    render(
      <AiAnalysisWorkspace
        client={client}
        data={aiWorkspaceDataOf()}
        subjectRulesConfirmed={false}
      />,
    )

    expect(screen.getByText(AI_SUBJECT_RULES_BLOCK_TITLE)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: AI_GENERATE_LABEL }))
    const confirm = screen.getByRole('button', { name: AI_CONFIRM_LABEL })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(confirm)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(calls).toHaveLength(0)
  })

  it('改了参数后必须重新确认：旧令牌作废，绝不会用旧确认发出新内容（AI03）', async () => {
    const user = userEvent.setup()
    const { client, calls } = fakeClient()
    const firstPreview = previewOf()
    render(<AiAnalysisWorkspace data={aiWorkspaceDataOf()} client={client} />)

    await user.click(screen.getByRole('button', { name: AI_GENERATE_LABEL }))
    const confirm = screen.getByRole('button', { name: AI_CONFIRM_LABEL })
    // 第一次点：只为「这一份内容」建立令牌（不发请求）
    await user.click(confirm)
    expect(calls).toHaveLength(0)
    expect(screen.getByRole('button', { name: AI_REGENERATE_LABEL })).toBeTruthy()

    // 改动模型：预览内容变了，旧确认必须失效
    fireEvent.change(screen.getByLabelText('自定义模型 ID（留空表示使用上面的选择）'), {
      target: { value: 'deepseek-v4-pro' },
    })
    // 再点一次确认：这次的点击只重新建立令牌，因此仍然不发请求
    await user.click(screen.getByRole('button', { name: AI_CONFIRM_LABEL }))
    expect(calls).toHaveLength(0)

    // 再点第二次才发出「新内容」的那一次请求，且 hash 与旧内容不同
    await user.click(screen.getByRole('button', { name: AI_CONFIRM_LABEL }))
    await waitFor(() => {
      expect(calls).toHaveLength(1)
    })
    expect(calls[0]?.requestedModel).toBe('deepseek-v4-pro')
    expect(calls[0]?.previewHash).not.toBe(firstPreview.hash)
  })
})

describe('步骤14：预览面板在真实 DOM 里的交互（复制 / 目的地 / 费用）', () => {
  it('复制按钮把动作交给注入的实现，且页面逐字展示将要复制的文本', async () => {
    const user = userEvent.setup()
    const onCopy = vi.fn()
    const preview = previewOf()
    render(
      <AiPreviewPanel
        canConfirm
        confirmed={false}
        copyState={{ kind: 'idle' }}
        onCancel={() => undefined}
        onCancelRequest={() => undefined}
        onConfirm={() => undefined}
        onCopy={onCopy}
        preview={preview}
        stale={false}
        submitOutcome={{ kind: 'idle' }}
      />,
    )

    // `<pre>` 里的文本用 textContent 逐字比较（getByText 会折叠空白，对 JSON 不适用）
    expect(displayedPayloadJson()).toBe(preview.payloadJson)
    await user.click(screen.getByRole('button', { name: AI_COPY_LABEL }))
    expect(onCopy).toHaveBeenCalledTimes(1)
  })

  it('目的地、费用上限估算与每一条脱敏说明都直接可见（不让用户为看不见的东西负责）', () => {
    const preview = previewOf()
    render(
      <AiPreviewPanel
        canConfirm
        confirmed={false}
        copyState={{ kind: 'idle' }}
        onCancel={() => undefined}
        onCancelRequest={() => undefined}
        onConfirm={() => undefined}
        onCopy={() => undefined}
        preview={preview}
        stale={false}
        submitOutcome={{ kind: 'idle' }}
      />,
    )

    expect(screen.getByText(/费用上限估算/)).toBeTruthy()
    expect(screen.getByText('https://api.deepseek.com/chat/completions')).toBeTruthy()
    // 脱敏说明逐条来自引擎（界面不改写）：白名单重建 / 小样本抑制都在场
    expect(screen.getByText('白名单重建：')).toBeTruthy()
    expect(screen.getByText(/有效分母小于 5 的单元格整格省略/)).toBeTruthy()
  })
})
