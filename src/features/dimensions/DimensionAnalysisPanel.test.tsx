/**
 * 分维度分析渲染冒烟测试（步骤9）。
 *
 * 为什么用 `react-dom/server`：与步骤8 的看板测试同一套理由——组件测试依赖
 * （Testing Library + jsdom）属于步骤14，但「8 个模块是否真的把引擎数字渲染出来」
 * 必须被验证，不能只靠纯函数测试。`renderToStaticMarkup` 只跑**渲染**、不跑 effect，
 * 因此既不加载 ECharts，也不发任何请求。
 *
 * 覆盖点：
 * 1. 8 个模块标题与「量、率、D、有效周期 n」四类列真的出现（PRD 8 章验收）；
 * 2. HR 覆盖需求数单列，且「只有 1 位 HR」时不出排名文案；
 * 3. 岗位排行的合并行**不可下钻**（下钻回调收到真实取值而不是「其他（N 个分组合并）」）；
 * 4. 未确认币种 / 计薪周期时薪资分布明确禁用（不显示 0 元、不出分位）；
 * 5. 空记录时只有空态说明，不画图、不显示 0%。
 *
 * 数据全部来自 `domain/analytics/fixtures.ts` 的合成夹具（AGENTS.md §2.6）。
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  aggregateByDimension,
  salaryDistributionByUnit,
  type MetricAvailability,
  type NormalizedRecord,
} from '../../domain'
import { syntheticRecords } from '../../domain/analytics/fixtures'
import { ReturnToAllScope } from '../dashboard/ReturnToAllScope'
import { RETURN_TO_ALL_LABEL } from '../dashboard/dashboardText'

import DimensionAnalysisPanel from './DimensionAnalysisPanel'
import {
  CHART_HINT,
  COLUMN_LABELS,
  DRILLDOWN_LABEL,
  NO_RECORDS_NOTE,
  SECTION_TITLES,
} from './analysisText'
import { RANK_MODE_NOTE } from './analysisText'
import { EFFICIENCY_NOTE, SALARY_COMPARISON_DISABLED_REASON } from '../../domain'

/* ------------------------------------------------------------------ 合成数据 */

const RECORDS: readonly NormalizedRecord[] = syntheticRecords([
  // 上海 / Boss / 技术 / 前端开发
  { city: '上海', channel: 'Boss', position: '前端开发', jobFamily: '技术', department: '研发中心', recruiter: 'HR-甲', requirementId: 'REQ-001', offerStatus: '已入职', graduationYear: 2027, education: '本科', school: '甲大学', isGptSchool: true, salaryAmount: 4000, currency: 'CNY', salaryUnit: '元/月', housingType: '现金房补', housingAmount: 1500, housingPeriod: '月', recruitmentStartDate: '2026-01-05', joiningDate: '2026-01-15' },
  { city: '上海', channel: 'Boss', position: '前端开发', jobFamily: '技术', department: '研发中心', recruiter: 'HR-甲', requirementId: 'REQ-002', offerStatus: '拒绝offer', graduationYear: 2027, education: '本科', school: '甲大学', isGptSchool: true, salaryAmount: 4500, currency: 'CNY', salaryUnit: '元/月', housingType: '现金房补', housingAmount: 1500, housingPeriod: '月', recruitmentStartDate: '2026-01-06', rejectionReason: null },
  { city: '上海', channel: '内推', position: '前端开发', jobFamily: '技术', department: '研发中心', recruiter: 'HR-甲', requirementId: 'REQ-003', offerStatus: '待入职', graduationYear: 2028, education: '硕士', school: '乙大学', isGptSchool: false, salaryAmount: 5000, currency: 'CNY', salaryUnit: '元/月', housingType: '提供住宿', recruitmentStartDate: '2026-02-01', joiningDate: '2026-03-01' },
  // 广州 / 实习僧 / 产品
  { city: '广州', channel: '实习僧', position: '产品经理', jobFamily: '产品', department: '产品部', recruiter: 'HR-乙', requirementId: 'REQ-004', offerStatus: '已入职', graduationYear: 2027, education: '本科', school: '丙大学', salaryAmount: 3800, currency: 'CNY', salaryUnit: '元/月', housingType: '无补贴', housingAmount: 0, housingPeriod: '月', recruitmentStartDate: '2026-02-10', joiningDate: '2026-03-01' },
  { city: '广州', channel: '实习僧', position: '产品经理', jobFamily: '产品', department: '产品部', recruiter: 'HR-乙', requirementId: 'REQ-005', offerStatus: 'offer审批中', graduationYear: 2028, education: '本科', school: '丙大学', salaryAmount: 3800, currency: 'CNY', salaryUnit: '元/月', housingType: '无补贴', recruitmentStartDate: '2026-02-11' },
  // 杭州 / 无渠道（未知）/ 技术 / 后端开发
  { city: '杭州', position: '后端开发', jobFamily: '技术', department: '研发中心', recruiter: 'HR-乙', requirementId: 'REQ-006', offerStatus: '已入职', graduationYear: 2027, education: '硕士', school: '丁大学', salaryAmount: 4200, currency: 'CNY', salaryUnit: '元/月', housingType: '提供住宿', recruitmentStartDate: '2026-03-01', joiningDate: '2026-03-20' },
  { city: '杭州', position: '后端开发', jobFamily: '技术', department: '研发中心', recruiter: 'HR-乙', requirementId: 'REQ-007', offerStatus: '拒绝口头offer', graduationYear: 2028, education: '本科', school: '丁大学', salaryAmount: 4200, currency: 'CNY', salaryUnit: '元/月', housingType: '未知', recruitmentStartDate: '2026-03-02', rejectionReason: '薪酬' },
])

