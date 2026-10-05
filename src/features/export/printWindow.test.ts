import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = fileURLToPath(new URL('.', import.meta.url))
/** 仓库根目录（本文件在 src/features/export/ 下，因此上溯三层） */
const ROOT = join(HERE, '..', '..', '..')

/**
 * 「打开新窗口写入打印版」这条路的机器守卫（2026-09-27 晚，用户反馈「导出 PDF 是空白页」之后加）。
 *
 * ## 守的是什么
 *
 * `window.open('', '_blank', 'noopener,noreferrer')` 读起来更安全，实际是**坏的**：
 * 带 `noopener` 时浏览器**返回 null**。调用方于是既拿不到窗口引用、写不进任何内容，
 * 又会走进「返回 null = 被弹窗拦截」的分支，给用户一句**与事实不符**的提示
 * （「浏览器拦截了新窗口」——其实窗口开着，只是空白）。
 *
 * 正确写法只有一种：用**普通** `window.open('', '_blank')` 拿到引用，
 * 写内容之前手动 `opened.opener = null`。防护效果相同（新窗口拿不到 `window.opener`），
 * 但我们保住了引用。这条口径写死在 `ExportWorkspace.tsx` 与 `AiResultPanel.tsx` 两处。
 *
 * ## 为什么必须是扫描，而不是只补一个用例
 *
 * 这个 bug 在两个地方各写了一遍（报告导出、AI 结果打印版），单测看不见（jsdom 不会真的开窗口），
 * 端到端只能钉住被点的那一处。扫描能让**下一次**有人顺手写成 `noopener,noreferrer` 时立刻失败。
 */
function sourceFiles(prefix = ''): readonly string[] {
  const skipDirs = new Set(['node_modules', 'dist', '_checks', '.git', 'test-results', 'playwright-report'])
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue
      }
      found.push(...sourceFiles(relative))
      continue
    }
    if (/\.tsx?$/.test(entry.name)) {
      found.push(relative)
    }
  }
  return found
}

describe('打印版窗口：window.open 不得带 noopener', () => {
  const files = sourceFiles('src')

  it('扫描范围覆盖整个 src（否则这条守卫等于没跑）', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('没有任何 window.open(...) 在特性串里写 noopener', () => {
    const offenders: string[] = []
    for (const relative of files) {
      // 守卫文件自己必须写下被禁止的写法（才能检查它），因此排除自己——
      // 与 acceptance.test.ts / aiNetworkGuard.test.ts 排除自身的理由一致
      if (relative.endsWith('export/printWindow.test.ts')) {
        continue
      }
      /*
       * 先去掉注释再扫：代码里的说明**必须**能写出那个坏写法（不然下一个人不知道为什么不许这么写），
       * 所以「注释里出现 noopener」不算违规，只有**真的会执行**的那一行才算。
       */
      const code = readFileSync(join(ROOT, relative), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '')
      for (const line of code.split('\n')) {
        if (line.includes('window.open(') && line.includes('noopener')) {
          offenders.push(`${relative}: ${line.trim()}`)
        }
      }
    }
    expect(
      offenders,
      '带 noopener 的 window.open 会返回 null，导致打印窗口是空白页；请改成普通 window.open 后手动 opened.opener = null',
    ).toEqual([])
  })
})
