/**
 * AI 深度分析的**全部界面文案**（AI-1，docs/PRD.md 16–18 章）。
 *
 * 为什么要把文案集中在常量文件里（与 `rejectionText` / `privacyText` 同一套理由）：
 * 1. **可核对**：这些句子是对用户的承诺（「本步不发任何请求」），必须能被单测逐条钉住，
 *    而不是散在 JSX 里改一个字都没人发现；
 * 2. **不重复**：同一句话在入口按钮、预览面板、说明段里只写一遍，避免三处说法慢慢不一致；
 * 3. **写作纪律**：本文件里**不允许出现 Markdown 加粗标记**（`**` / `__`）。
 *    React 不会解析 Markdown，星号会被原样渲染成字面量——前几步已经踩过这个坑，
 *    因此 `AI_UI_TEXTS` 把全部字符串导出，供测试统一断言「没有 `**`」。
 *
 * 另一条纪律：**不得**声称 AI 已接通、正在工作或正在发送。本步只做本地预览 + 模拟确认，
 * 真实网络适配器是 AI-4，且只有它能发请求。
 */

import { AI_CORS_UNVERIFIED_NOTE } from '../../ai/catalog'
import type { PrivacyLevel } from '../../privacy/sanitize'

/* ------------------------------------------------------------------ 入口按钮 */

export const AI_ENTRY_BUTTON_LABEL = 'AI 深度分析（本地脱敏预览）'
export const AI_ENTRY_COLLAPSE_LABEL = '收起 AI 深度分析'
export const AI_ENTRY_NOTE =
  'AI 深度分析入口：点击只在你自己的浏览器里生成一份脱敏预览，这一步不发任何网络请求。只有你看完完整预览、点击确认并逐次提交之后，才可能发出这一次调用（唯一出站路径在 src/ai/client.ts 里）。'
export const AI_ENTRY_UNSAVED_NOTE =
  '生成预览只是本机计算：筛选、隐私级别、模型参数或数据一变，预览 hash 就会变，旧确认随之失效。'

/* ------------------------------------------------------------------ 工作区 */

export const AI_WORKSPACE_TITLE = 'AI 深度分析（本地脱敏预览）'
export const AI_WORKSPACE_INTRO =
  '本步把当前筛选下的聚合结果交给脱敏引擎，在本机生成一份完整的候选载荷与预览。你可以逐字核对将要发送的内容；点确认只是批准这一份内容，再点一次才会消费一次性令牌并发出这一次请求（不会自动重试、不会换模型或端点）。'
export const AI_WORKSPACE_NO_DATA_TITLE = '当前没有可摘要的记录'
export const AI_WORKSPACE_NO_DATA_DESCRIPTION =
  '脱敏载荷只能由聚合后的计数构造：一条记录都没有时没有可聚合的分组，因此这里不生成空载荷，也不显示 0 值占位。'
export const AI_WORKSPACE_NO_DATA_ITEMS: readonly string[] = [
  '先导入名单、确认字段映射并提交清洗结果',
  '或放宽当前筛选条件，让至少有可聚合的记录进入分析集',
  '本步不会因为你打开面板就发起任何请求',
]

export const AI_SCOPE_TITLE = '本次摘要的范围（筛选快照）'
export const AI_PRIVACY_LEVEL_LABEL = '隐私级别（脱敏级别）'
export const AI_PRIVACY_LEVEL_HINT =
  '级别决定载荷里允许出现哪些维度：未列出的维度由引擎整维省略，并在预览的「被省略项」里列出原因。切换级别后旧确认立即失效，必须重新生成预览。'
export const AI_PRIVACY_LEVEL_OPTIONS: Readonly<
  Record<PrivacyLevel, { readonly label: string; readonly description: string }>
