/**
 * 报告的**唯一取值层**（步骤11）：把 `SanitizedReport` 摊平成「章节 → 表格 → 行列」。
 *
 * 为什么要有这一层（PRD 11.2「三种格式使用同一筛选、同一数据版本、同一口径……避免数值不一致」）：
 * XLSX、Markdown、打印 HTML 三种格式如果各自去读 `report.kpis` / `report.dimensions`，
 * 只要有一处把 `null` 写成 0、把抑制写成 0%，三种格式就会出现不同的数字——而且很难被发现。
 * 因此：**读报告的地方只有这一处**，三种格式只负责把同一批行列排版出来。
 *
 * 两条不可退让的规则：
 * 1. **缺失 = `—`**：任何 `null` 都转成 `—`，绝不用 0 或 0% 代替（AGENTS.md §6）；
 * 2. **被抑制 = `—`**：抑制不是 0 人，也不是 0%，它在表格里就是「—」，并在备注里说明原因。
 *
 * 本层是纯函数：不依赖 React / DOM / 网络 / 存储。
 */

import type { SanitizedReport } from '../privacy'

/** 缺失值的统一占位符（与 `lib/format.ts` 的 `EMPTY_VALUE` 同字，但本层不依赖界面层） */
export const MISSING_TEXT = '—'

export type ReportTableCell = string | number

export type ReportTable = {
  readonly id: string
  readonly title: string
  readonly header: readonly string[]
  readonly rows: readonly (readonly ReportTableCell[])[]
  readonly notes: readonly string[]
  /** 关键指标（数值）行：Markdown / 打印版会加粗显示，XLSX 保持普通单元格 */
  readonly highlightRowIndexes: readonly number[]
}

export type ReportSectionContent = {
  readonly id: string
  readonly title: string
  readonly notes: readonly string[]
  readonly tables: readonly ReportTable[]
}

/** 数值 → 单元格；缺失一律 `—`（抑制也是缺失，因为抑制的输出就是 null） */
export function cellOfNumber(value: number | null): ReportTableCell {
  return value === null || !Number.isFinite(value) ? MISSING_TEXT : value
}

/** 比率 → 单元格：0.4 → `40.00%`；null → `—`（**绝不** 0.00%） */
export function cellOfPercent(value: number | null): ReportTableCell {
  if (value === null || !Number.isFinite(value)) {
    return MISSING_TEXT
  }
  return `${(value * 100).toFixed(2)}%`
}

/** 天数 / 一般小数 */
export function cellOfDecimal(value: number | null, digits = 2): ReportTableCell {
  if (value === null || !Number.isFinite(value)) {
    return MISSING_TEXT
  }
  return value.toFixed(digits)
}

function rateCell(value: number | null, suppressed: boolean, numerator: number, denominator: number): string {
  if (suppressed || denominator === 0) {
    return MISSING_TEXT
  }
  if (value === null) {
    return MISSING_TEXT
  }
  return `${(value * 100).toFixed(2)}%（${String(numerator)} ÷ ${String(denominator)}）`
}

/** 抑制状态列：让读表的人一眼看出「这里是 —，因为按脱敏口径不给这个数」 */
function suppressedCell(suppressed: boolean): string {
  return suppressed ? '已抑制' : '—'
}

/**
 * 把整份报告摊平成章节表格。
 *
 * 输出顺序与 `report.sections` 一致；每个章节的表结构固定，便于三种格式对照。
 * 明细表只在 `report.details.length > 0` 时出现（默认关闭，PRD 11.4）。
 */
