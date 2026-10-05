import { formatInteger } from '../../lib/format'
import { isPhraseConfirmed } from './vaultText'

type PhraseConfirmProps = {
  /** 必须原样输入的确认短语，由调用方给出（例如「清空业务数据」） */
  readonly phrase: string
  readonly value: string
  readonly busy: boolean
  /** 已输入字符数：用于「还差几个字符」的即时提示，不揭示短语本身 */
  readonly onChange: (value: string) => void
}

/**
 * 破坏性操作的确认输入（步骤6）。
 *
 * 为什么不用勾选框：勾选框会被顺手勾掉，而清空本地仓**不可撤销**。
 * 这里要求用户逐字输入短语（不含任何数据内容），确保动作本身是「想清楚了」的；
 * 已输入内容只存在组件内部状态里，不落盘、不打印。
 */
export default function PhraseConfirm({ phrase, value, busy, onChange }: PhraseConfirmProps) {
  const matched = isPhraseConfirmed(value, phrase)
  return (
    <label className="block space-y-1 text-xs text-slate-700">
      <span className="font-medium text-slate-900">
        请输入「{phrase}」以启用按钮（已输入 {formatInteger([...value].length)} /{' '}
        {formatInteger([...phrase].length)} 字符）
      </span>
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
        disabled={busy}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        type="text"
        value={value}
      />
      <span className={matched ? 'block text-emerald-700' : 'block text-slate-500'}>
        {matched ? '确认短语匹配，按钮已可用。' : '未匹配前按钮保持禁用，不会发生任何写入。'}
      </span>
    </label>
  )
}