> = {
  strict: {
    label: '严格（strict）',
    description:
      '只发送总体与城市、房补类型；HR、岗位类别、学校层次、渠道、原因之外的维度全部整维省略。',
  },
  standard: {
    label: '标准（standard，默认）',
    description:
      '在严格级别之上增加渠道、推荐类型、HR 代号、岗位类别、序列、部门、需求类型、学校层次、毕业年级、学历、薪资区间与周期区间。',
  },
  custom: {
    label: '自定义（custom）',
    description:
      '只能从标准级别的白名单里勾选你要发的维度，做不到解除任何身份禁出项——那些字段在载荷结构里根本没有位置。',
  },
}
export const AI_CUSTOM_DIMENSIONS_LABEL = '本级别实际允许的维度'
export const AI_CUSTOM_DIMENSIONS_HINT =
  '取消勾选表示整维不发送；引擎只会收窄，不会因为你勾了什么就多发一个被禁维度。'
export const AI_CUSTOM_EMPTY_NOTE =
  '没有勾选任何维度：载荷仍会发送总体 KPI 与质量计数，它们是聚合计数、不含身份信息。'

/* ------------------------------------------------------------------ 模型与参数 */

export const AI_PARAMS_TITLE = '模型与参数'
export const AI_PARAMS_HINT =
  '这些参数参与预览 hash 计算：改任何一个都会让旧确认失效。模型与能力来自本版本核实的官方目录（不探活、不查模型列表、不查余额）；不支持的参数在界面禁用而不是发送后被忽略。'
export const AI_PARAM_MODEL_LABEL = '模型'
export const AI_PARAM_TEMPERATURE_LABEL = '温度 temperature'
export const AI_PARAM_MAX_TOKENS_LABEL = '最长输出 max_tokens'
export const AI_PARAM_TIMEOUT_LABEL = '超时 timeout（毫秒）'
export const AI_PARAM_THINKING_LABEL = '思考模式'
export const AI_PARAM_INVALID_NOTE =
  '参数输入不合法（空值、非数字或超出范围）时按默认值处理，并在下方「本机自动调整」里逐条说明——预览与将要发送的内容必须一致。'

/** AI 开关关闭时的说明（PRD 18.1：默认关闭；开关在设置页，关闭不影响任何本地功能） */
export const AI_DISABLED_NOTE =
  'AI 深度分析当前是关闭状态（默认关闭）。本地导入、清洗、看板、拒 offer 专项、导出全部功能不受影响，也不会产生任何外部请求。要使用 AI 分析，请到设置页打开 AI 开关。'

/* ------------------------------------------------------------------ 生成与动作 */

export const AI_GENERATE_LABEL = '生成脱敏预览'
export const AI_REGENERATE_LABEL = '重新生成预览'
export const AI_CANCEL_LABEL = '取消'
export const AI_COPY_LABEL = '复制预览内容'
export const AI_COPY_DONE = '已复制预览内容到剪贴板。'
export const AI_COPY_FAILED = '无法访问剪贴板，请手动选择预览文本后复制。'
export const AI_CONFIRM_LABEL = '确认并调用 DeepSeek'
export const AI_CONFIRM_NOTE =
  '第一次点击只是批准这一份内容（建立一次性令牌），第二次点击才消费令牌并发出这一次请求。取消、失败或超时都不会自动重试，也不会切换模型或端点；本机规则未在设置页确认时这里不会发出请求。'

export const AI_NO_PREVIEW_NOTE =
  '还没有生成预览：点击「生成脱敏预览」后，这里会逐字显示将要发送的完整 JSON、system 与 user 消息、模型参数、目的地与全部脱敏说明。'

/* ------------------------------------------------------------------ 预览面板 */

export const AI_PREVIEW_TITLE = '完整脱敏预览（将要发送的内容）'
export const AI_PREVIEW_LOCAL_ONLY_NOTE =
  '生成预览这一步不会发送任何内容：预览完全在本机生成。只有你点击确认并再次提交之后，才会发出这一次调用。'
