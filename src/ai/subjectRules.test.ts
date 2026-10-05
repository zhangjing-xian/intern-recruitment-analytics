/**
 * AI-6 单测：本地规则集与二次确认（`src/ai/subjectRules.ts`）。
 *
 * 这一步的验收标准里有两条与这个模块直接相关：
 * - **「规则一改，确认必须失效」**：不能靠界面记得重置布尔量，只能靠指纹比较；
 * - **「岗位类别映射、学校层次本地名单、原因主题」都要能对用户说清「会发出什么」**，
 *   因此视图里必须有 `sends` 与 `neverSends`，且 `neverSends` 里明确包含原文。
 *
 * 这里刻意**不**测界面：本模块是纯函数，界面只负责摆放（渲染断言在
 * `features/settings/AiSettingsPanel.test.tsx`）。
 */

import { describe, expect, it } from 'vitest'

import type { NormalizedDataset } from '../domain'
import {
  AI_SUBJECT_RULE_IDS,
  EMPTY_AI_LOCAL_RULES,
  aiLocalRulesOf,
  buildAiSubjectRules,
  confirmAiSubjectRules,
  isAiSubjectRulesConfirmed,
  ruleVersionLabelOf,
  subjectRulesFingerprint,
  subjectRulesFingerprintOf,
  type AiSubjectRulesInput,
} from './subjectRules'

function inputOf(overrides: Partial<AiSubjectRulesInput> = {}): AiSubjectRulesInput {
  return {
    positionCategories: [],
    gptListCount: 12,
    gptListMode: 'list-mode',
    gptListComplete: true,
    schoolAliasCount: 3,
    ruleVersion: '1.0.0+3F2A19C4',
    ...overrides,
  }
}

describe('AI-6：规则指纹', () => {
  it('同一份规则 → 同一个指纹；每一处变化都会换指纹', () => {
    const base = inputOf()
    const fingerprint = subjectRulesFingerprint(base)

    expect(subjectRulesFingerprint(inputOf())).toBe(fingerprint)
    expect(subjectRulesFingerprint(inputOf({ positionCategories: [{ keyword: '前端', category: '研发' }] }))).not.toBe(fingerprint)
    expect(subjectRulesFingerprint(inputOf({ gptListCount: 13 }))).not.toBe(fingerprint)
    expect(subjectRulesFingerprint(inputOf({ gptListMode: 'raw-first' }))).not.toBe(fingerprint)
    expect(subjectRulesFingerprint(inputOf({ gptListComplete: false }))).not.toBe(fingerprint)
    expect(subjectRulesFingerprint(inputOf({ schoolAliasCount: 4 }))).not.toBe(fingerprint)
    expect(subjectRulesFingerprint(inputOf({ ruleVersion: '1.0.0+AAAAAAAA' }))).not.toBe(fingerprint)
  })

  it('「读不到」与「空名单」不是同一个状态（null 不折叠成 0/空）', () => {
    const unknown = subjectRulesFingerprint(inputOf({ gptListCount: null, schoolAliasCount: null }))
    const empty = subjectRulesFingerprint(inputOf({ gptListCount: 0, schoolAliasCount: 0 }))

    expect(unknown).not.toBe(empty)
  })

  it('不合格的映射规则不进指纹（它们根本不会被使用）', () => {
    const without = subjectRulesFingerprint(inputOf())
    const withInvalid = subjectRulesFingerprint(
      inputOf({
        positionCategories: [
          { keyword: '前端', category: '这是一段长得像自由文本的类别名' },
          { keyword: '后端', category: 'REQ-0001' },
        ],
      }),
    )

    expect(withInvalid).toBe(without)
  })

  it('指纹是同输入同输出的稳定短串', () => {
    const fingerprint = subjectRulesFingerprintOf('same-input')
    expect(fingerprint).toBe(subjectRulesFingerprintOf('same-input'))
    expect(fingerprint).toMatch(/^[0-9A-F]{8}$/)
    expect(subjectRulesFingerprintOf('same-inpuu')).not.toBe(fingerprint)
  })
})

describe('AI-6：二次确认只对「那一份规则」有效', () => {
  it('没有确认记录 / 确认时间为空 → 未确认', () => {
    expect(isAiSubjectRulesConfirmed(null, inputOf())).toBe(false)
    expect(
      isAiSubjectRulesConfirmed(
        { fingerprint: subjectRulesFingerprint(inputOf()), confirmedAt: '   ' },
        inputOf(),
      ),
    ).toBe(false)
  })

  it('确认后规则不变 → 仍然有效；规则一改 → 立即失效', () => {
    const rules = inputOf()
    const confirmation = confirmAiSubjectRules(rules, '2026-09-26T00:00:00.000Z')

    expect(confirmation.fingerprint).toBe(subjectRulesFingerprint(rules))
    expect(isAiSubjectRulesConfirmed(confirmation, rules)).toBe(true)
    // 换名单（配置摘要变化）属于「规则变了」
    expect(isAiSubjectRulesConfirmed(confirmation, inputOf({ ruleVersion: '1.0.0+BBBBBBBB' }))).toBe(false)
    // 加一条岗位类别映射也属于「规则变了」
    expect(
      isAiSubjectRulesConfirmed(
        confirmation,
        inputOf({ positionCategories: [{ keyword: '前端', category: '研发' }] }),
      ),
    ).toBe(false)
  })

  it('指纹对不上（例如被手改过的仓内容）→ 未确认', () => {
    expect(
      isAiSubjectRulesConfirmed(
        { fingerprint: 'DEADBEEF', confirmedAt: '2026-09-26T00:00:00.000Z' },
        inputOf(),
      ),
    ).toBe(false)
  })
})

