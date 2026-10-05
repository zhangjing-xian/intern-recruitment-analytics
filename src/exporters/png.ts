/**
 * PNG 图表导出（步骤11，docs/PRD.md 11.2「图片」行）。
 *
 * 三条硬规则：
 * 1. **离屏渲染、绝不截图看板**：图表从「脱敏后的图表规格」重新渲染，
 *    而不是把屏幕上的 DOM 截下来——截屏会把筛选面板、明细表、tooltip 一起带进图片（PRD 11.2 明令禁止）；
 * 2. **ECharts 仍走既有懒加载通道**：只能经 `features/dashboard/charts/echartsLoader.ts` 的动态
 *    `import()` 使用，本文件**不得**静态 `import 'echarts'`（AGENTS.md §3 的两条禁令）；
 * 3. **可注入 canvas 工厂**：Node 里没有 `document`，真实 PNG 字节需要浏览器，
 *    因此把「造一个 canvas」这件事抽成 `CanvasFactory`，测试里可以注入假实现来验证
 *    编码解码与坐标轴 / 数据那一半逻辑；真实像素渲染在 Node 中**未验证**（见文件末尾说明）。
 */

import type { ChartSpecInput, SanitizedReport } from '../privacy'

import type {
  CanvasFactory,
  CanvasLike,
  OffscreenChartRenderer,
} from './pngTypes'

/* ------------------------------------------------------------------ 类型契约 */

// 共享结构类型定义在 `./pngTypes.ts`（叶子模块，图表层也用同一套），这里只做转发，
// 让导出层的使用者不必知道那个文件的存在。
export type { CanvasFactory, CanvasLike, OffscreenChartRenderer } from './pngTypes'

export type ChartRasterOptions = {
  readonly width?: number
  readonly height?: number
  /** 设备像素比（PRD 11.2「按图表组件真实尺寸和 DPI 渲染」）；默认 2 */
  readonly pixelRatio?: number
  readonly backgroundColor?: string
  /**
   * 水印文案（可空）。只允许传「数据截至日 + 脱敏级别」这类非敏感信息——
   * 水印会进入图片像素，敏感值一旦写上就无法撤回。
   */
  readonly watermark?: string
  /** 注入的 canvas 工厂；不传时在浏览器里用 `document.createElement` */
  readonly createCanvas?: CanvasFactory
  /** 注入的离屏渲染器；不传时走看板的懒加载 ECharts */
  readonly renderOffscreen?: OffscreenChartRenderer
}

/* ------------------------------------------------------------------ 编码工具 */

/** data URL 的 base64 → 字节；非法输入返回 null（不抛错，由调用方给安全失败文案） */
export function decodeBase64Bytes(base64: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  const lookup = new Map<string, number>()
  for (let index = 0; index < alphabet.length; index += 1) {
    lookup.set(alphabet[index], index)
  }

  const clean = base64.replace(/\s/g, '').replace(/=+$/, '')
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of clean) {
    const value = lookup.get(char)
    if (value === undefined) {
      return null
    }
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(bytes)
}

/** 从 `data:image/png;base64,...` 取出字节；不是 PNG data URL 时返回 null */
export function pngBytesFromDataUrl(dataUrl: string): Uint8Array | null {
  const matched = /^data:image\/png;base64,(.*)$/s.exec(dataUrl)
  if (matched === null) {
    return null
  }
  return decodeBase64Bytes(matched[1])
}

/* ------------------------------------------------------------------ 图表规格 → ECharts option */

/**
 * 直接从脱敏报告构造图表规格（**新增**，不改动 `ChartSpecInput` 契约）。
 *
 * 为什么放在导出层而不是组件里：图的类目就是分组标签，而分组标签的脱敏口径
 * （HR 代号、小组合并、被抑制组不显示）只在报告模型里成立。
 * 让调用方自己拼 `categories`，就等于把「图上会出现什么文字」这条规则交给了组件，
 * 一旦有人把真实分组值塞进去，PNG 就会成为唯一的泄漏点——而且是图片，检索不出来。
 *
 * 口径：
 * - 每个维度一张柱状图，类目 = 该维度**未被抑制**的分组标签 + 合计行；
 * - 被抑制的分组一律不进图（图上没有「—」这种东西，只能不画）；
 * - 序列只有两个：N（总数）与 D（核心分母），都是计数，不含任何金额与分位。
 */
