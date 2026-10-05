/**
 * ECharts 注册模块（**只能被动态 `import()` 加载**，见 `./echartsLoader.ts`）。
 *
 * 为什么单独一个文件：这里用官方文档推荐的**具名导入**（`import { BarChart } from 'echarts/charts'`），
 * 打包器才能按属性做 tree-shaking，把用不到的地图 / Geo / 数据集转换器模块整个丢掉。
 * 若在 `echartsLoader.ts` 里写 `const charts = await import('echarts/charts')` 再访问
 * `charts.BarChart`，rollup 对命名空间对象的属性访问保守处理，会把整个 barrel 都保留下来
 * （实测会多出 parseGeoJson 等 ~400 kB 的懒加载 chunk）。
 *
 * 这个文件被静态导入也**不会**进入首屏：`App.tsx` 只静态引用页面，页面引用 `EChart.tsx`，
 * 而 `EChart.tsx` 只通过 `echartsLoader.ts` 动态加载本文件。
 */

import * as echarts from 'echarts/core'
import { BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import type { OffscreenRenderInput } from '../../../exporters/pngTypes'

// 只注册本看板真正用到的模块：柱状图 / 折线图 / 散点图 + 直角坐标系 + 提示框 + 图例 + 无障碍 + Canvas 渲染
// 散点图用于步骤9「岗位 / 序列 / 部门」的量率图（横轴 D、纵轴拒 offer 率），仍属懒加载 chunk，不进首屏。
echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
])

/** 初始化一个图表实例（容器由调用方提供） */
export function initChart(element: HTMLElement): echarts.EChartsType {
  return echarts.init(element)
}

/**
 * 离屏渲染一张图并返回带像素的 canvas（步骤11 的 PNG 导出用）。
 *
 * 为什么放在这个模块：它需要 `echarts.init`，而本模块是**唯一**允许接触 `echarts` 的地方
 * （且只被动态 `import()` 加载）。放在导出层就等于让导出层静态依赖 ECharts，
 * 首屏包会直接翻倍（AGENTS.md §3 的两条禁令）。
 *
 * 为什么用 `ssr: true`：SSR 模式下 ECharts 不依赖 DOM 布局与动画帧，
 * 传入 width / height 即可同步渲染完成，`renderToCanvas()` 立刻能拿到完整像素，
 * 不需要 `setTimeout` 等动画（等待时长不确定，会导致导出偶发空图）。
 *
 * 渲染完必须 `dispose()`：离屏实例持有 canvas 与事件绑定，反复导出而不释放会累积内存。
 */
export function renderOffscreenChart(input: OffscreenRenderInput): HTMLCanvasElement {
  // 容器在 SSR 模式下只起「画布宿主」的作用：尺寸来自 width / height，不读 DOM 布局。
  // 这里用 `new OffscreenCanvas(...)` 不可行（ECharts 需要 zrender 的 DOM 宿主），
  // 因此由调用方（导出层）通过注入的 canvas 工厂提供宿主对象。
  const instance = echarts.init(input.element as unknown as HTMLElement, null, {
    renderer: 'canvas',
    ssr: true,
    width: input.width,
    height: input.height,
    devicePixelRatio: input.pixelRatio,
  })
  try {
    instance.setOption(input.option as Parameters<typeof instance.setOption>[0], true)
    return instance.renderToCanvas({
      backgroundColor: input.backgroundColor,
      pixelRatio: input.pixelRatio,
    })
  } finally {
    instance.dispose()
  }
}
