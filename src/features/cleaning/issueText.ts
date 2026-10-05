import { ISSUE_SEVERITY, ISSUE_TITLES, type DataQualityIssue } from '../../domain'

/**
 * 问题的可读摘要：`问题码 → 中文标题（严重度）`。
 *
 * 标题与严重度都取自领域目录（`src/domain/quality.ts`），界面与导出报告共用同一份文案，
 * 避免「同一问题在两处叫不同名字」。
 */
export function describeIssue(issue: DataQualityIssue): string {
  return `${ISSUE_TITLES[issue.code]}（${ISSUE_SEVERITY[issue.code]}）`
}
