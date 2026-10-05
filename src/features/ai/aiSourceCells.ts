/**
 * 看板 / 摘要聚合结果 → AI 脱敏引擎的**候选单元格**（AI-1 建立，AI-2 复用）。
 *
 * ## 这一层存在的理由
 *
 * 脱敏引擎（`src/privacy/aiSummary.ts`）是**纯函数**：它拿不到记录、也不认识看板的
 * `GroupSummary`，只接受 `AiSourceCell`。因此必须有人把「已经算好的分组」翻译成候选单元格。
 * 这个翻译是**安全关键**的：如果把 HR 真名当 `key` 交上去、或者把原始金额当成薪资区间交上去，
 * 载荷就会泄漏。所以本模块只做「取值 → 候选格」的映射，三条纪律：
 *
 * 1. **不重算任何指标**：`total` / `coreDenominator` / `rejected` 一律取引擎已算好的
 *    `group.counts`，周期取 `group.cycles.actual.medianDays`（AGENTS.md §2.3、§4）；
 * 2. **危险取值换成受控取值**：HR 出代号（绝不是真名）、学校出层次、薪资出区间；
 * 3. **换不出来就不发**：宁可整格省略并计入抑制数，也不换一个「猜的」值（AI08）。
 *
 * ## 与引擎的分工（重要）
 *
 * 本层**不**决定「能不能发」：白名单、隐私级别、`D < 5` 抑制、TopN 合并、体积预算
 * 全部由引擎负责（`buildSanitizedAiPayload`）。本层只负责把候选值表达清楚。
 * 这样「改隐私级别就撤销旧预览」这类要求只需要在引擎里正确一次。
 *
 * ## 本模块**刻意不发出**的维度（逐条说明原因）
 *
 * - `isGptSchool`：它不是「可外发的粒度」，而是学校维度的**派生层次**。引擎要求
 *   `dimension: 'school'` + `isGptSchool` 三值，由 `schoolLevelOf` 换成
 *   「GPT 院校 / 非 GPT 院校 / 未标注」。多发一个 `isGptSchool` 维度只会得到同一份信息，
 *   还会因「同一维度在多张表中重复出现」触发引擎的整维省略（AI06 的跨表检查）。
 * - `candidateId` / `requirementId`：身份与需求 ID 属于**禁止发送**项（PRD 16.3、AI05）。
 *   它们在载荷结构里没有位置，因此本层连候选格都不生成；即使误发，引擎的
 *   `looksLikeIdentifier` 也会挡住形如 `REQ-0001` 的取值（两道保险，不是二选一）。
 * - `candidateName` / `recruiterName` / `sourceFileName` / 拒绝原因自由文本：同上，
 *   一律不进候选格。原因只以「受控类别 + 计数」出现在载荷的 `rejectionReasons`，
 *   由调用方从 `rejectionReasonDistribution` 取类别，原文样例留在本机。
 * - `recordId` / `recordCode`：逐条记录级标识，任何一粒明细都不该进聚合载荷（AGENTS.md §2.2）。
 */

import {
  GPT_NO_LABEL,
  GPT_YES_LABEL,
  UNKNOWN,
  actualCycleDays,
  groupRecords,
  summarizeRecords,
  type GroupSummary,
  type NormalizedRecord,
  type TriState,
} from '../../domain'
import {
  cycleBandOf,
  type AiSourceCell,
  type AiSourceProfileCell,
} from '../../privacy/aiSummary'

/* ------------------------------------------------------------------ 输入契约 */

/**
 * 一个维度交给 AI 的输入。
 *
 * `dimension` 用**看板的维度名**（`school` / `position` / …）而不是载荷维度名：
 * 归一化（`school → schoolLevel`、`position → positionCategory`）是引擎的职责，
 * 界面再映射一遍就会出现两处口径，早晚不一致。
 */
export type AiDimensionGroupInput = {
  readonly dimension: string
  /** 维度标签（仅用于界面提示，不进载荷；载荷标签由引擎的 `AI_DIMENSION_LABELS` 给） */
  readonly label: string
  readonly groups: readonly GroupSummary[]
  /** 该维度的合计（`summarizeRecords('全部（当前筛选）', records)`），保留以核对样本量 */
  readonly total: GroupSummary
}

