import {
  buildSalarySetting,
  getStandardField,
  type CleaningSettings,
  type SalaryUnitOption,
} from '../../domain'
import {
  CLEANING_SETTING_HELP,
  DEFAULT_CYCLE_TOO_LONG_DAYS,
} from '../../cleaning'
import { formatInteger } from '../../lib/format'
import ConfigImpactPreview from './ConfigImpactPreview'
import { formatAliasLines, parseAliasLines, parseLineList } from './settingsText'

const SALARY_OPTIONS: readonly SalaryUnitOption[] = ['人民币元/月', '人民币元/天', '其他', '暂不确定']
const DATE_ORDER_OPTIONS: readonly { readonly value: '' | 'day-first' | 'month-first'; readonly label: string }[] = [
  { value: '', label: '未确认（歧义日期不转换，只提示）' },
  { value: 'day-first', label: '日/月/年（01/02/2026 = 2 月 1 日）' },
  { value: 'month-first', label: '月/日/年（01/02/2026 = 1 月 2 日）' },
]

/** 名单 / 别名的文本解析见 `./settingsText`：解析只拆行拆符号，不猜业务含义 */

type CleaningSettingsPanelProps = {
  readonly settings: CleaningSettings
  readonly onChange: (patch: Partial<CleaningSettings>) => void
  readonly onReset: () => void
  /**
   * 已提交数据集清洗时用的那份设置；没有已提交数据集时为 null。
   * 只用于「变更影响预览」：配置摘要与逐字段变更都由 `ConfigImpactPreview` 调引擎算，本面板不参与。
   */
  readonly committedSettings?: CleaningSettings | null
}

/**
 * 清洗口径设置（docs/PRD.md 5.2 / 5.3 / 5.4）。
 *
 * 每一项都直接写进 `CleaningSettings`，由 `cleanSheet` 统一消费：组件内**不**重复实现任何口径。
 * 默认值来自 `createDefaultCleaningSettings`（最保守起点）：薪资「暂不确定」、日月顺序未确认、
 * 隐藏行包含、表头回声行保留、去重「确认后每组保留首条」但未确认。
 *
 * 面板顶部固定显示**规则配置版本**与（有已提交数据集时）**变更影响预览**：
 * 改了名单 / 别名 / 去重策略就会换版本，用户必须在提交前看到这件事（PRD 10.5）。
 */
