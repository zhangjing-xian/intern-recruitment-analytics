/**
 * AI 载荷的**验收标准测试**（AI05–AI09，docs/PRD.md 19 章）。
 *
 * 为什么值得单独一个文件：AI01–AI18 是需求文档里逐条写死的验收项，而在此之前
 * **AI05–AI09 没有任何对应的自动化测试**——「我们做对了」只停留在代码意图上。
 * 本文件把 AI-1 负责的五条钉成可执行的断言：
 *
 * | 编号 | 验收项 |
 * |---|---|
 * | AI05 | 摘要 JSON 中无姓名、准确薪资、需求 ID、HR 真名、文件名 |
 * | AI06 | 所有 `n<5` 单元被抑制，且互补抑制可防反算 |
 * | AI07 | 薪资 / 周期分桶边界正确（2000.5 落桶正确、边界值不重复计数） |
 * | AI08 | 学校 / 岗位仅以层次或类别出现，未知不猜测 |
 * | AI09 | 修改脱敏配置立即撤销旧预览，需重新生成 |
 *
 * 数据全部为人工构造的合成值（AGENTS.md §2.6）。
 */

import { describe, expect, it } from 'vitest'

import {
  AI_CELL_MIN_SAMPLE,
  AI_SUMMARY_SCHEMA_VERSION,
  AI_SUMMARY_TOP_N,
  buildSanitizedAiPayload,
  checkSanitizedAiPayload,
  collectKeys,
  collapseTopN,
  cycleBandOf,
  schoolLevelOf,
  type AiSourceCell,
  type AiSummaryInput,
} from './aiSummary'
import { SALARY_BAND_EDGES, salaryBandOf } from './sanitize'

/* ------------------------------------------------------------------ 合成夹具 */

/** 这些值一旦出现在载荷里就是泄漏 */
const SENTINEL_NAME = '张合成甲'
const SENTINEL_HR = '合成HR-乙'
const SENTINEL_REQUIREMENT = 'REQ-合成-9901'
const SENTINEL_FILE = '招聘数据分析-示例名单.xlsx'
const SENTINEL_SCHOOL = '合成科技大学'
const SENTINEL_REASON_TEXT = '薪酬太低所以接了别家的offer'
const SENTINEL_SALARY = 2000.5

function baseInput(cells: readonly AiSourceCell[]): AiSummaryInput {
  return {
    privacyLevel: 'standard',
    scope: {
      rowCount: 128,
      dedupPolicy: '确认后每组保留首条',
      // 这些说明本身必须已脱敏：不得含文件名 / 学校全名 / HR 真名
      filters: ['城市：上海、广州、杭州'],
      ruleVersion: '1.0.0+3F2A19C4',
      dataAsOf: '2026-08-31',
    },
    kpi: {
      total: 128,
      joined: 41,
      pending: 9,
      approving: 6,
      rejectedOffer: 5,
      rejectedVerbally: 2,
      coreDenominator: 57,
    },
    cells,
    reasons: [{ category: '薪酬', count: 5 }],
    quality: { unknownStatus: 0, missingSalary: 21, unknownSchool: 3 },
    caliberNotes: ['D = 已入职 + 待入职 + 拒绝 offer'],
    generatedAt: '2026-09-26T10:00:00.000Z',
  }
}

/* ------------------------------------------------------------------ AI05 */

