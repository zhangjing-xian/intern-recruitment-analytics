/**
 * PWA 更新提示的**全部界面文案**（步骤13）。
 *
 * 与项目其他 `*Text.ts` 同一套理由：这些句子是对用户的承诺（「更新不会动你的数据」），
 * 必须能被单测逐条钉住，而不是散在 JSX 里；而且它们会**逐字渲染**，
 * 因此全仓扫描（`features/privacy/uiTextGuard.test.ts`）也会检查它们里没有 Markdown 强调标记。
 */

export const PWA_UPDATE_TITLE = '有新版本可用'
export const PWA_UPDATE_BODY =
  '新版本已经下载好，但它不会自动顶掉你正在看的页面。点「立即更新」会在刷新后使用新版本；刷新只换静态资源，本机加密仓里的数据集、清洗设置与 AI 历史都不受影响，也不需要重新导入。'
export const PWA_UPDATE_APPLY_LABEL = '立即更新'
export const PWA_UPDATE_LATER_LABEL = '稍后'
export const PWA_UPDATE_LATER_NOTE =
  '选择稍后不会阻止更新：下次打开本站时仍会使用新版本。本应用不会自动刷新页面，也不会在后台重发任何请求。'

export const PWA_OFFLINE_NOTE =
  '首次打开后，应用壳与静态资源会被本机缓存，断网也能打开看板与已提交的数据集。缓存只包含同源静态资源：不缓存招聘数据、不缓存导出文件，也绝不缓存、排队或重发 AI 请求。'

/** 全部用户可见文案（供测试遍历「没有 Markdown 强调标记」） */
export const PWA_UI_TEXTS: readonly string[] = [
  PWA_UPDATE_TITLE,
  PWA_UPDATE_BODY,
  PWA_UPDATE_APPLY_LABEL,
  PWA_UPDATE_LATER_LABEL,
  PWA_UPDATE_LATER_NOTE,
  PWA_OFFLINE_NOTE,
]