/** 周期区间分组的输入：`groups` 必须是**按周期区间分好**的组（见 `cycleBandGroupsOf`） */
export type AiCycleBandGroupsInput = {
  readonly groups: readonly GroupSummary[]
  readonly total: GroupSummary
}

export type AiSourceCellsInput = {
  readonly dimensions: readonly AiDimensionGroupInput[]
  /**
   * 薪资区间分档边界（与筛选面板 / 分组共用同一份用户配置）。
   *
   * 为什么必须传：`salaryBand` 维度的分组键只可能是「区间标签」或「未知」。
   * 「未知」绝不能当区间发出去（缺失 ≠ 最低薪，PRD 16.3），所以本层要用它反查，
   * 只有确实是区间标签的键才给出 `salaryBand`。
   *
   * 调用方注意：`dimension === 'salaryBand'` 的分组**必须用同一份边界**聚合出来
   * （`aggregateByDimension(records, 'salaryBand', { salaryBandEdges: edges })`），
   * 否则分组键全是「未知」，薪资维度会被整维省略——那是静默丢功能，不是更安全。
   * 看板侧本来就把同一份 `groupingOptions` 同时交给筛选与分组，因此天然一致。
   */
  readonly salaryBandEdges?: readonly number[]
  /** 周期区间分组（可选；不传则不发周期维度，而不是编一个） */
  readonly cycleBandGroups?: AiCycleBandGroupsInput
  /**
   * 显式指定的 HR 代号映射（可选）。
   *
   * 不传时本层会自己编一套（首次出现顺序）。需要**多次遍历同一批分组**时
   * （主表 + 组内构成表）必须显式传入同一份映射，否则两次会编出不同代号，
   * 组内构成会在脱敏引擎里匹配不上并静默消失（见 `RecruiterOrdinals`）。
   */
  readonly recruiterOrdinals?: RecruiterOrdinals
}

/**
 * HR 代号映射：`分组原始取值 → 代号`。
 *
 * 为什么需要它（AI-2 发现的一个静默丢数据问题）：代号原本按**每组 `groups` 的首次出现顺序**
 * 现编，于是「主表」与「拒 offer 组间比较表」各自从 1 开始编，同一个 HR 在两处拿到**不同代号**
 * （主表 `HR-1`、比较表可能是 `HR-2`）。而脱敏引擎是按「载荷维度名 + 原始取值」把组内构成
 * 合并到主表行上的，代号一旦不一致，组内构成就**匹配不上并静默消失**——
 * 界面看起来一切正常，只是那一列数字没了。
 *
 * 因此代号必须由**同一批分组**预先定下来、并显式传给后续那次遍历。
 */
export type RecruiterOrdinals = ReadonlyMap<string, string>

/* ------------------------------------------------------------------ 三值反查 */

/**
 * 看板分组键 → 三值（`isGptSchool` 的**反向映射**）。
 *
 * 为什么需要反查：`grouping.ts` 的 `dimensionValueOf` 把三值**字符串化**后才分组——
 * `true → '是'`、`false → '否'`、`null/undefined → '未知'`（`triStateLabel`）。
 * 而引擎的 `schoolLevelOf` 需要的是三值本身。两边必须严格对齐：
 * - `'是' → true`、`'否' → false`；
 * - **任何其他取值（含 `'未知'`）→ null**：未知必须保持未知，
 *   绝不能因为「不是『是』」就猜测成「非 GPT 院校」（AI08）。
 *
 * 用同一套导出常量（`GPT_YES_LABEL` / `GPT_NO_LABEL`）而不是把中文再写一遍：
 * 抄一遍就等于两处口径，改一处就会静默失配。
 */
export function gptTriStateOf(groupKey: string): TriState {
  if (groupKey === GPT_YES_LABEL) {
    return true
  }
  if (groupKey === GPT_NO_LABEL) {
    return false
  }
  return null
}

