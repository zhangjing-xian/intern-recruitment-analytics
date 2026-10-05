/**
 * 报告导出页的界面文案（步骤11，唯一来源）。
 *
 * 分工（与 `features/rejection/rejectionText.ts` 同一套办法）：
 * - **数据口径**（章节标题、抑制原因、结论文案、限制说明）全部来自 `privacy/report.ts`
 *   与 `exporters/sections.ts`，本文件一个字都不改写，只做展示；
 * - 本文件只放**界面措辞**：标题、按钮、空态、提示、错误说明。
 *
 * 三条不许违反的措辞规则：
 * 1. **不出现 Markdown 强调标记**（`**` / `__` / 反引号）：界面是纯文本渲染，
 *    `**重点**` 会原样显示成星号（前几步出现过这个 bug，这里用测试钉住）；
 * 2. 缺失一律说「—」：不写「0」「0%」这类会把抑制读成 0 的说法；
 * 3. 不承诺「不可重新识别」：脱敏是降低暴露，不是匿名化。
 */

/** 页头 */
export const PAGE_TITLE = '报告导出'
export const PAGE_INTRO =
  '四种输出（Excel / 图片 / 打印或另存为 PDF / Markdown）全部由同一个脱敏报告模型生成：同一筛选、同一数据版本、同一口径，因此数字必然一致。默认只导出聚合结果，不含候选人姓名、需求 ID、具体推荐人、准确薪资与原因原文；导出前必须先看预览。'

/** 章节标题 */
export const SECTION_TITLES = {
  gates: '导出前检查（必须全部通过）',
  privacy: '脱敏级别',
  preview: '报告预览（导出文件里真实包含的章节与行数）',
  suppression: '抑制说明（本次导出实际做了什么）',
  actions: '导出',
  notes: '边界说明',
} as const

/** 脱敏级别选项（与 PRD 18.5 的三个级别一一对应） */
export const PRIVACY_LEVELS = [
  {
    id: 'strict' as const,
    label: '严格（strict）',
    hint: '仅总体与更粗的分桶：移除城市名、维度名与 HR 代号，隐藏精确分位，抑制门槛提高到 10。',
  },
  {
    id: 'standard' as const,
    label: '标准（standard，默认）',
    hint: '保留城市、渠道、岗位类别、画像层次与薪资 / 周期分桶；HR 用代号，需求 ID / 推荐人 / 原因原文移除。',
  },
  {
    id: 'custom' as const,
    label: '自定义（custom）',
    hint: '在标准的白名单内增减允许项，不能解除身份禁出项（姓名 / 需求 ID / 推荐人 / 准确薪资永远不导出）。',
  },
] as const

/** 开关文案（自定义级别下可改；每一项都写明「开了会发生什么」） */
export const TOGGLE_LABELS = {
  includeRecordDetail: '包含记录级明细（默认关闭）',
  includeRecordDetailHint:
    '开启后按报告内记录代号逐条列出状态 / 城市 / 渠道 / 薪资区间 / 周期；代号在同一文件内稳定、跨报告重建，没有跨批次身份含义，对照表不导出。',
  removeHrNames: '移除 HR 姓名（改为 HR 代号）',
  removeHrNamesHint: '关闭后报告里会出现真实 HR 姓名——只有在你确认报告不离开本机时才应关闭。',
  removeRequirementIds: '移除需求 ID',
  removeRequirementIdsHint: '需求 ID 只以「覆盖需求数」的计数形式出现，绝不导出 ID 列表。',
  removeReferrerNames: '移除具体推荐人',
  removeReferrerNamesHint: '推荐人身份一律不导出，只保留「推荐类型」这类受控分类。',
  removeFreeTextReasons: '移除自由文本原因原文',
  removeFreeTextReasonsHint: '原因只以受控类别出现；原文一律不导出（PRD 10.6）。',
} as const

/** 「先看预览」闸门 */
export const GATE_TITLE = '导出前必须先看预览'
export const GATE_LOCKED_NOTE =
  '四个导出按钮在你看过预览之前保持禁用：预览里会列出实际包含的章节、行数与抑制项，确认没有意料之外的内容后再导出。'
export const GATE_OPENED_NOTE = '已看过预览：导出按钮可用。修改脱敏级别或明细开关后，预览作废，需要重新查看。'
export const OPEN_PREVIEW_LABEL = '生成并查看预览'
export const REGENERATE_PREVIEW_LABEL = '重新生成预览'

