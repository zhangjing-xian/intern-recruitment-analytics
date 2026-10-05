/**
 * 三级脱敏的设置项（AI-6，docs/PRD.md 18.5）。
 *
 * ## 为什么设置页也要有这一项（工作区里已经有了）
 *
 * 两处的职责不同，刻意都保留：
 * - **设置页**选的是**默认级别**：登录一次、改一次，之后每次打开看板都从这个默认值开始；
 * - **预览面板**里改的是**这一次**的级别，改完旧确认立即失效（那是 AI03 / AI09 的验收点）。
 *
 * 若只保留预览里的临时选择，用户每次分析都要重新点一遍；若只保留设置页的默认值，
 * 用户就没法在不改默认设置的前提下试一次更严格的级别。
 *
 * ## 边界
 *
 * 本组件**不做**白名单判断（哪些维度能发由 `privacy/aiSummary.ts` 决定），
 * 也不自己拼级别文案（级别说明与预览面板共用 `features/ai/aiText.ts` 的同一份常量）。
 */

import {
  AI_CUSTOM_DIMENSIONS_HINT,
  AI_CUSTOM_DIMENSIONS_LABEL,
  AI_CUSTOM_EMPTY_NOTE,
  AI_PRIVACY_LEVEL_HINT,
  AI_PRIVACY_LEVEL_LABEL,
  AI_PRIVACY_LEVEL_OPTIONS,
} from '../ai/aiText'
import { AI_DIMENSION_LABELS, AI_DIMENSIONS_BY_LEVEL, type AiAllowedDimension } from '../../privacy/aiSummary'
import type { PrivacyLevel } from '../../privacy/sanitize'
import { AI_PRIVACY_SECTION_INTRO, AI_PRIVACY_SECTION_TITLE } from './aiSettingsText'

type AiPrivacyLevelPanelProps = {
  readonly privacyLevel: PrivacyLevel
  readonly customDimensions: readonly AiAllowedDimension[]
  readonly busy: boolean
  readonly onChange: (level: PrivacyLevel, customDimensions: readonly AiAllowedDimension[]) => void
}

export default function AiPrivacyLevelPanel({
  privacyLevel,
  customDimensions,
  busy,
  onChange,
}: AiPrivacyLevelPanelProps) {
  /** 首次切到 custom 时给一份显式初值：让用户对着空清单猜是更糟的体验 */
  const dimensionsForCustom =
    customDimensions.length === 0 ? AI_DIMENSIONS_BY_LEVEL.standard : customDimensions

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-slate-900">{AI_PRIVACY_SECTION_TITLE}</h3>
        <p className="text-xs leading-5 text-slate-600">{AI_PRIVACY_SECTION_INTRO}</p>
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-800">{AI_PRIVACY_LEVEL_LABEL}</p>
        <p className="text-xs leading-5 text-slate-600">{AI_PRIVACY_LEVEL_HINT}</p>
        {(Object.keys(AI_PRIVACY_LEVEL_OPTIONS) as readonly PrivacyLevel[]).map((level) => (
          <label className="flex items-start gap-2 text-xs leading-5 text-slate-700" key={level}>
            <input
              checked={privacyLevel === level}
              className="mt-0.5"
              disabled={busy}
              name="ai-privacy-level-setting"
              onChange={() =>
                onChange(level, level === 'custom' ? dimensionsForCustom : customDimensions)
              }
              type="radio"
              value={level}
            />
            <span>
              <span className="font-medium text-slate-900">{AI_PRIVACY_LEVEL_OPTIONS[level].label}</span>
              ：{AI_PRIVACY_LEVEL_OPTIONS[level].description}
            </span>
          </label>
        ))}
      </div>

      {privacyLevel === 'custom' ? (
        <div className="space-y-1 rounded border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-800">{AI_CUSTOM_DIMENSIONS_LABEL}</p>
          <p className="text-xs leading-5 text-slate-600">{AI_CUSTOM_DIMENSIONS_HINT}</p>
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {AI_DIMENSIONS_BY_LEVEL.standard.map((dimension) => (
              <label
                className="flex items-center gap-2 text-xs leading-5 text-slate-700"
                key={dimension}
              >
                <input
                  checked={dimensionsForCustom.includes(dimension)}
                  disabled={busy}
                  onChange={() =>
                    onChange(
                      'custom',
                      dimensionsForCustom.includes(dimension)
                        ? dimensionsForCustom.filter((item) => item !== dimension)
                        : [...dimensionsForCustom, dimension],
                    )
                  }
                  type="checkbox"
                />
                <span>{AI_DIMENSION_LABELS[dimension]}</span>
              </label>
            ))}
          </div>
          {dimensionsForCustom.length === 0 ? (
            <p className="text-xs leading-5 text-amber-800">{AI_CUSTOM_EMPTY_NOTE}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
