import type { SchoolAliasRule } from '../../domain'

/**
 * 界面文本 → 设置值的解析（不属于清洗口径本身，放这里避免混进 `src/cleaning` 的纯规则层）。
 *
 * 解析只做「拆行 / 去空行 / 去重 / 拆 `=`」，**不**猜任何业务含义：
 * 没有 `=` 的别名行直接忽略，也不判断哪边是规范名；判断与生效都由 `cleanSheet` 的规则决定。
 */

/** 多行文本框 → 去空行 / 去重后的列表（名单与别名共用同一份解析，避免两处口径不同） */
export function parseLineList(text: string): readonly string[] {
  const seen = new Set<string>()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed !== '') {
      seen.add(trimmed)
    }
  }
  return [...seen]
}

/** 别名行格式：`别名=规范名`；没有 `=` 的行忽略（**不**猜测哪边是规范名） */
export function parseAliasLines(text: string): readonly SchoolAliasRule[] {
  const rules: SchoolAliasRule[] = []
  for (const line of parseLineList(text)) {
    const separator = line.indexOf('=')
    if (separator <= 0 || separator === line.length - 1) {
      continue
    }
    rules.push({
      alias: line.slice(0, separator).trim(),
      canonical: line.slice(separator + 1).trim(),
    })
  }
  return rules.filter((rule) => rule.alias !== '' && rule.canonical !== '')
}

/** 别名规则 → 多行文本（回填用，与 `parseAliasLines` 一一对应） */
export function formatAliasLines(rules: readonly SchoolAliasRule[]): string {
  return rules.map((rule) => `${rule.alias}=${rule.canonical}`).join('\n')
}
