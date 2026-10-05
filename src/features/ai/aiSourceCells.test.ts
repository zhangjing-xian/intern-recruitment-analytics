/**
 * AI 候选单元格构造测试（AI-1，docs/PRD.md 16.3 / 18.5；AGENTS.md §2.2）。
 *
 * 为什么这一层的测试必须存在：脱敏引擎的安全性建立在「交上去的候选值已经足够安全」这个前提上。
 * 引擎只读 `recruiterCode` / `isGptSchool` / `salaryBand` / `cycleDays` 这几个字段，
 * 因此本层的映射错了，引擎**不会报错**——它会安静地发出一行不该发的东西，或者整维丢掉功能。
 * 本文件把这些映射钉成可执行断言：
 *
 * 1. HR：代号稳定（同一份输入 → 同一套代号），且**真实姓名绝不出现在候选格里**；
 * 2. 学校：分组键 `是 / 否 / 其他（含未知）` → `true / false / null`，未知必须保持未知；
 * 3. 薪资：只有确实是区间标签的键才给出 `salaryBand`，「未知」与裸金额一定给 null；
 * 4. 周期：`cycleDays` 取该区间的实际周期中位数；中位数缺失的格直接不发；
 * 5. 计数一律来自引擎的 `counts`（本层不重算），并且候选格里的 `total` / `D` / `R` 与分组一致。
 *
 * 关于样本量：引擎会抑制 `D < 5` 的单元格（AI06），所以断言「载荷里有 HR-1」之前
 * 必须先把分组的有效分母抬到门槛之上——否则看到的是**引擎在正确抑制**，不是本层出错。
 * 夹具用 `enoughRecords` 显式做到这一点，并在注释里写明原因。
 *
 * 数据全部是人工构造的合成值（AGENTS.md §2.6），不含任何真实姓名 / 薪资 / 学校。
 */

import { describe, expect, it } from 'vitest'

import {
  GPT_NO_LABEL,
  GPT_YES_LABEL,
  UNKNOWN,
  aggregateByDimension,
  sortGroupsByDenominator,
  summarizeRecords,
  type City,
  type GroupDimension,
  type NormalizedRecord,
} from '../../domain'
import { syntheticRecords, type SyntheticRecordInput } from '../../domain/analytics/fixtures'
import { bandOf } from '../../domain/analytics/grouping'
import { AI_CELL_MIN_SAMPLE, buildSanitizedAiPayload } from '../../privacy/aiSummary'

import {
  buildAiSourceCells,
  cycleBandGroupsOf,
  gptTriStateOf,
  salaryBandOfGroupKey,
  type AiDimensionGroupInput,
} from './aiSourceCells'

/* ------------------------------------------------------------------ 合成夹具 */

/** 一旦出现在候选格或载荷里就说明泄漏了 */
const SENTINEL_HR = '合成HR-乙'
const SENTINEL_HR_TWO = '合成HR-丙'
const SENTINEL_SCHOOL = '合成科技大学'

const SHA = '上海' as City
const GZ = '广州' as City

const RECORDS = syntheticRecords([
  { offerStatus: '已入职', recruiter: SENTINEL_HR, city: SHA, salaryAmount: 4200 },
  { offerStatus: '已入职', recruiter: SENTINEL_HR, city: SHA, salaryAmount: 4500 },
  { offerStatus: '拒绝offer', recruiter: SENTINEL_HR_TWO, city: GZ, salaryAmount: 3100 },
  { offerStatus: '待入职', recruiter: SENTINEL_HR_TWO, city: GZ, salaryAmount: null },
  { offerStatus: 'offer审批中', recruiter: SENTINEL_HR, city: SHA, salaryAmount: 5200 },
  { offerStatus: '已入职', recruiter: SENTINEL_HR_TWO, city: SHA, salaryAmount: 6100 },
])

/** 某个维度的输入：`total` 用引擎对同一批记录重新汇总（与看板同一读数） */
function dimensionInputFor(
  dimension: string,
  groupDimension: GroupDimension,
  records: readonly NormalizedRecord[] = RECORDS,
  edges: readonly number[] = [],
): AiDimensionGroupInput {
  return {
    dimension,
    label: dimension,
    groups: sortGroupsByDenominator(
      aggregateByDimension(records, groupDimension, { salaryBandEdges: edges }),
    ),
    total: summarizeRecords('全部（当前筛选）', records),
  }
}

/** `n` 条「已入职」记录（有效分母 = n），用来把分组的样本量抬过引擎门槛 */
function enoughRecords(
  n: number,
  overrides: SyntheticRecordInput = {},
): readonly NormalizedRecord[] {
  return syntheticRecords(
    Array.from({ length: n }, () => ({ offerStatus: '已入职' as const, ...overrides })),
  )
}