export const AI_PREVIEW_HASH_LABEL = '预览 hash'
export const AI_PREVIEW_HASH_HINT =
  'hash 由载荷、消息、模型参数与目的地共同算出：其中任何一项变化，hash 就会变，旧确认随即失效。'
export const AI_PREVIEW_JSON_TITLE = '完整 JSON 载荷（payloadJson，逐字节等于将要发送的文本）'
export const AI_PREVIEW_MESSAGES_TITLE = 'messages（system 在前，user 在后）'
export const AI_PREVIEW_DESTINATION_TITLE = '目的地（本次唯一端点）'
export const AI_PREVIEW_DESTINATION_LABEL = '完整地址'
export const AI_PREVIEW_DESTINATION_NOTE =
  '同一时刻只有一个目的地：默认是 DeepSeek 官方端点；如果你在设置页登记了自有代理，这里显示的就是你登记的那个地址。除它之外没有第二个域名，也不使用 no-cors。'
export const AI_PREVIEW_NOTES_TITLE = '脱敏说明（引擎逐条给出，界面不改写）'
export const AI_PREVIEW_META_TITLE = '本次预览的元数据'

export const AI_FIELD_PRIVACY_LEVEL = '隐私级别'
export const AI_FIELD_CONTENT_BYTES = '内容大小（payloadJson 的 UTF-8 字节数）'
export const AI_FIELD_SCHEMA_VERSION = '载荷结构版本'
export const AI_FIELD_PROMPT_VERSION = '提示词版本'
export const AI_FIELD_GENERATED_AT = '预览生成时间'
export const AI_FIELD_HASH = '预览 hash'
export const AI_FIELD_SCOPE_ROW_COUNT = '参与聚合的记录数'
export const AI_FIELD_SUPPRESSED_CELL_COUNT = '被整格省略的单元格数'
export const AI_FIELD_OMITTED = '被省略的指标与原因'
export const AI_FIELD_LIMITS = '本次载荷自带的限制说明'

export const AI_OMITTED_EMPTY = '没有被整维省略的维度。'
export const AI_LIMITS_EMPTY = '本次载荷没有额外限制说明。'
export const AI_BYTES_UNIT = '字节'

export const AI_STALE_NOTE =
  '当前预览已过期：源数据、隐私级别或模型参数在生成之后发生了变化，旧确认不再对应这份内容。请重新生成预览并再次确认。'
export const AI_CONFIRMED_PENDING_NOTE =
  '已确认这一份预览，令牌还没有被消费。确认回答「你批准了哪一份内容」，消费才回答「这一次调用能不能发」：再点一次同一按钮即消费令牌并发出这一次请求。'
export const AI_CONFIRMED_NOTE =
  '这一份预览的确认令牌已被消费。确认只对这一次有效：改了任何输入都要重新生成并再次确认，本应用不会自动重试。'
export const AI_NOT_CONFIRMED_NOTE =
  '尚未确认：请先逐字看完上方的完整预览，再点击「确认并调用 DeepSeek」。'

export const AI_SUBMIT_REJECTED_TITLE = '提交被引擎拒绝（原因是引擎原文，界面不改写）'

/* ------------------------------------------------------------------ 真实请求（AI-4） */

export const AI_SENT_TITLE = '已收到这一次的结果'
export const AI_SENT_BODY =
  '这就是本次确认发起的那一次请求的结果。结果与本地统计各自独立：AI 的文字不覆盖、也不改写看板上的任何数字，两者不一致时以本地统计为准。'
export const AI_SENT_HASH_LABEL = '本次结果对应的预览 hash'

export const AI_LATE_RESPONSE_TITLE = '这次响应已作废（迟到结果）'
export const AI_LATE_RESPONSE_BODY =
  '请求发出后发生了锁定、清空或会话失效，因此这份响应不再属于当前状态，已被丢弃、不会写入任何地方。要重新分析请重新生成预览并确认。'

