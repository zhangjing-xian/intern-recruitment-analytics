/**
 * 本地版生产构建的浏览器端验收（步骤14）。
 *
 * 这个文件承担四类在 Node 里**做不到**的检查：
 *
 * | 编号 | 本文件断言 | 为什么必须真实浏览器 |
 * |---|---|---|
 * | A01 / A02 / A03 / A05 | 粘贴 → 映射 → 清洗 → 看板整条链路走通且数字出现 | 交互只在浏览器里发生 |
 * | A14 / AI17 / AI18 | 全程**零出站请求**，且页面内 `fetch` 官方端点被 **CSP 拒绝** | 请求与 CSP 只有浏览器会执行 |
 * | A12 | 临时模式全程不落盘；建仓后明文存储仍为空 | 只有浏览器有 IndexedDB / localStorage |
 * | A15 | 恶意内容页面不产生外部请求、不出现可点击外链或远程图片 | 渲染与请求由浏览器决定 |
 *
 * 前提：`dist/` 是 `npm run build`（本地版，`connect-src 'none'`）的产物。
 */

import { expect, test } from '@playwright/test'

import { CHECK_PASSED } from '../../src/features/export/exportText'

import {
  SENTINELS,
  confirmMappingAndCommit,
  expectNoExternalRequests,
  gotoNav,
  kpiSection,
  openApp,
  pasteDemoTable,
  readCountCard,
  readDashboardN,
  trackPageErrors,
  trackRequests,
} from './helpers'

/** 建仓 / 解锁用的合成密码（只在本次测试里使用，不是任何真实凭据） */
const SYNTHETIC_PASSWORD = '合成密码-仅测试用-0001'