/** 用足够的样本量构造一个分组汇总（否则引擎会整格抑制，断言看不到行） */
function groupOf(key: string, records: readonly NormalizedRecord[]) {
  const group = summarizeRecords(key, records)
  expect(group.counts.coreDenominator).toBeGreaterThanOrEqual(AI_CELL_MIN_SAMPLE)
  return group
}

/** 把候选格真的送进引擎，用户在产物上检查「有没有泄漏」 */
function payloadOf(cells: Parameters<typeof buildSanitizedAiPayload>[0]['cells']) {
  return buildSanitizedAiPayload({
    privacyLevel: 'standard',
    scope: {
      rowCount: 64,
      dedupPolicy: '确认后每组保留首条',
      filters: [],
      ruleVersion: '1.0.0+00000000',
      dataAsOf: '2026-08-31',
    },
    kpi: {
      total: 64,
      joined: 30,
      pending: 8,
      approving: 4,
      rejectedOffer: 12,
      rejectedVerbally: 2,
      coreDenominator: 52,
    },
    cells,
    reasons: [],
    quality: { unknownStatus: 0, missingSalary: 0, unknownSchool: 0 },
    caliberNotes: [],
    generatedAt: '2026-09-26T10:00:00.000Z',
  })
}

/* ------------------------------------------------------------------ 三值反查 */

describe('学校三值反查：是 / 否 / 其他', () => {
  it('「是」→ true、「否」→ false，其余（含「未知」）→ null', () => {
    expect(gptTriStateOf(GPT_YES_LABEL)).toBe(true)
    expect(gptTriStateOf(GPT_NO_LABEL)).toBe(false)
    // 关键：未知保持未知，不能因为「不是『是』」就猜成 false（AI08）
    expect(gptTriStateOf(UNKNOWN)).toBeNull()
    expect(gptTriStateOf('')).toBeNull()
    expect(gptTriStateOf('待确认')).toBeNull()
    expect(gptTriStateOf(SENTINEL_SCHOOL)).toBeNull()
  })

  it('学校维度的候选格给出三值，真实校名不进载荷', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        {
          dimension: 'school',
          label: '学校层次',
          // 刻意用「GPT 三值字符串化」后的分组键（与 dimensionValueOf 的口径一致）
          groups: [
            groupOf(GPT_YES_LABEL, enoughRecords(6, { isGptSchool: true })),
            groupOf(GPT_NO_LABEL, enoughRecords(5, { isGptSchool: false })),
            groupOf(UNKNOWN, enoughRecords(7, { isGptSchool: null })),
          ],
          total: summarizeRecords('全部（当前筛选）', enoughRecords(18)),
        },
      ],
    })

    expect(cells.map((cell) => cell.isGptSchool)).toEqual([true, false, null])

    const payload = payloadOf(cells)
    const serialized = JSON.stringify(payload)
    expect(serialized).toContain('GPT 院校')
    expect(serialized).toContain('非 GPT 院校')
    expect(serialized).toContain('未标注')
    expect(serialized).not.toContain(SENTINEL_SCHOOL)
  })
})

/* ------------------------------------------------------------------ HR 代号 */

describe('HR 只出代号，且代号稳定', () => {
  it('按首次出现顺序编号 HR-1 / HR-2，且候选格里不含真实姓名', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        {
          dimension: 'recruiter',
          label: '招聘 HR',
          groups: [
            groupOf(SENTINEL_HR, enoughRecords(7, { recruiter: SENTINEL_HR })),
            groupOf(SENTINEL_HR_TWO, enoughRecords(5, { recruiter: SENTINEL_HR_TWO })),
          ],
          total: summarizeRecords('全部（当前筛选）', RECORDS),
        },
      ],
    })

    expect(cells.map((cell) => cell.recruiterCode)).toEqual(['HR-1', 'HR-2'])
    // 候选格里的 key 也只是代号，不携带任何身份信息
    expect(cells.map((cell) => cell.key)).toEqual(['HR-1', 'HR-2'])

    const serialized = JSON.stringify(cells)
    expect(serialized).not.toContain(SENTINEL_HR)
    expect(serialized).not.toContain(SENTINEL_HR_TWO)

    // 引擎产物里同样不含真名，只含代号
    const payload = payloadOf(cells)
    expect(JSON.stringify(payload)).not.toContain(SENTINEL_HR)
    expect(JSON.stringify(payload)).toContain('HR-1')
  })

  it('同一份输入重复构造得到逐字相同的候选格（代号不会随渲染次数漂移）', () => {
    const input = { dimensions: [dimensionInputFor('recruiter', 'recruiter')] }
    const first = buildAiSourceCells(input)
    const second = buildAiSourceCells(input)

    expect(second).toEqual(first)
    expect(second.map((cell) => cell.recruiterCode)).toEqual(
      first.map((cell) => cell.recruiterCode),
    )
  })

  it('「未知」HR 整行不发：它不是一个招聘 HR', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        {
          dimension: 'recruiter',
          label: '招聘 HR',
          groups: [
            groupOf(SENTINEL_HR, enoughRecords(7, { recruiter: SENTINEL_HR })),
            groupOf(UNKNOWN, enoughRecords(5, { recruiter: null })),
          ],
          total: summarizeRecords('全部（当前筛选）', RECORDS),
        },
      ],
    })

    expect(cells.length).toBe(1)
    expect(cells[0]?.recruiterCode).toBe('HR-1')
    expect(JSON.stringify(cells)).not.toContain(UNKNOWN)
  })

  it('代号只由顺序决定：换一批 D 排序就会换代号，这是「同一份输入内稳定」的含义', () => {
    const sorted = sortGroupsByDenominator(
      aggregateByDimension(enoughRecords(12, { recruiter: SENTINEL_HR }), 'recruiter'),
    )
    const first = buildAiSourceCells({
      dimensions: [
        {
          dimension: 'recruiter',
          label: '招聘 HR',
          groups: sorted,
          total: summarizeRecords('全部', enoughRecords(12)),
        },
      ],
    })
    // 同一份输入重复构造 → 同一套代号（跨文件重建不做承诺，代号也不用于跨报告对照）
    expect(first.map((cell) => cell.recruiterCode)).toEqual(['HR-1'])
  })
})

