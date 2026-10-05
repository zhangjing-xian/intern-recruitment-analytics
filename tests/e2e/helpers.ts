/**
 * Playwright 用例的共享工具（步骤14）。
 *
 * 三条纪律写在代码里，避免每个 spec 各自发挥：
 * 1. **只点真实存在的界面**：所有选择器都按用户看得见的文案（按钮名、标签、输入框）来，
 *    不用 `data-testid` 去走后门——验收说的是「界面能不能用」，不是「能不能被脚本点」；
 * 2. **记录网络**：`trackRequests` 收集每一个请求，用例据此断言「默认零出站」；
 *    外站请求一律视为失败（AI 请求在 AI 版用例里由 `page.route` 拦下）。
 * 3. **只用合成数据**：粘贴内容来自 `_demo/demo-intern-recruitment.tsv`，
 *    哨兵值是明显合成的字符串（「样例」「合成」）。
 *
 * 另一条容易踩的坑写在帮助函数里：HashRouter 的会话只在**内存**里，
 * 用 `page.goto('/#/xxx')` 直接跳路由会整页重载并丢掉已解析的数据，
 * 因此所有跨页面跳转都必须**点界面上的链接**。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import { expect, type Locator, type Page } from '@playwright/test'

/** 仓库根目录 */
export const E2E_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** 演示数据（合成，50 条，标准 21 列），导入页直接粘贴即可 */
export function demoTableText(): string {
  return readFileSync(join(E2E_ROOT, '_demo', 'demo-intern-recruitment.tsv'), 'utf8')
}

/**
 * 演示数据里的**哨兵值**：这些字符串绝不允许出现在任何出站请求、明文存储或导出里。
 * 它们都是明显合成的（「样例」「合成」），因此可以安全地出现在测试代码里。
 */
export const SENTINELS = {
  hr: 'HR样例甲',
  requirementId: 'REQ-0001',
  school: '合成大学',
} as const

export type RequestLog = {
  readonly url: string
  readonly method: string
  readonly external: boolean
}

/**
 * 开始记录请求。判定「外站」的口径：不是本机 4173 端口来的 http(s) 请求都算
 * （`data:` / `blob:` 不是网络请求，直接忽略）。
 */
export function trackRequests(page: Page): { readonly log: RequestLog[] } {
  const log: RequestLog[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return
    }
    log.push({
      url,
      method: request.method(),
      external: !/^https?:\/\/127\.0\.0\.1:4173\//.test(url),
    })
  })
  return { log }
}

/** 断言：到此刻为止没有任何指向外站的请求 */
export function expectNoExternalRequests(log: readonly RequestLog[]): void {
  const external = log.filter((entry) => entry.external)
  expect(external, `出现了出站请求：${external.map((entry) => entry.url).join('、')}`).toEqual([])
}

/** 收集控制台错误与页面异常：任何一条都说明界面在真实浏览器里出过问题 */
export function trackPageErrors(page: Page): { readonly errors: string[] } {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    errors.push(error.message)
  })
  return { errors }
}

/** 打开应用并确认外壳已挂载（导航在，说明 React 起来了） */
export async function openApp(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('navigation', { name: '主导航' })).toBeVisible()
}

/** 点主导航跳页（必须点界面链接：HashRouter 的会话在内存里，整页重载会丢数据） */
export async function gotoNav(page: Page, label: string): Promise<void> {
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: label }).click()
}

/**
 * 从导入页开始：粘贴合成表格 → 检查（读取设置）→ 开始解析 → 等到「下一步」入口出现。
 *
 * 导入页**刻意分两步**（PRD 5.1）：粘贴只做「读取设置 + 原文预览」，
 * 用户在确认编码 / 分隔符 / 表头行之后才真的解析。用例按用户的路走，不跳过这一步。
 */
export async function pasteDemoTable(page: Page): Promise<void> {
  await openApp(page)
  await page.locator('textarea').first().fill(demoTableText())
  await page.getByRole('button', { name: '解析粘贴内容' }).click()
  await expect(page.getByRole('button', { name: '开始解析' })).toBeVisible()
  await page.getByRole('button', { name: '开始解析' }).click()
  await expect(page.getByRole('link', { name: '下一步：字段映射' })).toBeVisible()
  // 演示数据没有阻断级问题，否则「下一步」是禁用态，后面的用例会以更难懂的方式失败
  await expect(page.getByText('存在阻断级问题')).toHaveCount(0)
}

/** 读核心指标卡片上的数字（卡片 = 标签所在元素 + 紧跟的数值） */
export async function readCountCard(scope: Page | Locator, label: string): Promise<number> {
  const element = scope.getByText(label, { exact: true }).first()
  await expect(element).toBeVisible()
  const text = (await element.locator('xpath=..').textContent()) ?? ''
  const matched = /(\d+)/.exec(text)
  expect(matched, `没读到「${label}」的数字：${text}`).not.toBeNull()
  return Number(matched?.[1] ?? '0')
}

/** 看板「核心指标」区块（卡片文案只在区块内取，避免匹配到别的表格里的同名文字） */
export function kpiSection(page: Page): Locator {
  // 页面外壳的 section 也「包含」这个标题（它是后代），因此取最内层的那个
  return page
    .locator('section', { has: page.getByRole('heading', { name: '核心指标' }) })
    .last()
}

/** 走完「映射 → 清洗提交」两步，让看板拿到一份数据集 */
export async function confirmMappingAndCommit(page: Page): Promise<void> {
  await page.getByRole('link', { name: '下一步：字段映射' }).click()
  await expect(page.getByRole('button', { name: '确认字段映射' })).toBeEnabled()
  await page.getByRole('button', { name: '确认字段映射' }).click()
  await expect(page.getByRole('link', { name: '下一步：清洗预览' })).toBeVisible()

  await page.getByRole('link', { name: '下一步：清洗预览' }).click()
  await expect(page.getByRole('button', { name: '提交为规范化数据集' })).toBeEnabled()
  await page.getByRole('button', { name: '提交为规范化数据集' }).click()
  // 提交成功的唯一标志：会话里出现了数据集名称与行数
  await expect(page.getByText('会话中现有数据集：')).toBeVisible()
}

/** 跳到看板并返回「总 offer 记录数（含审批中）」那张卡片上的数字 */
export async function readDashboardN(page: Page): Promise<number> {
  await gotoNav(page, '分析看板')
  const kpi = kpiSection(page)
  await expect(kpi).toBeVisible()
  return readCountCard(kpi, '总 offer 记录数（含审批中）')
}
