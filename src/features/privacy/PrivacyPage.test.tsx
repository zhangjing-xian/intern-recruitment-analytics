/**
 * 隐私页渲染冒烟测试（步骤12，docs/PRD.md 10.4 / 10.5 / 10.6）。
 *
 * 为什么用 `react-dom/server`：与看板 / 分维度 / 拒 offer 专项同一套理由——
 * 组件测试依赖（Testing Library + jsdom）属于后续步骤，但「页面上到底写了什么」必须被验证。
 * `renderToStaticMarkup` 只跑**渲染**、不跑 effect，因此既不加载任何存储模块，也不可能发请求。
 *
 * 这一页的测试重点不是「有没有渲染」，而是**声明是否成立**：
 * 1. 无 Markdown 加粗标记（`**` 会被原样渲染成星号，前几步踩过这个坑）；
 * 2. 没有过度承诺：不得声称能找回密码，不得声称清除会删掉已下载文件，
 *    不得声称数据一定不会丢；
 * 3. 必需的边界声明逐条在场：无服务端 / 唯一出站例外是可选 DeepSeek 且当前是占位 /
 *    明文不落盘 / 同源共享存储 / 无密码找回 / 清除的两条「做不到」/ 脱敏不承诺不可重新识别。
 *
 * 文案断言全部引用 `privacyText` 的导出常量，而不是把句子抄一遍：
 * 抄一遍会变成「测试自己在测自己」，改文案时看不出任何变化。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { NAV_ITEMS, getNavItem } from '../../lib/navigation'
import PrivacyWorkspace from './PrivacyWorkspace'
import {
  AI_EXCEPTION_STATUS,
  CLEAR_DOES_NOT_DELETE_DOWNLOADS,
  CLEAR_DOES_NOT_TOUCH_OTHER_APPS,
  LOCAL_ONLY_PARAGRAPHS,
  PRIVACY_PAGE_LEAD,
  PRIVACY_PAGE_TEXTS,
  PRIVACY_PAGE_TITLE,
  SANITIZE_PARAGRAPHS,
  STORAGE_BOUNDARY_FACTS,
  STORAGE_PARAGRAPHS,
} from './privacyText'

function renderPrivacyHtml(): string {
  return renderToStaticMarkup(<PrivacyWorkspace />)
}

describe('PrivacyWorkspace 事实声明', () => {
  it('页面渲染出标题与导语，且全部段落都被渲染（不留未使用的文案）', () => {
    const html = renderPrivacyHtml()

    expect(html).toContain(PRIVACY_PAGE_TITLE)
    expect(html).toContain(PRIVACY_PAGE_LEAD)
    for (const paragraph of [
      ...LOCAL_ONLY_PARAGRAPHS,
      ...STORAGE_PARAGRAPHS,
      ...SANITIZE_PARAGRAPHS,
    ]) {
      expect(html).toContain(paragraph)
    }
    for (const fact of STORAGE_BOUNDARY_FACTS) {
      expect(html).toContain(fact.term)
      expect(html).toContain(fact.detail)
    }
  })

  it('声明「没有服务端 / 没有 CDN / 没有埋点」，而不是含糊的「很安全」', () => {
    const localOnly = LOCAL_ONLY_PARAGRAPHS.join('\n')

    expect(localOnly).toContain('没有服务器')
    expect(localOnly).toContain('没有云账号')
    expect(localOnly).toContain('上传接口')
    expect(localOnly).toContain('第三方运行时脚本')
    expect(localOnly).toContain('CDN')
    expect(localOnly).toContain('埋点')
    expect(localOnly).toContain('遥测')
    expect(localOnly).toContain('localStorage')
    expect(localOnly).toContain('Service Worker')
  })

  it('唯一的出站例外是可选 DeepSeek，并写明逐次确认的条件与真实的当前状态', () => {
    const html = renderPrivacyHtml()

    /*
     * 这段断言被修正过两次，每次都因为「文案必须跟着实现走」：
     * 1. AI-1 收尾：原先钉的是「按钮是禁用占位」，AI-1 把入口改成可点开本地脱敏预览后
     *    那句话就成了假话，于是改成钉「预览已可用、网络调用仍未实现」；
     * 2. AI-6：AI-4 交付真实适配器之后，「发出请求尚未实现 / 没有任何出站路径」又成了假话，
     *    于是改成钉**现在的真实状态**——调用已交付，但「浏览器直连是否被允许」仍是未验证项。
     * 这三次的共同点是：状态变了就必须同时改文案与断言，不能只改一处。
     */
    expect(AI_EXCEPTION_STATUS).toContain('一次确认后的真实调用都已交付')
    expect(AI_EXCEPTION_STATUS).toContain('未验证')
    expect(AI_EXCEPTION_STATUS).toContain('不写成可用')
    expect(html).toContain(AI_EXCEPTION_STATUS)
    // 逐次确认：预览要完整、确认只对这一次有效、取消不重试
    expect(html).toContain('AI 深度分析')
    expect(html).toContain('脱敏预览')
    expect(html).toContain('绝不包含')
    expect(html).toContain('Authorization')
    // 发送内容边界：不得出现「把姓名换成代号就可以发送」
    expect(html).toContain('把姓名换成代号不算聚合')
  })

  it('不承诺「所有模式绝不出站」、不声称供应商零保留、不声称会探活', () => {
    const joined = PRIVACY_PAGE_TEXTS.join('\n')

    // 三条都是 AI-6 的验收项：承诺过头的说法一条都不许出现
    expect(joined).toContain('不承诺「所有模式下绝不出站」')
    expect(joined).toContain('默认不出站')
    expect(joined).toContain('不声称供应商零保留')
    expect(joined).toContain('无法保证 DeepSeek 是否保留')
    expect(joined).toContain('不会做探活')
    expect(joined).toContain('不查模型列表')
    expect(joined).toContain('不查余额')
    // 反过来说：不许出现「绝不外发 / 零保留 / 绝不离开设备」这类承诺
    expect(joined).not.toContain('绝不外发')
    expect(joined).not.toContain('供应商零保留。')
    expect(joined).not.toContain('Key 绝不离开设备。')
  })

  it('写明三级脱敏与「本地规则需要确认」，以及代理的可见范围与不托管', () => {
    const joined = PRIVACY_PAGE_TEXTS.join('\n')

    expect(joined).toContain('严格')
    expect(joined).toContain('自定义')
    expect(joined).toContain('只能在标准允许的范围内收窄')
    expect(joined).toContain('需要在设置页确认一次才能发送')
    expect(joined).toContain('代理能看到你的 Key 与脱敏摘要原文')
    expect(joined).toContain('不提供代理程序')
    expect(joined).toContain('撤销旧地址上的 Key 许可')
    expect(joined).toContain('不配置代理时全部本地功能完全可用')
  })

  it('写明存储位置与「明文从不落盘」', () => {
    const storage = STORAGE_PARAGRAPHS.join('\n')

    expect(storage).toContain('内存')
    expect(storage).toContain('刷新页面')
    expect(storage).toContain('IndexedDB')
    expect(storage).toContain('AES-GCM')
    expect(storage).toContain('PBKDF2')
    expect(storage).toContain('明文业务数据从不落盘')
    // 不得夸大：物理内存擦除做不到就写做不到
    expect(storage).toContain('无法保证物理内存级的擦除')
  })

  it('存储边界声明覆盖同源共享、独立配置文件、密码不是系统隔离、没有找回', () => {
    const boundary = STORAGE_BOUNDARY_FACTS.map((fact) => `${fact.term}\n${fact.detail}`).join('\n')

    expect(boundary).toContain('同一来源')
    expect(boundary).toContain('共享')
    expect(boundary).toContain('浏览器配置文件')
    expect(boundary).toContain('操作系统账号')
    expect(boundary).toContain('静态加密')
    expect(boundary).toContain('不是操作系统级的访问控制')
    expect(boundary).toContain('没有密码找回')
    expect(boundary).toContain('加密备份')
    expect(boundary).toContain('清空整个本地仓')
    expect(boundary).toContain('配额不足')
  })

  it('清除的两条「做不到」在页面上逐字在场，并与设置页共用同一份常量', () => {
    const html = renderPrivacyHtml()

    expect(CLEAR_DOES_NOT_DELETE_DOWNLOADS).toContain('无法删除你已经下载到本机的文件')
    expect(CLEAR_DOES_NOT_DELETE_DOWNLOADS).toContain('报告')
    expect(CLEAR_DOES_NOT_DELETE_DOWNLOADS).toContain('备份')
    expect(CLEAR_DOES_NOT_TOUCH_OTHER_APPS).toContain('不会碰同一来源下其他应用')
    expect(html).toContain(CLEAR_DOES_NOT_DELETE_DOWNLOADS)
    expect(html).toContain(CLEAR_DOES_NOT_TOUCH_OTHER_APPS)
  })

  it('脱敏边界声明「降低暴露面」而不是「不可重新识别」', () => {
    const sanitize = SANITIZE_PARAGRAPHS.join('\n')

    expect(sanitize).toContain('脱敏降低的是暴露面')
    expect(sanitize).toContain('不是不可重新识别')
    expect(sanitize).toContain('n 小于 5')
  })
})

