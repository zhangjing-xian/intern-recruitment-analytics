/**
 * 文档与构建产物的**机器可检查**形式（AI-7）。
 *
 * ## 为什么文档也要有守卫
 *
 * AI-7 的验收标准里有三条是**文档层面**的要求，而文档最容易「看着写了、其实漏了」：
 *
 * 1. **AI01–AI18 与 A01–A20 逐项都要有判定**：漏一行、把两项合并成一行、或把判定写成
 *    「待补」都会让验收表变成一句空话；
 * 2. **隐私结论必须两处一致**：站内「隐私说明」页与根目录 `PRIVACY.md` 说的必须是同一件事，
 *    否则用户看到的与仓库里写的是两套说法（本项目已经因为「文案与实现不一致」修过三次）；
 * 3. **`dist/` 与仓库里不得有真实 Key 或第三方统计脚本**：这是「默认零外部请求 / 无 CDN /
 *    无统计 SDK」在**产物层面**的证据，靠人工每次翻一遍不可靠。
 *
 * 因此这里把这三条变成可执行的断言。判定用词只有三种（已通过 / 部分通过 / 未验证），
 * 未验证的**必须**写「未验证」——把未测写成通过是红线上最重的一条。
 *
 * 数据：扫描的是文档与构建产物，不涉及任何真实数据；仓库内允许出现的「像 Key 的串」
 * 在 `SYNTHETIC_KEY_ALLOWLIST` 里逐条列明（只有测试用的合成串）。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CLEAR_AI_HISTORY_PHRASE,
  CLEAR_OBJECTS_PHRASE,
  CLEAR_VAULT_PHRASE,
  DELETE_SECRET_PHRASE,
} from '../settings/vaultText'

/** 仓库根目录（本文件在 `src/features/privacy/` 下） */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

function readAtRoot(relative: string): string {
  return readFileSync(join(ROOT, relative), 'utf8')
}

const ACCEPTANCE = readAtRoot('docs/ACCEPTANCE.md')
const README = readAtRoot('README.md')
const PRIVACY_DOC = readAtRoot('PRIVACY.md')
const KNOWN_ISSUES = readAtRoot('docs/KNOWN_ISSUES.md')
const PRIVACY_PAGE_TEXT = readAtRoot('src/features/privacy/privacyText.ts')

/**
 * 允许出现在仓库里的「像 Key 的串」：**只有**测试用的合成值。
 * 往这里加一条等于声明「这个串不是凭据」——真实 Key 必须自己去设置页里填，不许进仓库。
 */
const SYNTHETIC_KEY_ALLOWLIST: readonly string[] = [
  // 测试里反复使用的合成 Key（形状像 Key，绝不是凭据）
  'sk-synthetic-not-a-real-credential-0001',
  // 上面那一把的「第二把」，用于验证「换 Key 后旧值不再出现」
  'sk-another-synthetic-credential-0002',
  // 历史/导出哨兵：证明凭据不会落盘
  'sk-sentinel-history-9f3a2b',
]

/** 出现即说明引入了第三方统计 / CDN（这些主机名只会出现在真的加载了它们的时候） */
const FORBIDDEN_VENDORS: readonly string[] = [
  'googletagmanager.com',
  'google-analytics.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'umami.is',
  'hm.baidu.com',
  'browser.sentry-cdn.com',
]

/** `sk-` 打头的长串：真实 Key 的形状 */
const KEY_SHAPED = /sk-[A-Za-z0-9_-]{16,}/g

/** 仓库里要扫的文件（跳过依赖、构建产物与被 gitignore 的验证输出） */
function repositoryFiles(prefix = ''): readonly string[] {
  /*
   * `test-results` / `playwright-report` 是步骤14 起 Playwright 每次运行都会重写的产物
   * （截图、error context、性能基线快照），已在 `.gitignore` 里忽略。
   * 它们里面会出现「失败用例把整页文本与合成 Key 抄了一份」这类内容，
   * 扫它们等于用一次失败的运行把守卫弄红——守卫要守的是**仓库内容**，不是运行残留。
   */
  const skipDirs = new Set([
    'node_modules',
    'dist',
    '_checks',
    '.git',
    'test-results',
    'playwright-report',
  ])
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) {
        continue
      }
      found.push(...repositoryFiles(relative))
      continue
    }
    if (/\.(md|ts|tsx|json|html|css|svg|txt|yaml|yml|cjs|mjs)$/.test(entry.name)) {
      found.push(relative)
    }
  }
  /**
   * 本守卫文件自己也在仓库里：它必须写下被禁止的主机名（才能检查它们）与合成 Key 白名单，
   * 因此把自己排除掉——否则守卫会因为「写了要检查的东西」而失败，下一个人只能删掉名单。
   * 与 `aiNetworkGuard.test.ts` 排除测试文件的理由一致。
   */
  return found.filter((relative) => !relative.endsWith('features/privacy/acceptance.test.ts'))
}