export function reportToSections(report: SanitizedReport): readonly ReportSectionContent[] {
  const sections: ReportSectionContent[] = []

  const byId = new Map(report.sections.map((section) => [section.id, section]))
  const notesOf = (id: string): readonly string[] => byId.get(id)?.notes ?? []
  /**
   * 明细章节的说明**必须**在章节不存在时补一句。
   *
   * 为什么：读者看不到明细表时，无法区分「这次没开启明细」与「被抑制/被过滤掉了」。
   * 三种格式都读这一段，因此这条说明在 XLSX / Markdown / 打印版里必然一致。
   */
  const detailNote =
    report.details.length === 0
      ? '本次未开启记录级明细：只导出聚合结果。'
      : `本次包含 ${String(report.details.length)} 条记录级明细，仅使用报告内记录代号。`

  /* 1. 报告说明与口径快照 */
  sections.push({
    id: 'meta',
    title: byId.get('meta')?.title ?? '报告说明与口径快照',
    notes: notesOf('meta'),
    tables: [
      {
        id: 'meta.snapshot',
        title: '口径快照',
        header: ['项目', '内容'],
        rows: [
          ['报告标题', report.meta.title],
          ['生成时间', report.meta.generatedAt],
          ['数据截至日', report.meta.dataAsOf],
          ['去重策略', report.meta.dedupStrategy],
          ['清洗规则版本', report.meta.cleaningRuleVersion],
          ['分析规则版本', report.meta.analysisRuleVersion],
          ['隐私级别', report.meta.privacyLevel],
          [
            '生效筛选',
            report.meta.activeFilters.length === 0 ? '未启用筛选' : report.meta.activeFilters.join('；'),
          ],
          ['身份说明', report.contract.identityNote],
          ['抑制口径', report.meta.suppressionNote],
          ['使用限制', report.meta.limitationNote],
        ],
        notes: [],
        highlightRowIndexes: [],
      },
    ],
  })

  /* 2. 核心 KPI */
  sections.push({
    id: 'kpi',
    title: byId.get('kpi')?.title ?? '核心 KPI',
    notes: notesOf('kpi'),
    tables: [
      {
        id: 'kpi.list',
        title: '核心指标',
        header: ['指标', '数值', '分子', '分母', '口径说明'],
        rows: report.kpis.map((kpi) => [
          kpi.label,
          cellOfNumber(kpi.value),
          cellOfNumber(kpi.numerator),
          cellOfNumber(kpi.denominator),
          kpi.note,
        ]),
        notes: [],
        highlightRowIndexes: [],
      },
    ],
  })

  /* 3. 分维度分析 */
  sections.push({
    id: 'dimensions',
    title: byId.get('dimensions')?.title ?? '分维度分析',
    notes: notesOf('dimensions'),
    tables: report.dimensions.map((dimension) => ({
      id: `dimensions.${dimension.dimension}`,
      title: dimension.label,
      header: [
        '分组',
        'N',
        'J',
        'P',
        'A',
        'R',
        'D',
        '拒 offer 率（R ÷ D）',
        '率状态',
        '实际周期样本 n',
        '实际周期中位数区间',
        '平均实际周期（天）',
        '抑制状态',
      ],
      rows: dimension.groups.map((group) => [
        group.label,
        cellOfNumber(group.total),
        cellOfNumber(group.joined),
        cellOfNumber(group.pending),
        cellOfNumber(group.approving),
        cellOfNumber(group.rejected),
        cellOfNumber(group.coreDenominator),
        rateCell(
          group.rejectedRate.value,
          group.rejectedRate.suppressed,
          group.rejectedRate.numerator,
          group.rejectedRate.denominator,
        ),
        suppressedCell(group.rejectedRate.suppressed),
        group.cycle === null ? MISSING_TEXT : cellOfNumber(group.cycle.n),
        group.cycle?.medianBand ?? MISSING_TEXT,
        group.cycle === null ? MISSING_TEXT : cellOfDecimal(group.cycle.meanDays),
        suppressedCell(group.suppressed),
      ]),
      notes: [
        `合计 ${String(dimension.total)} 条；合并分组数 ${String(dimension.mergedGroupCount)}；被抑制分组数 ${String(dimension.suppressedGroupCount)}`,
        ...dimension.notes,
      ],
      highlightRowIndexes: [],
    })),
  })

  /* 4. 拒 offer 专项 */
  const reasonTotal = report.reasons.reduce((sum, reason) => sum + reason.count, 0)
  sections.push({
    id: 'rejection',
    title: byId.get('rejection')?.title ?? '拒 offer 专项',
    notes: notesOf('rejection'),
    tables: [
      {
        id: 'rejection.reasons',
        title: '拒 offer 原因分布（受控类别）',
        header: ['原因类别', '计数', '占比', '抑制状态'],
        rows: report.reasons.map((reason) => [
          reason.category,
          cellOfNumber(reason.suppressed ? null : reason.count),
          cellOfPercent(reason.share),
          suppressedCell(reason.suppressed),
        ]),
        notes: [
          `原因计数合计 ${String(reasonTotal)} 条（分母为全部拒 offer 记录 R，含「未填写」）`,
          '自由文本原因原文不导出：只保留受控类别，「未分类」与「未填写」分开计数',
        ],
        highlightRowIndexes: [],
      },
    ],
  })

  /* 5. 结论与行动建议 */
  sections.push({
    id: 'conclusions',
    title: byId.get('conclusions')?.title ?? '结论与行动建议',
    notes: notesOf('conclusions'),
    tables: [
      {
        id: 'conclusions.list',
        title: '规则结论（可回溯到规则 ID 与版本）',
        header: [
          '规则 ID',
          '规则版本',
          '级别',
          '结论',
          '命中条件',
          '未知条件',
          '建议核查事项',
          '适用范围',
        ],
        rows: report.conclusions.map((conclusion) => [
          conclusion.ruleId,
          conclusion.ruleVersion,
          conclusion.level,
          conclusion.text,
          conclusion.metConditions.length === 0 ? MISSING_TEXT : conclusion.metConditions.join('、'),
          conclusion.unknownConditions.length === 0
            ? MISSING_TEXT
            : conclusion.unknownConditions.join('、'),
          conclusion.suggestedCheck,
          conclusion.scopeNote,
        ]),
        notes: [],
        highlightRowIndexes: [],
      },
      {
        id: 'conclusions.advice',
        title: '行动建议',
        header: ['观察', '建议'],
        rows:
          report.advice.length === 0
            ? [[MISSING_TEXT, '本次没有可给出的行动建议（没有观察到明确证据）']]
            : report.advice.map((item) => [item.observation, item.advice]),
        notes: [],
        highlightRowIndexes: [],
      },
    ],
  })

  /* 6. 数据质量与限制 */
  sections.push({
    id: 'quality',
    title: byId.get('quality')?.title ?? '数据质量与限制',
    notes: notesOf('quality'),
    tables: [
      {
        id: 'quality.summary',
        title: '数据质量',
        header: ['项目', '内容'],
        rows: [
          ['保留行数', report.quality.keptRows],
          ['问题行数', report.quality.issueRows],
          ['未知与禁用模块', report.quality.unknownShareNote],
          [
            '有效样本说明',
            report.quality.effectiveSampleNotes.length === 0
              ? '没有模块被禁用'
              : report.quality.effectiveSampleNotes.join('；'),
          ],
        ],
        notes: [],
        highlightRowIndexes: [],
      },
      {
        id: 'quality.suppression',
        title: '抑制说明（本次导出实际做了什么）',
        header: ['位置', '原因', '影响分组数'],
        rows:
          report.suppression.length === 0
            ? [[MISSING_TEXT, '本次没有发生任何抑制', 0]]
            : report.suppression.map((note) => [note.path, note.reason, note.suppressedCount]),
        notes: ['抑制说明只写路径与原因，不包含被抑制分组的原标签'],
        highlightRowIndexes: [],
      },
    ],
  })

  /* 7. 记录级明细（默认关闭） */
  if (report.details.length > 0) {
    sections.push({
      id: 'details',
      title: byId.get('details')?.title ?? '记录级明细',
      notes: notesOf('details'),
      tables: [
        {
          id: 'details.list',
          title: '记录级明细（仅报告内记录代号）',
          header: ['记录代号', '状态', '城市', '渠道', '薪资区间', '实际周期（天）', '周期分桶'],
          rows: report.details.map((detail) => [
            detail.recordCode,
            detail.status,
            detail.city ?? MISSING_TEXT,
            detail.channel ?? MISSING_TEXT,
            detail.salaryBand ?? MISSING_TEXT,
            cellOfNumber(detail.cycleDays),
            detail.cycleBand ?? MISSING_TEXT,
          ]),
          notes: [
            '记录代号在同一文件内稳定、跨报告重建，没有跨批次身份含义；对照表不导出',
          ],
          highlightRowIndexes: [],
        },
      ],
    })
  }

  // 末章：导出说明（明细是否包含 + 使用限制）。三种格式都读这一段，
  // 因此「文件里为什么没有明细表」在任何格式里都有同一句解释。
  sections.push({
    id: 'export.notes',
    title: '导出说明',
    notes: [],
    tables: [
      {
        id: 'export.notes.list',
        title: '本次导出内容',
        header: ['项目', '内容'],
        rows: [
          ['记录级明细', detailNote],
          ['使用限制', report.meta.limitationNote],
          ['缺失值口径', '缺失值一律显示 —；分母为 0 或按脱敏口径被抑制的数值也显示 —，不代表 0。'],
        ],
        notes: [],
        highlightRowIndexes: [],
      },
    ],
  })

  return sections
}

/** 扁平预览行：界面与「导出前先看预览」用它，内容与导出文件一一对应 */
export function previewLinesOf(
  sections: readonly ReportSectionContent[],
  limit = 200,
): readonly string[] {
  const lines: string[] = []
  for (const section of sections) {
    lines.push(section.title)
    for (const table of section.tables) {
      lines.push(`【${table.title}】${table.header.join(' | ')}`)
      lines.push(`共 ${String(table.rows.length)} 行`)
      if (lines.length >= limit) {
        return lines.slice(0, limit)
      }
    }
  }
  return lines
}

/** 导出内容里出现的全部字符串（用于本地敏感字段检查；数值不参与检查） */
export function textValuesOf(sections: readonly ReportSectionContent[]): readonly string[] {
  const values: string[] = []
  for (const section of sections) {
    values.push(section.title, ...section.notes)
    for (const table of section.tables) {
      values.push(table.title, ...table.header, ...table.notes)
      for (const row of table.rows) {
        for (const cell of row) {
          if (typeof cell === 'string') {
            values.push(cell)
          }
        }
      }
    }
  }
  return values
}