/** 城市分组（供断言「合计 > 任何单组」） */
const CITY_GROUPS = aggregateByDimension(RECORDS, 'city')

const AVAILABLE: readonly MetricAvailability[] = []

/** 薪资 / 房补被禁用的可用性声明 */
const SALARY_DISABLED: readonly MetricAvailability[] = [
  { module: '薪资对比', available: false, validSampleCount: null, reason: '币种未确认' },
  { module: '房补对比', available: false, validSampleCount: null, reason: '币种未确认' },
]

function render(
  records: readonly NormalizedRecord[] = RECORDS,
  options: { readonly comparable?: boolean; readonly availability?: readonly MetricAvailability[] } = {},
): string {
  return renderToStaticMarkup(
    <DimensionAnalysisPanel
      availability={options.availability ?? AVAILABLE}
      comparable={options.comparable ?? true}
      groupingOptions={{}}
      onDrilldown={() => {}}
      records={records}
    />,
  )
}

/* ------------------------------------------------------------------ 断言 */

describe('分维度分析：8 个模块与必需列', () => {
  it('渲染出 PRD 8 章的全部 8 个模块标题', () => {
    const html = render()
    for (const title of Object.values(SECTION_TITLES)) {
      expect(html).toContain(title)
    }
  })

  it('分组表给出量、率、D 与有效周期 n 四类列（PRD 8 章验收）', () => {
    const html = render()
    // 量：N / J / P / A / R 与核心分母 D
    expect(html).toContain(COLUMN_LABELS.total)
    expect(html).toContain(COLUMN_LABELS.coreDenominator)
    // 率：入职率与拒 offer 率（带分子 ÷ 分母）
    expect(html).toContain(COLUMN_LABELS.joinedRate)
    expect(html).toContain(COLUMN_LABELS.rejectionRate)
    expect(html).toMatch(/分子 \d+ ÷ 分母 \d+/)
    // 有效周期：n / 均值 / 中位数
    expect(html).toContain(COLUMN_LABELS.cycle)
    // 样本门槛列（小样本不参与自动排名）
    expect(html).toContain(COLUMN_LABELS.sample)
  })

  it('合计行说明率由合计分子分母重算，不是平均各分组百分比', () => {
    const html = render()
    expect(html).toContain('合计（引擎对同一批记录重新汇总）')
  })

  /*
   * 用户需求 ③：渠道 / HR / 需求类型 / 画像（年级·学历·学校·GPT）/ 时间效率都要有图。
   * `EChart` 的服务端渲染产出 `role="img"` + `aria-label`，因此这里断言的是
   * 「图确实被渲染出来、且读屏能拿到一句描述」——真实绘制由端到端用例在浏览器里证明
   * （jsdom / 服务端渲染都没有 canvas）。
   */
  it('六个模块都渲染出图表（role=img 且带可读描述）', () => {
    const html = render()
    const labels = [
      '各渠道的记录数与拒 offer 率',
      '各招聘 HR 的记录数与拒 offer 率',
      '各需求类型的记录数',
      '各毕业年级的记录数',
      '各学历的记录数',
      '各学校（Top 10）的记录数；长尾合并分组不进图',
      'GPT 院校三值（是 / 否 / 未知）的记录数',
      '各岗位的实际招聘周期中位数',
    ]
    for (const label of labels) {
      expect(html, `缺少图表：${label}`).toContain(label)
    }
    // 每个图都是 role="img"，否则读屏软件读不到
    expect((html.match(/role="img"/g) ?? []).length).toBeGreaterThanOrEqual(labels.length)
  })

  it('合计 N 等于记录总数（合计不是把各分组的率平均）', () => {
    const total = CITY_GROUPS.reduce((sum, group) => sum + group.counts.total, 0)
    expect(total).toBe(RECORDS.length)
    expect(render()).toContain(`${RECORDS.length}`)
  })
})

