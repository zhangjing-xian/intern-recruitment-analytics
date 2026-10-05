/**
 * AI 摘要所依赖的**本地规则集**与它们的二次确认（AI-6，docs/PRD.md 18.1 / 18.5）。
 *
 * ## 这个模块解决什么问题
 *
 * 摘要里有三个维度的取值**不是原始数据，而是本地解释的结果**：
 *
 * | 维度 | 本地解释来自哪里 | 原文会不会出去 |
 * |---|---|---|
 * | 岗位类别 `positionCategory` | 设置页维护的岗位类别映射 | 不会（只出类别） |
 * | 学校层次 `schoolLevel` | 清洗页的本地 GPT 名单 + 别名表 | 不会（只出层次） |
 * | 拒 offer 原因主题 `rejection.reasons` | 引擎的原因字典（精确查表） | 不会（只出类别与计数） |
 *
 * 这三样都是**用户自己的口径**，不是客观事实。把它们静默塞进外发摘要会有两种事故：
 * 1. 用户不知道「原来我的名单 / 字典也被发出去了」（哪怕只是它们的**结论**）；
 * 2. 用户改了名单或映射之后，上一次的「我知道了」被**自动沿用**到一套新规则上。
 *
 * 因此这里给出：规则的**可展示视图** + 一个**指纹**。用户确认的是「这份指纹对应的规则」；
 * 只要底层规则变了（换名单、改别名、改映射、字典版本变了），指纹就变，
 * 旧确认自动失效，必须重新到设置页确认一次。这比「让界面记得重置一个布尔量」可靠——
 * 它不依赖界面有没有真的清干净（与预览 hash 同一套思路）。
 *
 * ## 一条刻意的边界
 *
 * 本模块**不做**任何外发判断（那由 `privacy/aiSummary.ts` 的白名单与 `aiConfig` 负责），
 * 也不读加密仓 / 会话：调用方把当前生效的规则传进来，本模块只算「这是什么、指纹是多少」。
 * 因此它是纯函数层，不依赖 React / DOM / 网络 / 存储。
 */

import { REJECTION_REASON_CATEGORIES, type NormalizedDataset, type RuleVersion } from '../domain'
import {
  POSITION_CATEGORY_FALLBACK,
  POSITION_CATEGORY_MAX_RULES,
  normalizePositionCategoryRules,
  type PositionCategoryRule,
} from '../privacy/aiSummary'

/* ------------------------------------------------------------------ 类型 */

/** 三个规则集的稳定标识（界面与测试都用它对齐，文案可以改，这个不要改） */
export const AI_SUBJECT_RULE_IDS = ['positionCategory', 'schoolLevel', 'reasonTopic'] as const
export type AiSubjectRuleId = (typeof AI_SUBJECT_RULE_IDS)[number]

/**
 * 一个规则集的**可展示视图**。
 *
 * `sends` / `neverSends` 是这一层最重要的两个字段：用户要能一眼看出
 * 「哪些取值会被发出去、哪些原文永远不会」。缺了 `neverSends`，界面就只能说
 * 「已脱敏」——那正是本项目拒绝的写法。
 */
export type AiSubjectRuleView = {
  readonly id: AiSubjectRuleId
  readonly label: string
  /** 当前生效的取值（会作为维度键进入载荷） */
  readonly sends: readonly string[]
  /** 明确**不会**外发的原文（如实列出，不写「等等」） */
  readonly neverSends: readonly string[]
  /** 事实说明：谁负责、改了会怎样、做不到什么 */
  readonly lines: readonly string[]
  /** 规则来源（仓库里的实现位置，便于核对） */
  readonly source: string
}

/**
 * 调用方交给本模块的**当前生效规则**。
 *
 * 每一项都允许为 `null` 表示「本机还没有这份规则」（例如还没提交数据集）——
 * 此时视图必须如实说「未知」，**不得**编造一套默认名单。
 */
export type AiSubjectRulesInput = {
  /** 岗位类别映射（来自 AI 偏好；空数组 = 用户没配，退回中性标签） */
  readonly positionCategories: readonly PositionCategoryRule[]
  /** 本地 GPT 名单条数；`null` = 本机没有已提交的数据集，读不到 */
  readonly gptListCount: number | null
  /** GPT 名单模式（原值优先 / 列表模式） */
  readonly gptListMode: 'raw-first' | 'list-mode' | null
  /** 用户是否声明本地 GPT 名单完整 */
  readonly gptListComplete: boolean | null
  /** 学校别名条数 */
  readonly schoolAliasCount: number | null
  /**
   * 已提交数据集的规则版本（含**配置摘要**，步骤12）。
   *
   * 为什么指纹里有它：配置摘要已经把「名单 / 别名 / 去重策略」压成了短串，
   * 因此换名单必然换摘要——不需要把学校名单本身（可能很长、也是业务数据）
   * 复制进指纹计算里。
   */
  readonly ruleVersion: string | null
}

