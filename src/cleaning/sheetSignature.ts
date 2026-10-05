/**
 * 源表签名（用户需求 ①，2026-09-27）。
 *
 * ## 它解决什么问题
 *
 * 人工修正按「工作表 + 物理行号 + 字段」定位（原因见 `ManualCorrection` 的注释：`recordId`
 * 每次清洗都会重新生成，不能当键）。物理行号是稳定的，但它只对**同一份表**稳定：
 * 如果用户换了另一份表（或同一份表改了行数 / 表头），旧的修正就可能指到别的数据上。
 *
 * 因此修正集合记一份表签名；签名不一致时**一条修正都不应用**，并如实提示。
 * 这正是「绝不静默改写用户数据」这条纪律在修正功能上的落地。
 *
 * ## 为什么签名里没有文件名
 *
 * `RawSheet.sourceFileName` 只允许用于本机展示（AGENTS §4：禁止写进日志、报告与 AI 摘要），
 * 而修正集合会随 `CleaningSettings` 进数据集元信息与报告。因此签名只用
 * 「来源类型 + 工作表名 + 表头 + 行数 + 列数」——足够区分「换了一份表」，
 * 又不携带任何文件名或单元格内容。
 */

import { stableDigest, type RawSheet } from '../domain'

export function sheetSignatureOf(sheet: RawSheet): string {
  const payload = {
    sourceKind: sheet.sourceKind,
    sourceSheet: sheet.sourceSheet,
    headers: sheet.header.headers,
    rowCount: sheet.rows.length,
    columnCount: sheet.columnCount,
  }
  return stableDigest(JSON.stringify(payload))
}
