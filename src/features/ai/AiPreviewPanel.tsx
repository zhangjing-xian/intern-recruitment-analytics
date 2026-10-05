/**
 * AI 完整脱敏预览面板（AI-1，docs/PRD.md 16.2 / 17.3 / 18.4）。
 *
 * ## 这个组件为什么「什么都摊开」
 *
 * 「逐次确认」只有在用户**能看见全部将要发送的内容**时才有意义。因此本面板刻意不做
 * 「默认折叠、想看再点」：完整 JSON、system 与 user 两条消息、模型与每一项参数、
 * 完整目的地地址、隐私级别、内容大小、引擎给出的**每一条**脱敏说明，全部直接渲染。
 * 只给一句「已脱敏，可放心发送」等于让用户为一个看不见的东西负责。
 *
 * ## 本组件的边界
 *
 * - **纯展示**：不构造载荷、不判断「能不能发」、不消费确认令牌。
 *   脱敏由 `src/privacy/aiSummary.ts` 做，确认与过期判断由 `src/privacy/aiPreview.ts` 做；
 * - **不发请求**：本文件里没有也不允许出现任何网络调用（guard 测试会逐行检查）；
 * - **不用 `dangerouslySetInnerHTML`**：`payloadJson` 与提示词都是模型侧与本地侧的可疑文本，
 *   一律当**文本**渲染（React 会转义），绝不当 HTML 解析（AGENTS.md §6）。
 */

import { formatDateTime, formatInteger } from '../../lib/format'
import { estimateCost, formatCostEstimate, modelSpecOf } from '../../ai/catalog'
import { finishStatusOf, AI_FINISH_REASON_NOTES } from '../../ai/aiResult'
import type { AiPreview } from '../../privacy/aiPreview'

import {
  AI_BYTES_UNIT,
  AI_CANCEL_LABEL,
  AI_CANCEL_REQUEST_LABEL,
  AI_CONFIRM_LABEL,
  AI_CONFIRM_NOTE,
  AI_CONFIRMED_PENDING_NOTE,
  AI_COPY_DONE,
  AI_COPY_FAILED,
  AI_COPY_LABEL,
  AI_FIELD_CONTENT_BYTES,
  AI_FIELD_GENERATED_AT,
  AI_FIELD_HASH,
  AI_FIELD_OMITTED,
  AI_FIELD_PRIVACY_LEVEL,
  AI_FIELD_PROMPT_VERSION,
  AI_FIELD_SCHEMA_VERSION,
  AI_FIELD_SCOPE_ROW_COUNT,
  AI_FIELD_SUPPRESSED_CELL_COUNT,
  AI_LIMITS_EMPTY,
  AI_LATE_RESPONSE_BODY,
  AI_LATE_RESPONSE_TITLE,
  AI_NO_RETRY_NOTE,
  AI_NOT_CONFIRMED_NOTE,
  AI_OMITTED_EMPTY,
  AI_PREVIEW_DESTINATION_LABEL,
  AI_PREVIEW_DESTINATION_NOTE,
  AI_PREVIEW_DESTINATION_TITLE,
  AI_PREVIEW_HASH_HINT,
  AI_PREVIEW_HASH_LABEL,
  AI_PREVIEW_JSON_TITLE,
  AI_PREVIEW_LOCAL_ONLY_NOTE,
  AI_PREVIEW_MESSAGES_TITLE,
  AI_PREVIEW_META_TITLE,
  AI_PREVIEW_NOTES_TITLE,
  AI_PREVIEW_TITLE,
  AI_REQUEST_IN_PROGRESS_BODY,
  AI_REQUEST_IN_PROGRESS_TITLE,
  AI_RESULT_NOT_RENDERED_NOTE,
  AI_SEND_FAILED_TITLE,
  AI_SENT_BODY,
  AI_SENT_HASH_LABEL,
  AI_SENT_TITLE,
  AI_STALE_NOTE,
  AI_SUBMIT_REJECTED_TITLE,
} from './aiText'