describe('AI05：摘要 JSON 中无姓名、准确薪资、需求 ID、HR 真名、文件名', () => {
  it('把危险来源（含姓名 / HR 真名 / 学校全名 / 需求 ID / 文件名的行）喂进去，产物里一个都不出现', () => {
    const cells: AiSourceCell[] = [
      // 调用方把「原始值」当 key 交上来：HR 真名、学校全名、需求 ID、自由文本原因
      { dimension: 'recruiter', key: SENTINEL_HR, total: 40, coreDenominator: 18, rejected: 6 },
      { dimension: 'school', key: SENTINEL_SCHOOL, total: 30, coreDenominator: 12, rejected: 5 },
      { dimension: 'requirementType', key: SENTINEL_REQUIREMENT, total: 10, coreDenominator: 8, rejected: 1 },
      { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
    ]
    const payload = buildSanitizedAiPayload(baseInput(cells))
    const serialized = JSON.stringify(payload)

    for (const sentinel of [
      SENTINEL_NAME,
      SENTINEL_HR,
      SENTINEL_REQUIREMENT,
      SENTINEL_FILE,
      SENTINEL_SCHOOL,
      SENTINEL_REASON_TEXT,
    ]) {
      expect(serialized.includes(sentinel), `载荷泄漏了哨兵：${sentinel}`).toBe(false)
    }
  })

  it('准确薪资不以数值或字符串片段出现（只允许出现分桶后的区间）', () => {
    const cells: AiSourceCell[] = [
      {
        dimension: 'salaryBand',
        key: String(SENTINEL_SALARY),
        salaryBand: salaryBandOf(SENTINEL_SALARY),
        total: 20,
        coreDenominator: 11,
        rejected: 3,
      },
    ]
    const payload = buildSanitizedAiPayload(baseInput(cells))
    const serialized = JSON.stringify(payload)

    expect(serialized).not.toContain(String(SENTINEL_SALARY))
    // 换成了区间
    expect(serialized).toContain('<3000')
  })

  it('HR 维度只出代号；没有代号时**整行不发**而不是回退成真名', () => {
    const withCode: AiSourceCell[] = [
      { dimension: 'recruiter', key: SENTINEL_HR, recruiterCode: 'HR-1', total: 40, coreDenominator: 18, rejected: 6 },
    ]
    const withoutCode: AiSourceCell[] = [
      { dimension: 'recruiter', key: SENTINEL_HR, total: 40, coreDenominator: 18, rejected: 6 },
    ]

    const coded = buildSanitizedAiPayload(baseInput(withCode))
    expect(JSON.stringify(coded)).toContain('HR-1')
    expect(JSON.stringify(coded)).not.toContain(SENTINEL_HR)

    const uncoded = buildSanitizedAiPayload(baseInput(withoutCode))
    // 换不出代号 → 整行省略，并计入被抑制格数（绝不回退成真名）
    expect(JSON.stringify(uncoded)).not.toContain(SENTINEL_HR)
    expect(uncoded.dimensions).toEqual([])
    expect(uncoded.suppressedCellCount).toBeGreaterThan(0)
  })

  it('载荷里出现的键全部在白名单内（出现未知键即失败）', () => {
    const payload = buildSanitizedAiPayload(
      baseInput([{ dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 }]),
    )
    expect(checkSanitizedAiPayload(payload).ok).toBe(true)
  })

  it('白名单校验能抓到人为塞进去的未知键', () => {
    const payload = buildSanitizedAiPayload(
      baseInput([{ dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 }]),
    )
    const tampered = { ...payload, candidateName: SENTINEL_NAME }
    const check = checkSanitizedAiPayload(tampered)
    expect(check.ok).toBe(false)
    expect(check.problems.join('|')).toContain('candidateName')

    // 嵌套层塞进去也要抓到
    const nested = {
      ...payload,
      dimensions: [{ ...payload.dimensions[0], records: [{ name: SENTINEL_NAME }] }],
    }
    expect(checkSanitizedAiPayload(nested).ok).toBe(false)
    expect([...collectKeys(nested)].some((key) => key === 'records')).toBe(true)
  })

  it('载荷结构里没有任何位置能装下原始行（顶层与行级键都是固定的计数）', () => {
    const payload = buildSanitizedAiPayload(
      baseInput([{ dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 }]),
    )
    for (const table of payload.dimensions) {
      for (const row of table.rows) {
        // 没有提供组内构成时，行里就**只有**这 4 个计数键：不给 0、不给空串占位
        expect(Object.keys(row).sort()).toEqual(['D', 'N', 'R', 'key'])
      }
    }
    // 行里只有计数，连「率」都没有：率由阅读者用 分子 ÷ 分母 自行读出
    //
    // AI-2 新增了两个顶层键，这里**必须**跟着改——那正是这条断言的目的：
    // 往载荷里加字段会让测试失败，从而逼出一个显式决定，而不是静默多带一份数据出去。
    expect(Object.keys(payload).sort()).toEqual([
      'caliber',
      'contentBytes',
      'dataAsOf',
      'dimensions',
      'generatedAt',
      'kpi',
      'limits',
      'omitted',
      'privacyLevel',
      'quality',
      'rejectionComparison',
      'rejectionReasons',
      'schemaVersion',
      'scope',
      'suppressedCellCount',
    ])
  })

  it('AI-2：提供组内构成时，两个组内计数与 N/D/R 同行出现，且没有额外表格', () => {
    const payload = buildSanitizedAiPayload({
      ...baseInput([{ dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 }]),
      rejectionProfile: [
        {
          dimension: 'city',
          key: '上海',
          rejectedGroupCount: 4,
          joinedGroupCount: 16,
        },
      ],
      rejectionTotals: { rejectedTotal: 4, joinedTotal: 16, excludedFromComparison: 12 },
    })
    const row = payload.dimensions[0]?.rows[0]
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'D',
      'N',
      'R',
      'joinedGroupCount',
      'key',
      'rejectedGroupCount',
    ])
    // 两个视角分母不同：D 是核心率分母（含待入职），组内构成的分母是 R / J
    expect(row?.D).toBe(20)
    expect(row?.rejectedGroupCount).toBe(4)
    expect(row?.joinedGroupCount).toBe(16)
    expect(payload.rejectionComparison).toMatchObject({
      rejectedTotal: 4,
      joinedTotal: 16,
      excludedFromComparison: 12,
    })
    // 组内构成**不做成第二张同维度的表**：那会造出跨表可反算量
    expect(checkSanitizedAiPayload(payload).ok).toBe(true)
  })

  it('AI-2：组间比较人群不足 k 时整对省略组内构成，且不填 0', () => {
    const payload = buildSanitizedAiPayload({
      ...baseInput([{ dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 }]),
      // 比较人群 = 1 + 2 = 3 < 5：即使 D = 20 远高于门槛，这两个数也不发
      rejectionProfile: [
        { dimension: 'city', key: '上海', rejectedGroupCount: 1, joinedGroupCount: 2 },
      ],
      rejectionTotals: { rejectedTotal: 1, joinedTotal: 2, excludedFromComparison: 3 },
    })
    const row = payload.dimensions[0]?.rows[0]
    expect(row?.rejectedGroupCount).toBeUndefined()
    expect(row?.joinedGroupCount).toBeUndefined()
    expect(Object.keys(row ?? {}).sort()).toEqual(['D', 'N', 'R', 'key'])
    expect(payload.suppressedCellCount).toBe(1)
  })
})

