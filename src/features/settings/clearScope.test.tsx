/**
 * 清除数据分层范围模型的单测（步骤12，docs/PRD.md 10.5）。
 *
 * 为什么这些断言值得写：清除是**不可撤销**的动作，而它最容易出的错不是「删不掉」，
 * 而是「说错了」——把「只删本应用数据库」说成「清空站点数据」，或暗示能删掉用户已下载的报告。
 * 因此这里逐条钉住三件事：
 * 1. 层与动作**严格对应** `storage/vaultFacade.ts` 的实际方法（多一个动作、少一层都要失败）；
 * 2. 两条「做不到」一定在场：不删已下载文件、不碰同源其他应用；
 * 3. 「删 Key 不删数据集、清业务数据不删 Key」这类双向约束能从模型里被断言，而不是只写在文案里。
 *
 * 全部使用合成状态（库名与条数都是编的），不含任何真实数据。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import ClearScopePanel from './ClearScopePanel'
import {
  CLEAR_ACTION_IDS,
  CLEAR_GLOBAL_LIMITS,
  buildClearLayers,
  clearActionFacadeMethod,
  clearActionTouchesObjects,
  clearActionTouchesSecret,
} from './clearScope'
import {
  CLEAR_AI_HISTORY_PHRASE,
  CLEAR_OBJECTS_PHRASE,
  CLEAR_VAULT_PHRASE,
  DELETE_SECRET_PHRASE,
} from './vaultText'

/** 合成仓状态：库名与条数都是编的（不含任何真实数据） */
const SYNTHETIC_STATUS = { databaseName: 'synthetic-vault-db', objectCount: 7 } as const

