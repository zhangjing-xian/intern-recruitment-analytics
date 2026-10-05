/**
 * 脱敏原语层单测（步骤11，docs/PRD.md 10.6 / 11.5）。
 *
 * 数据红线：全部使用**合成**哨兵字符串与人工构造的小组（AGENTS.md §2.6），
 * 不含任何真实候选人、HR、薪资或需求 ID。
 *
 * 覆盖点（逐条对应 PRD 10.6 与 11.5 的验收）：
 * 1. 薪资分档：边界左闭右开、`null` / 非法值 / 负值一律不落桶（缺失 ≠ 0 元）；
 * 2. 互补抑制：每个维度**至少两个**分组被抑制，绝不允许恰好一个；
 * 3. `containsForbiddenField`：驼峰 / 下划线 / 大写都能命中，且不误伤合法字段名；
 * 4. `findSensitiveFields`：命中全部 `FORBIDDEN_FIELD_NAMES`、命中调用方给的哨兵值，
 *    且干净的聚合报告必须**通过**（否则这道闸门会被迫加豁免，等于没有闸门）。
 */

import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN_FIELD_NAMES,
  FORBIDDEN_KEYS,
  SALARY_BAND_EDGES,
  SENTINEL_HIT_LABEL,
  applyComplementarySuppression,
  collectAllowedKeys,
  containsForbiddenField,
  findSensitiveFields,
  salaryBandOf,
  type SuppressibleGroup,
} from './sanitize'

/* ------------------------------------------------------------------ 薪资分档 */