test.describe('本地版：整条链路 + 零出站', () => {
  /*
   * 打印（另存为 PDF）在自动化里必须先把 `print()` 换掉：真实打印机对话框会阻塞整个用例。
   * 这不是「绕开断言」——本用例要断言的是**新窗口里到底有没有内容**，
   * 以及 `print()` 有没有被调用过，这两件事被替换后照样能测。
   */
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'print', {
        configurable: true,
        writable: true,
        value: () => {
          ;(window as unknown as { __printed?: boolean }).__printed = true
        },
      })
    })
  })

  test('粘贴 → 映射 → 清洗 → 看板：数字出现、无外站请求、无控制台错误', async ({ page }) => {
    const requests = trackRequests(page)
    const errors = trackPageErrors(page)

    await pasteDemoTable(page)
    await confirmMappingAndCommit(page)

    // 看板：N 是真实算出来的（演示数据 50 行，去重后必然 ≤ 50 且 > 0），
    // 并逐项核对恒等式 N = J + P + A + R1 + R2 + U（AGENTS.md §7）
    const total = await readDashboardN(page)
    expect(total).toBeGreaterThan(0)
    expect(total).toBeLessThanOrEqual(50)

    const kpi = kpiSection(page)
    const parts = {
      joined: await readCountCard(kpi, '已入职'),
      pending: await readCountCard(kpi, '待入职'),
      approving: await readCountCard(kpi, 'offer 审批中'),
      rejectedOffer: await readCountCard(kpi, '拒绝 offer'),
      rejectedVerbally: await readCountCard(kpi, '拒绝口头 offer'),
      other: await readCountCard(kpi, '其他'),
      unknown: await readCountCard(kpi, '未知'),
    }
    expect(
      parts.joined +
        parts.pending +
        parts.approving +
        parts.rejectedOffer +
        parts.rejectedVerbally +
        parts.other +
        parts.unknown,
      '恒等式 N = J + P + A + R1 + R2 + U 在看板上不成立',
    ).toBe(total)
    // 核心分母 D = J + P + R1 + R2（排除审批中、其他、未知）
    expect(await readCountCard(kpi, '核心分母 D')).toBe(
      parts.joined + parts.pending + parts.rejectedOffer + parts.rejectedVerbally,
    )

    // 用户需求4 + 用户反馈②：下钻之后必须能在**原地**回到全部数据。
    // 「只看该组」会把全局筛选设为该取值；状态结构 / 时间趋势各一个，
    // 分维度分析的 8 个模块**每个**各一个（用户反馈②：不想再滚回页面顶部去找），
    // 它们走的是与筛选条「清空筛选」同一个纯函数。
    const returnButtons = page.getByRole('button', { name: '返回全部数据' })
    expect(
      await returnButtons.count(),
      '状态结构 1 + 趋势 1 + 分维度分析面板标题 1 + 8 个模块各 1 = 11',
    ).toBe(11)

    const drilldown = page.getByRole('button', { name: '只看该组' }).first()
    await expect(drilldown).toBeVisible()
    await drilldown.click()
    const subsetTotal = await readDashboardN(page)
    expect(subsetTotal, '下钻后 N 应变小').toBeLessThan(total)
    await expect(page.getByText(/当前有筛选生效/).first()).toBeVisible()

    // 点分维度分析最后一个模块（时间效率）里的那一个：这正是用户说的「不想滚回顶部」的位置
    await returnButtons.last().click()
    expect(await readDashboardN(page), '点「返回全部数据」后必须回到全量').toBe(total)
    await expect(page.getByText(/当前没有筛选/).first()).toBeVisible()

    /*
     * 用户需求 ③：图表要真的画出来（不是只渲染了一个空容器）。
     * ECharts 是懒加载的，因此这里等第一块 canvas 出现；六个新增图（渠道 / HR / 需求类型 /
     * 画像四张 / 时间效率）都在看板同页，画布数量应当明显多于两张图。
     */
    await expect(page.locator('canvas').first()).toBeVisible()
    expect(
      await page.locator('canvas').count(),
      '分维度分析新增图表后，画布数量应当明显增加',
    ).toBeGreaterThanOrEqual(6)

    /*
     * 本地版不含 AI（CSP `connect-src 'none'`）：界面**不许**摆一个点下去必然失败的 AI 入口，
     * 而要说明事实。含 AI 版的同一处由 `ai-one-shot.spec.ts` 断言按钮存在——
     * 两条用例一起证明「界面说的是这一份产物真实的能力」。
     */
    await expect(page.getByText('AI 深度分析（本部署不可用）')).toBeVisible()
    await expect(page.getByText(/connect-src 是 none/)).toBeVisible()
    expect(
      await page.getByRole('button', { name: 'AI 深度分析（本地脱敏预览）' }).count(),
      '不含 AI 的产物不该出现 AI 入口',
    ).toBe(0)

    // 同一份筛选快照下，拒 offer 专项与报告导出也要能打开
    // （用 level 2：level 1 是页面外壳的标题，level 2 才是这一页自己渲染的主体）
    await gotoNav(page, '拒 offer 专项')
    await expect(page.getByRole('heading', { level: 2, name: '拒 offer 专项' })).toBeVisible()
    await expect(page.getByText('拒 offer 率（R ÷ D）').first()).toBeVisible()
    // 本页此前一张图都没有；原因分布图与维度率对比图都应当画出画布来
    await expect(page.getByText('拒绝原因分布').first()).toBeVisible()
    await expect(page.locator('canvas').first()).toBeVisible()
    expect(await page.locator('canvas').count()).toBeGreaterThanOrEqual(2)

    await gotoNav(page, '报告导出')
    await expect(page.getByRole('heading', { level: 2, name: '报告导出' })).toBeVisible()

    /*
     * 导出闸门（2026-09-27 修的死锁，必须由真实浏览器钉住）：
     * 生成并查看预览之前四个导出按钮是禁用的；点过预览之后必须真的可用。
     * 原实现把「已查看」的标记只写在导出按钮自己的 onClick 里，而那些按钮又是禁用的，
     * 于是导出永远点不动——单测（服务端渲染）看不出来，这里能看出来。
     */
    const excelButton = page.getByRole('button', { name: /^导出 Excel（\.xlsx）/ })
    await expect(excelButton).toBeDisabled()
    await page.getByRole('button', { name: /^生成并查看预览$/ }).click()
    // 用应用里的同一份文案常量，避免测试与界面文案漂移（这两句必须一致：检查通过才允许导出）
    await expect(page.getByText(CHECK_PASSED)).toBeVisible()
    await expect(excelButton).toBeEnabled()

    /*
     * 用户反馈（2026-09-27 晚）：点「打印 / 另存为 PDF」打开的窗口是**空白页**，
     * 而且什么也没下载。根因是 `window.open('', '_blank', 'noopener,noreferrer')`
     * 在带 `noopener` 时**返回 null**：于是我们既没往新窗口写内容，又误报「浏览器拦截了新窗口」。
     * 单测看不见（jsdom 没有真的开窗口），必须由真实浏览器钉住：
     * 新窗口里要有报告正文，而且 print() 真的被调用过。
     */
    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      page.getByRole('button', { name: /^打印 \/ 另存为 PDF/ }).click(),
    ])
    await popup.waitForLoadState('domcontentloaded')
    const printed = await popup.evaluate(() => ({
      called: (window as unknown as { __printed?: boolean }).__printed === true,
      textLength: document.body.innerText.length,
      hasNote: document.body.innerText.includes('数据截至日'),
    }))
    expect(printed.called, '新窗口里必须调用过 print()').toBe(true)
    expect(printed.hasNote, '新窗口里必须有报告正文，不能是空白页').toBe(true)
    expect(printed.textLength, '空白页的正文长度会是 0').toBeGreaterThan(200)

    expectNoExternalRequests(requests.log)
    expect(errors.errors, `控制台错误：${errors.errors.join(' | ')}`).toEqual([])
  })

  test('清洗预览：异常行清单能打开改值窗口，原因不填会被挡住（用户需求①）', async ({ page }) => {
    const requests = trackRequests(page)
    await pasteDemoTable(page)
    await page.getByRole('link', { name: '下一步：字段映射' }).click()
    await page.getByRole('button', { name: '确认字段映射' }).click()
    await page.getByRole('link', { name: '下一步：清洗预览' }).click()

    // 清单一定在：要么列出异常行，要么说明「没有问题行」——两种都是如实呈现
    await expect(
      page.getByRole('heading', { name: /异常行清单（可以在这里直接改）/ }),
    ).toBeVisible()

    const fixButtons = page.getByRole('button', { name: '修改这一格' })
    if ((await fixButtons.count()) > 0) {
      await fixButtons.first().click()
      const dialog = page.getByRole('dialog', { name: /人工修改这一格/ })
      await expect(dialog).toBeVisible()
      // 原值与自动清洗值两栏都要在（改的是规则算错的那一格，不是凭空填一个数）
      await expect(dialog.getByText('原值（源文件里写的）')).toBeVisible()
      await expect(dialog.getByText('自动清洗值（规则本来算出的）')).toBeVisible()
      // 原因必填：直接保存会被挡住，并且不会产生任何修正
      await dialog.getByRole('button', { name: '保存这处修改' }).click()
      await expect(dialog.getByText(/请填写修改原因/)).toBeVisible()
      await dialog.getByRole('button', { name: '取消' }).click()
      await expect(dialog).toHaveCount(0)
    }

    expectNoExternalRequests(requests.log)
  })

  test('本地版没有出站能力：页面内直接 fetch 官方端点被 CSP 拒绝（A14 / AI17 / AI18）', async ({
    page,
  }) => {
    const requests = trackRequests(page)
    await openApp(page)

    // 1) 页面头部的 meta CSP 就是本地版策略：connect-src 全禁、无通配符
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content')
    expect(csp).toContain("connect-src 'none'")
    expect(csp).not.toContain('*')

    // 2) 真的去发一次请求：浏览器必须拒绝，且**不会**留下任何出站记录
    const outcome = await page.evaluate(async () => {
      try {
        await fetch('https://api.deepseek.com/chat/completions', { method: 'POST' })
        return 'allowed'
      } catch (error) {
        return `blocked:${(error as Error).name}`
      }
    })
    expect(outcome).toBe('blocked:TypeError')

    expectNoExternalRequests(requests.log)
  })

  test('临时模式全程不落盘：IndexedDB / localStorage / sessionStorage / Cookie 都是空的（A12）', async ({
    page,
  }) => {
    await pasteDemoTable(page)
    await confirmMappingAndCommit(page)

    const storage = await page.evaluate(async () => {
      const databases =
        typeof indexedDB.databases === 'function'
          ? (await indexedDB.databases()).map((entry) => entry.name ?? '')
          : []
      return {
        databases,
        localKeys: Object.keys(window.localStorage),
        sessionKeys: Object.keys(window.sessionStorage),
        cookies: document.cookie,
      }
    })

    expect(storage.databases).toEqual([])
    expect(storage.localKeys).toEqual([])
    expect(storage.sessionKeys).toEqual([])
    expect(storage.cookies).toBe('')
  })

  test('建仓后落盘的只有密文信封：哨兵在 IndexedDB 明文里搜不到（A11 / A12）', async ({ page }) => {
    const requests = trackRequests(page)

    /*
     * 顺序：先导入并提交数据集，**再**建仓。
     *
     * `pasteDemoTable` 会整页打开应用，而解锁状态只在本页内存里——解仓后再整页重载会让仓
     * 回到锁定态（`KNOWN_ISSUES.md` 里记着这条行为）。放在建仓之前，才能验证更有意思的那件事：
     * 「仓已经建好并且**正解锁着**，业务数据仍然不会被顺手写进去」。
     */
    await pasteDemoTable(page)
    await confirmMappingAndCommit(page)

    await gotoNav(page, '设置')
    await page.getByLabel('密码', { exact: true }).fill(SYNTHETIC_PASSWORD)
    await page.getByLabel('再次输入密码').fill(SYNTHETIC_PASSWORD)
    await page.getByRole('button', { name: '创建并解锁' }).click()
    await expect(page.getByText('已解锁').first()).toBeVisible()

    const scan = await page.evaluate(async () => {
      const rows: string[] = []
      const databases =
        typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
      for (const entry of databases) {
        const name = entry.name ?? ''
        if (name === '') {
          continue
        }
        const db = await new Promise<IDBDatabase | null>((resolve) => {
          const request = indexedDB.open(name)
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => resolve(null)
        })
        if (db === null) {
          continue
        }
        for (const store of [...db.objectStoreNames]) {
          const values = await new Promise<unknown[]>((resolve) => {
            const transaction = db.transaction(store, 'readonly')
            const all = transaction.objectStore(store).getAll()
            all.onsuccess = () => resolve(all.result as unknown[])
            all.onerror = () => resolve([])
          })
          for (const value of values) {
            rows.push(JSON.stringify(value))
          }
        }
        db.close()
      }
      return { rows, localKeys: Object.keys(window.localStorage) }
    })

    // 仓里确实写了东西（否则下面的「搜不到哨兵」是空转）
    expect(scan.rows.length).toBeGreaterThan(0)
    const dump = scan.rows.join('\n')
    for (const sentinel of Object.values(SENTINELS)) {
      expect(dump, `IndexedDB 的明文里出现了 ${sentinel}`).not.toContain(sentinel)
    }
    // 也没有原始文件名，也没有任何明文键值存储
    expect(dump).not.toContain('demo-intern-recruitment')
    expect(scan.localKeys).toEqual([])

    expectNoExternalRequests(requests.log)
  })
})

test.describe('本地版：无外链与空态（A15 / AI12）', () => {
  test('AI 结果页与 AI 历史页在无数据时可打开，且页面不含可点击外链或远程图片', async ({
    page,
  }) => {
    const requests = trackRequests(page)
    await openApp(page)

    await gotoNav(page, 'AI 结果')
    await expect(page).toHaveURL(/#\/ai\/result$/)
    await gotoNav(page, 'AI 历史')
    await expect(page).toHaveURL(/#\/ai\/history$/)

    // 页面不允许出现可点击的外部链接或远程图片（AI 返回内容里的链接会降级为纯文本）
    expect(await page.locator('a[href^="http"]').count()).toBe(0)
    expect(await page.locator('img[src^="http"]').count()).toBe(0)
    expectNoExternalRequests(requests.log)
  })
})
