import { useState } from 'react'

import EmptyState from '../../components/EmptyState'
import { getImportSession } from '../../storage/sessionStore'
import MappingEditor from './MappingEditor'

/**
 * 字段映射页入口（步骤4）。
 *
 * 数据来源是步骤3 的解析结果，只存在于内存会话（`src/storage/sessionStore.ts`）：
 * 没有解析结果时给出明确空态并指回导入页，**不伪造**表头或样例。
 */
export default function MappingWorkspace() {
  /** 只在挂载时读一次：同一标签页内，映射页打开时解析结果不会变（换数据要重新解析） */
  const [session] = useState(() => getImportSession())

  if (session.sheet === null) {
    return (
      <EmptyState
        description="字段映射需要先有一份已解析的原始表。映射结果只是暂存配置，提交前不会写入本地仓，返回也不会丢失编辑。"
        items={[
          '源表头 → 标准字段的下拉映射，附每列样例与前 5 行预览',
          '匹配置信类型（精确 / 规范化 / 别名 / 模板 / 模糊 / 人工）与必填字段缺失清单',
          '缺 offer 状态列或存在目标列冲突时阻断提交，并给出冲突原因与处置方式',
        ]}
        nextStep={{ label: '先去导入数据', to: '/import' }}
        title="还没有可映射的表头"
      />
    )
  }

  return (
    <MappingEditor
      initialDraft={session.draft}
      initialMapping={session.confirmedMapping}
      sheet={session.sheet}
    />
  )
}
