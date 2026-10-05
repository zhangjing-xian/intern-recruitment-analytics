/**
 * 打印版 HTML 与 PNG 离屏渲染测试（步骤11，docs/PRD.md 11.2 / 11.5）。
 *
 * 打印版与 Markdown 同源（都来自 `reportToSections`），因此这里重点验证：
 * 1. 专用版式真的存在（`@page`、本地中文字体栈、页眉页脚）且**零外部资源**；
 * 2. 页面里没有任何哨兵，HTML 转义正确（不给 `dangerouslySetInnerHTML` 留把柄）；
 * 3. PNG：`data:` URL → 字节的解码正确；离屏渲染器被正确调用；
 *    **真实 PNG 像素在 Node 里未验证**（没有 rasterizer），这一点在测试里也如实写明。
 */

import { describe, expect, it, vi } from 'vitest'

import { findSensitiveFields } from '../privacy'

import { buildChartSpecsFromReport, buildChartOption, decodeBase64Bytes, pngBytesFromDataUrl, renderChartPng, withWatermark } from './png'
import type { CanvasLike, OffscreenRenderInput } from './pngTypes'
import { PRINT_STYLE, escapeHtml, exportPrintHtml } from './print'
import { buildExportReport, exportSentinelTokens } from './testFixture'

/* ------------------------------------------------------------------ 打印版 */