/** 隐私检查（本地敏感字段扫描） */
export const CHECK_TITLE = '导出前本地敏感字段检查'
export const CHECK_PASSED = '检查通过：报告中未发现被禁字段名，也未命中任何本机已知的敏感值。'
export const CHECK_BLOCKED_TITLE = '检查未通过：已阻断导出'
/** 「检查未通过」时导出区顶部的那句话（与 CHECK_BLOCKED_TITLE 同一结论，措辞面向动作） */
export const CHECK_BLOCKED_TITLE_AND_ADVICE =
  '检查未通过：导出按钮保持禁用，请先解决上面列出的字段名 / 敏感值命中。'
/**
 * 预览已作废（2026-09-27 修复后新增）。
 *
 * 触发条件：脱敏级别 / 明细开关 / 筛选变了，旧预览与当前配置不同指纹。
 * 它**不是**「检查未通过」——检查结果属于旧预览，必须重新生成预览再看一次。
 */
export const GATE_STALE_NOTE =
  '预览已作废：脱敏级别、明细开关或筛选变化之后，必须重新点「重新生成预览」核对一遍，导出按钮才会重新可用。'
/** 生成了预览但还没被当作「已查看」时的说明（正常情况下点完按钮即视为已查看） */
export const GATE_NEEDS_ACK_NOTE = '这一份预览还没有确认：请重新生成预览后再导出。'
export const CHECK_BLOCKED_NOTE =
  '报告里出现了不该出现的内容，因此本次不生成任何文件、也不发起任何网络请求。下面只列出命中的字段名，不回显命中的值。'
export const CHECK_NO_RECORDS_NOTE = '当前筛选下没有记录：没有可导出的内容，也不显示 0% 占位。'
export const CHECK_INPUT_NOTE =
  '检查方式是本地纯字符串比对：字段名比对被禁清单，值比对源数据里的姓名 / 推荐人 / HR / 原因原文，全程不出浏览器。'
export const CHECK_FORBIDDEN_LABEL = '命中的被禁字段名（只列字段，不回显值）'
export const CHECK_SENTINEL_LABEL = '命中本机已知敏感值的位置（只列位置，不回显值）'
export const CHECK_INPUT_FIELDS_LABEL = '参与检查的源数据字段'
export const CHECK_INPUT_COUNT_LABEL = '参与检查的敏感取值条数'

/**
 * 参与哨兵检查的源数据字段（对话文案用的中文标签）。
 *
 * 为什么只挑这四个：它们都是**自由文本或身份类**字段，一旦泄漏就是直接可识别信息；
 * 而 `recordId` / `sourceRow` 这类内部编号既不进入报告，数值型字段（薪资）又会被
 * 区间化处理，把它们的字符串形式当哨兵只会误伤（详见 `privacy/sanitize.ts` 的说明）。
 */
export const SENTINEL_FIELD_LABELS: Readonly<Record<string, string>> = {
  candidateName: '候选人姓名',
  referrer: '具体推荐人',
  recruiter: '招聘 HR',
  rejectionReason: '拒绝原因原文',
}

/** 导出按钮 */
export const EXPORT_LABELS = {
  xlsx: '导出 Excel（.xlsx）',
  png: '导出图表图片（.png）',
  pdf: '打印 / 另存为 PDF',
  markdown: '导出 Markdown（.md）',
} as const

export const EXPORT_HINTS = {
  xlsx: '多工作表、无隐藏 sheet；所有单元格强制为文本或数字，以 = + - @ 开头的文本会被中和，不可能被当成公式执行。Excel 里只有数据表，不带图——要看图请用「打印 / 另存为 PDF」或「导出图表图片」。',
  png: '图表从脱敏后的图表规格离屏重绘，不是对当前页面的截图；被抑制的分组不进图。',
  pdf: '使用专用打印版式（@page、本地中文字体栈、页眉页脚），并把图表一起嵌进去（图同样由本机从脱敏报告重绘，不是界面截图）；在打印对话框里选择「另存为 PDF」。',
  markdown: '纯文本，便于粘贴到文档；表格里的竖线会被转义，结构不会被分组标签破坏。Markdown 里不带图，需要图请用 PDF 或单独的图片导出。',
} as const