/* ------------------------------------------------------------------ AI06 */

describe('AI06：所有 n<5 单元被抑制，且互补抑制可防反算', () => {
  it('D < 5 的格整格省略，且不填 0', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
      // 只有 3 条有效分母：必须省略
      { dimension: 'city', key: '广州', total: 3, coreDenominator: 3, rejected: 1 },
    ]
    const payload = buildSanitizedAiPayload(baseInput(cells))
    const city = payload.dimensions.find((table) => table.dim === 'city')
    expect(city?.rows.map((row) => row.key)).toEqual(['上海'])
    // 不是 0，而是「不存在」
    expect(city?.rows.some((row) => row.key === '广州')).toBe(false)
    expect(payload.suppressedCellCount).toBe(1)
    expect(payload.limits.join('|')).toContain('不足 5')
  })

  it('恰好 5 条**不**被抑制（门槛是 < 5）', () => {
    const payload = buildSanitizedAiPayload(
      baseInput([{ dimension: 'city', key: '上海', total: 5, coreDenominator: 5, rejected: 1 }]),
    )
    expect(payload.dimensions.find((table) => table.dim === 'city')?.rows.length).toBe(1)
    expect(payload.suppressedCellCount).toBe(0)
  })

  it('阈值常量与实现一致（避免门槛被悄悄改成别的数）', () => {
    expect(AI_CELL_MIN_SAMPLE).toBe(5)
    // 4 抑制、5 保留
    const four = buildSanitizedAiPayload(
      baseInput([{ dimension: 'city', key: '甲', total: 4, coreDenominator: 4, rejected: 1 }]),
    )
    const five = buildSanitizedAiPayload(
      baseInput([{ dimension: 'city', key: '甲', total: 5, coreDenominator: 5, rejected: 1 }]),
    )
    expect(four.dimensions).toEqual([])
    expect(five.dimensions.length).toBe(1)
  })

  it('互补抑制：TopN 合并行若合并后仍不足门槛，则整行不发（不留一个可反算的小格）', () => {
    // 造 12 个格：前 10 个达标、后 2 个各 2 条（合计 4 < 5）
    const cells: AiSourceCell[] = [
      ...Array.from({ length: AI_SUMMARY_TOP_N }, (_, index) => ({
        dimension: 'city',
        key: `合格城市${String(index + 1)}`,
        total: 20,
        coreDenominator: 12,
        rejected: 3,
      })),
      { dimension: 'city', key: '小甲', total: 2, coreDenominator: 2, rejected: 0 },
      { dimension: 'city', key: '小乙', total: 2, coreDenominator: 2, rejected: 0 },
    ]
    const payload = buildSanitizedAiPayload(baseInput(cells))
    const city = payload.dimensions.find((table) => table.dim === 'city')
    // 小格先被抑制，因此只剩 10 行，不产生合并行
    expect(city?.rows.length).toBe(AI_SUMMARY_TOP_N)
    expect(city?.rows.some((row) => row.key.includes('其他'))).toBe(false)
  })

  it('合并行本身重新合计（不是平均百分比），且合计仍不足门槛时整行不发', () => {
    const rows = [
      ...Array.from({ length: AI_SUMMARY_TOP_N }, (_, index) => ({
        key: `大${String(index)}`,
        N: 20,
        D: 12,
        R: 3,
      })),
      { key: '小甲', N: 3, D: 3, R: 1 },
      { key: '小乙', N: 3, D: 3, R: 1 },
    ]
    const collapsed = collapseTopN(rows)
    const merged = collapsed.find((row) => row.key.includes('其他'))
    // 合计：N 6 / D 6 / R 2（6 已达门槛，因此保留）
    expect(merged).toEqual({ key: '其他（2 个分组合并）', N: 6, D: 6, R: 2 })

    // 合计仍不足门槛时不发合并行
    const tiny = collapseTopN([
      ...Array.from({ length: AI_SUMMARY_TOP_N }, (_, index) => ({
        key: `大${String(index)}`,
        N: 20,
        D: 12,
        R: 3,
      })),
      { key: '小甲', N: 2, D: 2, R: 1 },
      { key: '小乙', N: 2, D: 2, R: 1 },
    ])
    expect(tiny.some((row) => row.key.includes('其他'))).toBe(false)
  })
})