export default function CleaningSettingsPanel({
  settings,
  onChange,
  onReset,
  committedSettings = null,
}: CleaningSettingsPanelProps) {
  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">清洗口径确认</h2>
        <button
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 transition-colors hover:bg-slate-50"
          onClick={onReset}
          type="button"
        >
          恢复最保守默认值
        </button>
      </div>

      <ConfigImpactPreview committedSettings={committedSettings} settings={settings} />

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="space-y-1 text-xs text-slate-700">
          <span className="font-medium text-slate-900">分析截止日</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            onChange={(event) => {
              onChange({ dataAsOf: event.target.value })
            }}
            type="date"
            value={settings.dataAsOf}
          />
          <span className="block text-slate-500">{CLEANING_SETTING_HELP.dataAsOf}</span>
        </label>

        <label className="space-y-1 text-xs text-slate-700">
          <span className="font-medium text-slate-900">薪资计薪口径（默认 人民币元/月，可改）</span>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            onChange={(event) => {
              const option = event.target.value as SalaryUnitOption
              onChange({
                salary: buildSalarySetting(
                  option,
                  option === '暂不确定' ? null : new Date().toISOString(),
                ),
              })
            }}
            value={settings.salary.option}
          >
            {SALARY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <span className="block text-slate-500">
            {CLEANING_SETTING_HELP.salary}
            {/*
              三句必须互不相同且都与事实一致（用户反馈 ① 之后新增第一种情况）：
              默认值**不是**用户确认过的值，因此不能写成「确认于 …」；
              显示「未记录」会让人以为是自己确认漏了，所以单独说清是默认值。
            */}
            {settings.salary.comparable
              ? settings.salary.confirmedAt === null
                ? '（当前用的是默认值，还没有手动改过：名单里有按天计薪或外币的行时请在这里改）'
                : `（当前：${settings.salary.option}，确认于 ${settings.salary.confirmedAt}）`
              : '（当前未确认：待遇对比与低薪标签已禁用）'}
          </span>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <label className="space-y-1 text-xs text-slate-700">
          <span className="font-medium text-slate-900">歧义日期日月顺序</span>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            onChange={(event) => {
              const value = event.target.value
              onChange({
                ambiguousDateOrder: value === 'day-first' || value === 'month-first' ? value : null,
              })
            }}
            value={settings.ambiguousDateOrder ?? ''}
          >
            {DATE_ORDER_OPTIONS.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className="block text-slate-500">{CLEANING_SETTING_HELP.ambiguousDateOrder}</span>
        </label>

        <label className="space-y-1 text-xs text-slate-700">
          <span className="font-medium text-slate-900">导入模式</span>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            onChange={(event) => {
              const value = event.target.value
              onChange({
                importMode: value === '追加' || value === '替换当前数据集' ? value : '新建快照',
              })
            }}
            value={settings.importMode}
          >
            <option value="新建快照">新建快照</option>
            <option value="替换当前数据集">替换当前数据集</option>
            <option value="追加">追加</option>
          </select>
          <span className="block text-slate-500">{CLEANING_SETTING_HELP.importMode}</span>
        </label>

        <label className="space-y-1 text-xs text-slate-700">
          <span className="font-medium text-slate-900">长周期提示阈值（天）</span>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
            min={1}
            onChange={(event) => {
              const parsed = Number(event.target.value)
              onChange({
                cycleTooLongDays:
                  Number.isFinite(parsed) && parsed > 0
                    ? Math.floor(parsed)
                    : DEFAULT_CYCLE_TOO_LONG_DAYS,
              })
            }}
            type="number"
            value={settings.cycleTooLongDays}
          />
          <span className="block text-slate-500">{CLEANING_SETTING_HELP.cycleTooLongDays}</span>
        </label>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <fieldset className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          <legend className="px-1 text-sm font-semibold text-slate-900">重复记录处理</legend>
          <label className="block space-y-1">
            <span className="font-medium text-slate-900">策略</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              onChange={(event) => {
                onChange({
                  dedupStrategy:
                    event.target.value === '保留全部' ? '保留全部' : '确认后每组保留首条',
                })
              }}
              value={settings.dedupStrategy}
            >
              <option value="确认后每组保留首条">确认后每组保留首条（建议）</option>
              <option value="保留全部">保留全部（只标记，不减少样本）</option>
            </select>
          </label>
          <label className="flex items-start gap-2">
            <input
              checked={settings.dedupConfirmed}
              onChange={(event) => {
                onChange({ dedupConfirmed: event.target.checked })
              }}
              type="checkbox"
            />
            <span>
              我已确认上面的去重策略：只有确认后，重复行才会被标记为「按策略移除」并减少样本；
              未确认时全部保留待确认，样本数不减少。
            </span>
          </label>
          <p className="text-slate-500">{CLEANING_SETTING_HELP.dedupStrategy}</p>
        </fieldset>

        <fieldset className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          <legend className="px-1 text-sm font-semibold text-slate-900">行与列的取舍</legend>
          <label className="flex items-start gap-2">
            <input
              checked={settings.includeHiddenRows}
              onChange={(event) => {
                onChange({ includeHiddenRows: event.target.checked })
              }}
              type="checkbox"
            />
            <span>
              包含隐藏行（默认）：{CLEANING_SETTING_HELP.includeHiddenRows}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              checked={settings.dropHeaderEchoRows}
              onChange={(event) => {
                onChange({ dropHeaderEchoRows: event.target.checked })
              }}
              type="checkbox"
            />
            <span>
              剔除表头回声行（默认关闭，只提示）：{CLEANING_SETTING_HELP.dropHeaderEchoRows}
            </span>
          </label>
          {/*
            用户需求 ②（2026-09-27）：渠道缺失时按推荐人补成内推。
            默认关闭是硬约束（AGENTS §6 禁止「自动把 `-` 渠道判为内推」），
            因此这里必须是用户亲手勾选，且说明里写清「只补缺失、不覆盖已有值」。
          */}
          <label className="flex items-start gap-2">
            <input
              checked={settings.channelFromReferrer}
              onChange={(event) => {
                onChange({ channelFromReferrer: event.target.checked })
              }}
              type="checkbox"
            />
            <span>
              渠道缺失时按推荐人补成「内推」（默认关闭）：{CLEANING_SETTING_HELP.channelFromReferrer}
            </span>
          </label>
        </fieldset>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <fieldset className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          <legend className="px-1 text-sm font-semibold text-slate-900">
            {getStandardField('isGptSchool').header}判定
          </legend>
          <label className="block space-y-1">
            <span className="font-medium text-slate-900">判定方式</span>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              onChange={(event) => {
                onChange({
                  gptListMode: event.target.value === 'list-mode' ? 'list-mode' : 'raw-first',
                })
              }}
              value={settings.gptListMode}
            >
              <option value="raw-first">原值优先（缺失保持未知，不查名单）</option>
              <option value="list-mode">原值优先 + 本地名单补缺</option>
            </select>
          </label>
          <label className="flex items-start gap-2">
            <input
              checked={settings.gptListComplete}
              disabled={settings.gptListMode !== 'list-mode'}
              onChange={(event) => {
                onChange({ gptListComplete: event.target.checked })
              }}
              type="checkbox"
            />
            <span>
              我声明本地名单完整：只有声明后，「不在名单」才判为「否」，否则仍记为未知。
            </span>
          </label>
          <label className="block space-y-1">
            <span className="font-medium text-slate-900">
              本地名单（每行一所学校，当前 {formatInteger(settings.gptList.length)} 条）
            </span>
            <textarea
              className="h-24 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              disabled={settings.gptListMode !== 'list-mode'}
              onChange={(event) => {
                onChange({ gptList: parseLineList(event.target.value) })
              }}
              placeholder={'上海交通大学\n复旦大学'}
              value={settings.gptList.join('\n')}
            />
          </label>
          <p className="text-slate-500">{CLEANING_SETTING_HELP.gptListMode}</p>
        </fieldset>

        <fieldset className="space-y-2 rounded-md bg-slate-50 p-3 text-xs text-slate-700">
          <legend className="px-1 text-sm font-semibold text-slate-900">
            {getStandardField('school').header}别名归一
          </legend>
          <label className="block space-y-1">
            <span className="font-medium text-slate-900">
              每行一条「别名=规范名」（当前 {formatInteger(settings.schoolAliases.length)} 条）
            </span>
            <textarea
              className="h-24 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              onChange={(event) => {
                onChange({ schoolAliases: parseAliasLines(event.target.value) })
              }}
              placeholder={'上交=上海交通大学\n复旦=复旦大学'}
              value={formatAliasLines(settings.schoolAliases)}
            />
          </label>
          <p className="text-slate-500">{CLEANING_SETTING_HELP.schoolAliases}</p>
        </fieldset>
      </div>


    </section>
  )
}