/**
 * 分组键 → 已分桶的薪资区间。
 *
 * 只接受**确实是一个区间标签**的键（`<3000` / `3000–3999` / `≥6000`）。
 * 判定方式是「键必须属于该分档配置下所有可能的区间标签集合」：
 * - `'未知'`、空串、裸金额（`'4200'`）都不在集合里 → 返回 null → 引擎整行省略。
 *   这一点很关键：把「未知」当成区间发出去等于声称「这些人的薪资落在某个区间」，那是编造；
 * - 反查**不依赖**「某一个具体金额」，因为区间标签是有限的：
 *   边界 `[3000, 4000]` 只会产生 `<3000` / `3000–3999` / `≥4000` 三种标签。
 *
 * 为什么不用 `domain` 的 `bandOf` 反查：那是看板侧的分档函数，桶边界语义与脱敏层要求
 * 的「区间字符串」并不完全一致（看板的 `bandOf` 对低于首个边界的值会向上落桶）。
 * 脱敏层只要求「这是一个区间、不是一个点值」，因此这里按脱敏层的形状判定。
 */
export function salaryBandOfGroupKey(
  groupKey: string,
  edges: readonly number[] | undefined,
): string | null {
  if (edges === undefined || edges.length === 0) {
    return null
  }
  const labels = bandLabelsOf(edges)
  return labels.includes(groupKey) ? groupKey : null
}

/** 给定边界下所有可能的区间标签（与 `grouping.ts` 的 `bandOf` 输出形状一致） */
function bandLabelsOf(edges: readonly number[]): readonly string[] {
  const sortedEdges = [...new Set(edges)]
    .filter((edge) => Number.isFinite(edge))
    .sort((left, right) => left - right)
  if (sortedEdges.length === 0) {
    return []
  }
  const labels: string[] = [`<${String(sortedEdges[0])}`]
  for (let index = 0; index < sortedEdges.length - 1; index += 1) {
    const lower = sortedEdges[index]
    const upper = sortedEdges[index + 1]
    if (lower === undefined || upper === undefined) {
      continue
    }
    labels.push(`${String(lower)}–${String(upper - 1)}`)
  }
  const last = sortedEdges[sortedEdges.length - 1]
  if (last !== undefined) {
    labels.push(`≥${String(last)}`)
  }
  return labels
}

/* ------------------------------------------------------------------ 周期区间分组 */

/**
 * 把记录按**实际招聘周期区间**分组（可选输入，供 `dimension: 'cycleBand'` 使用）。
 *
 * 为什么周期维度不能像其他维度一样直接取分组：载荷里的周期只能以区间出现（PRD 16.3），
 * 而引擎的分桶函数 `cycleBandOf` 按天数算，因此候选格的键必须是「区间」本身，
 * 不能是城市名之类。本函数用引擎的同一个 `cycleBandOf` 先分桶，再交给引擎的
 * 通用分组聚合（`groupRecords` + `summarizeRecords`）计算 N / D / R ——
 * **计数仍全部来自引擎**，本层只是提供了「按区间取值」这一个选择器。
 *
 * 无法计算周期的记录（日期缺失 / 非法 / 为负）**不进任何桶**：`'未知'` 不是一个周期区间，
 * 把它当区间发出去会被读成「这些人的周期落在某个区间」。这些记录由载荷的 `quality`
 * 与 `limits` 单列说明，不会被静默吞掉。
 */
export function cycleBandGroupsOf(records: readonly NormalizedRecord[]): readonly GroupSummary[] {
  return groupRecords(records, (record) =>
    // 分桶口径与引擎完全共用：`cycleBandOf` 是 `src/privacy/aiSummary.ts` 的导出函数。
    // 无法分桶（null）时用 `UNKNOWN` 占位，紧接着被下面的 filter 去掉——
    // 「未知周期」不是一个可外发的周期区间。
    cycleBandOf(actualCycleDays(record)) ?? UNKNOWN,
  )
    .filter((group) => group.key !== UNKNOWN)
    .map((group) => summarizeRecords(group.key, group.records))
}

/* ------------------------------------------------------------------ HR 代号 */

/**
 * 预先把 HR 代号编好，供**多次遍历同一批分组**时共用（AI-2）。
 *
 * 编号顺序 = 输入维度的遍历顺序（调用方传的是按 D 降序排好的分组），
 * 因此同一份输入必然得到同一套代号。
 */
