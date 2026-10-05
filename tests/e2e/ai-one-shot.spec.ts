/**
 * 含 AI 版生产构建的浏览器端验收（步骤14）——一次性调用与出站边界。
 *
 * 前置：`dist/` 必须是 `npm run build:ai`（`connect-src https://api.deepseek.com`）的产物，
 * 因此这些用例带 `@ai-build` 标记，由 `npm run test:e2e:ai` 单独跑。
 * 在本地版产物上它们会直接 skip（而不是假装通过）：本地版**不可能**发得出去，
 * 用它验证 AI 链路等于什么都没验证。
 *
 * 这一个文件回答四件事：
 *
 * | 编号 | 断言 | 为什么只有真实浏览器能回答 |
 * |---|---|---|
 * | AI13 / AI14 | 开开关 / 存 Key / 导入 / 清洗 / 生成预览都不发请求，点「确认并调用」才发一次 | 请求时序与 CORS 预检只有浏览器会做 |
 * | AI15 / AI02 | 真正发出的正文包含预览里那段逐字相同的载荷，且不含任何哨兵值 | 需要读真实请求体 |
 * | AI03 / AI04 | Key 只出现在 `Authorization` 头里，URL 与正文都没有 | 需要看真实请求头 |
 * | AI12 | 返回内容经安全 Markdown 渲染：面板里没有 script / a / img 节点 | 渲染结果只在浏览器里存在 |
 *
 * 请求由 `page.route` 拦下并本地应答（含 CORS 预检），**不产生任何真实外发流量**，
 * 也不使用任何真实 Key（合成值只用于证明「它只出现在 Authorization 头里」）。
 */

import { expect, test, type Page, type Request } from '@playwright/test'

import {
  SENTINELS,
  confirmMappingAndCommit,
  gotoNav,
  openApp,
  pasteDemoTable,
  trackRequests,
} from './helpers'

/** 合成 Key：形状像 Key，但绝不是任何真实凭据（仓库白名单里允许的合成值之一） */
const SYNTHETIC_KEY = 'sk-synthetic-not-a-real-credential-0001'
/** 建仓用的合成密码 */
const SYNTHETIC_PASSWORD = '合成密码-仅测试用-0001'
const ENDPOINT_PREFIX = 'https://api.deepseek.com'
const RESULT_TITLE = 'AI 深度分析结果'

/** 官方响应形状的合成样例（字段名与文档一致；正文是我们自己写的合成结论） */
const SUCCESS_BODY = JSON.stringify({
  id: 'chatcmpl-browser-acceptance-1',
  object: 'chat.completion',
  created: 1_760_000_000,
  model: 'deepseek-chat',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: {
        role: 'assistant',
        content: '## 合成分析结论\n\n这是浏览器验收用的合成结果。\n\n- 第一点\n- 第二点',
        // 真实响应在思考模式下会带思维链；带上它用来证明我们**不读**它
        reasoning_content: '这段思维链不应该被保存或展示。',
      },
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
})

type CapturedPost = {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: string
}

type EndpointProbe = {
  readonly posts: CapturedPost[]
  /** CORS 预检次数（浏览器自动发起的 OPTIONS） */
  preflightCount: () => number
}

/** 拦住官方端点：OPTIONS 带 CORS 头放行，POST 记录后返回合成结果 */
async function interceptEndpoint(page: Page): Promise<EndpointProbe> {
  const posts: CapturedPost[] = []
  let preflights = 0
  await page.route(`${ENDPOINT_PREFIX}/**`, async (route) => {
    const request: Request = route.request()
    const cors = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
    }
    if (request.method() === 'OPTIONS') {
      preflights += 1
      await route.fulfill({ headers: cors, status: 204 })
      return
    }
    posts.push({
      url: request.url(),
      headers: request.headers(),
      body: request.postData() ?? '',
    })
    await route.fulfill({
      body: SUCCESS_BODY,
      headers: { ...cors, 'content-type': 'application/json' },
      status: 200,
    })
  })
  return { posts, preflightCount: () => preflights }
}

/**
 * 准备一个「真的能发送」的状态。
 *
 * ## 顺序是有讲究的（步骤14 实测踩到过）
 *
 * `pasteDemoTable` 会**整页打开**应用（`page.goto`），而加密仓的解锁状态只在本页内存里：
 * 一旦在解仓之后再做整页重载，仓就回到锁定态，`loadAiSettings` 会按设计回落到默认值
 * （关闭 + 默认参数），看板上的 AI 面板显示「AI 已关闭（默认）」——共享同一个浏览上下文的
 * 用例会以为「设置没保存」。因此：**先导入并提交数据集，再建仓并设置 AI**，
 * 之后到用完为止只用界面内导航（HashRouter 不会整页重载）。
 */