describe('exportPrintHtml', () => {
  it('产出专用打印版式：@page、中文字体栈、页眉页脚都在', () => {
    const result = exportPrintHtml(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    expect(result.artifact.format).toBe('pdf')
    expect(result.artifact.text).toContain('<!doctype html>')
    expect(result.artifact.text).toContain('@page')
    expect(result.artifact.text).toContain('Microsoft YaHei')
    expect(result.artifact.text).toContain('print-footer')
    expect(result.artifact.text).toContain('另存为 PDF')
    expect(result.artifact.fileName.endsWith('.pdf')).toBe(true)
  })

  it('零外部资源：不含 http(s) 链接、不含 <img>、不含 @import / 在线字体', () => {
    const result = exportPrintHtml(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    const html = result.artifact.text
    expect(html.includes('http://')).toBe(false)
    expect(html.includes('https://')).toBe(false)
    expect(html.includes('<img')).toBe(false)
    expect(html.includes('<script')).toBe(false)
    expect(html.includes('@import')).toBe(false)
    expect(html.includes('fonts.googleapis')).toBe(false)
    expect(PRINT_STYLE.includes('url(')).toBe(false)
  })

  /*
   * 用户需求 ③：打印 / PDF 要带图。三条断言分别对应三件必须成立的事：
   * 1. 给了本机 PNG 就真的嵌进去（且仍然零外部资源：只有 data: URL）；
   * 2. 来路不明的图（http 链接、非 PNG）一律丢弃——绝不能把远程引用写进一份「本机报告」；
   * 3. 没有给定图时与从前逐字节一致（步骤11 的既有断言因此仍然有效）。
   */
  it('给定本机 PNG 时把图嵌进打印版，且仍然零外部资源', () => {
    const result = exportPrintHtml(buildExportReport(), [
      {
        title: '渠道记录数',
        note: '由本机根据脱敏报告重绘，不是界面截图。',
        dataUrl: 'data:image/png;base64,aGVsbG8=',
      },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    const html = result.artifact.text
    expect(html).toContain('<h2>图表</h2>')
    expect(html).toContain('渠道记录数')
    expect(html).toContain('src="data:image/png;base64,aGVsbG8="')
    expect(html.includes('http://')).toBe(false)
    expect(html.includes('https://')).toBe(false)
    expect(html.includes('<script')).toBe(false)
  })

  it('非本机 PNG 的图一律丢弃：http 链接与伪造的 data URL 都不会出现在打印版里', () => {
    const result = exportPrintHtml(buildExportReport(), [
      { title: '远程图', note: '不该出现', dataUrl: 'https://example.test/chart.png' },
      { title: '假 data URL', note: '不该出现', dataUrl: 'data:image/png;base64,不是合法 base64!!' },
      { title: '合法图', note: '应当出现', dataUrl: 'data:image/png;base64,aGVsbG8=' },
    ])
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    const html = result.artifact.text
    expect(html).not.toContain('远程图')
    expect(html).not.toContain('假 data URL')
    expect(html).not.toContain('example.test')
    // 合法的这一张仍然在，说明是「丢弃非法项」而不是「整块跳过」
    expect(html).toContain('合法图')
  })

  it('不给图时与从前一致：没有图表小节', () => {
    const result = exportPrintHtml(buildExportReport(), [])
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }
    expect(result.artifact.text).not.toContain('<h2>图表</h2>')
    expect(result.artifact.text.includes('<img')).toBe(false)
  })

  it('页面里不含任何哨兵，且导出前的本地检查放行', () => {    const result = exportPrintHtml(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }

    const tokens = exportSentinelTokens()
    for (const token of tokens) {
      expect(result.artifact.text.includes(token), `打印版里出现了哨兵：${token}`).toBe(false)
    }
    expect(findSensitiveFields(result.artifact.text, tokens)).toEqual([])
  })

  it('默认不含明细表', () => {
    const result = exportPrintHtml(buildExportReport())
    expect(result.ok).toBe(true)
    if (!result.ok || result.artifact.text === null) {
      return
    }
    expect(result.artifact.text).toContain('本次未开启记录级明细')
  })
})

describe('escapeHtml', () => {
  it('转义五个 HTML 元字符，杜绝把分组标签当标签渲染', () => {
    expect(escapeHtml('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;')
    expect(escapeHtml('其他（3 个分组合并）')).toBe('其他（3 个分组合并）')
  })
})

/* ------------------------------------------------------------------ PNG */

/** 假 canvas：只实现 `pngTypes.CanvasLike` 要求的三个成员 */
function fakeCanvas(dataUrl: () => string): CanvasLike {
  return {
    width: 0,
    height: 0,
    toDataURL: dataUrl,
  }
}

/** 1x1 透明 PNG 的合法字节 */
const ONE_PIXEL_PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function base64Of(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
}

describe('PNG 编码工具', () => {
  it('decodeBase64Bytes 解出与输入一致的字节，非法输入返回 null', () => {
    const decoded = decodeBase64Bytes(base64Of(ONE_PIXEL_PNG))
    expect(decoded).not.toBeNull()
    expect(Array.from(decoded ?? [])).toEqual(Array.from(ONE_PIXEL_PNG))
    expect(decodeBase64Bytes('!!!!')).toBeNull()
  })

  it('pngBytesFromDataUrl 只接受 PNG data URL', () => {
    const url = `data:image/png;base64,${base64Of(ONE_PIXEL_PNG)}`
    expect(Array.from(pngBytesFromDataUrl(url) ?? [])).toEqual(Array.from(ONE_PIXEL_PNG))
    expect(pngBytesFromDataUrl('data:image/jpeg;base64,AAAA')).toBeNull()
    expect(pngBytesFromDataUrl('https://example.com/a.png')).toBeNull()
  })
})

describe('buildChartSpecsFromReport / buildChartOption', () => {
  it('图表规格只使用未被抑制的分组标签，被抑制的组不进图', () => {
    const report = buildExportReport()
    const specs = buildChartSpecsFromReport(report)

    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(spec.categories).toContain('合计')
      for (const token of exportSentinelTokens()) {
        expect(spec.categories.join('|').includes(token)).toBe(false)
      }
    }
    // 每个 spec 的类目数 = 可见分组数 + 合计
    const dimension = report.dimensions[0]
    const visible = dimension.groups.filter((group) => !group.suppressed).length
    const spec = specs.find((item) => item.id === `chart.${dimension.dimension}`)
    expect(spec?.categories.length).toBe(visible + 1)
    expect(spec?.series[0].values.length).toBe(visible + 1)
  })

  it('option 用柱 / 折线 + 类目轴，且类目就是脱敏后的分类标签', () => {
    const spec = buildChartSpecsFromReport(buildExportReport())[0]
    const option = buildChartOption(spec)

    expect(option.xAxis).toBeDefined()
    expect(JSON.stringify(option)).toContain(spec.title)
    expect((option.series as readonly { type: string }[])[0].type).toBe('bar')
    // 无障碍描述必须存在（读屏用户靠它知道这张图讲什么）
    expect(JSON.stringify(option.aria)).toContain(spec.title)
  })

  it('水印只作为可选的 graphic 文本，未提供时不改 option', () => {
    const option = { a: 1 }
    expect(withWatermark(option)).toBe(option)
    const withMark = withWatermark(option, '数据截至日 2026-09-26 ｜ standard')
    expect(JSON.stringify(withMark)).toContain('数据截至日 2026-09-26')
    expect(withWatermark(option, '   ')).toBe(option)
  })
})

describe('renderChartPng（注入式离屏渲染）', () => {
  it('调用注入的渲染器并返回解码后的 PNG 字节', async () => {
    const render = vi.fn(
      (_input: OffscreenRenderInput): CanvasLike =>
        fakeCanvas(() => `data:image/png;base64,${base64Of(ONE_PIXEL_PNG)}`),
    )
    const spec = buildChartSpecsFromReport(buildExportReport())[0]

    const bytes = await renderChartPng(spec, {
      createCanvas: () => fakeCanvas(() => 'data:,') ,
      renderOffscreen: render,
      width: 800,
      height: 450,
      pixelRatio: 2,
      watermark: '数据截至日 2026-09-26 ｜ standard',
    })

    expect(Array.from(bytes)).toEqual(Array.from(ONE_PIXEL_PNG))
    expect(render).toHaveBeenCalledTimes(1)
    const call = render.mock.calls[0][0]
    expect(call.width).toBe(800)
    expect(call.height).toBe(450)
    expect(call.pixelRatio).toBe(2)
    expect(JSON.stringify(call.option)).toContain('数据截至日 2026-09-26')
    // 容器尺寸按 DPI 放大
    expect(call.element.width).toBe(1600)
    expect(call.element.height).toBe(900)
  })

  it('渲染器没给出 PNG data URL 时抛错（而不是返回空字节冒充成功）', async () => {
    const spec = buildChartSpecsFromReport(buildExportReport())[0]
    await expect(
      renderChartPng(spec, {
        createCanvas: () => fakeCanvas(() => 'data:,'),
        renderOffscreen: () => fakeCanvas(() => 'data:,'),
      }),
    ).rejects.toThrow('离屏渲染没有产出 PNG data URL')
  })

  /*
   * 未验证部分（如实标注，而不是假装测过）：
   * Node 环境没有真实 canvas 光栅化实现，因此这里**不可能**产出真实 PNG 像素。
   * 本用例只覆盖到「注入的渲染器被调用 → data URL 解码 → 字节返回」这一段；
   * 真实像素、字体、水印在图片里的位置必须在浏览器里人工验证（步骤14 的端到端测试范围）。
   */
  it('（未验证）真实 PNG 像素只能在浏览器里验证：Node 侧仅验证到解码与调用契约', () => {
    expect(true).toBe(true)
  })
})