export const DOWNLOAD_NOTE = '文件通过本地 Blob 与对象 URL 下载：不经过任何服务器，也不会上传到任何位置。'
export const PRINT_NOTE =
  '打印会打开浏览器打印窗口：请在目标里选择「另存为 PDF」。iframe 打印在部分浏览器会被拦截，因此优先使用新窗口。'

/** 明细开关关闭时的说明（与导出文件里的同一句话保持一致） */
export const DETAIL_OFF_NOTE = '本次未开启记录级明细：只导出聚合结果。'

/** 空态：本地仓被锁定 / 清空 */
export const LOCKED_TITLE = '本地仓已锁定'
export const LOCKED_DESCRIPTIONS: Readonly<Record<'idle' | 'manual' | 'other', string>> = {
  idle: '闲置超过设定时间，本地仓已自动锁定，内存中的业务数据（解析结果、已提交数据集）已一并清空。',
  manual: '你手动锁定了本地仓，内存中的业务数据已一并清空。',
  other: '本地仓被清空或会话已过期，内存中的业务数据已一并清空。',
}
export const LOCKED_ITEMS = [
  '这是预期行为：锁定时必须清空可控状态与图表缓存，避免敏感明细留在内存里',
  '解锁后需要重新导入数据，或从加密仓恢复数据集，再回到本页导出',
  '临时模式没有加密仓，关闭页面即清除；需要长期保存请使用加密仓',
] as const

/** 空态：未导入 / 未确认映射 / 未提交清洗结果 */
export const NO_SHEET_TITLE = '还没有可导出的报告'
export const NO_SHEET_DESCRIPTION =
  '报告只从「已确认映射并提交的清洗结果」生成。现在内存会话里没有任何数据集，因此这里不显示任何示例章节、示例行数或占位数字。'
export const NO_SHEET_ITEMS = [
  '读 Excel / CSV / TSV 或直接粘贴表格，生成原始数据集',
  '确认字段映射后进入清洗预览，检查问题、重复与口径',
  '提交清洗结果后回到本页，即可预览并导出脱敏报告',
] as const

export const NO_MAPPING_TITLE = '字段映射尚未确认'
export const NO_MAPPING_DESCRIPTION =
  '没有确认字段映射时，无法知道哪一列是 offer 状态、哪一列是薪资；报告里的率与分位都会被算错，所以这里不猜、也不导出。'
export const NO_MAPPING_ITEMS = [
  '映射页会给出四级匹配建议与冲突清单，冲突必须显式选择或合并',
  '缺列会导致对应分析模块被禁用，报告里会如实写明「该模块无有效样本」',
  '确认映射后返回清洗预览，再提交数据集',
] as const

export const NO_DATASET_TITLE = '还没有已提交的清洗结果'
export const NO_DATASET_DESCRIPTION =
  '字段映射已确认，但清洗结果还没有提交。报告只消费「已提交的规范化数据集」，这样每份导出文件都能对应到一份确定的输入与一套规则版本。'
export const NO_DATASET_ITEMS = [
  '清洗页可预览前 100 行、查看问题统计与城市 / 状态别名',
  '确认去重策略、分析截止日与薪资口径后点击提交，数据集才会进入分析',
  '改清洗设置会作废已提交数据集（导出文件必须能对应到确定的输入）',
] as const

/** 筛选区（与看板共用同一份筛选口径） */
export const FILTER_SECTION_TITLE = '全局筛选（与看板共用同一份筛选口径）'
export const FILTER_SECTION_HINT =
  '报告按这里筛选后的记录生成；筛选层与看板是同一份纯逻辑，因此同一筛选下的看板、分维度、拒 offer 专项与本报告数字必然一致。'

/** 边界说明 */
export const NOTES = [
  '脱敏是降低暴露风险，不承诺不可重新识别；报告下载后由用户自行控制，本地加密不等于导出文件已加密。',
  '文件名、图注、水印、页眉页脚与导出日志都不含数据集名、源文件名、HR 姓名与城市。',
  '导出全程只在本机进行：没有任何 fetch / XHR，也不使用 CDN 或在线字体；PDF 就是浏览器自带的打印。',
] as const

/** 后台生成失败时的提示（错误文案由导出层给，这里只给前缀） */
export const EXPORT_FAILED_PREFIX = '导出未完成：'
export const PNG_UNVERIFIED_NOTE =
  '图片导出的真实像素需要浏览器 canvas；本页在 Node 测试里只能验证到「图表规格 → 数据 URL → 字节」这一段，像素级结果尚未人工验证。'