export function buildRecruiterOrdinals(
  dimensions: readonly AiDimensionGroupInput[],
): RecruiterOrdinals {
  const ordinals = new Map<string, string>()
  let ordinal = 0
  for (const dimension of dimensions) {
    if (dimension.dimension !== 'recruiter') {
      continue
    }
    for (const group of dimension.groups) {
      if (group.key === UNKNOWN || group.key.trim() === '' || ordinals.has(group.key)) {
        continue
      }
      ordinal += 1
      ordinals.set(group.key, `HR-${String(ordinal)}`)
    }
  }
  return ordinals
}

/* ------------------------------------------------------------------ 主入口 */

/**
 * 唯一的构造入口：已算好的分组 → 候选单元格。
 *
 * 顺序即输出顺序（引擎按输入顺序生成行，保证「同输入同产物」）。
 * 排序保持调用方给的顺序（看板 / 摘要用 `sortGroupsByDenominator`），因此 HR 代号
 * 「首个出现的 D 最大者 = HR-1」是稳定的，不会因为渲染次数变化。
 */
export function buildAiSourceCells(input: AiSourceCellsInput): readonly AiSourceCell[] {
  const cells: AiSourceCell[] = []
  const recruiters = new Map<string, string>(input.recruiterOrdinals ?? [])
  /** 已经发出的 HR 代号数：只增不减，保证「同一份输入 → 同一套代号」 */
  let ordinal = recruiters.size

  const codeOf = (rawKey: string): string => {
    const existing = recruiters.get(rawKey)
    if (existing !== undefined) {
      return existing
    }
    ordinal += 1
    const code = `HR-${String(ordinal)}`
    recruiters.set(rawKey, code)
    return code
  }

  for (const dimension of input.dimensions) {
    for (const group of dimension.groups) {
      const cell = cellOf(dimension.dimension, group, input.salaryBandEdges, codeOf)
      if (cell !== null) {
        cells.push(cell)
      }
    }
  }

  if (input.cycleBandGroups !== undefined) {
    for (const group of input.cycleBandGroups.groups) {
      const cell = cycleBandCellOf(group)
      if (cell !== null) {
        cells.push(cell)
      }
    }
  }

  return cells
}

/** 取某个分组在某个维度上的候选格；返回 null 表示「本层决定不发这一格」 */
function cellOf(
  dimension: string,
  group: GroupSummary,
  salaryBandEdges: readonly number[] | undefined,
  recruiterCodeOf: (rawKey: string) => string,
): AiSourceCell | null {
  const base = {
    total: group.counts.total,
    coreDenominator: group.counts.coreDenominator,
    rejected: group.counts.rejected,
  }

  switch (dimension) {
    case 'recruiter': {
      /*
       * HR：**真名绝不进载荷**。引擎只读 `recruiterCode`，但 `key` 也必须中性——
       * 因为候选格以后可能被写进日志、历史或错误信息，真名一旦带上就出去了。
       */
      if (group.key === UNKNOWN || group.key.trim() === '') {
        // 「未知」不是一位 HR：发出去只会变成一位不存在的招聘 HR，因此整行不发。
        return null
      }
      const code = recruiterCodeOf(group.key)
      return { dimension, key: code, ...base, recruiterCode: code }
    }
    case 'school':
      /*
       * 学校：**只出层次**。分组键是 `dimensionValueOf` 字符串化后的三值标签
       * （是 / 否 / 未知），这里反查回三值交给引擎；未知保持 null，不猜（AI08）。
       * 因此 school 维度的候选格可能只有 GPT / 非 GPT / 未标注三个键——
       * 那正是我们要的粒度，学校全名永远不进载荷。
       */
      return { dimension, key: group.key, ...base, isGptSchool: gptTriStateOf(group.key) }
    case 'salaryBand': {
      // 薪资：只发已分桶的区间；区间反查不出来（含「未知」）就给 null，由引擎整行省略。
      const band = salaryBandOfGroupKey(group.key, salaryBandEdges)
      return { dimension, key: group.key, ...base, salaryBand: band }
    }
    default:
      // 其余维度（城市 / 渠道 / 推荐类型 / 岗位 / 序列 / 部门 / 需求类型 / 毕业年级 /
      // 学历 / 房补类型）：取值本身是受控枚举或用户业务标签，原样交给引擎按白名单与
      // 隐私级别处理；「未知」是独立可选值，不是脏数据（PRD 6.3），因此照发。
      return { dimension, key: group.key, ...base }
  }
}