async function prepareAiReadyState(page: Page): Promise<void> {
  // 1) 数据集：导入 → 映射 → 清洗提交（这一步自带一次整页打开，放在建仓之前）
  await pasteDemoTable(page)
  await confirmMappingAndCommit(page)

  // 2) 建仓（AI 偏好要写进加密仓，临时模式写不进去）→ 开开关 → 存 Key（仅内存）→ 确认本地规则
  await gotoNav(page, '设置')
  await page.getByLabel('密码', { exact: true }).fill(SYNTHETIC_PASSWORD)
  await page.getByLabel('再次输入密码').fill(SYNTHETIC_PASSWORD)
  await page.getByRole('button', { name: '创建并解锁' }).click()
  await expect(page.getByText('已解锁').first()).toBeVisible()

  await page.getByRole('button', { name: '开启 AI 深度分析' }).click()
  await expect(page.getByText('当前状态：已开启')).toBeVisible()
  // 「已开启」提示只在**真的写进加密仓**之后才出现；没有它说明偏好只是内存态
  await expect(page.getByText('AI 深度分析已开启')).toBeVisible()

  await page.getByLabel('粘贴你的 DeepSeek API Key').fill(SYNTHETIC_KEY)
  await page.getByRole('button', { name: '保存到内存' }).click()
  // Key 只以掩码显示，明文绝不回显在任何文本节点里
  await expect(page.getByText(SYNTHETIC_KEY)).toHaveCount(0)

  await page.getByRole('button', { name: '确认这批规则可以用于摘要' }).click()
  await expect(page.getByText(/这批规则已确认/).first()).toBeVisible()
}

/** 打开看板上的 AI 工作区并生成完整脱敏预览，返回预览里那段载荷文本 */
async function generatePreview(page: Page): Promise<string> {
  await gotoNav(page, '分析看板')
  // 先确认看板真的读到了刚才保存的偏好：读不到说明仓被锁了，后面的断言会以更难懂的方式失败
  await expect(page.getByText('当前状态：AI 已开启')).toBeVisible()
  await page.getByRole('button', { name: 'AI 深度分析（本地脱敏预览）' }).click()
  await page.getByRole('button', { name: '生成脱敏预览' }).click()

  const payloadTitle = '完整 JSON 载荷（payloadJson，逐字节等于将要发送的文本）'
  const payloadSection = page
    .locator('section', { has: page.getByRole('heading', { name: payloadTitle }) })
    .last()
  await expect(payloadSection).toBeVisible()
  return (await payloadSection.locator('pre').textContent()) ?? ''
}

/**
 * 只有当 `dist/` 是含 AI 版构建时这些用例才成立。
 * 先 `openApp` 再读 meta CSP：about:blank 上读不到任何策略，会把「没导航」误判成「本地版」。
 */
