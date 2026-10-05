/**
 * 生成一份**合成演示数据**（步骤11 收尾，给用户手工体验用）。
 *
 * 为什么用测试来生成：`TEMPLATE_COLUMNS` 是全项目唯一的 21 列契约来源，
 * 手写 TSV 一定会和它漂移（列序 / 表头名对不上，导入时就无法自动映射）。
 * 这里直接用同一份契约拼行，因此产物与「下载标准模板」的格式逐字节同源。
 *
 * 数据红线：**全部为人工构造的合成值**（AGENTS.md §2.6），不含任何真实姓名 / 薪资 / HR / 学校。
 * 产物写入 `_demo/`（该目录不进构建、不参与测试收集）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'

import { describe, it } from 'vitest'

import { TEMPLATE_COLUMNS, TEMPLATE_LINE_ENDING, TEMPLATE_SEPARATOR, type NormalizedRecord } from '../domain'
import { syntheticRecords, type SyntheticRecordInput } from '../domain/analytics/fixtures'

/* ------------------------------------------------------------------ 合成输入 */

const CITIES = ['上海', '广州', '杭州'] as const
const CHANNELS = ['Boss', '实习僧', '内推'] as const
const POSITIONS = ['数据分析实习生', '前端开发实习生', '产品运营实习生'] as const
const FAMILIES = ['数据', '技术', '产品'] as const
const DEPARTMENTS = ['示例事业部', '示例研发中心'] as const
const RECRUITERS = ['HR样例甲', 'HR样例乙'] as const
const SCHOOLS = ['合成大学', '示例理工大学', '样例师范大学'] as const
const REFERRERS = ['内推', '样例推荐人'] as const

/** 刻意做成「有拒 offer、有审批中、有待入职」，这样专项页与看板都有东西可看 */
const STATUS_PLAN = [
  ...Array.from({ length: 26 }, () => '已入职' as const),
  ...Array.from({ length: 4 }, () => '待入职' as const),
  ...Array.from({ length: 9 }, () => 'offer审批中' as const),
  ...Array.from({ length: 6 }, () => '拒绝offer' as const),
  ...Array.from({ length: 3 }, () => '拒绝口头offer' as const),
  '其他' as const,
  '未知' as const,
]

/** 拒 offer 的原因刻意留一部分为空 / 一部分是字典外的自由文本，用来演示两种提示 */
const REASONS = ['薪酬', '地点', '实习时间', '住房/住宿', null, null, '薪酬太低所以去了别家', null]

function buildInputs(): readonly SyntheticRecordInput[] {
  return STATUS_PLAN.map((status, index) => {
    const rejected = status === '拒绝offer' || status === '拒绝口头offer'
    const joined = status === '已入职'
    const startMonth = String((index % 6) + 1).padStart(2, '0')
    const startDay = String((index % 27) + 1).padStart(2, '0')
    const joiningDay = String(((index + 14) % 27) + 1).padStart(2, '0')
    return {
      requirementId: `REQ-${String(index + 1).padStart(4, '0')}`,
      recruiter: RECRUITERS[index % RECRUITERS.length],
      city: CITIES[index % CITIES.length],
      department: DEPARTMENTS[index % DEPARTMENTS.length],
      position: POSITIONS[index % POSITIONS.length],
      jobFamily: FAMILIES[index % FAMILIES.length],
      requirementType: index % 7 === 0 ? '替补替换未拆分' : '新增招聘',
      recruitmentStartDate: `2026-${startMonth}-${startDay}`,
      joiningDate: joined || status === '待入职' ? `2026-${startMonth}-${joiningDay}` : null,
      graduationYear: index % 2 === 0 ? 2027 : 2028,
      education: index % 3 === 0 ? '硕士' : '本科',
      school: SCHOOLS[index % SCHOOLS.length],
      isGptSchool: index % 4 === 0,
      referrer: REFERRERS[index % REFERRERS.length],
      referralType: index % 3 === 0 ? '内推' : 'HR推',
      channel: CHANNELS[index % CHANNELS.length],
      salaryAmount: 3500 + ((index % 6) * 300),
      currency: 'CNY',
      salaryUnit: '元/月',
      housingType: index % 5 === 0 ? '提供住宿' : index % 3 === 0 ? '现金房补' : '无补贴',
      housingAmount: index % 3 === 0 && index % 5 !== 0 ? 1500 : index % 5 === 0 ? null : 0,
      housingPeriod: index % 3 === 0 && index % 5 !== 0 ? '月' : null,
      offerStatus: status,
      rejectionReason: rejected ? (REASONS[index % REASONS.length] ?? null) : null,
    }
  })
}

/* ------------------------------------------------------------------ 取值 */

/**
 * 把一条规范化记录摊平成「模板列顺序」的文本行。
 * 日期字段输出 `YYYY-MM-DD`（导入端会按标准模板解析），其余按原值。
 */
function cellOf(record: NormalizedRecord, key: string): string {
  const value = (record as unknown as Record<string, unknown>)[key]
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否'
  }
  return String(value)
}

describe('生成演示数据', () => {
  it('写出 _demo/demo-intern-recruitment.tsv', () => {
    const records = syntheticRecords(buildInputs())
    const header = TEMPLATE_COLUMNS.map((column) => column.header).join(TEMPLATE_SEPARATOR)
    const lines = records.map((record) =>
      TEMPLATE_COLUMNS.map((column) => cellOf(record, column.key)).join(TEMPLATE_SEPARATOR),
    )
    const text = [header, ...lines].join(TEMPLATE_LINE_ENDING) + TEMPLATE_LINE_ENDING

    mkdirSync('_demo', { recursive: true })
    writeFileSync('_demo/demo-intern-recruitment.tsv', text, 'utf8')

    // 自检：列数一致、至少有一条拒 offer 与一条已入职（否则专项页没东西看）
    const columnCount = TEMPLATE_COLUMNS.length
    for (const line of [header, ...lines]) {
      if (line.split(TEMPLATE_SEPARATOR).length !== columnCount) {
        throw new Error(`列数不等于 ${String(columnCount)}：${line.slice(0, 80)}`)
      }
    }
    const plain = text
    if (!plain.includes('已入职') || !plain.includes('拒绝offer') || !plain.includes('offer审批中')) {
      throw new Error('演示数据缺少必要状态分布')
    }
  })
})
