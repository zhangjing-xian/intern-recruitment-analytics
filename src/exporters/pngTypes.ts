/**
 * PNG 离屏渲染的**共享结构类型**（步骤11）。
 *
 * 为什么单独一个叶子模块：导出层（`exporters/png.ts`）与图表层
 * （`features/dashboard/charts/echartsRegister.ts`）需要同一套 canvas / 渲染器签名，
 * 而 `png.ts` 又必须用动态 `import()` 调 `echartsLoader.ts`（静态引用会把 ECharts 拉进首屏包）。
 * 把类型放在这里，两边都只依赖这个**没有任何运行时依赖**的文件：
 * 既避免了循环 import，也不会把 ECharts 类型带进导出层的编译单元。
 *
 * 注意这里只描述我们真正用到的能力（`getContext` / `toDataURL`），
 * 而不是完整的 `HTMLCanvasElement`：Node 测试里注入的假 canvas 才可能满足它。
 */

/**
 * 离屏渲染需要的最小 canvas 能力。
 *
 * 刻意**只要求** `width` / `height` / `toDataURL`：
 * 1. ECharts SSR 渲染在内部自己创建绘图用的 canvas（`platformApi.createCanvas()`），
 *    传进来的容器只承担「宿主尺寸」与「取像素」两件事；
 * 2. 要求得越少，`HTMLCanvasElement` 越能自然地满足它（不需要强制类型转换），
 *    Node 测试里注入假 canvas 也越容易——这是「可注入 canvas 工厂」能落地的前提。
 */
export type CanvasLike = {
  width: number
  height: number
  toDataURL: (type?: string, quality?: number) => string
}

/** 造 canvas 的工厂；浏览器里是 `document.createElement('canvas')`，测试里注入假实现 */
export type CanvasFactory = () => CanvasLike

/**
 * 离屏渲染的入参。
 *
 * `element` 在 ECharts SSR 下**只作为容器概念**使用：尺寸来自 `width` / `height`，
 * ECharts 不读 DOM 布局、也不需要真实的浏览器 canvas 实现。
 */
export type OffscreenRenderInput = {
  readonly element: CanvasLike
  readonly option: unknown
  readonly width: number
  readonly height: number
  readonly pixelRatio: number
  readonly backgroundColor: string
}

/** 离屏渲染器：吃 `<canvas>` 规格，吐带像素的 canvas */
export type OffscreenChartRenderer = (input: OffscreenRenderInput) => CanvasLike