describe('PrivacyWorkspace 文案纪律', () => {
  it('全部用户可见文案都没有 Markdown 加粗标记', () => {
    for (const text of PRIVACY_PAGE_TEXTS) {
      expect(text).not.toContain('**')
      expect(text).not.toContain('__')
    }
    // 渲染结果同样不许出现（含属性与结构拼接）
    expect(renderPrivacyHtml()).not.toContain('**')
  })

  it('不存在「可以找回密码」的过度承诺，且明确说出没有找回入口', () => {
    for (const text of PRIVACY_PAGE_TEXTS) {
      expect(text).not.toContain('找回密码')
      expect(text).not.toContain('重置密码')
      expect(text).not.toContain('密码提示问题')
      expect(text).not.toContain('客服')
    }
    const boundary = STORAGE_BOUNDARY_FACTS.map(
      (fact) => `${fact.term}\n${fact.detail}`,
    ).join('\n')
    expect(boundary).toContain('没有密码找回')
    expect(boundary).toContain('不存在第三条路')
  })

  it('不存在「清除会删掉已下载文件」的说法，也没有永久保留的保证', () => {
    const joined = PRIVACY_PAGE_TEXTS.join('\n')

    // 清除相关句子必须是否定式：出现「删除已下载」「删除下载的文件」这类肯定表述即失败
    expect(joined).not.toContain('会删除已下载')
    expect(joined).not.toContain('删除已下载的文件')
    expect(joined).not.toContain('会一并删除导出')
    // 永久性保证不允许出现；相关句子必须是「无法保证 / 可能回收 / 降低概率」
    expect(joined).not.toContain('绝不会丢失')
    expect(joined).not.toContain('永远不会丢失')
    expect(joined).not.toContain('永久保留这些数据')
    expect(joined).not.toContain('绝对安全')
    expect(joined).not.toContain('保证不可识别')
    // 反面：必须明确写出「无法保证数据永久保留」
    const boundary = STORAGE_BOUNDARY_FACTS.map((fact) => fact.detail).join('\n')
    expect(boundary).toContain('无法保证数据永久保留')
  })

  it('不使用 dangerouslySetInnerHTML，也没有任何可点击的出站链接', () => {
    const html = renderPrivacyHtml()

    /*
     * 断言从「不许出现 https://」改成「不许出现链接与资源标签」：
     * AI-6 起这一页必须如实写出**目的地**（`https://api.deepseek.com/chat/completions`），
     * 而它是一段纯文本（React 文本节点），不是可点击链接。真正要防的是
     * 「页面里出现能发起请求或跳转的元素」，因此逐条查标签与属性，而不是查 URL 子串。
     */
    expect(html).not.toContain('<a ')
    expect(html).not.toContain('href=')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
    // 文案里也不许出现 Markdown 链接语法（渲染出来同样是字面量）
    for (const text of PRIVACY_PAGE_TEXTS) {
      expect(text).not.toContain('](')
    }
  })
})

describe('隐私页的路由登记', () => {
  it('/privacy 已登记，且有页面（否则导航与路由会脱节）', () => {
    const paths = NAV_ITEMS.map((item) => item.path)

    expect(paths).toContain('/privacy')
    expect(new Set(paths).size).toBe(paths.length)
    const item = getNavItem('/privacy')
    expect(item.label).toBe('隐私说明')
    expect(item.summary).toContain('本机浏览器')
    expect(item.plannedStep).toBe('步骤12')
  })
})