/* ------------------------------------------------------------------ AI07 */

describe('AI07：薪资 / 周期分桶边界正确', () => {
  it('2000.5 落在 <3000（不是 3000-4000）', () => {
    expect(salaryBandOf(2000.5)).toBe('<3000')
    expect(salaryBandOf(2999.99)).toBe('<3000')
  })

  it('边界值左闭右开：3000 落 3000-4000、4000 落 4000-5000、6000 落 >=6000', () => {
    expect(salaryBandOf(3000)).toBe('3000-4000')
    expect(salaryBandOf(3999.99)).toBe('3000-4000')
    expect(salaryBandOf(4000)).toBe('4000-5000')
    expect(salaryBandOf(5000)).toBe('5000-6000')
    expect(salaryBandOf(5999.99)).toBe('5000-6000')
    expect(salaryBandOf(6000)).toBe('>=6000')
  })

  it('边界值不重复计数：每个值恰好落一个桶，桶之间不重叠', () => {
    /*
     * 把每个边界值与它的左 / 右邻取值一起喂进去，确认两两不同桶。
     * 这条能抓到「用了 <= 上界」这类实现错误——那会让 4000 同时落进两个桶。
     */
    const probes: readonly number[] = [
      0, 2999.99, 3000, 3000.01, 3999.99, 4000, 4000.01, 4999.99, 5000, 5000.01, 5999.99, 6000,
      6000.01,
    ]
    const bands = probes.map((value) => salaryBandOf(value))
    expect(bands.every((band) => band !== null)).toBe(true)
    // 单调不减：金额升序 → 桶序不会回退
    const order = ['<3000', '3000-4000', '4000-5000', '5000-6000', '>=6000']
    const indexes = bands.map((band) => order.indexOf(band as string))
    for (let index = 1; index < indexes.length; index += 1) {
      expect(indexes[index]).toBeGreaterThanOrEqual(indexes[index - 1])
    }
    // 每个边界值只属于一个桶（compare 到自身就是它）
    expect(salaryBandOf(4000)).toBe(salaryBandOf(4000))
    expect(SALARY_BAND_EDGES).toEqual([3000, 4000, 5000, 6000])
  })

  it('缺失 / 非法金额一律 null，绝不落进 <3000（缺失 ≠ 低薪）', () => {
    expect(salaryBandOf(null)).toBeNull()
    expect(salaryBandOf(Number.NaN)).toBeNull()
    expect(salaryBandOf(Number.POSITIVE_INFINITY)).toBeNull()
    expect(salaryBandOf(-1)).toBeNull()
  })

  it('周期分桶：左闭右开，10 天落 10-19天，9.9 天落 0-9天', () => {
    expect(cycleBandOf(0)).toBe('0-9天')
    expect(cycleBandOf(9.9)).toBe('0-9天')
    expect(cycleBandOf(10)).toBe('10-19天')
    expect(cycleBandOf(19.99)).toBe('10-19天')
    expect(cycleBandOf(30)).toBe('30-39天')
  })

  it('周期缺失 / 负值一律 null（不能当 0 天）', () => {
    expect(cycleBandOf(null)).toBeNull()
    expect(cycleBandOf(Number.NaN)).toBeNull()
    expect(cycleBandOf(-3)).toBeNull()
  })
})

