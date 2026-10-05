/**
 * 存储边界与多标签页协作事实的测试（步骤12，docs/PRD.md 10.5）。
 *
 * 这一段最容易写出「听起来很好」的假话，因此测试只钉三件事：
 * 1. 跨标签页的机制**不许被说成即时推送**：`vaultEvents` 是同页面内的事件通道，
 *    跨标签页只能靠写入前的仓版本校验发现，文案必须承认这一点；
 * 2. 配额与持久化**不许被说成保证**：必须出现「由浏览器决定 / 无法保证」这类限定；
 * 3. 每条事实都要能被面板渲染出来（同一份数据，不允许面板里另抄一份文案）。
 *
 * 全部为纯静态文案与渲染，不读取任何存储，也不含任何真实数据。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import StorageBoundaryPanel from './StorageBoundaryPanel'
import { STORAGE_BOUNDARY_FACTS, VAULT_EVENT_NOTICE } from './storageBoundary'

describe('storageBoundary 事实清单', () => {
  it('每条事实都有 id / 标题 / 说明 / 实现位置，且 id 唯一', () => {
    expect(STORAGE_BOUNDARY_FACTS.length).toBeGreaterThan(0)
    for (const fact of STORAGE_BOUNDARY_FACTS) {
      expect(fact.id.length).toBeGreaterThan(0)
      expect(fact.title.length).toBeGreaterThan(0)
      expect(fact.detail.length).toBeGreaterThan(0)
      // 「实现位置」是可核对性的抓手：没有它，这段说明就退化成无法验证的宣传
      expect(fact.source.length).toBeGreaterThan(0)
    }
    expect(new Set(STORAGE_BOUNDARY_FACTS.map((fact) => fact.id)).size).toBe(
      STORAGE_BOUNDARY_FACTS.length,
    )
  })

  it('多标签页提示说清「谁推送、谁不推送」：推送式失效成立，但不许暗示有实时同步通道', () => {
    /*
     * 这条断言在步骤12 收尾时被修正过一次，原因是它原先钉的是一个**错误的前提**：
     * 当时认为「跨标签页不会即时通知、只能等下一次读写」。实际上 IndexedDB 的
     * `versionchange` 就是浏览器对同源其他连接的**主动推送**，`storage/db.ts` 收到后
     * 会立刻关闭连接、丢弃内存密钥，因此失效是即时发生的。
     * 修正后同时钉两件不同的事，避免把两层机制混为一谈：
     * 1. 失效是推送式的（所以文案必须敢写「主动通知」）；
     * 2. 但仍不得暗示存在「实时同步数据」的通道（那是另一回事，本项目没有）。
     */
    expect(VAULT_EVENT_NOTICE).toContain('主动通知')
    expect(VAULT_EVENT_NOTICE).toContain('推送式')
    // 不得暗示有实时同步 / 跨标签数据同步通道
    expect(VAULT_EVENT_NOTICE).not.toContain('实时同步')
    expect(VAULT_EVENT_NOTICE).not.toContain('同步数据')
  })

  it('跨标签页事实的来源指向真正实现推送的位置', () => {
    const byId = new Map(STORAGE_BOUNDARY_FACTS.map((fact) => [fact.id, fact]))
    const crossTab = byId.get('cross-tab-detection')
    expect(crossTab).toBeDefined()
    expect(crossTab?.detail).toContain('versionchange')
    // 推送（db.ts）与校验（requireFreshMeta）是两道互补保险，来源里都要点到
    expect(crossTab?.source).toContain('db.ts')
    expect(crossTab?.source).toContain('requireFreshMeta')
  })

  it('配额与持久化事实保留「未知 ≠ 0」与「浏览器决定」两条限定', () => {
    const byId = new Map(STORAGE_BOUNDARY_FACTS.map((fact) => [fact.id, fact]))
    const quota = byId.get('quota-estimate')
    const persist = byId.get('persist-request')
    expect(quota).toBeDefined()
    expect(persist).toBeDefined()
    expect(quota?.detail).toContain('未知')
    expect(quota?.detail).toContain('0')
    expect(persist?.detail).toContain('由浏览器决定')
    expect(persist?.detail).toContain('不是保证')
  })

  it('明文与第三方存储两条事实都在场，且引用里点出了实现模块', () => {
    const joined = STORAGE_BOUNDARY_FACTS.map((fact) => `${fact.title}|${fact.detail}|${fact.source}`).join('\n')
    expect(joined).toContain('明文')
    expect(joined).toContain('vaultMeta')
    expect(joined).toContain('localStorage')
    expect(joined).toContain('Service Worker')
  })
})

describe('StorageBoundaryPanel 渲染', () => {
  it('渲染全部事实与跨标签页提示，且没有 Markdown 加粗标记', () => {
    const html = renderToStaticMarkup(<StorageBoundaryPanel />)

    expect(html).toContain('存储边界与多标签页协作')
    expect(html).toContain(VAULT_EVENT_NOTICE)
    for (const fact of STORAGE_BOUNDARY_FACTS) {
      expect(html).toContain(fact.title)
      expect(html).toContain(fact.detail)
      expect(html).toContain(fact.source)
    }
    expect(html).not.toContain('**')
  })
})