function distFiles(prefix = ''): readonly string[] {
  const found: string[] = []
  for (const entry of readdirSync(join(ROOT, 'dist', prefix), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      found.push(...distFiles(relative))
      continue
    }
    if (!entry.name.endsWith('.map')) {
      found.push(relative)
    }
  }
  return found
}

/** 验收表的全部表格行（只取 `|` 开头的行，表头与分隔行由 id 匹配自然排除） */
function acceptanceRows(): readonly string[] {
  return ACCEPTANCE.split(/\r?\n/).filter((line) => line.startsWith('|'))
}

describe('AI-7：验收表逐项有判定', () => {
  it('A01–A20 每一项都在表里，且判定只用三种写法', () => {
    const rows = acceptanceRows()
    for (let index = 1; index <= 20; index += 1) {
      const id = `A${String(index).padStart(2, '0')}`
      const matched = rows.filter((row) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(row))
      expect(matched, `${id} 在 ACCEPTANCE.md 里必须恰好一行`).toHaveLength(1)
      expect(
        /已通过|部分通过|未验证/.test(matched[0] ?? ''),
        `${id} 的判定必须是「已通过 / 部分通过 / 未验证」之一`,
      ).toBe(true)
    }
  })

  it('AI01–AI18 每一项都在表里，且判定只用三种写法', () => {
    const rows = acceptanceRows()
    for (let index = 1; index <= 18; index += 1) {
      const id = `AI${String(index).padStart(2, '0')}`
      const matched = rows.filter((row) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(row))
      expect(matched, `${id} 在 ACCEPTANCE.md 里必须恰好一行`).toHaveLength(1)
      expect(
        /已通过|部分通过|未验证/.test(matched[0] ?? ''),
        `${id} 的判定必须是「已通过 / 部分通过 / 未验证」之一`,
      ).toBe(true)
    }
  })

  it('未验证的项必须写明「未验证」，且表里说明了判定词的含义', () => {
    expect(ACCEPTANCE).toContain('未验证')
    expect(ACCEPTANCE).toContain('部分通过')
    expect(ACCEPTANCE).toContain('已通过')
    // 判定词的定义与「不把建议测试写成通过」这条纪律必须在文件开头写明
    expect(ACCEPTANCE).toContain('不允许把「建议测试」写成本条通过')
    // 真实部署与浏览器手工测试状态必须留一节（AI-7 的硬要求）
    expect(ACCEPTANCE).toContain('真实部署与浏览器手工测试状态')
    expect(ACCEPTANCE).toContain('未执行')
  })

  it('实跑命令与结果记录在案（含测试例数与构建体积）', () => {
    for (const command of ['npm run build', 'npm run typecheck', 'npm run lint', 'npm test']) {
      expect(ACCEPTANCE, `缺少实跑命令 ${command}`).toContain(command)
    }
    expect(ACCEPTANCE).toMatch(/\d{3,}\s*例通过/)
    expect(ACCEPTANCE).toMatch(/个文件/)
    expect(ACCEPTANCE).toMatch(/kB/)
  })
})