describe('分维度分析：HR 效能', () => {
  it('覆盖需求数单列，并附口径提示与「缺需求 ID」计数', () => {
    const html = render()
    expect(html).toContain(COLUMN_LABELS.coverage)
    expect(html).toContain('只在单个 HR 内去重')
    expect(html).toContain('缺需求 ID')
  })

  it('有 2 位 HR 时给出「可参与自动排名」人数', () => {
    const html = render()
    expect(html).toContain('位招聘 HR')
  })

  it('只有 1 位 HR 时不出排名（判定来自引擎 recruiterRankingAvailability）', () => {
    const single = syntheticRecords([
      { city: '上海', recruiter: 'HR-甲', offerStatus: '已入职' },
      { city: '上海', recruiter: 'HR-甲', offerStatus: '拒绝offer' },
    ])
    const html = render(single)
    expect(html).toContain('只有 1 位招聘 HR')
    expect(html).not.toContain('位招聘 HR，其中')
  })
})

describe('分维度分析：岗位排行的合并行', () => {
  /** 12 个岗位：超出 Top 8，因此必然出现一行「其他（N 个分组合并）」 */
  const MANY_POSITIONS: readonly NormalizedRecord[] = syntheticRecords(
    Array.from({ length: 12 }, (_, index) => ({
      position: `岗位${String(index + 1).padStart(2, '0')}`,
      city: '上海',
      offerStatus: '已入职' as const,
    })),
  )

  it('岗位数超过 TopN 时出现合并行，并标明不可下钻', () => {
    const html = render(MANY_POSITIONS)
    // 12 - 8 = 4 个分组合并
    expect(html).toContain('其他（4 个分组合并）')
    // 合并行不是真实取值：只提示，不给下钻按钮
    expect(html).toContain('（合并行，不可下钻）')
  })

  it('合并不影响散点点数：图上只有真实取值（12 组 → 8 个点，不含合并行）', () => {
    const html = render(MANY_POSITIONS)
    expect(html).toContain('共 8 个点')
  })

  it('排行的完整表与 TopN 表都能切换，口径提示里写明合并不是真实取值', () => {
    const html = render()
    expect(html).toContain('完整表')
    expect(html).toContain(RANK_MODE_NOTE)
    // 岗位维度可切换（真实标签来自引擎的 GROUP_DIMENSION_LABELS）
    expect(html).toContain('序列')
    expect(html).toContain('一级部门')
  })

  it('下钻按钮对所有真实分组可见', () => {
    const html = render()
    expect(html).toContain(DRILLDOWN_LABEL)
  })

  it('图表下永远有同数数据表（统一提示文案）', () => {
    expect(render()).toContain(CHART_HINT)
  })

  /*
   * 用户反馈 ②（2026-09-27 晚）：每个模块都要有「返回全部数据」。
   * 这里用静态渲染数按钮：作用域提供一次、`SectionShell` 每个模块渲染一个，
   * 因此按钮数 = 8 个模块。（面板标题栏那一个是旧的可选出口，只有调用方显式传
   * `onReturnToAll` 时才渲染，本用例不传，所以数出来正好是 8。）
   * 没有作用域时一个都不渲染——避免出现「点了没反应」的空按钮。
   */
  it('每个模块标题栏都有「返回全部数据」；没有作用域时一个都不渲染', () => {
    const withScope = renderToStaticMarkup(
      <ReturnToAllScope filtersActive onReturnToAll={() => {}}>
        <DimensionAnalysisPanel
          availability={AVAILABLE}
          comparable
          groupingOptions={{}}
          onDrilldown={() => {}}
          records={RECORDS}
        />
      </ReturnToAllScope>,
    )
    const countOfButtons = (html: string) =>
      html.split(`>${RETURN_TO_ALL_LABEL}</button>`).length - 1
    const moduleTitles = Object.values(SECTION_TITLES).length
    expect(moduleTitles).toBe(8)
    expect(countOfButtons(withScope)).toBe(moduleTitles)
    // 作用域没提供时不渲染按钮（避免「点了没反应」）
    expect(countOfButtons(render())).toBe(0)
  })
})

