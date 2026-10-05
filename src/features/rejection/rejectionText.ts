/**
 * 拒 offer 专项的界面文案（步骤10，唯一来源）。
 *
 * 分工（与 `features/dimensions/analysisText.ts` 同一套办法）：
 * - **业务口径**（原因字典、条件判定、阈值分级、结论模板、免责声明）全部由
 *   `domain/analytics/rejection.ts` 与 `insights/rejection.ts` 提供，本文件**一个字都不改写**，
 *   组件也直接从引擎字段取值（例如 `evaluation.conclusion` 原样渲染）；
 * - 本文件只放**界面措辞**：章节标题、列表头、徽标文字、空态说明、单位后缀。
 *
 * 三条不许违反的措辞规则：
 * 1. `level` 徽标里**只有** `observed` 允许出现「观察到…关联」，其余两级只能写「样本不足」「仅供描述」；
 * 2. 任何地方都不得写「概率」「可能性」「预计会拒」这类未校准的预测说法（PRD 9.3 禁止）；
 * 3. 缺失一律显示 `—`：R = 0 时填写率是 `null` 而不是 0%，界面不造 0%。
 */

import type { RejectionConclusionLevel } from '../../domain'

/** 章节标题 */
export const SECTION_TITLES = {
  groups: '分析人群：核心率口径与两组比较口径',
  reasons: '拒 offer 原因分布',
  dimensions: '分维度对比（特征内结果 + 组内构成）',
  attention: '拒 offer 运营关注标签',
  advice: '行动建议（由已观察到的证据推导）',
} as const

/** 表格与卡片列名 */
export const COLUMN_LABELS = {
  share: '占拒 offer 总数 R',
  ruleVersion: '规则 ID / 版本',
  hitCount: '命中记录数',
  hitBreakdown: '命中拆分',
  ruleRate: '组内拒 offer 率（R ÷ D）',
  baseline: '比较基准',
  rateGap: '率差（百分点）',
  metConditions: '命中条件',
  unknownConditions: '未知条件（必须显式保留）',
  unmetConditions: '不满足的条件',
  suggestedCheck: '建议核查事项',
  scope: '适用范围',
  observation: '观察',
  advice: '建议',
  dataAsOf: '数据截至日',
} as const

/** 两组口径卡片上要展示的计数标签（顺序与引擎的 `StatusCounts` 命名一致） */
export const COUNT_LABELS = {
  total: 'N 总 offer 记录数（含审批中）',
  joined: 'J 已入职',
  pending: 'P 待入职',
  approving: 'A offer 审批中',
  rejected: 'R 拒 offer（拒绝 offer + 拒绝口头 offer）',
  coreDenominator: 'D 核心分母（J + P + R）',
} as const

/** 卡片底部的样本门槛与率 */
export const SAMPLE_LABEL = '样本门槛'
export const REJECTION_RATE_LABEL = '拒 offer 率（R ÷ D）'
export const GROUP_COMPOSITION_LABEL = '组内构成'

/** 结论级别徽标；逐个显式写出，杜绝「observed 的说法被复用到另外两级」 */
export const LEVEL_LABELS: Readonly<Record<RejectionConclusionLevel, string>> = {
  insufficient: '样本不足',
  description: '仅供描述',
  observed: '观察到关联',
}

/**
 * 结论级别的含义说明（徽标旁的小字）。
 * 这里只解释「这一级能说什么、不能说什么」，阈值数字本身来自引擎的结论文案，界面不重述。
 */
export const LEVEL_NOTES: Readonly<Record<RejectionConclusionLevel, string>> = {
  insufficient: '命中样本量未达门槛：只作为线索登记，不构成结论，也不参与排名。',
  description: '已达到最低样本量但率差未达门槛：只描述观察到的数字，不下结论。',
  observed: '三条门槛同时满足（组内 D、组内拒 offer 数、率差）：可写「观察到关联」，但这不是因果结论。',
}

/** 原因分布区的提示 */
export const REASONS_HEADING = '原因填写率与类别分布'
export const REASONS_FILL_RATE_LABEL = '原因填写率（已填写 ÷ R）'
export const REASONS_UNCLASSIFIED_LABEL = '有值但不在字典内（未分类）'
export const REASONS_UNCLASSIFIED_SAMPLES_LABEL = '未分类原值样例（仅本机展示，用于维护字典）'
export const REASONS_MATCHED_LABEL = '命中字典的条数'
export const REASONS_FILLED_LABEL = '已填写原因的条数'
export const REASONS_DENOMINATOR_LABEL = '分母 R（全部拒 offer 记录，含未填写）'

