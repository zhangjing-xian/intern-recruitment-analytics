import { useState } from 'react'

import EmptyState from '../../components/EmptyState'
import { getCleaningSession, getImportSession } from '../../storage/sessionStore'
import CleaningEditor from './CleaningEditor'

/**
 * 清洗预览页入口（步骤5）。
 *
 * 输入是**已确认的字段映射** + 内存会话里的解析结果；两者缺一都给出明确空态并指回上一步，
 * **不**伪造数据、也不允许「先出结论再补确认」（未确认映射不得进入清洗）。
 */
export default function CleaningWorkspace() {
  /** 只在挂载时读一次：同一标签页内本页打开时输入不会变（换数据要重新导入并重新确认映射） */
  const [session] = useState(() => getImportSession())
  const [cleaning] = useState(() => getCleaningSession())

  if (session.sheet === null) {
    return (
      <EmptyState
        description="清洗只做规范化与校验，不删除记录：无法识别的行会保留并标记问题，最终以质量报告的形式告诉你哪几行需要人工确认。"
        items={[
          '前 100 行分页预览，清洗值与原值 / 命中规则逐列对照',
          '问题统计：缺必填、日期非法、薪资单位不明、疑似重复等',
          '城市 / 状态 / 学校别名确认，薪资单位与计薪周期确认，去重策略确认',
        ]}
        nextStep={{ label: '先去导入数据', to: '/import' }}
        title="还没有可清洗的数据"
      />
    )
  }

  if (session.confirmedMapping === null) {
    return (
      <EmptyState
        description="清洗必须以「已确认的字段映射」为输入。未确认时本页不会猜测列含义，也不会产出任何标准化结果。"
        items={[
          '未确认映射：不知道哪个源列是 offer 状态，任何率都会被算错',
          '映射确认后返回本页即可看到规范化结果与质量报告',
          '改设置或重新确认映射都会重算：结果始终与当时的输入对应',
        ]}
        nextStep={{ label: '先去确认字段映射', to: '/mapping' }}
        title="字段映射尚未确认"
      />
    )
  }

  return (
    <CleaningEditor
      initialSettings={cleaning.settings}
      mapping={session.confirmedMapping}
      sheet={session.sheet}
    />
  )
}