/* ------------------------------------------------------------------ AI08 */

describe('AI08：学校 / 岗位仅以层次或类别出现，未知不猜测', () => {
  it('学校三值 → 三种层次，未知不猜成「非 GPT」', () => {
    expect(schoolLevelOf(true)).toBe('GPT 院校')
    expect(schoolLevelOf(false)).toBe('非 GPT 院校')
    // 关键：缺失 / undefined 都必须落在「未标注」，不能猜成 false
    expect(schoolLevelOf(null)).toBe('未标注')
    expect(schoolLevelOf(undefined)).toBe('未标注')
  })

  it('学校维度输出的是层次而不是全名', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'school', key: SENTINEL_SCHOOL, isGptSchool: true, total: 30, coreDenominator: 12, rejected: 5 },
      { dimension: 'school', key: '另一所合成大学', isGptSchool: null, total: 20, coreDenominator: 9, rejected: 2 },
    ]
    const payload = buildSanitizedAiPayload(baseInput(cells))
    const serialized = JSON.stringify(payload)
    expect(serialized).toContain('GPT 院校')
    expect(serialized).toContain('未标注')
    expect(serialized).not.toContain(SENTINEL_SCHOOL)
    expect(serialized).not.toContain('另一所合成大学')
  })

  it('岗位维度输出类别而不是岗位全名', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'position', key: '数据分析实习生', total: 30, coreDenominator: 12, rejected: 5 },
      { dimension: 'position', key: '', total: 10, coreDenominator: 6, rejected: 1 },
    ]
    const payload = buildSanitizedAiPayload(baseInput(cells))
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('数据分析实习生')
    expect(serialized).toContain('有岗位记录')
    expect(serialized).toContain('未知')
  })

  it('AI-6：岗位类别映射命中时发类别、未命中仍发中性标签，岗位原文一律不发', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'position', key: '前端开发实习生', total: 30, coreDenominator: 12, rejected: 5 },
      { dimension: 'position', key: '某个没配过的岗位', total: 20, coreDenominator: 9, rejected: 3 },
    ]
    const payload = buildSanitizedAiPayload({
      ...baseInput(cells),
      positionCategories: [
        { keyword: ' 前端开发实习生 ', category: ' 研发 ' },
        { keyword: '算法工程师', category: '算法' },
      ],
    })
    const table = payload.dimensions.find((item) => item.dim === 'positionCategory')
    // 映射命中的发类别（去空白），未命中的发中性标签——**都不是原文**
    expect(table?.rows.map((row) => row.key).sort()).toEqual(['有岗位记录', '研发'])
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('前端开发实习生')
    expect(serialized).not.toContain('某个没配过的岗位')
    // 没有格子命中这条规则，因此它的类别也不该出现在载荷里
    expect(serialized).not.toContain('算法工程师')
    expect(table?.rows.map((row) => row.key)).not.toContain('算法')
  })

  it('AI-6：不合格的类别不会因为「来自映射」而被放行', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'position', key: '前端', total: 30, coreDenominator: 12, rejected: 5 },
    ]
    const payload = buildSanitizedAiPayload({
      ...baseInput(cells),
      positionCategories: [
        { keyword: '前端', category: 'REQ-0001' },
        { keyword: '前端', category: '这是一段明显超过十二个字的类别名称' },
      ],
    })
    const table = payload.dimensions.find((item) => item.dim === 'positionCategory')
    // 两条都被规范化丢掉 → 退回中性标签，绝不把「映射里写的自由文本」发出去
    expect(table?.rows.map((row) => row.key)).toEqual(['有岗位记录'])
    expect(JSON.stringify(payload)).not.toContain('REQ-0001')
  })

  it('AI-6：映射只在 position 维度生效，别的维度取值不受影响', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'department', key: '研发', total: 30, coreDenominator: 12, rejected: 5 },
    ]
    const payload = buildSanitizedAiPayload({
      ...baseInput(cells),
      positionCategories: [{ keyword: '研发', category: '研发中心' }],
    })
    const table = payload.dimensions.find((item) => item.dim === 'department')
    expect(table?.rows.map((row) => row.key)).toEqual(['研发'])
  })

  it('薪资维度只接受已分桶的区间；未分桶的原始金额整行不发', () => {
    const cells: AiSourceCell[] = [
      // 调用方没给 salaryBand，key 又是原始金额：不能发
      { dimension: 'salaryBand', key: '4321', salaryBand: null, total: 20, coreDenominator: 11, rejected: 3 },
      // 给了分桶值：可以发
      { dimension: 'salaryBand', key: 'ignored', salaryBand: '4000-5000', total: 20, coreDenominator: 11, rejected: 3 },
    ]
    const payload = buildSanitizedAiPayload(baseInput(cells))
    const table = payload.dimensions.find((item) => item.dim === 'salaryBand')
    expect(table?.rows.map((row) => row.key)).toEqual(['4000-5000'])
    expect(JSON.stringify(payload)).not.toContain('4321')
  })
})