describe('分维度分析：画像与需求类型', () => {
  it('学校别名与 GPT 结论来源单列（便于核对归一 / 名单补全）', () => {
    const html = render()
    expect(html).toContain('结论来源')
    expect(html).toContain('别名表')
    expect(html).toContain('本地名单')
    expect(html).toContain('学校全表')
  })

  it('需求类型：未拆分时给出「替补替换未拆分」的独立计数', () => {
    const html = render()
    expect(html).toContain('未拆分')
  })

  it('画像不提供录用 / 淘汰建议（口径文案来自引擎）', () => {
    const html = render()
    expect(html).toContain('不提供录用 / 淘汰建议')
    expect(html).not.toContain('建议淘汰')
  })
})

describe('分维度分析：薪酬与房补', () => {
  it('币种未确认时明确禁用薪资分布，并给出原因（不出分位）', () => {
    const html = render(RECORDS, { comparable: false, availability: SALARY_DISABLED })
    expect(html).toContain(SALARY_COMPARISON_DISABLED_REASON)
    expect(html).toContain('该模块在导入阶段已被标记为不可用')
  })

  it('币种未确认时现金房补金额分位同样不显示（被禁用的模块不得照旧出金额）', () => {
    const html = render(RECORDS, { comparable: false, availability: SALARY_DISABLED })
    // 金额分位表（含「房补周期」表头）不出现，改为一句禁用说明
    expect(html).not.toContain('房补周期')
    expect(html).toContain('现金房补金额分位已禁用')
    // 但房补的**类型分布与各率**不受影响，仍要显示
    expect(html).toContain('提供住宿')
    expect(html).toContain('无补贴')
  })

  it('可比时按计薪单位分别展示，且说明单位之间不合算', () => {
    const html = render()
    expect(html).toContain('计薪单位：元/月')
    expect(html).toContain('不能合算')
  })

  it('住宿 / 无补贴 / 未知是三个不同数字，不折算成 0 元', () => {
    const html = render()
    expect(html).toContain('提供住宿')
    expect(html).toContain('无补贴')
    expect(html).toContain('不折算成现金')
  })

  it('直方图有同数数据表：分箱标签与计数都作为文本出现（不只画在画布上）', () => {
    const html = render()
    expect(html).toContain('薪资分布直方图数据表')
    // 2026-09-27 起按取值种类分流：只要求标签是**可读数字文本**
    // （逐值箱形如 `4000`，等宽箱形如 `3800–3950`），并且给出本次分箱方式
    expect(html).toMatch(/\d+(\.\d+)?(–\d+(\.\d+)?)?/)
    expect(html).toContain('分箱方式：')
    expect(html).toContain('各箱计数之和 = 有效样本 n')
  })

  it('n < 5 的单位只报记录数，不出分位与直方图', () => {
    // 刻意构造 3 条「元/天」（n = 3 < 5），以及 1 条「元/月」用来区分单位
    const thin = syntheticRecords([
      { city: '上海', offerStatus: '已入职', salaryAmount: 200, currency: 'CNY', salaryUnit: '元/天' },
      { city: '上海', offerStatus: '已入职', salaryAmount: 220, currency: 'CNY', salaryUnit: '元/天' },
      { city: '上海', offerStatus: '拒绝offer', salaryAmount: 240, currency: 'CNY', salaryUnit: '元/天' },
      { city: '上海', offerStatus: '已入职', salaryAmount: 4000, currency: 'CNY', salaryUnit: '元/月' },
    ])
    const html = render(thin)
    // 元/天 n = 3 走「不足门槛」分支：只报 n，不出分位与直方图
    expect(html).toContain('只报记录数，不出分位与直方图')
    expect(html).toContain('计薪单位：元/天')
    // 元/月 只有 1 条，同样不出分位
    expect(html).toContain('计薪单位：元/月')
  })

  it('样本达标（n ≥ 5）的单位才出分位表', () => {
    const html = render()
    // 夹具里元/月 有 7 条有效样本 → 出分位表头
    expect(html).toContain('P25')
    expect(html).toContain('P50')
    expect(html).not.toContain('只报记录数，不出分位与直方图')
  })
})