describe('salaryBandOf 与 SALARY_BAND_EDGES', () => {
  it('边界表与 PRD 10.6 的五个区间一致', () => {
    expect(SALARY_BAND_EDGES).toEqual([3000, 4000, 5000, 6000])
  })

  it('按左闭右开分桶：3000 落进 3000-4000，3999 也在同一桶，4000 进下一桶', () => {
    expect(salaryBandOf(0)).toBe('<3000')
    expect(salaryBandOf(2999)).toBe('<3000')
    expect(salaryBandOf(3000)).toBe('3000-4000')
    expect(salaryBandOf(3999)).toBe('3000-4000')
    expect(salaryBandOf(4000)).toBe('4000-5000')
    expect(salaryBandOf(4999)).toBe('4000-5000')
    expect(salaryBandOf(5000)).toBe('5000-6000')
    expect(salaryBandOf(5999)).toBe('5000-6000')
    expect(salaryBandOf(6000)).toBe('>=6000')
    expect(salaryBandOf(999999)).toBe('>=6000')
  })

  it('缺失与非法值一律 null（不落进 <3000，避免把「没填」读成「低薪」）', () => {
    expect(salaryBandOf(null)).toBeNull()
    expect(salaryBandOf(-1)).toBeNull()
    expect(salaryBandOf(Number.NaN)).toBeNull()
    expect(salaryBandOf(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('自定义边界同样左闭右开；空边界不发明区间', () => {
    expect(salaryBandOf(100, [100, 200])).toBe('100-200')
    expect(salaryBandOf(99, [100, 200])).toBe('<100')
    expect(salaryBandOf(200, [100, 200])).toBe('>=200')
    expect(salaryBandOf(500, [])).toBeNull()
    // 乱序 / 重复 / 非法边界先归一化，避免出现「半套分档」
    expect(salaryBandOf(3500, [5000, 3000, 3000, Number.NaN])).toBe('3000-5000')
  })
})

/* ------------------------------------------------------------------ 互补抑制 */

function groupOf(
  key: string,
  total: number,
  suppressed = false,
  coreDenominator = total,
): SuppressibleGroup {
  return { key, total, coreDenominator, suppressed, mergedCount: 1 }
}

describe('applyComplementarySuppression（互补抑制）', () => {
  it('一个分组都没有抑制时补足到两个，且优先牺牲人数最少的组', () => {
    const result = applyComplementarySuppression(
      [groupOf('A', 40), groupOf('B', 12), groupOf('C', 9), groupOf('D', 6)],
      { minSuppressed: 2, suppressBelow: 5 },
    )

    // 返回顺序与入参一致，被抑制的是人数最少的 C（9）与 D（6）
    expect(result.map((group) => [group.key, group.suppressed])).toEqual([
      ['A', false],
      ['B', false],
      ['C', true],
      ['D', true],
    ])
    // 绝不修改入参（纯函数）
    const input = [groupOf('A', 40), groupOf('B', 12)]
    applyComplementarySuppression(input, { minSuppressed: 2, suppressBelow: 5 })
    expect(input.every((group) => !group.suppressed)).toBe(true)
  })

  it('已经有两个被抑制时不额外抑制（最小必要原则）', () => {
    const result = applyComplementarySuppression(
      [groupOf('A', 40), groupOf('B', 30, true), groupOf('C', 20, true)],
      { minSuppressed: 2, suppressBelow: 5 },
    )

    expect(result.filter((group) => group.suppressed)).toHaveLength(2)
    expect(result[0].suppressed).toBe(false)
  })

  it('只有一个分组时无法补足两个：返回结果保持不变（由报告层整维抑制）', () => {
    // 为什么不在本函数里把它标成 suppressed：这样「至少两个」的语义就只由调用方决定，
    // 而调用方（buildSanitizedReport）必须写一句解释给读者看，不能悄悄少一行。
    const result = applyComplementarySuppression([groupOf('唯一', 30)], {
      minSuppressed: 2,
      suppressBelow: 5,
    })

    expect(result).toHaveLength(1)
    expect(result[0].suppressed).toBe(false)
  })

  it('每个维度都不会出现「恰好一个被抑制」的列（否则总计减其余即可还原）', () => {
    // 逐列遍历：3 / 4 / 5 个分组，各组合下断言抑制数 ≠ 1
    for (const sizes of [
      [10, 10, 10],
      [10, 10, 10, 10],
      [9, 8, 7, 6, 5],
      [30, 4, 3],
      [100, 2, 2, 2],
    ]) {
      const result = applyComplementarySuppression(
        sizes.map((size, index) => groupOf(`G${String(index)}`, size)),
        { minSuppressed: 2, suppressBelow: 5 },
      )
      const suppressed = result.filter((group) => group.suppressed).length
      expect(suppressed === 0 || suppressed >= 2).toBe(true)
    }
  })

  it('大于两个被抑制时保持原样（不把已抑制的组「放开」）', () => {
    const groups = [groupOf('A', 3, true), groupOf('B', 4, true), groupOf('C', 4, true)]
    const result = applyComplementarySuppression(groups, { minSuppressed: 2, suppressBelow: 5 })
    expect(result.map((group) => group.suppressed)).toEqual([true, true, true])
  })
})

/* ------------------------------------------------------------------ 字段名检查 */

describe('containsForbiddenField', () => {
  it('命中 camelCase / snake_case / 大写写法（PRD 11.5 用哨兵检索导出内容）', () => {
    expect(containsForbiddenField('candidateName')).toBe(true)
    expect(containsForbiddenField('candidate_name')).toBe(true)
    expect(containsForbiddenField('CANDIDATENAME')).toBe(true)
    expect(containsForbiddenField('candidate-name')).toBe(true)
    expect(containsForbiddenField('requirementId')).toBe(true)
    expect(containsForbiddenField('salaryAmount')).toBe(true)
    expect(containsForbiddenField('rejectionReason')).toBe(true)
    expect(containsForbiddenField('recruiter')).toBe(true)
    expect(containsForbiddenField('姓名')).toBe(true)
    expect(containsForbiddenField('推荐人')).toBe(true)
  })

  it('不误伤报告自身的合法字段名（否则最后一道闸门会被迫加豁免）', () => {
    for (const allowed of [
      'allowedKeys',
      'suppression',
      'suppressed',
      'salaryBand',
      'salaryBandEdges',
      'dimensions',
      'coreDenominator',
      'rejectedRate',
      'medianBand',
      'unknownConditions',
      'effectiveSampleNotes',
      'recordCode',
      'privacyLevel',
      'suppressBelow',
      'sourceRowExcludedCount',
    ]) {
      expect(containsForbiddenField(allowed)).toBe(false)
    }
    expect(containsForbiddenField('')).toBe(false)
    expect(containsForbiddenField('   ')).toBe(false)
  })

  it('FORBIDDEN_KEYS 与 FORBIDDEN_FIELD_NAMES 同源，不会各自漂移', () => {
    expect(FORBIDDEN_KEYS).toEqual(FORBIDDEN_FIELD_NAMES)
  })
})

/* ------------------------------------------------------------------ 敏感字段扫描 */

/** 合成哨兵：姓名 / 准确薪资 / HR 姓名 / 需求 ID / 自由文本原因（全部人工构造） */
const SENTINELS = ['张合成', '3500', '李招聘', 'REQ-9001', '薪酬太低所以去了别家'] as const

describe('findSensitiveFields', () => {
  it('对每一个被禁字段名都能命中', () => {
    for (const field of FORBIDDEN_FIELD_NAMES) {
      const hits = findSensitiveFields({ [field]: 'x' })
      expect(hits.length, `未捕获被禁字段：${field}`).toBeGreaterThan(0)
    }
  })

  it('命中嵌套对象与数组里的被禁字段名，并给出不含值的路径', () => {
    const hits = findSensitiveFields({
      meta: { title: '报告' },
      details: [{ recordCode: 'R-0001', candidateName: '张合成' }],
    })

    expect(hits).toContain('details[0].candidateName')
    // 只报字段名，绝不回显命中的值（值本身才是敏感信息）
    expect(hits.join('|')).not.toContain('张合成')
  })

  it('凡是值里出现哨兵字符串（姓名 / 准确薪资 / HR 姓名 / 需求 ID / 原因原文）都命中', () => {
    const hits = findSensitiveFields(
      {
        meta: { title: '张合成的报告' },
        kpis: [{ id: 'x', label: '薪资', note: '中位数 3500 元' }],
        dimensions: [{ label: '招聘HR：李招聘' }],
        reasons: [{ category: 'REQ-9001' }],
        advice: [{ observation: '薪酬太低所以去了别家', advice: '—' }],
      },
      SENTINELS,
    )

    // 每个哨兵都必须在某个路径上被报出来（只报位置标记，不回显原文）
    expect(hits.filter((hit) => hit.endsWith(SENTINEL_HIT_LABEL)).length).toBeGreaterThanOrEqual(5)
    expect(hits.join('|')).not.toContain('张合成')
    expect(hits.join('|')).not.toContain('3500')
  })

  it('没有哨兵、也没有被禁字段名的干净聚合报告必须通过', () => {
    const clean = {
      meta: { title: '实习生招聘复盘报告', generatedAt: '2026-09-26T00:00:00.000Z' },
      kpis: [
        { id: 'total', label: 'N 总 offer 记录数（含审批中）', value: 6, numerator: null, denominator: null },
      ],
      dimensions: [
        {
          dimension: 'city',
          label: '城市',
          groups: [{ label: '上海', code: null, total: 6, rejectedRate: { value: 40 } }],
        },
      ],
      suppression: [{ path: 'dimensions.city', reason: '互补抑制', suppressedCount: 2 }],
      allowedKeys: ['meta', 'kpis', 'dimensions'],
    }

    expect(findSensitiveFields(clean, ['张合成', '李招聘'])).toEqual([])
  })

  it('大小写与空白差异不影响哨兵匹配', () => {
    expect(findSensitiveFields({ label: 'REQ-9001' }, ['req-9001'])).toContain(
      `label:${SENTINEL_HIT_LABEL}`,
    )
    // 空哨兵被忽略，不会让任何东西命中
    expect(findSensitiveFields({ label: '任意' }, ['', '   '])).toEqual([])
  })
})

/* ------------------------------------------------------------------ allowedKeys */

describe('collectAllowedKeys', () => {
  it('收集嵌套键与数组元素键，并按字母序稳定返回', () => {
    expect(
      collectAllowedKeys({ b: 1, a: { d: [{ c: 2 }] } }),
    ).toEqual(['a', 'b', 'c', 'd'])
  })

  it('非对象输入返回空清单（不抛错）', () => {
    expect(collectAllowedKeys(null)).toEqual([])
    expect(collectAllowedKeys(42)).toEqual([])
    expect(collectAllowedKeys('文本')).toEqual([])
  })
})
