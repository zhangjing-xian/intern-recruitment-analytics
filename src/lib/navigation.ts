/**
 * 全站导航与路由登记表（唯一来源）。
 *
 * - 布局导航、页面标题、页面职责说明都从这里读取，避免多处重复维护；
 * - 页面清单与 docs/PRD.md 第 7 章一致：导入、字段映射、清洗预览、分析看板、
 *   拒 offer 专项、报告导出、设置、隐私说明，以及新增的 AI 结果 / AI 历史；
 * - `plannedStep` 对应 docs/IMPLEMENTATION_PLAN.md 中的步骤编号，用于在骨架阶段
 *   明确标注“本页将在哪一步实现”，避免把空态误认为已完成功能。
 */

export type NavItem = {
  /** 路由路径（HashRouter 下的 hash 部分） */
  readonly path: string
  /** 导航与页面标题 */
  readonly label: string
  /** 页面职责说明（取自 PRD 第 7 章） */
  readonly summary: string
  /** 计划在实施计划的哪一步完成 */
  readonly plannedStep: string
}

/** 默认落地路由：首屏进入「导入」 */
export const DEFAULT_ROUTE = '/import'

export const NAV_ITEMS: readonly NavItem[] = [
  {
    path: '/import',
    label: '导入',
    summary:
      '读取 Excel（.xlsx/.xls）、CSV / TSV 或直接粘贴表格，生成原始数据集；默认为临时内存模式，关闭页面即清除。',
    plannedStep: '步骤3',
  },
  {
    path: '/mapping',
    label: '字段映射',
    summary:
      '把源表头映射到标准字段，展示样例预览、匹配置信类型与缺失清单；冲突时阻断，确认后才继续。',
    plannedStep: '步骤4',
  },
  {
    path: '/cleaning',
    label: '清洗预览',
    summary:
      '分页预览清洗结果、问题统计、城市与状态别名、薪资单位确认、重复对照；确认提交后才进入分析。',
    plannedStep: '步骤5',
  },
  {
    path: '/dashboard',
    label: '分析看板',
    summary:
      '统一筛选下的核心指标（N / J / P / A / R1 / R2 / U / D）、状态结构、时间趋势、质量提示与记录明细，以及右上角 AI 深度分析入口。',
    plannedStep: '步骤8–9',
  },
  {
    path: '/rejection',
    label: '拒 offer 专项',
    summary:
      '拒 offer 率与组间比较、拒绝原因分布、风险组合与证据表；带同分母提示、小样本标识与样本定位。',
    plannedStep: '步骤10',
  },
  {
    path: '/export',
    label: '报告导出',
    summary:
      '从唯一脱敏报告模型生成 Excel、PNG、打印 PDF 与 Markdown；默认只导出聚合结果，先做小组抑制再导出。',
    plannedStep: '步骤11',
  },
  {
    path: '/settings',
    label: '设置',
    summary:
      '加密本地仓与闲置自动锁定、去重策略与时间基准、AI 开关与 Key 管理、备份恢复与彻底清除。',
    plannedStep: '步骤6 / 步骤12',
  },
  {
    path: '/privacy',
    label: '隐私说明',
    summary:
      '这一页说明数据只留在本机浏览器、唯一的出站例外（可选 DeepSeek 调用）及其逐次确认条件、本地存储位置与共享边界、清除能做到与做不到什么，以及脱敏的能力边界。',
    plannedStep: '步骤12',
  },
  {
    path: '/ai/result',
    label: 'AI 结果',
    summary:
      '展示 DeepSeek 返回内容的安全 Markdown 渲染结果，并标注模型、时间、脱敏级别与实际发送范围。',
    plannedStep: 'AI-5',
  },
  {
    path: '/ai/history',
    label: 'AI 历史',
    summary:
      '仅保存在本地加密仓的调用历史：查看已发送摘要、导出、删除单条或清空；绝不自动重发。',
    plannedStep: 'AI-5',
  },
]

/** 按路径取导航项；未登记路径直接报错，防止页面与导航文案脱节 */
export function getNavItem(path: string): NavItem {
  const item = NAV_ITEMS.find((navItem) => navItem.path === path)
  if (item === undefined) {
    throw new Error(`未登记的导航路由：${path}`)
  }
  return item
}
