/**
 * 右上角「AI 深度分析」入口（docs/PRD.md 16.2、步骤8 的入口 + AI-1 接通预览 + AI-3 接开关）。
 *
 * 历史：
 * - 步骤8 时这里是一个**常驻禁用**的占位按钮——当时链路还没实现，提前放一个能联网的按钮
 *   等于绕过「默认不发数据」这条硬约束；
 * - AI-1 起按钮**可以点**，但它只做一件事——展开/收起本地预览工作区。
 *   点击本身不生成摘要、不发请求；预览是纯本机计算，确认也只是消费一次性令牌；
 * - AI-3 起按钮**始终可点**（含 AI 关闭时）：用户需要看到「功能存在但没打开」，
 *   而不是面对一个消失的入口。开关状态由工作区内的提示与设置页负责说明。
 *
 * 真实网络调用属于 AI-4，文案里必须说清这一点，不能让用户以为「点了就发出去了」。
 */

import { formatInteger } from '../../lib/format'

import {
  AI_DISABLED_NOTE,
  AI_ENTRY_BUTTON_LABEL,
  AI_ENTRY_COLLAPSE_LABEL,
  AI_ENTRY_NOTE,
  AI_ENTRY_UNSAVED_NOTE,
} from '../ai/aiText'

type AiAnalysisButtonProps = {
  /** 当前筛选后的记录数（用于说明「有多少数据可被摘要」） */
  readonly recordCount: number
  /** 预览工作区是否已展开 */
  readonly open: boolean
  /** AI 开关是否已打开（关闭时按钮仍可点开工作区，但工作区里不能生成预览） */
  readonly enabled: boolean
  /**
   * 这一份产物是否**因为自身 CSP 而不可能用 AI**（本地版 / 公开部署的那一份）。
   *
   * 此时整个入口不渲染：给一个必然失败的按钮不符合「提示语必须与事实一致」，
   * 事实由看板用同一句话说明（见 `src/lib/aiAvailability.ts`）。
   */
  readonly hidden?: boolean
  readonly onToggle: () => void
}

export default function AiAnalysisButton({
  recordCount,
  open,
  enabled,
  hidden = false,
  onToggle,
}: AiAnalysisButtonProps) {
  if (hidden) {
    return null
  }
  return (
    <div className="flex max-w-sm flex-col items-start gap-1 sm:items-end">
      <button
        aria-expanded={open}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        onClick={onToggle}
        type="button"
      >
        {open ? AI_ENTRY_COLLAPSE_LABEL : AI_ENTRY_BUTTON_LABEL}
      </button>
      <p className="text-xs leading-5 text-slate-500">
        当前状态：{enabled ? 'AI 已开启' : 'AI 已关闭（默认）'}。
        {enabled ? AI_ENTRY_NOTE : AI_DISABLED_NOTE}
        {recordCount > 0 ? `当前筛选下可用于摘要的记录：${formatInteger(recordCount)} 条。` : ''}
      </p>
      {open ? null : (
        <p className="text-xs leading-5 text-slate-500">{AI_ENTRY_UNSAVED_NOTE}</p>
      )}
    </div>
  )
}