export const AI_SEND_FAILED_TITLE = '本次请求失败'
export const AI_NO_RETRY_NOTE =
  '本应用不会自动重试、不会换端点、也不会换模型。要再试一次，需要重新生成预览并逐次确认。'

export const AI_REQUEST_IN_PROGRESS_TITLE = '请求进行中'
export const AI_REQUEST_IN_PROGRESS_BODY =
  '正在等待 DeepSeek 的响应。取消只会让本地停止等待——取消后不承诺服务端未处理，也不承诺免收费。'
export const AI_CANCEL_REQUEST_LABEL = '取消本次请求'

/* ------------------------------------------------------------------ 本地规则闸门（AI-6） */

export const AI_SUBJECT_RULES_BLOCK_TITLE = '本地规则还没有确认，因此不能发送'
export const AI_SUBJECT_RULES_BLOCK_NOTE =
  '摘要里的岗位类别、学校层次与拒 offer 原因主题都来自本机的规则（岗位类别映射、本地 GPT 名单、原因字典）。这些规则需要在设置页确认一次才能用于摘要；确认之后规则一改就会失效，需要重新确认。现在仍然可以生成并逐字核对预览，但不会发出请求。'
export const AI_SUBJECT_RULES_BLOCK_REASON =
  '本机规则（岗位类别映射 / 学校层次名单 / 原因主题字典）尚未确认或已变化：请到设置页核对并确认这批规则后再发送。'
export const AI_SUBJECT_RULES_FINGERPRINT_LABEL = '当前规则指纹'

export const AI_RESULT_NOT_RENDERED_NOTE =
  '正文由本机解析成本地节点后渲染（不使用注入 HTML 的方式），因此脚本、远程图片、外链都不会被执行；结果的文字不覆盖、也不改写看板上的任何数字。'

/* ------------------------------------------------------------------ 交付边界 */

export const AI_NOT_IMPLEMENTED_NOTE =
  '尚未接入的项：把 AI 章节并入步骤11 的 XLSX / PNG 报告（当前只提供 Markdown 与打印版两个格式）；真实部署来源的浏览器直连（CORS）属于未验证项，官方文档没有对任意静态站点长期开放跨域的保证。已交付：脱敏引擎与完整预览（AI-1）、分析摘要生成器（AI-2）、模型目录与参数配置、API Key 的会话与加密保存（AI-3）、唯一网络适配器与一次性确认（AI-4）、结果展示与本地历史（AI-5）、三级脱敏与本地规则确认（AI-6）。'

/* ------------------------------------------------------------------ 文案清单（供「无 Markdown 标记」测试） */

/**
 * 文案清单（供「无 Markdown 标记」测试）。
 *
 * **新增任何会渲染进 AI 界面的文案常量，都必须加进这个数组**——包括来自
 * `src/ai/catalog.ts` 的说明文字。不进来的文案就不会被那条断言检查，
 * 而「渲染成一堆星号」的坑本项目已经踩过不止一次。
 */