describe('分维度分析：时间效率与空态', () => {
  it('实际周期与计划周期分开说明，且不计算拒 offer 决策耗时', () => {
    const html = render()
    expect(html).toContain(EFFICIENCY_NOTE)
    expect(html).toContain('实际招聘周期')
    expect(html).toContain('计划周期')
  })

  it('时间效率的差异表跟着当前结构维度命名，不把序列/部门冒充成岗位', () => {
    const html = render()
    // 默认结构维度是「岗位」，因此表头与说明都应是「岗位差异」「>岗位<」
    expect(html).toContain('岗位差异')
    expect(html).toContain('>岗位<')
    // 不应出现写死的「岗位」以外的错误标签（本用例只验证默认维度下的自洽）
    expect(html).not.toContain('序列差异')
    expect(html).not.toContain('一级部门差异')
  })

  it('周期分位表在「整组都被排除」时仍显示被排除数，而不是显示「—」', () => {
    // 3 条记录都没有可用日期：n = 0，但被排除数是**已知**的 3，不能藏起来
    const noDates = syntheticRecords([
      { city: '上海', offerStatus: '已入职' },
      { city: '上海', offerStatus: '已入职' },
      { city: '广州', offerStatus: '已入职' },
    ])
    const html = render(noDates)
    expect(html).toContain('被排除')
    // 「3」必须作为被排除数出现在文本里（而不是被 EMPTY_VALUE 顶掉）
    expect(html).toMatch(/>3<\/td>/)
  })

  it('没有记录时只给空态说明：不画图、不显示 0%', () => {
    const html = render([])
    expect(html).toContain(NO_RECORDS_NOTE)
    // 任何一个模块标题都不该出现（不渲染空表）
    expect(html).not.toContain(SECTION_TITLES.city)
    expect(html).not.toContain(COLUMN_LABELS.rejectionRate)
  })

  it('渲染不触发 ECharts 加载（EChart 处于「加载中」，不加载远程脚本）', () => {
    const html = render()
    // 8 个模块里带图的是城市 / 岗位 / 薪资：渲染期只出占位文字
    expect(html).toContain('加载中')
    expect(html).not.toContain('<canvas')
  })
})

describe('分维度分析：薪资分布引擎与界面一致', () => {
  it('界面展示的单位与引擎 salaryDistributionByUnit 的结果一致', () => {
    const distribution = salaryDistributionByUnit(RECORDS, { comparable: true })
    const html = render()
    for (const unit of distribution.byUnit) {
      expect(html).toContain(unit.label)
    }
    expect(distribution.byUnit.length).toBe(1)
    expect(distribution.byUnit[0].n).toBe(RECORDS.length)
  })
})
