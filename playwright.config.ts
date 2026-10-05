import { defineConfig } from '@playwright/test'

/**
 * Playwright 配置（步骤14）。
 *
 * ## 为什么用**系统已安装的 Chrome**，而不是 `npx playwright install`
 *
 * `channel: 'chrome'` 让 Playwright 直接驱动本机已安装的 Chrome（本机实测可用），
 * 因此**不需要下载任何浏览器二进制**。这与本项目的两条约束一致：
 * 不往仓库/CI 里塞大文件，也不为了跑测试引入一个必须联网下载的步骤。
 * 真要在别的机器上跑，装好 Chrome 或 Edge 即可（`channel: 'msedge'` 同理）。
 *
 * ## 为什么串行（`workers: 1`）
 *
 * 所有用例共用同一个 `vite preview` 服务器与同一个构建产物；串行能避免
 * 「两个用例同时往同一个 IndexedDB 里建仓 / 改偏好」这类互相干扰。
 *
 * ## 前置条件（由 npm script 保证）
 *
 * `dist/` 必须已经按对应模式构建好：
 * - 默认用例跑在**本地版**（`connect-src 'none'`）上；
 * - 带 `@ai-build` 标签的用例跑在**含 AI 版**（`connect-src https://api.deepseek.com`）上，
 *   因为它们要验证「确认后恰好一次请求」——本地版会先被 CSP 拦下。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    // 系统 Chrome：不需要 `npx playwright install`，也不下载任何浏览器
    channel: 'chrome',
    trace: 'off',
    // 测试全程不允许真的连外网：AI 请求由 `page.route` 拦下并合成响应
    offline: false,
  },
  webServer: {
    command: 'npx.cmd vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