/** 复制结果：`idle` = 还没点过；文案用于说明成功或「请手动选择」 */
export type AiCopyState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'copied'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

/* ------------------------------------------------------------------ 发送结果与接缝 */

/*
 * `AiSubmitOutcome` / `AiSubmitClient` / `DEFAULT_CLIENT` 的定义**不在这里**（AI-4）。
 *
 * 为什么搬走：预览面板与工作区都要用这三个名字，而面板本就 import 自工作区
 * （`AiAnalysisWorkspace` 渲染 `AiPreviewPanel`）。把它们留在任一侧都会造成
 * 「A 导 B、B 导 A」的循环，或者一份定义被复制两遍（两份真相）。
 * 因此放进中性模块 `./aiSubmit`，两侧都从那里取。
 */
export type { AiSubmitClient, AiSubmitOutcome } from './aiSubmit'
export { DEFAULT_AI_SUBMIT_CLIENT } from './aiSubmit'
import type { AiSubmitOutcome } from './aiSubmit'
import AiResultPanel from './AiResultPanel'
import { resultViewOf } from './aiResultView'
import type { AiHistoryPayload } from '../../ai/aiHistory'

type AiPreviewPanelProps = {
  readonly preview: AiPreview
  /** 当前预览是否已对不上最新输入（`isPreviewStale` 的结论，由工作区算好） */
  readonly stale: boolean
  /** 是否已存在未消费的确认令牌（确认只对同一 hash 有效） */
  readonly confirmed: boolean
  /** 确认按钮是否可点：预览已过期或令牌已被消费时为 false（防双击重复计费） */
  readonly canConfirm: boolean
  readonly copyState: AiCopyState
  readonly submitOutcome: AiSubmitOutcome
  readonly onCopy: () => void
  readonly onCancel: () => void
  /** 点击「确认并调用 DeepSeek」：第二次点击会消费令牌并发起**这一次**请求 */
  readonly onConfirm: () => void
  /** 取消在途请求（AI-4）：本地停止等待，不承诺服务端未处理 */
  readonly onCancelRequest: () => void
  /**
   * 保存结果到本地历史（AI-5）。缺省时不显示保存按钮——**不假装能保存**。
   * 只有显式点击才会写盘（PRD 16.5「历史只在用户点击保存后写入加密仓」）。
   */
  readonly onSaveHistory?: (
    payload: AiHistoryPayload,
  ) => Promise<{ readonly ok: boolean; readonly reason?: string }>
}

/** 一行「标签 : 值」，值可以是长文本（写成 pre 保真） */
function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  )
}

function LongBlock({
  title,
  text,
  note,
}: {
  readonly title: string
  readonly text: string
  readonly note?: string
}) {
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-semibold text-slate-800">{title}</h4>
      {note === undefined ? null : <p className="text-xs leading-5 text-slate-600">{note}</p>}
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-800">
        {text}
      </pre>
    </section>
  )
}

