import type { ImportPhase } from '../../importers'

type ProgressPanelProps = {
  readonly phase: ImportPhase
  readonly ratio: number
  /** 是否真的跑在同源 Worker 里（false = 进程内回退，页面可能短暂忙碌） */
  readonly runsInWorker: boolean
  readonly onCancel: () => void
}

/** 解析进度：只显示阶段与比例，不显示任何单元格内容（docs/PRD.md 10.4） */
export default function ProgressPanel({ phase, ratio, runsInWorker, onCancel }: ProgressPanelProps) {
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)))

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-slate-900">
          正在{phase}
          <span className="ml-2 text-slate-500">{percent}%</span>
        </p>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          onClick={onCancel}
          type="button"
        >
          取消解析
        </button>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-900 transition-[width]" style={{ width: `${percent}%` }} />
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {runsInWorker
          ? '解析在同源 Worker 后台线程执行，页面不会卡住。'
          : '当前环境不支持 Worker，解析在页面线程执行：大文件时界面可能短暂无响应。'}
        {' '}
        取消只会丢弃这一次解析，不会改动已有数据。
      </p>
    </div>
  )
}