describe('clearScope 分层范围模型', () => {
  it('三个动作与确认短语一一对应，且 id 不重复（不新增第四个动作）', () => {
    const layers = buildClearLayers(SYNTHETIC_STATUS)

    expect(layers.map((layer) => layer.id)).toEqual([
      'clear-objects',
      'delete-ai-key',
      'clear-vault',
    ])
    expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length)
    // 短语必须与界面用的常量为同一份值（写死另一份就会出现「按提示输入却永远点不动」）
    expect(layers.map((layer) => layer.phrase)).toEqual([
      CLEAR_OBJECTS_PHRASE,
      DELETE_SECRET_PHRASE,
      CLEAR_VAULT_PHRASE,
    ])
    // 确认短语必须两两不同：否则「想清业务数据」会被当成「想清空整个仓」
    expect(new Set(layers.map((layer) => layer.phrase)).size).toBe(3)
    expect([...CLEAR_ACTION_IDS]).toEqual(layers.map((layer) => layer.id))
  })

  it('每个动作都不可撤销，且都同时列出「会删除」与「会保留」', () => {
    for (const layer of buildClearLayers(SYNTHETIC_STATUS)) {
      expect(layer.irreversible).toBe(true)
      expect(layer.removes.length).toBeGreaterThan(0)
      expect(layer.keeps.length).toBeGreaterThan(0)
      expect(layer.doesNotDelete.length).toBeGreaterThan(0)
      expect(layer.label.length).toBeGreaterThan(0)
    }
  })

  it('每个动作都不声称能删除已下载的文件，且两条全局「做不到」一定在场', () => {
    const layers = buildClearLayers(SYNTHETIC_STATUS)

    // 模型的硬约束：每个动作都必须有一条「做不到」明确提到已下载的文件
    for (const layer of layers) {
      expect(layer.doesNotDelete.some((item) => item.includes('下载'))).toBe(true)
    }
    // 两条全局限制：不删已下载文件 / 不碰同源其他应用
    expect(CLEAR_GLOBAL_LIMITS).toHaveLength(2)
    expect(CLEAR_GLOBAL_LIMITS[0]).toContain('下载')
    expect(CLEAR_GLOBAL_LIMITS[0]).toContain('报告')
    expect(CLEAR_GLOBAL_LIMITS[0]).toContain('备份')
    expect(CLEAR_GLOBAL_LIMITS[1]).toContain('其他应用')
    expect(CLEAR_GLOBAL_LIMITS[1]).toContain('IndexedDB')
    // 「会删除」清单里不得出现把范围说大的肯定式表述（出现这种语气即过度承诺）
    const removals = layers.flatMap((layer) => layer.removes)
    expect(removals.some((item) => item.startsWith('清空整个浏览器'))).toBe(false)
    expect(removals.some((item) => item.startsWith('删除本机所有'))).toBe(false)
    expect(removals.some((item) => item.startsWith('清空站点数据'))).toBe(false)
    // 反面：必须有一句明确写清「不会清空整个浏览器」
    expect(CLEAR_GLOBAL_LIMITS[1]).toContain('不会清空整个浏览器')
  })

  it('动作 1 只清业务对象：保留密码与 AI Key，并说明不会顺手删掉 Key', () => {
    const layer = buildClearLayers(SYNTHETIC_STATUS).find((item) => item.id === 'clear-objects')
    expect(layer).toBeDefined()
    if (layer === undefined) {
      return
    }
    expect(layer.removes.join('\n')).toContain('7 条')
    expect(layer.keeps.join('\n')).toContain('密码')
    expect(layer.keeps.join('\n')).toContain('AI Key')
    expect(layer.removes.join('\n')).toContain('objects')
  })

  it('动作 2 只删秘密槽位：不牵入任何业务对象', () => {
    const layer = buildClearLayers(SYNTHETIC_STATUS).find((item) => item.id === 'delete-ai-key')
    expect(layer).toBeDefined()
    if (layer === undefined) {
      return
    }
    expect(layer.removes.join('\n')).toContain('secrets')
    expect(layer.keeps.join('\n')).toContain('数据集')
    // 模型层的双向断言：动作 2 不碰 objects，动作 1 不碰 secrets
    expect(clearActionTouchesObjects('delete-ai-key')).toBe(false)
    expect(clearActionTouchesSecret('delete-ai-key')).toBe(true)
    expect(clearActionTouchesObjects('clear-objects')).toBe(true)
    expect(clearActionTouchesSecret('clear-objects')).toBe(false)
    expect(clearActionTouchesObjects('clear-vault')).toBe(true)
    expect(clearActionTouchesSecret('clear-vault')).toBe(true)
  })

  it('动作 3 删除整个数据库，并保留已下载文件与其他应用的数据', () => {
    const layer = buildClearLayers(SYNTHETIC_STATUS).find((item) => item.id === 'clear-vault')
    expect(layer).toBeDefined()
    if (layer === undefined) {
      return
    }
    expect(layer.removes.join('\n')).toContain('synthetic-vault-db')
    expect(layer.keeps.join('\n')).toContain('下载')
    expect(layer.keeps.join('\n')).toContain('其他应用')
  })

  it('每个动作映射到门面上真实存在的方法名（不绕过 encryptedVault）', () => {
    expect(clearActionFacadeMethod('clear-objects')).toBe('clearObjects')
    expect(clearActionFacadeMethod('delete-ai-key')).toBe('deleteSecret')
    expect(clearActionFacadeMethod('clear-vault')).toBe('clearAll')
  })

  it('未读到仓状态时显示「未知」，不显示 0 或空库名', () => {
    const layers = buildClearLayers(null)
    const removes = layers[0]?.removes.join('\n') ?? ''
    expect(removes).toContain('未知')
    expect(removes).not.toContain('0 条')
    expect(layers[2]?.removes.join('\n')).toContain('未知')
  })

  it('AI-6：清空整个本地仓同时含 Key 与 AI 历史（三者互不代替的最后一条）', () => {
    const layer = buildClearLayers(SYNTHETIC_STATUS).find((item) => item.id === 'clear-vault')
    expect(layer).toBeDefined()
    if (layer === undefined) {
      return
    }
    const removes = layer.removes.join('\n')
    expect(removes).toContain('全部业务对象')
    expect(removes).toContain('秘密槽位')
    // 「AI 历史」属于业务对象，清业务数据会删它、删 Key 不会删它——两个方向都要在模型里
    const objects = buildClearLayers(SYNTHETIC_STATUS).find((item) => item.id === 'clear-objects')
    expect(objects?.removes.join('\n')).toContain('AI 历史')
    expect(
      buildClearLayers(SYNTHETIC_STATUS)
        .find((item) => item.id === 'delete-ai-key')
        ?.doesNotDelete.join('\n'),
    ).toContain('不会删除 AI 历史')
    // 清全部也会删掉 Key：两条模型断言同时成立
    expect(clearActionTouchesSecret('clear-vault')).toBe(true)
    expect(clearActionTouchesObjects('clear-vault')).toBe(true)
  })

  it('AI-6：清空历史的短语与清业务数据 / 删 Key / 清仓都不同（四者互不代替）', () => {
    const phrases = [
      CLEAR_OBJECTS_PHRASE,
      DELETE_SECRET_PHRASE,
      CLEAR_VAULT_PHRASE,
      CLEAR_AI_HISTORY_PHRASE,
    ]
    expect(new Set(phrases).size).toBe(phrases.length)
  })
})

describe('ClearScopePanel 渲染', () => {
  it('渲染三层范围与两条「做不到」，并带上确认短语', () => {
    const html = renderToStaticMarkup(<ClearScopePanel status={SYNTHETIC_STATUS} />)

    for (const layer of buildClearLayers(SYNTHETIC_STATUS)) {
      expect(html).toContain(layer.label)
      expect(html).toContain(layer.phrase)
    }
    expect(html).toContain('清除数据的范围')
    expect(html).toContain('清除做不到的两件事')
    for (const limit of CLEAR_GLOBAL_LIMITS) {
      expect(html).toContain(limit)
    }
    // 面板不得出现 Markdown 加粗标记（会原样渲染成星号）
    expect(html).not.toContain('**')
  })
})