/* ------------------------------------------------------------------ 薪资区间 */

describe('薪资只发已分桶的区间', () => {
  const edges = [3000, 4000, 5000, 6000]

  it('区间标签反查成功后才给出 salaryBand', () => {
    const midBand = bandOf(3100, edges)
    expect(midBand).toBe('3000–3999')
    expect(salaryBandOfGroupKey(midBand ?? '', edges)).toBe(midBand)
    expect(salaryBandOfGroupKey('<3000', edges)).toBe('<3000')
    expect(salaryBandOfGroupKey('≥6000', edges)).toBe('≥6000')
  })

  it('「未知」与原始金额都反查不出来 → 给 null（引擎据此整行省略，不填 0）', () => {
    expect(salaryBandOfGroupKey(UNKNOWN, edges)).toBeNull()
    expect(salaryBandOfGroupKey('4200', edges)).toBeNull()
    expect(salaryBandOfGroupKey('', edges)).toBeNull()
    expect(salaryBandOfGroupKey('3000-3999', edges)).toBeNull()
    // 没有配置分档边界时一律 null：宁可不发薪资维度，也不发明一套区间
    expect(salaryBandOfGroupKey('3000–3999', [])).toBeNull()
    expect(salaryBandOfGroupKey('3000–3999', undefined)).toBeNull()
  })

  it('缺失分档边界时交给引擎的是 null，因此载荷里没有薪资维度', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        dimensionInputFor('salaryBand', 'salaryBand', enoughRecords(6, { salaryAmount: 4200 })),
      ],
      salaryBandEdges: [],
    })

    expect(cells.every((cell) => cell.salaryBand === null)).toBe(true)
    expect(payloadOf(cells).dimensions.some((table) => table.dim === 'salaryBand')).toBe(false)
  })

  it('配置了分档边界时只发区间：区间标签与看板分档同源，裸金额一定不发', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        dimensionInputFor(
          'salaryBand',
          'salaryBand',
          enoughRecords(6, { salaryAmount: 4200 }),
          edges,
        ),
      ],
      salaryBandEdges: edges,
    })

    const banded = cells.filter((cell) => cell.salaryBand !== null)
    expect(banded.length).toBeGreaterThan(0)
    for (const cell of banded) {
      expect(bandOf(4200, edges)).toBe(cell.salaryBand)
    }

    const payload = payloadOf(cells)
    const serialized = JSON.stringify(payload)
    expect(serialized).toContain('4000–4999')
    // 准确金额不出现，只出现区间标签
    expect(serialized).not.toContain('4200')
  })

  it('「未知」薪资格给 null，绝不落进任何一个区间（缺失 ≠ 最低薪）', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        {
          dimension: 'salaryBand',
          label: '薪资区间',
          groups: [
            groupOf('3000–3999', enoughRecords(6, { salaryAmount: 3100 })),
            groupOf(UNKNOWN, enoughRecords(5, { salaryAmount: null })),
          ],
          total: summarizeRecords('全部（当前筛选）', RECORDS),
        },
      ],
      salaryBandEdges: edges,
    })

    expect(cells.find((cell) => cell.key === UNKNOWN)?.salaryBand).toBeNull()
    expect(cells.find((cell) => cell.key === '3000–3999')?.salaryBand).toBe('3000–3999')
  })
})