/** 二次确认记录：确认的是**哪一份**规则（指纹）+ 什么时候确认的 */
export type AiSubjectRulesConfirmation = {
  readonly fingerprint: string
  readonly confirmedAt: string
}

/**
 * 本地规则输入里**与数据集有关**的那一半（岗位类别映射除外）。
 *
 * 设置页与看板都要这份数据，因此取值口径只在这里实现一次：
 * 两边各自从 dataset 里抠字段，早晚会出现「设置页看到的名单条数与看板算指纹时用的不同」——
 * 那会让确认时对、发送时不对。
 */
export type AiLocalRuleInput = Omit<AiSubjectRulesInput, 'positionCategories'>

/** 没有已提交数据集时的规则输入：全部为 `null`（读不到就说读不到，不编造空名单） */
export const EMPTY_AI_LOCAL_RULES: AiLocalRuleInput = {
  ruleVersion: null,
  gptListCount: null,
  gptListMode: null,
  gptListComplete: null,
  schoolAliasCount: null,
}

/**
 * 已提交数据集 → 本地规则输入（设置页与看板共用）。
 *
 * 名单 / 别名 / 模式一律从 `metadata.cleaningSettings`（**提交那一刻的设置快照**）取，
 * 而不是从当前草稿取：摘要用的是已提交数据集，用它当时的设置才对得上
 * （步骤12 的原话：变更影响必须从这里取基准，不得由组件记一份）。
 * 快照缺失（步骤12 之前的数据集）时一律 `null`——**不假设**「设置没变」。
 */
export function aiLocalRulesOf(dataset: NormalizedDataset | null): AiLocalRuleInput {
  if (dataset === null) {
    return EMPTY_AI_LOCAL_RULES
  }
  const cleaning = dataset.metadata.cleaningSettings ?? null
  return {
    ruleVersion: ruleVersionLabelOf(dataset.metadata.ruleVersion),
    gptListCount: cleaning === null ? null : cleaning.gptList.length,
    gptListMode: cleaning === null ? null : cleaning.gptListMode,
    gptListComplete: cleaning === null ? null : cleaning.gptListComplete,
    schoolAliasCount: cleaning === null ? null : cleaning.schoolAliases.length,
  }
}

/* ------------------------------------------------------------------ 指纹 */

/**
 * 规则版本的可读标签（`语义基线+配置摘要`）。
 *
 * 为什么抽到这一层：它同时是**摘要范围**里显示的版本、AI 历史里回溯的版本、
 * 以及本模块指纹的输入之一。三处各写一遍「有摘要就拼、没有就只写基线」，
 * 早晚会出现「设置页说 A、历史里记的是 B」——那会让指纹比较失去意义。
 * `src/ai/summary.ts` 也从这里取，两边由同一个函数保证一致。
 */
export function ruleVersionLabelOf(version: RuleVersion): string {
  return version.configRevision === undefined
    ? version.rulesVersion
    : `${version.rulesVersion}+${version.configRevision}`
}

/**
 * 稳定指纹（FNV-1a 变体，与 `configVersion` / `previewHashOf` 同一算法口径）。
 *
 * 与 `privacy/aiPreview.ts` 的 `previewHashOf` 是同一段算法：两处都需要
 * 「同输入 → 同输出」，但服务于不同契约（规则集 vs 预览内容），各自独立演进更稳。
 * 这里只需要碰撞概率低，不用于防篡改。
 */
export function subjectRulesFingerprintOf(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).toUpperCase().padStart(8, '0')
}

/**
 * 规则集的指纹输入。**逐字段列出**（不展开对象）：
 * `JSON.stringify` 会把 `undefined` 的键丢掉，于是「没有名单」与「名单为空」
 * 会算出同一个指纹——两者是不同的状态（一个是读不到、一个是真的空名单）。
 */
export function subjectRulesFingerprint(input: AiSubjectRulesInput): string {
  const categories = normalizePositionCategoryRules(input.positionCategories).map(
    (rule) => `${rule.keyword}=>${rule.category}`,
  )
  return subjectRulesFingerprintOf(
    JSON.stringify({
      positionCategories: categories,
      gptListCount: input.gptListCount ?? null,
      gptListMode: input.gptListMode ?? null,
      gptListComplete: input.gptListComplete ?? null,
      schoolAliasCount: input.schoolAliasCount ?? null,
      ruleVersion: input.ruleVersion ?? null,
      // 原因字典是代码常量：把类别清单算进指纹，字典一改旧确认就失效
      reasonCategories: REJECTION_REASON_CATEGORIES,
    }),
  )
}

