/**
 * AI 结果的**本地敏感检查**（AI-5，docs/PRD.md 16.5 / 17.4）。
 *
 * ## 为什么收到内容后还要再查一遍
 *
 * PRD 16.5：「内容来自模型也视为不可信文本，再做一次本地敏感字段检查与导出预览」。
 * 这一步查的不是「我们发了什么」（发送前的白名单重建已经保证了），而是
 * **「模型回了什么」**：模型可能凭空写出形如 `candidateName` 的字段名，
 * 也可能被输入里某个取值启发而重复出来。查不到是常态，查到必须让用户看见。
 *
 * ## 与发送前检查的分工（两者都要跑，因为防的是不同的事故）
 *
 * | 阶段 | 检查 | 防的事故 |
 * |---|---|---|
 * | 发送前 | `checkSanitizedAiPayload`（白名单）+ `scanSensitiveFields` | 我们的载荷里混进了不该发的东西 |
 * | 收到后 | 本模块 | 模型的回复里出现了像敏感字段/取值的内容，用户据此做判断 |
 *
 * ## 两条纪律
 *
 * 1. **只报位置，不回显命中值**：与步骤11 的导出闸门一致——如果检查结果自己把敏感值
 *    回显到界面上，那这次检查本身就成了泄漏渠道；
 * 2. **不阻断展示**：模型回复里的 `candidateName` 很可能只是在**解释**「我没有看到姓名字段」。
 *    因此这是**提示**而不是闸门；真正的闸门在导出前（`exportAiMarkdown` 会阻断）。
 */

import {
  SENTINEL_HIT_LABEL,
  containsForbiddenField,
  forbiddenNamesIn,
  scanSensitiveFields,
} from '../privacy/sanitize'

export type AiResponseCheck = {
  /** 是否发现需要用户注意的内容 */
  readonly hasFindings: boolean
  /** 命中的**字段名**（去重、排序；只报名字，不回显任何取值） */
  readonly fieldNames: readonly string[]
  /** 是否有取值命中哨兵（只给一个标记，不说是哪个哨兵、更不回显原文） */
  readonly sentinelHit: boolean
  /** 面向用户的一句话说明（没有发现时为 null） */
  readonly note: string | null
}

/**
 * 检查模型返回的正文。
 *
 * `sentinels` 由调用方给出（通常是本次数据集里的姓名 / 学校 / HR 名等哨兵值）；
 * 不传时只做字段名检查——**不假装做过取值检查**。
 */
export function checkAiResponseText(
  text: string,
  sentinels: readonly string[] = [],
): AiResponseCheck {
  const scan = scanSensitiveFields(text, sentinels)
  /*
   * `forbiddenFieldNames` 的形态是 `路径.字段名`（例如 `kpis[0].candidateName`）。
   * 界面要的是**字段名清单**，因此这里取最后一段；路径本身对用户没有意义。
   * 只报名字、不回显任何取值——检查结果自己回显敏感值，就等于检查本身成了泄漏渠道。
   */
  const names = new Set(
    scan.forbiddenFieldNames.map(
      (path) => path.split(/[.[\]]/).filter(Boolean).pop() ?? path,
    ),
  )

  /*
   * **关键补丁**：`scanSensitiveFields` 是给「对象」用的——它只检查**键名**，
   * 字符串值只参与哨兵匹配、不参与禁名匹配（步骤11 的 SanitizedReport 正是那种形状）。
   * 但模型回复是**一整段自由文本**：没有键可言，禁名就藏在正文里。
   * 因此这里必须再对文本本身跑一次 `containsForbiddenField`，否则「回复里出现了
   * candidateName」会**静默放过**——那是这一步最容易漏掉的一类事故。
   * 两个检查都要跑：它们防的是不同形状的输入。
   */
  if (containsForbiddenField(text)) {
    for (const name of forbiddenNamesIn(text)) {
      names.add(name)
    }
    if (names.size === 0) {
      // 兜底：文本整体命中禁名判定，但没有单个禁名能对上（拼接写法）。
      // 这种情况下**不能说没命中**，因此给一个不含原文的占位说明。
      names.add('（疑似拼接写法的敏感字段名）')
    }
  }

  const fieldNames = [...names].sort()
  const sentinelHit = scan.sentinelHits.length > 0

  if (fieldNames.length === 0 && !sentinelHit) {
    return { hasFindings: false, fieldNames: [], sentinelHit: false, note: null }
  }

  const parts: string[] = []
  if (fieldNames.length > 0) {
    parts.push(
      `结果里出现了与敏感字段同名的字样：${fieldNames.join('、')}。这只说明模型提到了这些字段名，不代表它收到了对应数据；请对照左侧「本次已发送的摘要」自行判断。`,
    )
  }
  if (sentinelHit) {
    parts.push(
      `结果里有一处取值命中了本地哨兵${SENTINEL_HIT_LABEL}：这可能只是巧合（例如模型复述了聚合标签），也可能意味着某个取值被写了回来。出于安全考虑，这里不回显命中的原文。`,
    )
  }

  return {
    hasFindings: true,
    fieldNames,
    sentinelHit,
    note: parts.join(' '),
  }
}