describe('AI-6：规则视图必须说清「会发出什么、什么永远不会发出」', () => {
  it('三个规则集按固定顺序出现', () => {
    const rules = buildAiSubjectRules(inputOf())
    expect(rules.map((rule) => rule.id)).toEqual([...AI_SUBJECT_RULE_IDS])
  })

  it('岗位类别映射：没配映射时只发中性标签，配了才发类别；原文永远不发', () => {
    const empty = buildAiSubjectRules(inputOf())
    const position = empty.find((rule) => rule.id === 'positionCategory')
    expect(position?.sends).toEqual(['有岗位记录'])

    const configured = buildAiSubjectRules(
      inputOf({
        positionCategories: [
          { keyword: '前端开发', category: '研发' },
          { keyword: '算法', category: '算法' },
        ],
      }),
    )
    const mapped = configured.find((rule) => rule.id === 'positionCategory')
    expect(mapped?.sends).toEqual(['研发', '算法'])
    for (const rule of configured) {
      for (const never of rule.neverSends) {
        expect(never.length).toBeGreaterThan(0)
      }
    }
    expect(mapped?.neverSends.join('')).toContain('岗位名称原文')
  })

  it('学校层次：只发三值标签，读不到名单时如实说读不到', () => {
    const known = buildAiSubjectRules(inputOf()).find((rule) => rule.id === 'schoolLevel')
    expect(known?.sends).toEqual(['GPT 院校', '非 GPT 院校', '未标注'])
    expect(known?.lines.join('')).toContain('12 所学校')
    expect(known?.lines.join('')).toContain('已声明名单完整')
    expect(known?.neverSends.join('')).toContain('学校全名')

    const unknown = buildAiSubjectRules(
      inputOf({ gptListCount: null, schoolAliasCount: null }),
    ).find((rule) => rule.id === 'schoolLevel')
    expect(unknown?.lines.join('')).toContain('读不到当前生效的本地名单')
  })

  it('原因主题：只列可命中的主题，缺失统计（未填写 / 未分类）不算主题', () => {
    const topics = buildAiSubjectRules(inputOf()).find((rule) => rule.id === 'reasonTopic')
    expect(topics?.sends).toContain('薪酬')
    expect(topics?.sends).toContain('其他offer')
    expect(topics?.sends).not.toContain('未填写')
    expect(topics?.sends).not.toContain('未分类')
    expect(topics?.neverSends.join('')).toContain('原文')
  })
})

describe('AI-6：本地规则输入的取值口径', () => {
  it('没有已提交数据集 → 全部为 null（读不到就说读不到）', () => {
    expect(aiLocalRulesOf(null)).toEqual(EMPTY_AI_LOCAL_RULES)
    expect(EMPTY_AI_LOCAL_RULES.ruleVersion).toBeNull()
  })

  it('数据集带设置快照时按快照取名单 / 别名 / 模式', () => {
    const dataset = {
      metadata: {
        ruleVersion: { rulesVersion: '1.0.0', configRevision: '3F2A19C4' },
        cleaningSettings: {
          gptList: ['甲大学', '乙大学'],
          gptListMode: 'list-mode',
          gptListComplete: false,
          schoolAliases: [{ alias: '上交', canonical: '上海交通大学' }],
        },
      },
    } as unknown as NormalizedDataset

    expect(aiLocalRulesOf(dataset)).toEqual({
      ruleVersion: '1.0.0+3F2A19C4',
      gptListCount: 2,
      gptListMode: 'list-mode',
      gptListComplete: false,
      schoolAliasCount: 1,
    })
  })

  it('旧数据集没有设置快照时，名单侧为 null 但版本仍然读得到（不假设设置没变）', () => {
    const dataset = {
      metadata: { ruleVersion: { rulesVersion: '1.0.0' } },
    } as unknown as NormalizedDataset
    const rules = aiLocalRulesOf(dataset)

    expect(rules.ruleVersion).toBe('1.0.0')
    expect(rules.gptListCount).toBeNull()
    expect(rules.gptListMode).toBeNull()
    expect(rules.gptListComplete).toBeNull()
    expect(rules.schoolAliasCount).toBeNull()
  })

  it('版本标签与摘要层共用同一函数（有配置摘要才拼）', () => {
    expect(ruleVersionLabelOf({ rulesVersion: '1.0.0' } as never)).toBe('1.0.0')
    expect(
      ruleVersionLabelOf({ rulesVersion: '1.0.0', configRevision: 'ABCD1234' } as never),
    ).toBe('1.0.0+ABCD1234')
  })
})