export const AI_UI_TEXTS: readonly string[] = [
  // AI-3 的文案（来自 src/ai/catalog.ts）也必须在场，否则不会被「无 **」断言检查
  AI_CORS_UNVERIFIED_NOTE,
  AI_ENTRY_BUTTON_LABEL,
  AI_ENTRY_COLLAPSE_LABEL,
  AI_ENTRY_NOTE,
  AI_ENTRY_UNSAVED_NOTE,
  AI_WORKSPACE_TITLE,
  AI_WORKSPACE_INTRO,
  AI_WORKSPACE_NO_DATA_TITLE,
  AI_WORKSPACE_NO_DATA_DESCRIPTION,
  ...AI_WORKSPACE_NO_DATA_ITEMS,
  AI_SCOPE_TITLE,
  AI_PRIVACY_LEVEL_LABEL,
  AI_PRIVACY_LEVEL_HINT,
  AI_PRIVACY_LEVEL_OPTIONS.strict.label,
  AI_PRIVACY_LEVEL_OPTIONS.strict.description,
  AI_PRIVACY_LEVEL_OPTIONS.standard.label,
  AI_PRIVACY_LEVEL_OPTIONS.standard.description,
  AI_PRIVACY_LEVEL_OPTIONS.custom.label,
  AI_PRIVACY_LEVEL_OPTIONS.custom.description,
  AI_CUSTOM_DIMENSIONS_LABEL,
  AI_CUSTOM_DIMENSIONS_HINT,
  AI_CUSTOM_EMPTY_NOTE,
  AI_PARAMS_TITLE,
  AI_PARAMS_HINT,
  AI_PARAM_MODEL_LABEL,
  AI_PARAM_TEMPERATURE_LABEL,
  AI_PARAM_MAX_TOKENS_LABEL,
  AI_PARAM_TIMEOUT_LABEL,
  AI_PARAM_THINKING_LABEL,
  AI_PARAM_INVALID_NOTE,
  AI_GENERATE_LABEL,
  AI_REGENERATE_LABEL,
  AI_CANCEL_LABEL,
  AI_COPY_LABEL,
  AI_COPY_DONE,
  AI_COPY_FAILED,
  AI_CONFIRM_LABEL,
  AI_CONFIRM_NOTE,
  AI_NO_PREVIEW_NOTE,
  AI_PREVIEW_TITLE,
  AI_PREVIEW_LOCAL_ONLY_NOTE,
  AI_PREVIEW_HASH_LABEL,
  AI_PREVIEW_HASH_HINT,
  AI_PREVIEW_JSON_TITLE,
  AI_PREVIEW_MESSAGES_TITLE,
  AI_PREVIEW_DESTINATION_TITLE,
  AI_PREVIEW_DESTINATION_LABEL,
  AI_PREVIEW_DESTINATION_NOTE,
  AI_PREVIEW_NOTES_TITLE,
  AI_PREVIEW_META_TITLE,
  AI_FIELD_PRIVACY_LEVEL,
  AI_FIELD_CONTENT_BYTES,
  AI_FIELD_SCHEMA_VERSION,
  AI_FIELD_PROMPT_VERSION,
  AI_FIELD_GENERATED_AT,
  AI_FIELD_HASH,
  AI_FIELD_SCOPE_ROW_COUNT,
  AI_FIELD_SUPPRESSED_CELL_COUNT,
  AI_FIELD_OMITTED,
  AI_FIELD_LIMITS,
  AI_OMITTED_EMPTY,
  AI_LIMITS_EMPTY,
  AI_BYTES_UNIT,
  AI_STALE_NOTE,
  AI_CONFIRMED_NOTE,
  AI_CONFIRMED_PENDING_NOTE,
  AI_NOT_CONFIRMED_NOTE,
  AI_SUBMIT_REJECTED_TITLE,
  AI_SUBJECT_RULES_BLOCK_TITLE,
  AI_SUBJECT_RULES_BLOCK_NOTE,
  AI_SUBJECT_RULES_BLOCK_REASON,
  AI_SUBJECT_RULES_FINGERPRINT_LABEL,
  AI_NOT_IMPLEMENTED_NOTE,
  AI_DISABLED_NOTE,
  /*
   * AI-3 的文案：模型能力与 CORS 边界说明**必须**一起进这份清单。
   * 理由：这份清单是「无 Markdown 强调标记」断言的输入，而这两段文字会**逐字渲染**进工作区。
   * 收尾时 `AI_CORS_UNVERIFIED_NOTE` 里的 `**没有**` 就是这样被抓出来的——
   * 它被渲染成一对星号，正是本项目反复踩过的坑（口径见 D-060 顺带修正）。
   * 以后新增任何会渲染进 AI 界面的常量，都要加进这个数组。
   */
  AI_CORS_UNVERIFIED_NOTE,
]
