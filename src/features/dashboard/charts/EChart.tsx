import { useEffect, useRef, useState } from 'react'

import { loadECharts, type EChartOption, type EChartsInstance } from './echartsLoader'

/** 图表点击事件里我们只用到「点了哪个类目」与「它的下标」（用于下钻筛选），其余字段一概不读 */
export type EChartClickParams = {
  readonly name?: unknown
  readonly dataIndex?: unknown
}

type EChartProps = {
  readonly option: EChartOption
  /** 图表的无障碍名称；读屏用户与键盘用户据此找到同数数据表 */
  readonly ariaLabel: string
  readonly heightPx?: number
  /**
   * 点击柱子 / 折线点时触发。
   *
   * 第二个参数是**类目下标**：类目名可能被截断显示（长中文名），
   * 而筛选需要的是完整取值，因此调用方应当优先用下标回查原始取值。
   */
  readonly onSelectCategory?: (category: string, dataIndex?: number) => void
}

/**
 * 看板图表容器（步骤8）。
 *
 * 三条约定：
 * 1. ECharts **懒加载**：脚本落到独立 chunk，首屏不下载；加载中是明确的「加载中」文字，
 *    不是空白图（PRD 7 章「通用状态」：不能用空白图表掩盖状态）；
 * 2. 加载失败时给出可读提示，并且**下方永远有同数数据表**（PRD 7 章「图表可键盘关联到数据表」），
 *    所以失败不等于看不到数字；
 * 3. 组件不参与任何指标计算：`option` 由调用方用引擎结果拼好，这里只负责渲染与事件。
 */
export default function EChart({
  option,
  ariaLabel,
  heightPx = 280,
  onSelectCategory,
}: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<EChartsInstance | null>(null)
  const clickHandlerRef = useRef<((category: string, dataIndex?: number) => void) | undefined>(
    onSelectCategory,
  )
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    clickHandlerRef.current = onSelectCategory
  }, [onSelectCategory])

  useEffect(() => {
    const element = containerRef.current
    if (element === null) {
      return
    }
    let disposed = false
    let instance: EChartsInstance | null = null
    let observer: ResizeObserver | null = null

    void loadECharts()
      .then((echarts) => {
        if (disposed) {
          return
        }
        instance = echarts.init(element)
        chartRef.current = instance
        setStatus('ready')
        // 容器宽度随窗口变化（Tailwind 栅格）：用 ResizeObserver 而不是 window.onresize，
        // 这样侧边栏折叠等不发 window 事件的变化也能重排
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => {
            instance?.resize()
          })
          observer.observe(element)
        }
      })
      .catch(() => {
        if (!disposed) {
          setStatus('failed')
        }
      })

    return () => {
      disposed = true
      observer?.disconnect()
      instance?.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    const instance = chartRef.current
    if (instance === null || status !== 'ready') {
      return
    }
    // notMerge = true：筛选变化后类目数可能变少，不合并旧数据，避免留下幽灵柱子
    instance.setOption(option, true)
  }, [option, status])

  useEffect(() => {
    const instance = chartRef.current
    if (instance === null || status !== 'ready') {
      return
    }
    const handler = (params: EChartClickParams): void => {
      if (typeof params.name !== 'string') {
        return
      }
      // 下标一并传出：类目名可能被截断显示，下钻需要完整取值（见 props 注释）
      const index = typeof params.dataIndex === 'number' ? params.dataIndex : undefined
      clickHandlerRef.current?.(params.name, index)
    }
    instance.on('click', handler)
    return () => {
      instance.off('click', handler)
    }
  }, [status])

  return (
    <div className="space-y-2">
      <div
        aria-label={ariaLabel}
        className="w-full"
        ref={containerRef}
        role="img"
        style={{ height: `${heightPx}px` }}
      />
      {status === 'loading' && (
        <p className="text-xs text-slate-500">图表库加载中（本地打包的 ECharts，首次进入看板时才加载）…</p>
      )}
      {status === 'failed' && (
        <p className="text-xs text-rose-700">
          图表库未能加载。下方数据表与图表同源，数值不受影响；可刷新页面重试。
        </p>
      )}
    </div>
  )
}