/** 原因分布的空态与「不造原因」提示 */
export const REASONS_EMPTY_NOTE =
  '当前筛选下没有任何拒 offer 记录（R = 0）：原因分布的分母为 0，因此各占比显示「—」，不显示 0%，也不输出任何「主要原因」。'
export const REASONS_NO_REASON_NOTE =
  '本次全部拒 offer 记录都没有填写拒绝原因：原因填写率为 0%。在补齐访谈之前，本地与 AI 都不得推断「主要因为薪酬」等任何原因。'
export const REASONS_UNCLASSIFIED_NOTE =
  '存在有值但不在受控字典内的原因原值：这些记录单列为「未分类」，既不并入「其他」，也不猜成「薪酬」——请按业务口径维护字典。'

/** 未分类样例为空时的占位说明（避免出现一个空列表让人以为漏了内容） */
export const REASONS_NO_UNCLASSIFIED_SAMPLE = '没有未分类原值样例。'

/** 对比口径的固定提示（引擎另有 `insight.comparisonNote`，两者一起展示） */
export const COMPARISON_HEADING = '两个人群不同，不能混用'

/** 维度对比区的提示 */
export const DIMENSIONS_HEADING = '分维度对比'
export const DIMENSION_EMPTY_NOTE =
  '该维度在当前筛选下没有任何分组：不画空表、也不显示 0%，请放宽筛选或检查该字段是否被映射。'
export const DIMENSIONS_NOTE =
  '每个维度给出两种视角：特征内结果（该取值的 N / J / P / A / R / D、入职率、拒 offer 率，分母是该取值的 D，待入职仍在 D 内）与组内构成（该取值在拒 offer 组、入职组的人数，分母分别是 R 与 J）。两者分子相同、分母不同，不能互相替代。'

/** 维度对比表的说明：为什么不提供下钻（筛选已接入，缺的是「下钻后本页同步显示」这件事） */
export const DRILLDOWN_DISABLED_NOTE =
  '本页不提供下钻按钮：本页的筛选条与看板共用同一份口径，但下钻属于看板的交互（点击后改的是看板的筛选快照），在这里点击会改掉另一页的范围而本页无法即时同步，容易让读者以为两处数字不一致。要缩小范围请用上方筛选面板。'

/** 关注标签区的提示 */
export const ATTENTION_HEADING = '规则筛查（不是个人概率模型）'
export const ATTENTION_SCOPE_NOTE =
  '关注标签是规则筛查：命中条件全部满足才计入命中数；条件为「未知」的记录既不算命中、也不算不满足，并在「未知条件」里如实列出。'
export const ATTENTION_NO_RULES_NOTE = '当前没有可评估的规则。'
export const ATTENTION_EMPTY_SCOPE_NOTE =
  '当前筛选下两组比较人群为空（既没有拒 offer，也没有已入职）：所有规则的命中数都是 0，结论一律为「样本不足」。'

/** 阈值说明（数值来自 `insight.thresholds`，界面只解释它们是什么） */
export const THRESHOLDS_HEADING = '当前门槛（运营配置，不是行业标准）'
export const WAITING_THRESHOLD_LABEL = '等待时长阈值'

/** 建议区 */
export const ADVICE_HEADING = '行动建议'
export const ADVICE_EMPTY_NOTE =
  '本次没有可给出的行动建议：只有在观察到明确证据（原因缺失或未分类、低薪 / 无补贴 / 等待过长的规则有命中）时，才输出对应建议，不凭空生成。'

/** 页头 */
export const PAGE_TITLE = '拒 offer 专项'
export const PAGE_INTRO =
  '本页把「拒 offer 组（拒绝 offer + 拒绝口头 offer）」「入职组（已入职）」与核心率口径分开陈述：核心拒 offer 率的分母 D 含待入职，而两组比较人群只有拒 offer 组与入职组。原因只做受控字典查表，条件未知一律保持未知，结论一律可回溯到规则 ID 与规则版本。'
export const NO_RECORDS_NOTE =
  '当前筛选下没有记录：本页不显示任何比率、不画任何图表，也不显示 0%，请放宽筛选后再看。'

/** 数据集本身为空时的说明（与「筛选后为空」必须分开：后者要让用户去放宽筛选） */
export const NO_DATASET_RECORDS_NOTE =
  '已提交的数据集里没有任何保留记录：本页不显示任何比率，也不显示 0% 占位。'