describe('AI-7：文档必须说清的边界', () => {
  it('README 覆盖启动 / 构建 / 口径 / 隐私 / 部署 / 文档索引', () => {
    for (const required of [
      'npm install',
      'npm run dev',
      'npm run build',
      'npm test',
      '核心分母',
      '默认',
      '不出浏览器',
      '唯一出站例外',
      '逐次确认',
      'connect-src',
      'Service Worker',
      'CORS',
      '不承诺',
      'docs/ACCEPTANCE.md',
      'docs/KNOWN_ISSUES.md',
      'PRIVACY.md',
    ]) {
      expect(README, `README 缺少：${required}`).toContain(required)
    }
  })

  it('README 写出的四个删除短语与代码里的常量逐字一致', () => {
    for (const phrase of [
      CLEAR_OBJECTS_PHRASE,
      DELETE_SECRET_PHRASE,
      CLEAR_AI_HISTORY_PHRASE,
      CLEAR_VAULT_PHRASE,
    ]) {
      expect(README, `README 缺少确认短语：${phrase}`).toContain(phrase)
    }
  })

  it('PRIVACY.md 与站内隐私页说同一件事（两处都必须出现关键结论）', () => {
    const shared = [
      '不承诺「所有模式下绝不出站」',
      '不声称供应商零保留',
      '无法保证 DeepSeek 是否保留',
    ]
    for (const sentence of shared) {
      expect(PRIVACY_DOC, `PRIVACY.md 缺少：${sentence}`).toContain(sentence)
      expect(PRIVACY_PAGE_TEXT, `站内隐私页缺少：${sentence}`).toContain(sentence)
    }
    // 代理边界两侧都要写到（AI-6 的验收项，AI-7 负责在两份文档里对齐）
    for (const sentence of ['代理能看到', '不提供代理程序']) {
      expect(PRIVACY_DOC).toContain(sentence)
    }
    expect(PRIVACY_DOC).toContain('CORS')
  })

  it('PRIVACY.md 明确列出禁止出现的承诺', () => {
    expect(PRIVACY_DOC).toContain('禁止出现的承诺')
    for (const forbidden of [
      '绝对不出站',
      '供应商零保留',
      '密码可以找回',
      '导出文件自动加密',
      '不可重新识别',
    ]) {
      expect(PRIVACY_DOC, `PRIVACY.md 的禁止清单里缺少：${forbidden}`).toContain(forbidden)
    }
  })

  it('KNOWN_ISSUES 记录级别、未验证项与计划', () => {
    expect(KNOWN_ISSUES).toContain('P0')
    expect(KNOWN_ISSUES).toContain('P1')
    expect(KNOWN_ISSUES).toContain('P2')
    // 三个最关键的未验证 / 未落实项必须在场
    expect(KNOWN_ISSUES).toContain('CSP')
    expect(KNOWN_ISSUES).toContain('Service Worker')
    expect(KNOWN_ISSUES).toContain('AI16')
    // 真实浏览器才能确认的检查项必须单独成表
    expect(KNOWN_ISSUES).toContain('只能在真实环境里最终确认的检查项')
    expect(KNOWN_ISSUES).toContain('未验证')
  })
})

describe('AI-7：仓库与构建产物里没有真实凭据或第三方脚本', () => {
  it('仓库里出现的所有「像 Key 的串」都在合成值白名单里', () => {
    const offenders: string[] = []
    for (const relative of repositoryFiles()) {
      const text = readFileSync(join(ROOT, relative), 'utf8')
      for (const token of text.match(KEY_SHAPED) ?? []) {
        if (!SYNTHETIC_KEY_ALLOWLIST.includes(token)) {
          offenders.push(`${relative}：${token.slice(0, 12)}…`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('源码 / 文档里没有第三方统计或 CDN 主机名', () => {
    const offenders: string[] = []
    for (const relative of repositoryFiles()) {
      const text = readFileSync(join(ROOT, relative), 'utf8')
      for (const vendor of FORBIDDEN_VENDORS) {
        if (text.includes(vendor)) {
          offenders.push(`${relative}：${vendor}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('构建产物（dist 存在时）里没有 Key、没有统计 SDK、没有远程资源引用', () => {
    if (!existsSync(join(ROOT, 'dist'))) {
      // 没构建过就跳过产物检查（CI 会在 build 之后重跑）；这不是「已通过」，是「没有产物可查」
      expect(existsSync(join(ROOT, 'dist'))).toBe(false)
      return
    }
    const files = distFiles()
    expect(files.length).toBeGreaterThan(5)
    let sawScript = false
    for (const relative of files) {
      const text = readFileSync(join(ROOT, 'dist', relative), 'utf8')
      for (const token of text.match(KEY_SHAPED) ?? []) {
        expect(SYNTHETIC_KEY_ALLOWLIST, `dist 里出现了凭据形状的串：${token.slice(0, 12)}…`).toContain(
          token,
        )
      }
      for (const vendor of FORBIDDEN_VENDORS) {
        expect(text, `dist 里出现了第三方主机名：${vendor}`).not.toContain(vendor)
      }
      if (/\.(html|css)$/.test(relative)) {
        expect(text).not.toMatch(/https?:\/\/[^"')\s]+\.(js|css|woff2?|png|jpg|svg)/)
        if (relative.endsWith('.html')) {
          sawScript = text.includes('<script')
        }
      }
    }
    // 断言确实扫到了真正含脚本的产物（否则这个检查是空转）
    expect(sawScript).toBe(true)
  })
})