/** 生成一份确认记录（界面在用户点击「确认这批规则」时调用） */
export function confirmAiSubjectRules(
  input: AiSubjectRulesInput,
  confirmedAt: string,
): AiSubjectRulesConfirmation {
  return { fingerprint: subjectRulesFingerprint(input), confirmedAt }
}

/**
 * 当前规则是否已被确认（**唯一判据**：指纹相等）。
 *
 * 没有确认记录、指纹不同、确认时间缺失，三者都算「未确认」——
 * 宁可让用户多点一次，也不把一份没确认过的解释发出去。
 */
export function isAiSubjectRulesConfirmed(
  confirmation: AiSubjectRulesConfirmation | null,
  input: AiSubjectRulesInput,
): boolean {
  if (confirmation === null || confirmation.confirmedAt.trim() === '') {
    return false
  }
  return confirmation.fingerprint === subjectRulesFingerprint(input)
}

/* ------------------------------------------------------------------ 视图 */

/** 原因主题里不属于「可被命中的类别」的两个兜底项：它们是缺失统计，不是主题 */
const REASON_NON_TOPICS: readonly string[] = ['未分类', '未填写']

/**
 * 构造三个规则集的视图（唯一入口）。
 *
 * 顺序固定为 `AI_SUBJECT_RULE_IDS`：界面顺序与测试断言都依赖它稳定。
 */
export function buildAiSubjectRules(input: AiSubjectRulesInput): readonly AiSubjectRuleView[] {
  const rules = normalizePositionCategoryRules(input.positionCategories)
  const topics = REJECTION_REASON_CATEGORIES.filter(
    (category) => !REASON_NON_TOPICS.includes(category),
  )

  return [
    {
      id: 'positionCategory',
      label: '岗位类别映射',
      sends: rules.length === 0 ? [POSITION_CATEGORY_FALLBACK] : rules.map((rule) => rule.category),
      neverSends: ['岗位名称原文（映射只是本机查表，原文不进载荷）'],
      lines: [
        rules.length === 0
          ? `当前没有配置映射：岗位维度只会发出中性标签「${POSITION_CATEGORY_FALLBACK}」，具体岗位名不发出去。`
          : `当前配置了 ${String(rules.length)} 条映射（最多 ${String(POSITION_CATEGORY_MAX_RULES)} 条）：命中的取值发类别，未命中的发「${POSITION_CATEGORY_FALLBACK}」，都不发岗位原文。`,
        '映射是精确查表（去掉空白、忽略大小写后逐字比对），不做包含匹配、不做同义词推断——猜出来的类别属于编造。',
        '类别本身也是外发文本：超过 12 个字或长得像编号的类别会在保存时被丢掉，界面不会假装它生效了。',
      ],
      source: 'src/privacy/aiSummary.ts 的 positionCategoryOf + 设置页的映射编辑',
    },
    {
      id: 'schoolLevel',
      label: '学校层次（本地名单）',
      sends: ['GPT 院校', '非 GPT 院校', '未标注'],
      neverSends: ['学校全名（无论名单里有没有它）', '学校别名的原文与规范名'],
      lines: [
        input.gptListCount === null
          ? '本机还没有已提交的数据集，因此读不到当前生效的本地名单与别名；提交数据集后这里会显示它们。'
          : `当前生效的名单有 ${String(input.gptListCount)} 所学校，别名 ${String(input.schoolAliasCount ?? 0)} 条；模式为 ${
              input.gptListMode === 'list-mode' ? '原值优先 + 缺失时查名单' : '原值优先（缺失保持未知）'
            }，${input.gptListComplete === true ? '已声明名单完整（不在名单可判为否）' : '未声明名单完整（不在名单仍为未知）'}。`,
        '名单只决定「层次」这一个三值标签：命中与否都不会让学校全名进入载荷。',
        '名单、别名与模式在清洗预览页维护；改动会换数据集版本，因此本页的确认也会随之失效。',
      ],
      source: 'src/cleaning/normalize.ts 的 GPT 名单判定 + dataset.metadata.cleaningSettings',
    },
    {
      id: 'reasonTopic',
      label: '拒 offer 原因主题',
      sends: topics,
      neverSends: ['逐条拒绝原因的原文', '「未分类」样例（那只在拒 offer 专项页本机展示）'],
      lines: [
        `原因只查字典、不推断：命中的条数按 ${String(topics.length)} 个主题计入摘要，「未填写」与「未分类」作为缺失统计单独计数，不混进任何主题。`,
        '摘要是「主题 + 计数」，不是原因原文；自由文本原因在任何隐私级别下都不会被发送。',
        '字典随代码版本一起打包（rejection-rules/1）：字典一改，指纹就变，需要重新确认。',
      ],
      source: 'src/domain/analytics/rejection.ts 的 REJECTION_REASON_CATEGORIES',
    },
  ]
}