/* ------------------------------------------------------------------ 周期区间 */

describe('周期只发区间，且区间来自引擎的同一个分桶函数', () => {
  it('cycleBandGroupsOf 的分组键全部是周期区间，且没有「未知」桶', () => {
    const groups = cycleBandGroupsOf(RECORDS)

    // 合成记录没有日期，因此不会有任何周期区间（缺失 ≠ 0 天），也不会造出一个「未知」区间
    expect(groups.every((group) => /^\d+-\d+天$/.test(group.key))).toBe(true)
    expect(groups.some((group) => group.key === UNKNOWN)).toBe(false)
  })

  it('有效周期的记录被分到 10 天等宽的区间里，计数来自引擎汇总', () => {
    const dated = syntheticRecords([
      {
        offerStatus: '已入职',
        recruitmentStartDate: '2026-01-01',
        joiningDate: '2026-01-11',
      },
      {
        offerStatus: '已入职',
        recruitmentStartDate: '2026-02-01',
        joiningDate: '2026-03-03',
      },
    ])
    const groups = cycleBandGroupsOf(dated)

    // 10 天 → 10-19天；30 天 → 30-39天
    expect(groups.map((group) => group.key).sort()).toEqual(['10-19天', '30-39天'])
    expect(groups.map((group) => group.counts.total)).toEqual([1, 1])
  })

  it('中位数缺失的周期格直接不发（不填 0 天）', () => {
    const cells = buildAiSourceCells({
      dimensions: [],
      cycleBandGroups: {
        groups: [summarizeRecords('10-19天', [])],
        total: summarizeRecords('全部（当前筛选）', RECORDS),
      },
    })

    expect(cells.length).toBe(0)
  })

  it('有中位数时 cycleDays 取该区间的中位数，引擎据此还原成同一个区间', () => {
    const dated = syntheticRecords(
      Array.from({ length: 6 }, () => ({
        offerStatus: '已入职' as const,
        recruitmentStartDate: '2026-01-01',
        joiningDate: '2026-01-11',
      })),
    )
    const groups = cycleBandGroupsOf(dated)
    const cells = buildAiSourceCells({
      dimensions: [],
      cycleBandGroups: { groups, total: summarizeRecords('全部（当前筛选）', dated) },
    })

    expect(cells.length).toBe(1)
    expect(cells[0]?.cycleDays).toBe(10)
    const payload = payloadOf(cells)
    expect(payload.dimensions.find((table) => table.dim === 'cycleBand')?.rows[0]?.key).toBe(
      '10-19天',
    )
  })
})

/* ------------------------------------------------------------------ 计数搬运 */

describe('候选格的计数一律来自引擎的分组汇总', () => {
  it('total / coreDenominator / rejected 与分组 counts 完全一致', () => {
    const input = dimensionInputFor('city', 'city')
    const cells = buildAiSourceCells({ dimensions: [input] })

    expect(cells.length).toBe(input.groups.length)
    for (const cell of cells) {
      const group = input.groups.find((item) => item.key === cell.key)
      expect(group).toBeDefined()
      expect(cell.total).toBe(group?.counts.total)
      expect(cell.coreDenominator).toBe(group?.counts.coreDenominator)
      expect(cell.rejected).toBe(group?.counts.rejected)
    }
  })

  it('「未知」是独立可选值，仍然作为候选格交给引擎（不在这里预先丢掉）', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        {
          dimension: 'city',
          label: '城市',
          groups: [
            groupOf('上海', enoughRecords(6, { city: SHA })),
            groupOf(UNKNOWN, enoughRecords(5, { city: UNKNOWN as City })),
          ],
          total: summarizeRecords('全部（当前筛选）', RECORDS),
        },
      ],
    })

    expect(cells.map((cell) => cell.key)).toEqual(['上海', UNKNOWN])
  })

  it('每个维度只发出一张候选表（同一维度重复出现会触发引擎的整维省略）', () => {
    const cells = buildAiSourceCells({
      dimensions: [
        {
          dimension: 'city',
          label: '城市',
          groups: [groupOf('上海', enoughRecords(6, { city: SHA }))],
          total: summarizeRecords('全部（当前筛选）', RECORDS),
        },
        {
          dimension: 'school',
          label: '学校层次',
          groups: [groupOf(GPT_YES_LABEL, enoughRecords(5, { isGptSchool: true }))],
          total: summarizeRecords('全部（当前筛选）', RECORDS),
        },
      ],
    })

    // 两个维度、两个候选格：本层不会为同一个维度拆出多张表
    expect(cells.map((cell) => [cell.dimension, cell.key])).toEqual([
      ['city', '上海'],
      ['school', GPT_YES_LABEL],
    ])
    expect(new Set(cells.map((cell) => cell.dimension)).size).toBe(cells.length)
  })
})