/** 数据集有记录、但当前筛选一条都不满足时的说明 */
export const NO_MATCHED_RECORDS_NOTE =
  '当前筛选条件下没有匹配记录：本页不显示任何比率、不显示 0%，请在筛选面板里放宽条件或直接清空筛选。'

/* ------------------------------------------------- 图表文案（用户需求 ③，2026-09-27） */

/** 原因分布图的图注：强调分母是 R（含未填写），避免被读成「已填原因里的占比」 */
export const REASON_CHART_NOTE =
  '图上每一根柱子的分母都是全部拒 offer 记录 R（含「未填写」），不是「已填写」子集；「未分类」表示该列有值但不在字典内。'

/** 拒 offer 率 / 入职率对比图的图注 */
export const REJECTION_CHART_HINT =
  '图与下方数据表同源同精度（率一律保留 2 位小数，分母为 0 时不画点）。'

/** 筛选区标题与说明（本页复用看板的筛选面板，口径与看板完全一致） */
export const FILTER_SECTION_TITLE = '全局筛选（与看板共用同一份筛选口径）'
export const FILTER_SECTION_HINT =
  '本页的拒 offer 率、原因分布与关注标签都按这里筛选后的记录计算；筛选层与看板是同一份纯逻辑，因此两页数字必然一致。'
export const RULE_VERSION_LABEL = '规则版本'
export const RULE_VERSION_HINT = '每条关注标签都带同一版本号：结论可以按版本复现'
export const DATA_AS_OF_HINT = '数据快照声明，不由当前状态反推历史'

/** 免责声明标签（内容来自引擎的 `insight.disclaimer`） */
export const DISCLAIMER_LABEL = '免责声明（来自结论层，界面不改写）'

/** 空态：本地仓被锁定 / 清空 */
export const LOCKED_TITLE = '本地仓已锁定'
export const LOCKED_DESCRIPTIONS: Readonly<Record<'idle' | 'manual' | 'other', string>> = {
  idle: '闲置超过设定时间，本地仓已自动锁定，内存中的业务数据（解析结果、已提交数据集）已一并清空。',
  manual: '你手动锁定了本地仓，内存中的业务数据已一并清空。',
  other: '本地仓被清空或会话已过期，内存中的业务数据已一并清空。',
}
export const LOCKED_ITEMS = [
  '这是预期行为：锁定时必须清空可控状态与图表缓存，避免敏感明细留在内存里',
  '解锁后需要重新导入数据，或从加密仓恢复数据集（恢复入口在设置页，后续步骤接入）',
  '临时模式没有加密仓，关闭页面即清除；需要长期保存请使用加密仓',
] as const

/** 空态：未导入 / 未确认映射 / 未提交清洗结果 */
export const NO_SHEET_TITLE = '还没有可分析的记录'
export const NO_SHEET_DESCRIPTION =
  '拒 offer 专项只统计已确认并提交的清洗结果。现在内存会话里没有任何数据集，因此不显示任何示例比例、示例原因分布或占位数字。'
export const NO_SHEET_ITEMS = [
  '读 Excel / CSV / TSV 或直接粘贴表格，生成原始数据集',
  '确认字段映射后进入清洗预览，检查问题、重复与口径',
  '提交清洗结果后回到本页，即可看到两组口径、原因分布与关注标签',
] as const

export const NO_MAPPING_TITLE = '字段映射尚未确认'
export const NO_MAPPING_DESCRIPTION =
  '没有确认字段映射时，无法知道哪个源列是 offer 状态、哪个是拒绝原因；拒 offer 率与原因分布都会被算错，所以这里不猜、也不出结论。'
export const NO_MAPPING_ITEMS = [
  '映射页会给出四级匹配建议与冲突清单，冲突必须显式选择或合并',
  '「拒绝原因」列未映射时，原因分布会整体落到「未填写」，不能据此推断原因',
  '确认映射后返回清洗预览，再提交数据集',
] as const

export const NO_DATASET_TITLE = '还没有已提交的清洗结果'
export const NO_DATASET_DESCRIPTION =
  '字段映射已确认，但清洗结果还没有提交。拒 offer 专项只消费「已提交的规范化数据集」，这样每条结论都能对应到一份确定的输入。'
export const NO_DATASET_ITEMS = [
  '清洗页可预览前 100 行、查看问题统计与城市 / 状态别名',
  '确认去重策略、分析截止日与薪资口径后点击提交，数据集才会进入分析',
  '改清洗设置会作废已提交数据集（结论必须与输入一一对应）',
] as const