async function requireAiBuild(page: Page): Promise<void> {
  await openApp(page)
  const csp =
    (await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')) ?? ''
  test.skip(
    !csp.includes(ENDPOINT_PREFIX),
    '当前 dist 是本地版构建（connect-src 不含官方端点）：请用 npm run test:e2e:ai 运行本文件',
  )
}

test.describe('@ai-build 含 AI 版：一次性确认与出站边界', () => {
  test('开开关 / 存 Key / 生成预览都不发请求；点确认才发一次，且正文含预览里的载荷', async ({
    page,
  }) => {
    const requests = trackRequests(page)
    const endpoint = await interceptEndpoint(page)
    await requireAiBuild(page)

    await prepareAiReadyState(page)

    // 1) 到这一步为止：一次调用都没有（开开关 / 存 Key / 导入 / 清洗 / 映射都不发）
    expect(endpoint.posts, '在确认之前不应有任何调用').toEqual([])

    // 2) 生成完整脱敏预览（这一步同样不发请求）
    const approved = await generatePreview(page)
    expect(approved.length).toBeGreaterThan(0)
    expect(endpoint.posts, '生成预览不得触发调用').toEqual([])

    // 3) 两次点击的含义不同（PRD 16.2）：第一次只是「批准这一份」，第二次才消费令牌并发出去
    const confirmButton = page.getByRole('button', { name: '确认并调用 DeepSeek' })
    await confirmButton.click()
    await expect(page.getByText('已确认这一份预览，令牌还没有被消费')).toBeVisible()
    expect(endpoint.posts, '第一次点击只批准，不发请求').toEqual([])

    await confirmButton.click()
    await expect(page.getByRole('heading', { name: RESULT_TITLE })).toBeVisible()
    expect(endpoint.posts, `期望恰好一次调用，实际 ${endpoint.posts.length} 次`).toHaveLength(1)

    // 4) 真正发出的正文包含预览里那段载荷（预览标题写的就是「逐字节等于将要发送的文本」）
    const sent = endpoint.posts[0]
    expect(sent.url).toBe(`${ENDPOINT_PREFIX}/chat/completions`)
    const parsed = JSON.parse(sent.body) as {
      model?: string
      stream?: boolean
      messages?: { role: string; content: string }[]
    }
    expect(typeof parsed.model).toBe('string')
    expect(parsed.stream).toBe(false)
    expect(parsed.messages?.[0]?.role).toBe('system')
    const userMessage = parsed.messages?.find((message) => message.role === 'user')
    expect(userMessage, '正文里必须有 user 消息').toBeDefined()
    expect(userMessage?.content).toContain(approved)

    // 5) 聚合摘要里不得出现任何哨兵值，也不得出现原始文件名
    for (const sentinel of Object.values(SENTINELS)) {
      expect(sent.body, `出站正文里出现了 ${sentinel}`).not.toContain(sentinel)
    }
    expect(sent.body).not.toContain('demo-intern-recruitment')

    // 6) 返回内容经安全渲染：合成结论出现，且结果面板里没有任何 script / 链接 / 图片节点
    await expect(page.getByText('这是浏览器验收用的合成结果。')).toBeVisible()
    const resultPanel = page
      .locator('section', { has: page.getByRole('heading', { name: RESULT_TITLE }) })
      .last()
    expect(await resultPanel.locator('script').count()).toBe(0)
    expect(await resultPanel.locator('a').count()).toBe(0)
    expect(await resultPanel.locator('img').count()).toBe(0)

    // 7) 出站只允许官方端点：除这一次调用与它的预检，没有任何别的外站请求
    const unexpected = requests.log.filter(
      (entry) => entry.external && !entry.url.startsWith(ENDPOINT_PREFIX),
    )
    expect(
      unexpected,
      `出现了计划外的外站请求：${unexpected.map((entry) => entry.url).join('、')}`,
    ).toEqual([])
    expect(endpoint.preflightCount()).toBeLessThanOrEqual(1)

    // 8) 确认令牌只能消费一次：结果页不再有可点的确认按钮（再点也不会发第二次）
    const confirmAgain = page.getByRole('button', { name: '确认并调用 DeepSeek' })
    if ((await confirmAgain.count()) > 0) {
      await confirmAgain.click({ force: true })
    }
    expect(endpoint.posts, '第二次调用不得再发一次请求').toHaveLength(1)
  })

  test('Key 只出现在 Authorization 头里：URL 与请求正文里都没有它', async ({ page }) => {
    const endpoint = await interceptEndpoint(page)
    await requireAiBuild(page)

    await prepareAiReadyState(page)
    await generatePreview(page)
    // 第一次点 = 批准；第二次点 = 消费令牌并发出这一次请求
    const confirmButton = page.getByRole('button', { name: '确认并调用 DeepSeek' })
    await confirmButton.click()
    await expect(page.getByText('已确认这一份预览，令牌还没有被消费')).toBeVisible()
    await confirmButton.click()
    await expect(page.getByRole('heading', { name: RESULT_TITLE })).toBeVisible()

    expect(endpoint.posts).toHaveLength(1)
    const sent = endpoint.posts[0]
    expect(sent.headers.authorization).toBe(`Bearer ${SYNTHETIC_KEY}`)
    expect(sent.url).not.toContain(SYNTHETIC_KEY)
    expect(sent.body).not.toContain(SYNTHETIC_KEY)
    // 除了 Authorization，没有任何别的头带着它
    const carriers = Object.entries(sent.headers).filter(([name, value]) => {
      return name !== 'authorization' && value.includes(SYNTHETIC_KEY)
    })
    expect(carriers).toEqual([])
  })
})
