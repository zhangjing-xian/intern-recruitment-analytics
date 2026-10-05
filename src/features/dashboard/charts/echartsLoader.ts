/**
 * ECharts 懒加载入口（步骤8）。
 *
 * 为什么必须懒加载：ECharts 完整包压缩后仍是数百 kB，而本应用的**首屏是导入页**。
 * 若在看板里静态 `import 'echarts'`，ECharts 会跟着 `App.tsx` 的静态路由一起进入首屏包，
 * 直接让首屏体积翻倍。这里沿用加密仓（`storage/vaultFacade.ts` 的 `encryptedVault`）的既有约定：
 * **静态只 `import type`，运行时用动态 `import()`**，让 ECharts 落到独立 chunk，
 * 只有进入看板并真正渲染图表时才加载。
 *
 * 依然是**本地打包**（`package.json` 依赖 + 构建产物），**不是** CDN，也不加载任何远程脚本 / 字体
 * （AGENTS.md §2.1、§6；PRD 13.2「所有依赖本地打包，不使用 CDN」）。
 *
 * 按需注册（写法对照 ECharts 官方文档 handbook/zh/basics/import「按需引入」）：
 * 只注册用得到的柱状图 / 折线图 / 散点图、直角坐标系、提示框、图例、无障碍与 Canvas 渲染器。
 * 用不到 3D / 地图 / 数据集转换器就不注册，避免把体积浪费在没用的模块上。
 */

import type { BarSeriesOption, LineSeriesOption, ScatterSeriesOption } from 'echarts/charts'
import type {
  AriaComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from 'echarts/components'
import type { ComposeOption, EChartsType } from 'echarts/core'

import type { CanvasLike, OffscreenChartRenderer } from '../../../exporters/pngTypes'

/** 只组合出本看板真正用到的最小 Option 类型；少注册模块会在编译期就报错 */
export type EChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | ScatterSeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | AriaComponentOption
>

export type EChartsInstance = EChartsType

export type EChartsApi = {
  readonly init: (element: HTMLElement) => EChartsInstance
  /**
   * 离屏渲染一张图并返回带像素的 canvas（步骤11 的 PNG 导出唯一入口）。
   *
   * 签名与导出层的 `OffscreenChartRenderer` 完全一致（共享 `exporters/pngTypes.ts` 的
   * 结构类型），这样两边不靠强制类型转换就能接上；容器只作为 SSR 宿主，
   * 尺寸与 DPI 由调用方给出，不读 DOM 布局。
   */
  readonly renderOffscreen: OffscreenChartRenderer
}

let pending: Promise<EChartsApi> | null = null

/**
 * 加载并注册 ECharts（模块级缓存：同一标签页只加载一次）。
 *
 * 真正的注册发生在 `./echartsRegister.ts`：那里用具名导入写出必须的模块，
 * 打包器才能按属性做 tree-shaking（见该文件注释）。
 * 失败时把 promise 清掉，允许重试（不缓存失败结果，避免一次解析 / 加载问题让整个会话再也画不出图）。
 */
export function loadECharts(): Promise<EChartsApi> {
  if (pending === null) {
    pending = import('./echartsRegister').then((module) => ({
      init: module.initChart,
      // 结构类型直接接上：`renderOffscreenChart` 返回 `HTMLCanvasElement`，
      // 它是 `CanvasLike` 的结构子类型（多出的方法不会被用到）。
      renderOffscreen: (input): CanvasLike =>
        module.renderOffscreenChart({
          element: input.element,
          option: input.option,
          width: input.width,
          height: input.height,
          pixelRatio: input.pixelRatio,
          backgroundColor: input.backgroundColor,
        }),
    }))
    pending = pending.catch((error: unknown) => {
      pending = null
      throw error
    })
  }
  return pending
}