export default function AiPreviewPanel({
  preview,
  stale,
  confirmed,
  canConfirm,
  copyState,
  submitOutcome,
  onCopy,
  onCancel,
  onCancelRequest,
  onConfirm,
  onSaveHistory,
}: AiPreviewPanelProps) {
  const omitted = preview.payload.omitted
  const limits = preview.payload.limits

  /*
   * 费用上限估算（AI-3，PRD 18.3「费用与等待时间在进行前提示」）。
   *
   * 输入 token 用 `payloadJson` 的**字符数**粗估而不是字节数：中文一个字约 1 token，
   * 用字节数会把中文高估约 3 倍。真实摘要长度就在这里，因此估的是「本次这一份」的费用。
   */
  const cost = estimateCost({
    spec: modelSpecOf(preview.params.model),
    inputCharCount: preview.payloadJson.length,
    maxOutputTokens: preview.params.maxTokens,
  })

  return (
    <section className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{AI_PREVIEW_TITLE}</h3>
        {/* 本步边界必须写在最显眼的地方：这里没有发出任何东西 */}
        <p className="rounded border border-indigo-200 bg-white px-3 py-1 text-xs font-medium text-indigo-900">
          {AI_PREVIEW_LOCAL_ONLY_NOTE}
        </p>
      </div>

      {/* hash 放在最前面：用户批准的是「这一份内容」，hash 就是那份内容的标识 */}
      <div className="rounded border border-indigo-300 bg-white px-3 py-2">
        <p className="text-xs text-slate-500">{AI_PREVIEW_HASH_LABEL}</p>
        <p className="mt-0.5 font-mono text-base font-semibold tracking-wide text-indigo-900">
          {preview.hash}
        </p>
        <p className="mt-0.5 text-xs leading-5 text-slate-600">{AI_PREVIEW_HASH_HINT}</p>
      </div>

      {stale ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          {AI_STALE_NOTE}
        </p>
      ) : null}

      {confirmed ? (
        <p className="rounded border border-emerald-300 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
          {AI_CONFIRMED_PENDING_NOTE}
        </p>
      ) : (
        <p className="rounded border border-slate-300 bg-white p-3 text-xs leading-5 text-slate-700">
          {AI_NOT_CONFIRMED_NOTE}
        </p>
      )}

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-800">{AI_PREVIEW_META_TITLE}</h4>
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Field label={AI_FIELD_HASH} value={preview.hash} />
          <Field label={AI_FIELD_PRIVACY_LEVEL} value={preview.payload.privacyLevel} />
          <Field
            label={AI_FIELD_CONTENT_BYTES}
            value={`${String(preview.contentBytes)} ${AI_BYTES_UNIT}`}
          />
          <Field label={AI_FIELD_SCHEMA_VERSION} value={preview.schemaVersion} />
          <Field label={AI_FIELD_PROMPT_VERSION} value={preview.promptVersion} />
          <Field label={AI_FIELD_GENERATED_AT} value={formatDateTime(preview.generatedAt)} />
          <Field
            label={AI_FIELD_SCOPE_ROW_COUNT}
            value={`${String(preview.payload.scope.rowCount)} 条`}
          />
          <Field
            label={AI_FIELD_SUPPRESSED_CELL_COUNT}
            value={`${String(preview.payload.suppressedCellCount)} 格`}
          />
        </dl>
      </section>

      <LongBlock title={AI_PREVIEW_JSON_TITLE} text={preview.payloadJson} />

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-800">{AI_PREVIEW_MESSAGES_TITLE}</h4>
        <ul className="space-y-2">
          {preview.messages.map((message) => (
            <li key={message.role}>
              <p className="text-xs text-slate-600">
                角色：<span className="font-mono font-medium text-slate-900">{message.role}</span>
              </p>
              <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-800">
                {message.content}
              </pre>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-800">模型与参数（全部参与 hash 计算）</h4>
        {/*
          缺失的参数显示「不发送」而不是 0：`temperature` 在思考模式、`top_p` 在非思考模式下
          都会被服务端忽略（官方原文：「设置参数不会报错，但也不会生效」）。显示成 0 会让用户
          以为温度真的被设成了 0。
        */}
        <dl className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <Field label="模型 model" value={preview.params.model} />
          <Field
            label="思考模式 thinking"
            value={
              preview.params.thinking === 'auto'
                ? '不发送（由服务端按模型默认处理）'
                : preview.params.thinking === 'enabled'
                  ? '开启'
                  : '关闭'
            }
          />
          <Field
            label="温度 temperature"
            value={
              preview.params.temperature === undefined
                ? '不发送'
                : String(preview.params.temperature)
            }
          />
          <Field
            label="top_p"
            value={preview.params.topP === undefined ? '不发送' : String(preview.params.topP)}
          />
          <Field label="最长输出 max_tokens" value={String(preview.params.maxTokens)} />
          <Field label="超时 timeout（毫秒）" value={String(preview.params.timeoutMs)} />
          <Field
            label="推理强度 reasoning_effort"
            value={preview.params.reasoningEffort ?? '不指定（服务端默认档位）'}
          />
        </dl>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-800">可能产生的费用（上限估算）</h4>
        <p className="text-xs leading-5 text-slate-600">{formatCostEstimate(cost)}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs leading-5 text-slate-500">
          {cost.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-800">{AI_PREVIEW_DESTINATION_TITLE}</h4>
        <dl className="grid grid-cols-1 gap-2">
          <Field
            label={AI_PREVIEW_DESTINATION_LABEL}
            value={`${preview.destination.origin}${preview.destination.path}`}
          />
        </dl>
        <p className="text-xs leading-5 text-slate-600">{AI_PREVIEW_DESTINATION_NOTE}</p>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-slate-800">{AI_PREVIEW_NOTES_TITLE}</h4>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">
          {preview.desensitizeNotes.map((note) => (
            <li key={note.label}>
              <span className="font-medium">{note.label}：</span>
              {note.detail}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1">
        <h4 className="text-xs font-semibold text-slate-800">{AI_FIELD_OMITTED}</h4>
        {omitted.length === 0 ? (
          <p className="text-xs text-slate-600">{AI_OMITTED_EMPTY}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">
            {omitted.map((entry) => (
              <li key={`${entry.metricId}-${entry.reason}`}>
                <span className="font-mono">{entry.metricId}</span>：{entry.reason}
              </li>
            ))}
          </ul>
        )}
        {limits.length === 0 ? (
          <p className="text-xs text-slate-600">{AI_LIMITS_EMPTY}</p>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">
            {limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        )}
      </section>

      {/*
        AI-4：真实请求的三种结局分开显示。
        `sent` 且 `current === false` 是**迟到响应**（期间锁定 / 清空 / 切换过）——
        必须明确说「已丢弃」，绝不能让用户以为结果可用。
      */}
      {submitOutcome.kind === 'sent' ? (
        <div
          className={
            submitOutcome.current
              ? 'rounded border border-emerald-300 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900'
              : 'rounded border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900'
          }
        >
          <p className="font-medium">
            {submitOutcome.current ? AI_SENT_TITLE : AI_LATE_RESPONSE_TITLE}
          </p>
          <p className="mt-1">
            {submitOutcome.current ? AI_SENT_BODY : AI_LATE_RESPONSE_BODY}
          </p>
          <dl className="mt-2 space-y-0.5">
            <div>
              {AI_SENT_HASH_LABEL}：<span className="font-mono">{submitOutcome.result.requestHash}</span>
            </div>
            <div>
              请求模型 {submitOutcome.result.requestedModel}｜返回模型{' '}
              {submitOutcome.result.responseModel ?? '未返回'}
            </div>
            <div>结束原因 finish_reason：{submitOutcome.result.finishReason ?? '未返回'}</div>
            <div>
              用量 usage：
              {submitOutcome.result.usage === null
                ? '服务端未返回'
                : `输入 ${String(submitOutcome.result.usage.promptTokens)} / 输出 ${String(submitOutcome.result.usage.completionTokens)} / 合计 ${String(submitOutcome.result.usage.totalTokens)} tokens`}
            </div>
          </dl>
          {/*
            只显示「拿到了多少字」与结束原因，**不在这里渲染正文**：
            AI 文本是不可信内容，安全渲染与净化是 AI-5 的事。
          */}
          <p className="mt-2">
            已收到 {formatInteger(submitOutcome.result.content.length)} 个字符的正文；
            {AI_FINISH_REASON_NOTES[finishStatusOf(submitOutcome.result.finishReason)]}
          </p>
          <p className="mt-1">{AI_RESULT_NOT_RENDERED_NOTE}</p>
        </div>
      ) : null}

      {/*
        AI-5：成功拿到结果后，**在同一个面板里**渲染结果正文与元数据。
        复用 `AiResultPanel` 而不是另写一份：渲染方式本身是 AI12 的验收对象
        （不执行脚本、不发图片请求），只允许一套实现。
      */}
      {submitOutcome.kind === 'sent' && submitOutcome.current ? (
        <AiResultPanel
          {...(onSaveHistory === undefined ? {} : { onSave: onSaveHistory })}
          view={resultViewOf({ preview, result: submitOutcome.result, current: true })}
        />
      ) : null}

      {submitOutcome.kind === 'failed' ? (
        <div className="rounded border border-rose-300 bg-rose-50 p-3 text-xs leading-5 text-rose-900">
          <p className="font-medium">{AI_SEND_FAILED_TITLE}</p>
          <p className="mt-1">{submitOutcome.error.message}</p>
          {submitOutcome.error.advice === null ? null : (
            <p className="mt-1">{submitOutcome.error.advice}</p>
          )}
          <p className="mt-1">
            分类：{submitOutcome.error.kind}｜HTTP 状态：
            {submitOutcome.error.status === null ? '无（非 HTTP 失败）' : String(submitOutcome.error.status)}
            ｜服务端错误码：{submitOutcome.error.code ?? '未提供'}
          </p>
          {/* 没有重试按钮是刻意的：PRD 18.4 要求「不自动重试」，重试必须重新预览并确认 */}
          <p className="mt-1">{AI_NO_RETRY_NOTE}</p>
        </div>
      ) : null}

      {submitOutcome.kind === 'cancelling' ? (
        <div className="rounded border border-slate-300 bg-slate-50 p-3 text-xs leading-5 text-slate-700">
          <p className="font-medium">{AI_REQUEST_IN_PROGRESS_TITLE}</p>
          <p className="mt-1">{AI_REQUEST_IN_PROGRESS_BODY}</p>
          <button
            className="mt-2 rounded-md border border-slate-400 px-3 py-1 text-xs text-slate-700 hover:bg-white"
            onClick={onCancelRequest}
            type="button"
          >
            {AI_CANCEL_REQUEST_LABEL}
          </button>
        </div>
      ) : null}

      {submitOutcome.kind === 'rejected' ? (
        <div className="rounded border border-rose-300 bg-rose-50 p-3 text-xs leading-5 text-rose-900">
          <p className="font-medium">{AI_SUBMIT_REJECTED_TITLE}</p>
          {/* 引擎原文照抄：界面改写会掩盖「为什么被拒绝」 */}
          <p className="mt-1">{submitOutcome.reason}</p>
        </div>
      ) : null}

      {copyState.kind !== 'idle' ? (
        <p
          className={
            copyState.kind === 'copied'
              ? 'text-xs leading-5 text-emerald-800'
              : 'text-xs leading-5 text-amber-800'
          }
        >
          {copyState.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          onClick={onCopy}
          type="button"
        >
          {AI_COPY_LABEL}
        </button>
        <button
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
          onClick={onCancel}
          type="button"
        >
          {AI_CANCEL_LABEL}
        </button>
        <button
          className={
            canConfirm
              ? 'rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700'
              : 'rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-500'
          }
          disabled={!canConfirm}
          onClick={onConfirm}
          type="button"
        >
          {AI_CONFIRM_LABEL}
        </button>
      </div>

      <p className="text-xs leading-5 text-slate-600">{AI_CONFIRM_NOTE}</p>
      <p className="text-xs leading-5 text-slate-500">
        {AI_COPY_LABEL}会把上面这段文本整段放进剪贴板；{AI_COPY_DONE}
        {AI_COPY_FAILED}
      </p>
    </section>
  )
}