/**
 * 周期区间格：`cycleDays` 取该区间的**实际周期中位数**（引擎已算好）。
 *
 * 引擎会用 `cycleBandOf(cycleDays)` 重新算出区间键，因为中位数落回原区间，
 * 所以键与分组键一致；中位数缺失（`n = 0`）时不给 `cycleDays`，引擎整行省略。
 */
function cycleBandCellOf(group: GroupSummary): AiSourceCell | null {
  const medianDays = group.cycles.actual.medianDays
  if (medianDays === null) {
    return null
  }
  return {
    dimension: 'cycleBand',
    key: group.key,
    total: group.counts.total,
    coreDenominator: group.counts.coreDenominator,
    rejected: group.counts.rejected,
    cycleDays: medianDays,
  }
}

/**
 * 把同一批分组再换算成**组内构成候选格**（AI-2，PRD 9.1 视角一）。
 *
 * 必须复用同一套 HR 代号：代号若不一致，脱敏引擎按「维度 + 原始取值」合并组内构成时
 * 会匹配不上并**静默丢掉这一列**（见 `RecruiterOrdinals` 的说明）。
 * 因此这里显式接收 `recruiterOrdinals`，而不是自己再编一套。
 */
export function buildAiProfileCells(
  input: AiSourceCellsInput & { readonly recruiterOrdinals: RecruiterOrdinals },
): readonly AiSourceProfileCell[] {
  const cells: AiSourceProfileCell[] = []
  for (const dimension of input.dimensions) {
    for (const group of dimension.groups) {
      const cell = profileCellOf(dimension.dimension, group, input.recruiterOrdinals)
      if (cell !== null) {
        cells.push(cell)
      }
    }
  }
  return cells
}

/** 组内构成的一格：只带两个组内计数与可外发取值所需的辅助字段 */
function profileCellOf(
  dimension: string,
  group: GroupSummary,
  recruiterOrdinals: RecruiterOrdinals,
): AiSourceProfileCell | null {
  const base = {
    rejectedGroupCount: group.groupComposition.rejectedGroupCount,
    joinedGroupCount: group.groupComposition.joinedGroupCount,
  }
  switch (dimension) {
    case 'recruiter': {
      if (group.key === UNKNOWN || group.key.trim() === '') {
        return null
      }
      const code = recruiterOrdinals.get(group.key)
      if (code === undefined) {
        /*
         * 主表里没出现过这位 HR：说明两次遍历的输入不一致。
         * 此时**不发**这一格，而不是临时编一个代号——编出来的代号与主表对不上，
         * 引擎只会把它当成一个「不在主表里的取值」而丢弃，等于白带一份可能误导的数据。
         */
        return null
      }
      return { dimension, key: code, ...base, recruiterCode: code }
    }
    case 'school':
      return { dimension, key: group.key, ...base, isGptSchool: gptTriStateOf(group.key) }
    default:
      return { dimension, key: group.key, ...base }
  }
}

/**
 * 「缺失薪资」计数：有多少条记录的薪资**不可用于分析**。
 *
 * 为什么放在这一层、而不是在看板里就地算：它是载荷 `quality.missingSalary` 的取值来源，
 * 属于「喂给 AI 的数字」，应当与其它候选格的换算放在同一处，便于一处审查、一处测试。
 *
 * 为什么是「总数 − 可用数」而不是遍历记录去数：
 * 统一指标引擎已经算好了「薪资对比」的有效样本数（`metricAvailability` 里
 * `validSampleCount` 正好是「薪资金额非空的记录数」，见 `cleaning/report.ts` 的
 * `sampleCountFor`）。用一次减法复用既有口径，比在组件里再写一遍判断条件安全——
 * 后者会形成第二处口径实现，两处早晚会不一致（AGENTS.md §2.3）。
 *
 * `validSampleCount` 为 `null` 表示该模块口径不适用（例如薪资模块被禁用）。
 * 此时**不能填 0**：0 会被读成「没有记录缺薪资」，而实际是「全部记录的薪资都不可用」。
 */
export function missingSalaryCount(
  totalRecords: number,
  usableSalarySample: number | null,
): number {
  const usable = usableSalarySample ?? 0
  return Math.max(0, totalRecords - usable)
}