export function buildChartSpecsFromReport(report: SanitizedReport): readonly ChartSpecInput[] {
  return report.dimensions
    .filter((dimension) => dimension.groups.some((group) => !group.suppressed))
    .map((dimension) => {
      const visible = dimension.groups.filter((group) => !group.suppressed)
      return {
        id: `chart.${dimension.dimension}`,
        title: `各${dimension.label}的记录数与核心分母（含合计）`,
        kind: 'bar' as const,
        categories: [...visible.map((group) => group.label), '合计'],
        series: [
          {
            name: 'N 记录数（含审批中）',
            values: [...visible.map((group) => group.total), dimension.total],
          },
          {
            name: 'D 核心分母（J + P + R）合计',
            values: [...visible.map((group) => group.coreDenominator), dimension.total],
          },
        ],
      }
    })
}

/**
 * 把脱敏后的图表规格转成 ECharts option。
 *
 * 为什么 option 只从这里生成：图的类目就是分组标签，而分组标签已经过脱敏
 * （HR 是代号、小区组已合并）。让调用方自己传 option，就等于把「图上会出现什么文字」
 * 这条规则交给了组件，四种格式的图注一致性也就无从保证。
 */
export function buildChartOption(spec: ChartSpecInput): Record<string, unknown> {
  return {
    // 无障碍：读屏用户与键盘用户据此知道这张图在说什么（PRD 8 章要求图表可关联到数据表）
    aria: { enabled: true, decal: { show: false }, description: spec.title },
    tooltip: { trigger: 'axis' },
    legend: { data: spec.series.map((serie) => serie.name), bottom: 0 },
    grid: { left: 48, right: 24, top: 48, bottom: 48, containLabel: true },
    xAxis: { type: 'category', data: [...spec.categories], axisLabel: { interval: 0 } },
    yAxis: { type: 'value' },
    series: spec.series.map((serie) => ({
      name: serie.name,
      type: spec.kind,
      data: [...serie.values],
      smooth: false,
    })),
  }
}

/* ------------------------------------------------------------------ 离屏渲染 */

function browserCanvasFactory(): CanvasLike {
  const element = document.createElement('canvas')
  return element as unknown as CanvasLike
}

/**
 * 离屏渲染图表 PNG。
 *
 * 渲染流程：注入 / 浏览器提供的 canvas → ECharts SSR 实例（`renderer: 'canvas'`、`ssr: true`）
 * → `renderToCanvas()` 得到像素 → `toDataURL('image/png')` → 解出字节。
 *
 * **未验证的部分（如实说明）**：Node 环境没有真实 canvas 与 rasterizer，
 * 因此「真实 PNG 字节」只能由浏览器产生，本仓库的自动化测试只覆盖到
 * 「数据 URL → 字节」的解码与 option 生成；像素级结果**未在浏览器中验证**。
 */
export async function renderChartPng(
  spec: ChartSpecInput,
  options: ChartRasterOptions = {},
): Promise<Uint8Array> {
  const width = options.width ?? 960
  const height = options.height ?? 540
  const pixelRatio = options.pixelRatio ?? 2
  const createCanvas = options.createCanvas ?? browserCanvasFactory
  const backgroundColor = options.backgroundColor ?? '#ffffff'

  let render: OffscreenChartRenderer | undefined = options.renderOffscreen
  if (render === undefined) {
    // 动态 import：ECharts 只在这条路径上被加载，不进入首屏 chunk
    const { loadECharts } = await import('../features/dashboard/charts/echartsLoader')
    const echarts = await loadECharts()
    render = echarts.renderOffscreen
  }

  const holder = createCanvas()
  holder.width = Math.round(width * pixelRatio)
  holder.height = Math.round(height * pixelRatio)

  const canvas = render({
    element: holder,
    option: withWatermark(buildChartOption(spec), options.watermark),
    width,
    height,
    pixelRatio,
    backgroundColor,
  })
  const bytes = pngBytesFromDataUrl(canvas.toDataURL('image/png'))
  if (bytes === null) {
    throw new Error('离屏渲染没有产出 PNG data URL：当前环境不支持 canvas 光栅化')
  }
  return bytes
}

/**
 * 加水印。
 *
 * 水印只允许放**非敏感**信息（数据截至日 + 脱敏级别 + 报告标题）。它进入的是图片像素，
 * 一旦写错就无法撤回——所以这里不做任何「自动带上分组标签 / HR 代号」的扩展。
 */
export function withWatermark(
  option: Record<string, unknown>,
  watermark?: string,
): Record<string, unknown> {
  if (watermark === undefined || watermark.trim() === '') {
    return option
  }
  return {
    ...option,
    graphic: [
      {
        type: 'text',
        right: 16,
        bottom: 8,
        silent: true,
        style: {
          text: watermark,
          fill: 'rgba(15, 23, 42, 0.28)',
          fontSize: 12,
        },
      },
    ],
  }
}
