/**
 * 导出前的「本机已知敏感取值」哨兵收集（步骤11 建立，**2026-09-27 修正误拦**）。
 *
 * ## 它是干什么的
 *
 * `SanitizedReport` 里本来就不该出现姓名 / 具体推荐人 / HR 姓名 / 原因原文。
 * 因此导出前拿**源记录**里的这些值当哨兵，去报告里搜一遍：搜到就阻断导出
 * （PRD 11.5「用哨兵字符串检索导出内容」在真实数据上的等价做法）。
 *
 * ## 修正了什么（用户人工验收时撞到的问题）
 *
 * 原实现把源列里的**每一个非空值**都当哨兵。但有些列的取值是**受控字典词汇**，
 * 而聚合报告本来就会带这些标签，于是永远自撞：
 *
 * - 渠道 / 推荐类型：源里写「内推」，报告的「渠道 / 推荐类型」分组标签也是「内推」→ 命中 → 阻断；
 * - 拒 offer 原因：源里写「薪酬」（字典里的类别名），报告的「原因分布」类别也是「薪酬」→ 命中 → 阻断。
 *
 * 结果：这类**完全正常**的数据永远导不出报告——实测在演示数据（50 行合成样本）上就会
 * 命中 6 处、把四个导出按钮全部锁死。而报告里那几个字是**类别标签**，不是任何人的身份信息。
 *
 * 因此这里把哨兵收窄为「**可能指认到具体人或自由文本**的取值」：
 * 受控字典词汇（`内推` / `HR推` / 原因字典可命中的写法）不进哨兵集合；
 * 而**具体人名**（例如「示例推」这种带姓名的推荐人写法）与**字典外的自由文本**照旧是哨兵——
 * 它们才是真正需要盯住的东西。
 */

import { classifyRejectionReason, type NormalizedRecord } from '../../domain'

import { SENTINEL_FIELD_LABELS } from './exportText'

/** 每个字段最多采样多少条（避免几万行数据把导出前的检查拖成几十秒） */
export const SENTINEL_LIMIT_PER_FIELD = 200

/** 参与哨兵检查的源字段（顺序即展示顺序） */
export const SENTINEL_FIELDS: readonly (keyof NormalizedRecord)[] = [
  'candidateName',
  'referrer',
  'recruiter',
  'rejectionReason',
]

/** 字段名 → 界面上的中文标签由 `exportText` 提供（文案只有一个来源，这里不复制一份） */

/** 受控的推荐类型词汇：这些是类别标签，不是具体人（含「内推」与「HR推」两种标准写法） */
const CONTROLLED_REFERRAL_VALUES: readonly string[] = ['内推', 'HR推']

/**
 * 这个取值是不是**受控字典词汇**（＝报告里本来就会作为类别标签出现，因此不该当哨兵）。
 *
 * 只对两个字段做这个判断，且判断是**精确**的：
 * - `referrer`：只有两个标准写法算受控；「示例推」这类带姓名的写法**不**算（那是具体人）；
 * - `rejectionReason`：复用原因字典的同一套判定（`classifyRejectionReason`），
 *   命中字典才排除；「薪酬太低所以去了别家」这种自由文本仍**保留**为哨兵。
 */
export function isControlledDictionaryValue(
  field: keyof NormalizedRecord,
  value: string,
): boolean {
  if (field === 'referrer') {
    return CONTROLLED_REFERRAL_VALUES.includes(value)
  }
  if (field === 'rejectionReason') {
    return classifyRejectionReason(value).matched
  }
  // 姓名与 HR 姓名任何时候都不是「字典词汇」：它们不可能合法地出现在报告里
  return false
}

export type SentinelCollection = {
  readonly values: readonly string[]
  readonly fieldLabels: readonly string[]
  readonly sampledCount: number
}

/**
 * 从已提交数据集里收集哨兵。
 *
 * 为什么必须从**源记录**取：`SanitizedReport` 里本来就不该有这些值，
 * 因此只有拿源数据做对照，才能证明「报告里确实一个都没有」。
 */
export function collectSentinels(records: readonly NormalizedRecord[]): SentinelCollection {
  const values = new Set<string>()
  const fieldLabels: string[] = []
  for (const field of SENTINEL_FIELDS) {
    let seen = 0
    for (const record of records) {
      const raw = record[field]
      if (typeof raw !== 'string') {
        continue
      }
      const value = raw.trim()
      if (value === '') {
        continue
      }
      // 受控字典词汇不是身份信息：报告的类别标签与它同字，收集它只会自撞（见文件头说明）
      if (isControlledDictionaryValue(field, value)) {
        continue
      }
      values.add(value)
      seen += 1
      if (seen >= SENTINEL_LIMIT_PER_FIELD) {
        break
      }
    }
    const label = SENTINEL_FIELD_LABELS[String(field)]
    if (label !== undefined) {
      fieldLabels.push(label)
    }
  }
  return { values: [...values], fieldLabels, sampledCount: values.size }
}