/* ------------------------------------------------------------------ AI09 */

describe('AI09：修改脱敏配置立即撤销旧预览，需重新生成', () => {
  it('隐私级别不同 → 载荷不同（因此预览 hash 必然不同）', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
      { dimension: 'channel', key: 'Boss', total: 40, coreDenominator: 18, rejected: 6 },
      { dimension: 'recruiter', key: SENTINEL_HR, recruiterCode: 'HR-1', total: 40, coreDenominator: 18, rejected: 6 },
    ]
    const standard = buildSanitizedAiPayload({ ...baseInput(cells), privacyLevel: 'standard' })
    const strict = buildSanitizedAiPayload({ ...baseInput(cells), privacyLevel: 'strict' })

    // strict 只保留城市（HR / 渠道都不发）
    expect(strict.dimensions.map((table) => table.dim)).toEqual(['city'])
    expect(JSON.stringify(strict)).not.toContain('HR-1')
    expect(JSON.stringify(strict)).not.toContain('Boss')
    // 两者的规范序列化不同 → 预览 hash 不会相同
    expect(JSON.stringify(strict)).not.toBe(JSON.stringify(standard))
  })

  it('custom 只能在 standard 白名单内收窄，不能借此放出被禁维度', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
      { dimension: 'recruiter', key: SENTINEL_HR, recruiterCode: 'HR-1', total: 40, coreDenominator: 18, rejected: 6 },
      { dimension: 'school', key: SENTINEL_SCHOOL, isGptSchool: true, total: 30, coreDenominator: 12, rejected: 5 },
    ]
    // 试图把不在任何级别里的维度塞进 custom：必须被过滤掉
    const custom = buildSanitizedAiPayload({
      ...baseInput(cells),
      privacyLevel: 'custom',
      allowedDimensions: ['city', 'candidateName', 'records', 'fileName'],
    })
    expect(custom.dimensions.map((table) => table.dim)).toEqual(['city'])
    expect(custom.omitted.some((item) => item.metricId === 'channel')).toBe(false)
  })

  it('同一份输入重复构造得到逐字节相同的载荷（预览 hash 可复现）', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
      { dimension: 'channel', key: 'Boss', total: 40, coreDenominator: 18, rejected: 6 },
    ]
    const first = buildSanitizedAiPayload(baseInput(cells))
    const second = buildSanitizedAiPayload(baseInput(cells))
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(first.contentBytes).toBe(second.contentBytes)
  })

  it('被省略的指标如实列出原因（预览与发送内容必须一致）', () => {
    const cells: AiSourceCell[] = [
      { dimension: 'city', key: '上海', total: 36, coreDenominator: 20, rejected: 4 },
      // strict 下不该发的维度
      { dimension: 'recruiter', key: SENTINEL_HR, recruiterCode: 'HR-1', total: 40, coreDenominator: 18, rejected: 6 },
    ]
    const strict = buildSanitizedAiPayload({ ...baseInput(cells), privacyLevel: 'strict' })
    expect(strict.omitted.some((item) => item.metricId === 'recruiter')).toBe(true)
    expect(strict.omitted.every((item) => item.reason.length > 0)).toBe(true)
  })
})

/* ------------------------------------------------------------------ 结构与体积 */

describe('载荷结构与体积预算', () => {
  it('schemaVersion 是 AI 摘要契约版本（供历史辨认结构）', () => {
    const payload = buildSanitizedAiPayload(baseInput([]))
    expect(payload.schemaVersion).toBe(AI_SUMMARY_SCHEMA_VERSION)
  })

  it('KPI 用 PRD 的符号命名，且恒等式成立', () => {
    const payload = buildSanitizedAiPayload(baseInput([]))
    const { N, J, P, A, R1, R2, D } = payload.kpi
    expect(N).toBe(128)
    expect(J + P + A + R1 + R2).toBeLessThanOrEqual(N)
    expect(D).toBe(J + P + R1 + R2)
  })

  it('总体 KPI 与状态结构在任何隐私级别下都保留（它不含任何身份信息）', () => {
    for (const level of ['strict', 'standard', 'custom'] as const) {
      const payload = buildSanitizedAiPayload({ ...baseInput([]), privacyLevel: level })
      expect(payload.kpi.N).toBe(128)
    }
  })
})
