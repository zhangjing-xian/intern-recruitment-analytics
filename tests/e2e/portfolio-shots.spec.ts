/**
 * 作品集 / README 截图脚本（**默认跳过**，只在显式要求时运行）。
 *
 * 为什么默认跳过：它会在仓库里写 PNG 文件，属于"生成素材"的动作，不是"验证行为"的动作；
 * 混进每次 `npm run test:e2e` 会让测试跑出副作用。Playwright 里 **skip 是诚实的第三种状态**，
 * 因此这里明确跳过并写清该用哪条命令。
 *
 * 用法（在项目根目录，PowerShell）：
 *
 *   $env:PORTFOLIO_SHOTS='1'; npm run build; npx playwright test tests/e2e/portfolio-shots.spec.ts
 *
 * 产物：`docs/screenshots/1-dashboard.png`、`2-dimensions.png`、`3-cleaning.png`
 * （全部用 `_demo/` 的**合成**演示数据，不含任何真实招聘信息。）
 */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { E2E_ROOT, confirmMappingAndCommit, gotoNav, pasteDemoTable } from './helpers'

const OUT_DIR = join(E2E_ROOT, 'docs', 'screenshots')

test('作品集截图（合成数据）：清洗预览 / 看板 / 分维度', async ({ page }) => {
  test.skip(
    process.env.PORTFOLIO_SHOTS !== '1',
    "生成截图请用：$env:PORTFOLIO_SHOTS='1'; npx playwright test tests/e2e/portfolio-shots.spec.ts",
  )

  await page.setViewportSize({ width: 1440, height: 900 })
  mkdirSync(OUT_DIR, { recursive: true })

  await pasteDemoTable(page)
  await confirmMappingAndCommit(page)

  // ① 清洗预览：提交完就停在这一页，质量分级 / 异常清单都在这里
  await expect(page.getByText('会话中现有数据集：')).toBeVisible()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT_DIR, '3-cleaning.png') })

  // ② 看板：等图表真的画出来（ECharts 是懒加载的）
  await gotoNav(page, '分析看板')
  await expect(page.locator('canvas').first()).toBeVisible()
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT_DIR, '1-dashboard.png') })

  // ③ 分维度分析：用滚轮往下滚（页面的滚动容器不是 window，scrollIntoView 不移动视口），
  //    滚到分组图与数据表同屏的位置再截图
  await page.mouse.move(720, 500)
  await page.mouse.wheel(0, 3600)
  await page.waitForTimeout(1200)
  await page.screenshot({ path: join(OUT_DIR, '2-dimensions.png') })
})
