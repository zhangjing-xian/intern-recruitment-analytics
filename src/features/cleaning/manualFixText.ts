/**
 * 异常行清单与人工修正的界面文案（唯一来源，用户需求 ①，2026-09-27）。
 *
 * 两条纪律：
 * 1. 文案里**不得**出现会被逐字渲染的 Markdown 强调标记（`**` / `__`）——
 *    由 `features/privacy/uiTextGuard.test.ts` 全仓扫描守卫；
 * 2. 提示必须与事实一致：说清「改的是这份数据集里的值，不动源文件」，
 *    也要说清「报告里会注明有几处是人工改的」——不能让人以为报告里的数全是规则算出来的。
 */

export const WORKLIST_TITLE = '异常行清单（可以在这里直接改）'
export const WORKLIST_INTRO =
  '这里列出所有被标了问题的行。点某一行的「修改这一格」就能改值：改完会立刻按新值重新清洗（问题标记、质量统计、看板数字都会跟着变），并且可以随时撤销。源文件不会被改动。'

export const WORKLIST_ONLY_ISSUES_LABEL = '只看有问题的行'
export const WORKLIST_SEVERITY_LABEL = '按严重程度筛选'
export const WORKLIST_CODE_LABEL = '按问题类型筛选'
export const WORKLIST_ALL_OPTION = '全部'
export const WORKLIST_EMPTY_NOTE = '当前没有符合条件的异常行。'
export const WORKLIST_NO_ISSUES_NOTE = '这份数据没有发现任何问题行：逐行核对通过。'
export const WORKLIST_FIX_LABEL = '修改这一格'
export const WORKLIST_UNDO_LABEL = '撤销这处修改'
export const WORKLIST_APPLIED_LABEL = '已人工修改'
export const WORKLIST_COLUMNS = {
  row: '源文件行号',
  displayId: '代号',
  codes: '问题',
  fields: '涉及字段',
  fix: '操作',
} as const

export const FIX_DIALOG_TITLE = '人工修改这一格'
export const FIX_FIELD_LABEL = '要改的字段'
export const FIX_RAW_LABEL = '原值（源文件里写的）'
export const FIX_AUTO_LABEL = '自动清洗值（规则本来算出的）'
export const FIX_NEW_LABEL = '改成什么'
export const FIX_NEW_HINT = '留空表示「改成缺失」：缺失会显示「—」，绝不会写成 0。'
export const FIX_REASON_LABEL = '为什么这么改（必填）'
export const FIX_REASON_HINT =
  '这句话会跟着这处修改一起保存，方便以后（包括看报告的人）知道当时为什么改。'
export const FIX_SAVE_LABEL = '保存这处修改'
export const FIX_CANCEL_LABEL = '取消'
export const FIX_REASON_REQUIRED = '请填写修改原因：没有原因的话，过一段时间就没人知道为什么改了。'
export const FIX_NO_FIELDS_NOTE = '这行没有任何已映射的字段可以修改。'

export const CORRECTION_BANNER_TITLE = '这份数据里有 N 处人工修改'
export const CORRECTION_BANNER_NOTE =
  '人工修改的值不是规则算出来的：导出报告与 AI 摘要都会注明处数，展开该行可以看到「原值 / 自动清洗值 / 修正值 / 原因 / 时间」五栏。'
export const CORRECTION_STALE_NOTE =
  '有修正记录的源表与当前这份表不一致（表签名不同），因此一处都没有套用。请确认是否换过文件；确认后可以清空这些修正重新做。'
export const CORRECTION_CLEAR_ALL_LABEL = '清空全部人工修改'

export const SEVERITY_ORDER = ['阻断', '字段错误', '警告'] as const
