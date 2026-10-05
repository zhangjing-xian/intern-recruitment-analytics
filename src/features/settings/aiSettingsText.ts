/**
 * AI 设置的展示文案（AI-3，纯常量 + 纯格式化）。
 *
 * 为什么文案要单独一层（与本项目其他 `*Text.ts` 同一约定）：
 * 1. 隐私与边界的说法必须**能被单测钉住**——「不承诺绝对安全」「不查余额」这类句子
 *    一旦被随手改成更强的承诺，测试应当失败；
 * 2. 同一句话在设置页、看板、隐私页三处必须一致，不能各写一遍
 *    （前几步已经因为「文案说 X、实现是 Y」踩过坑，见 D-061 的顺带修正）。
 */

import type { AiKeySnapshot } from '../../ai/keySession'
import { maskApiKey } from '../../ai/keySession'
import { AI_CATALOG_VERIFIED_AT, type AiKeyPermission } from '../../ai/catalog'
import { destinationLabelOf } from '../../ai/aiConfig'
import {
  normalizePositionCategoryRules,
  type PositionCategoryRule,
} from '../../privacy/aiSummary'

export const AI_SETTINGS_TITLE = 'AI 深度分析（可选）'
export const AI_SETTINGS_INTRO =
  'AI 深度分析是可选功能，默认关闭。它只在你主动点击看板的「AI 深度分析」、查看完整脱敏预览并逐次确认后，才会把本次的脱敏聚合摘要发往 DeepSeek，可能产生你自己的 API 费用。'

/**
 * AI 开关的两条边界。
 * 必须同时说清「打开≠永久授权」与「关闭不删东西」，否则用户会误以为
 * 打开开关等于授权自动调用、或以为关闭会顺手清掉 Key 与历史。
 */
export const AI_ENABLED_NOTE =
  '打开这个开关只是允许进入分析流程，不是永久授权：每次发送仍然要单独预览并确认，本应用不会「记住本次同意」。'
export const AI_DISABLED_KEEPS_NOTE =
  '关闭这个开关不会删除已保存的 Key，也不会删除 AI 历史——删除 Key 与清空历史是各自独立的操作。关闭后本地功能（导入、清洗、看板、拒 offer 专项、导出）完全不受影响，也不会产生任何外部请求。'

export const AI_SWITCH_ON = '开启 AI 深度分析'
export const AI_SWITCH_OFF = '关闭 AI 深度分析'

/* ------------------------------------------------------------------ Key */

export const AI_KEY_TITLE = 'API Key'
export const AI_KEY_HINT =
  'Key 由你自己提供，仅用于向 DeepSeek 认证。默认只放在内存里；勾选加密保存后才写入加密仓的独立秘密槽位。'

/**
 * Key 去向的如实说明。
 * 三句都必须说清：经谁的手、认证必然发送、以及**不承诺**绝对不外发
 * （PRD 10.1 明确禁止写成「绝不离开浏览器」）。
 */
export const AI_KEY_TRANSMISSION_NOTE =
  'Key 不经过本网站的服务器（本项目没有服务器）。但在发起请求时，Key 必然作为 Authorization 请求头发给 DeepSeek——因此不能说「Key 绝不离开设备」。'

export const AI_KEY_MEMORY_LABEL = '只在内存（默认，刷新或锁定即丢弃）'
export const AI_KEY_ENCRYPTED_LABEL = '加密保存在本地仓（需要先解锁；普通备份不含 Key）'
export const AI_KEY_INPUT_LABEL = '粘贴你的 DeepSeek API Key'
export const AI_KEY_INPUT_PLACEHOLDER = 'sk-…（输入框遮蔽显示）'
export const AI_KEY_SAVE_LABEL = '保存到内存'
export const AI_KEY_SAVE_ENCRYPTED_LABEL = '加密保存到本地仓'
export const AI_KEY_LOAD_LABEL = '从本地仓读入内存（本次会话可用）'
export const AI_KEY_DELETE_LABEL = '删除本地仓中的 Key'
export const AI_KEY_CLEAR_MEMORY_LABEL = '清空内存中的 Key'

export const AI_KEY_NO_FORMAT_CHECK_NOTE =
  '本应用不探活、不查余额、不查模型列表，也不验证 Key 是否有效——那需要在未确认的情况下发请求。这里只做「明显不像 Key」的本地检查。'

/** Key 当前状态的如实描述（**只显示掩码**，掩码由会话层给出） */
export function describeKeyState(input: {
  readonly session: AiKeySnapshot
  readonly persistedInVault: boolean
  readonly vaultUnlocked: boolean
}): string {
  const parts: string[] = []
  parts.push(
    input.session.present
      ? `内存中有一把 Key（保存时间 ${input.session.savedAt ?? '未知'}）`
      : '内存中没有 Key',
  )
  if (!input.vaultUnlocked) {
    parts.push('本地仓未解锁，因此看不到仓里是否存过 Key')
  } else {
    parts.push(input.persistedInVault ? '本地仓里存有一份加密的 Key' : '本地仓里没有存 Key')
  }
  return parts.join('；')
}

/** 掩码展示（**唯一入口**：界面拿不到明文） */
export function describeKeyMask(value: string): string {
  return maskApiKey(value)
}

/* ------------------------------------------------------------------ 许可 */

export const AI_PERMISSION_TITLE = 'Key 使用许可（按端点绑定）'

export function describeKeyPermission(
  permission: AiKeyPermission | null,
  destination: { readonly origin: string; readonly path: string },
): string {
  const target = destinationLabelOf(destination.origin, destination.path)
  if (permission === null) {
    return `尚未授权把 Key 发往任何地址。发送前会要求你确认目的地：${target}。`
  }
  if (permission.origin !== destination.origin) {
    return `已授权的地址是 ${permission.origin}，与当前目的地 ${destination.origin} 不一致：旧许可已失效，不会把 Key 转发到新地址。`
  }
  return `已授权把 Key 发往 ${permission.origin}（授权时间 ${permission.grantedAt}）。目标路径：${target}。`
}

/* ------------------------------------------------------------------ 目录与费用 */

export const AI_MODEL_TITLE = '模型与参数'
export const AI_MODEL_CATALOG_NOTE = `模型目录随本版本打包，核实日期 ${AI_CATALOG_VERIFIED_AT}，不联网获取、不自动切换。选择官方已停用或已下线的模型时会保留你的选择并提示兼容风险。`

export const AI_COST_TITLE = '费用'
export const AI_COST_NOTE =
  '费用由 DeepSeek 按 token 用量计费。本应用不查询余额，也无法在发送前得知确切费用，因此只给「上限估算」并写明假设。'

/* ------------------------------------------------------------------ 边界 */

export const AI_BOUNDARY_TITLE = '本页做不到的事（如实列出）'

export const AI_BOUNDARY_ITEMS: readonly string[] = [
  '不能保证 DeepSeek 是否保留或如何使用收到的内容；那适用它自己的服务条款与隐私规则。',
  '不能撤回已经发出去的内容：本地删除 Key、清空历史或取消请求，都不会让 DeepSeek 忘记已收到的摘要。',
  '不能保证本地清除是取证级擦除：内存里的 Key 由 JavaScript 管理，无法承诺物理层面的彻底抹除。',
  '不能保证浏览器直连一定成功：DeepSeek 是否允许本站 Origin 的跨域预检不由本应用决定，需要实测。',
  '不提供密码找回，也不提供云端备份：忘记本地仓密码只能用加密备份恢复或清空重建。',
]

/* ------------------------------------------------------------------ 三级脱敏（AI-6） */

export const AI_PRIVACY_SECTION_TITLE = '三级脱敏（默认标准级别）'
export const AI_PRIVACY_SECTION_INTRO =
  '脱敏级别决定载荷里允许出现哪些维度。这里保存的是默认级别；在看板的预览面板里仍可临时切换，但任何切换都会让旧确认失效，必须重新生成预览。'

/* ------------------------------------------------------------------ 本地规则与二次确认（AI-6） */

export const AI_SUBJECT_TITLE = 'AI 摘要使用的本地规则（需要你确认一次）'
export const AI_SUBJECT_INTRO =
  '下面三类取值不是原始数据，而是本地规则算出来的结论。它们会随摘要一起发出去，因此需要你在这里确认一次「这批规则可以用于摘要」；规则一改（换名单、改别名、改岗位类别映射、字典换版本），确认立即失效，必须重新确认。'
export const AI_SUBJECT_FINGERPRINT_LABEL = '规则指纹'
export const AI_SUBJECT_CONFIRM_LABEL = '确认这批规则可以用于摘要'
export const AI_SUBJECT_CONFIRMED_NOTE =
  '这批规则已确认。指纹相同才继续有效：任何一项规则变化都会让指纹改变，届时这里会重新显示为未确认，看板也会拒绝发送。'
export const AI_SUBJECT_UNCONFIRMED_NOTE =
  '这批规则尚未确认。未确认时仍然可以生成并逐字核对预览，但不会发出请求——这是刻意的前置条件，不是错误。'
export const AI_SUBJECT_STALE_NOTE =
  '之前确认的那批规则已经变了（指纹不同），旧确认不再有效。请重新核对下面的内容再确认一次。'

/* --------------------------------------------- 岗位类别映射（AI-6，本地查表） */

export const AI_POSITION_MAP_TITLE = '岗位类别映射（只在本机查表）'
export const AI_POSITION_MAP_HINT =
  '每行写「岗位写法=类别」。摘要在岗位维度上只会发出类别，岗位名称原文永远不会外发；精确比对（忽略空白与大小写），不做包含匹配、不做同义词推断。'
export const AI_POSITION_MAP_PLACEHOLDER = '例如：前端开发=研发'
export const AI_POSITION_MAP_EMPTY =
  '还没有配置映射：岗位维度会发出中性标签「有岗位记录」，不猜具体类别。'
export const AI_POSITION_MAP_INVALID_NOTE =
  '下列行不会生效（类别超过 12 个字、长得像编号、写法或类别为空、写法重复）：它们会被丢掉，而不是将就着发出去。'
export const AI_POSITION_MAP_MAX_NOTE = '映射最多 50 条。'

/* --------------------------------------------- 自有 / 本地代理（AI-6，PRD 18.6） */

export const AI_PROXY_TITLE = '高级：本地 / 自有代理（可选，默认不配置）'
export const AI_PROXY_INTRO =
  '只有在官方地址因为跨域（CORS）不可用时，才需要考虑自建代理。这一节只定义配置边界：本仓库不提供代理程序，也不由网站运营方托管代理。'
export const AI_PROXY_ADDRESS_LABEL = '代理地址（只填到主机，可带端口）'
export const AI_PROXY_ADDRESS_PLACEHOLDER = '例如：https://proxy.example.com 或 http://127.0.0.1:8787'
export const AI_PROXY_SAVE_LABEL = '登记这个地址'
export const AI_PROXY_CLEAR_LABEL = '取消登记（回到官方地址）'
export const AI_PROXY_CURRENT_LABEL = '当前请求目的地'
export const AI_PROXY_OFFICIAL_NOTE =
  '没有登记代理时，请求目的地就是官方端点 https://api.deepseek.com/chat/completions。'
export const AI_PROXY_ACK_REQUIRED_NOTE =
  '登记前必须逐条勾选下面的确认项：没勾完不会保存，也不会被使用。'

/* --------------------------------------------- AI 数据的独立删除动作（AI-6） */

export const AI_RETENTION_TITLE = 'AI 数据的删除动作（互不代替）'
export const AI_RETENTION_INTRO =
  '关闭 AI 开关不会删除任何东西；下面三个动作各自独立：清空 AI 历史只删历史，删除 Key 只删 Key，清空整个本地仓才两者都删（连招聘数据一起删）。'
export const AI_RETENTION_HISTORY_LABEL = '清空 AI 历史'
export const AI_RETENTION_HISTORY_NOTE =
  '只删除加密仓里的 AI 历史记录，招聘数据、清洗设置、映射模板与 API Key 都不受影响。历史一旦清空无法恢复，也没有云端副本。'
export const AI_RETENTION_KEY_POINTER =
  '删除 Key 在上面的「API Key」一节里（需要逐字输入确认短语），它不会删除 AI 历史与招聘数据。'
export const AI_RETENTION_ALL_POINTER =
  '清空全部（连招聘数据、Key 与 AI 历史一起删）在本页「清除数据的范围」一节里，需要逐字输入「清空本地仓」。'
export const AI_RETENTION_LOCKED_NOTE =
  '本地仓未解锁（或当前是临时模式）时不能删除历史：那些记录要么读不到、要么根本没落盘。先解锁本地仓再操作。'

/* --------------------------------------------- 目的地展示（AI-6） */

export const AI_DESTINATION_TITLE = '出站目的地与费用（发送前的固定提示）'

export function describeAiDestination(destination: {
  readonly origin: string
  readonly path: string
}): string {
  return `${destination.origin}${destination.path}`
}

/* ------------------------------------------------------------------ 文案清单 */

/* ------------------------------------------------- 岗位类别映射的文本解析（AI-6） */

/**
 * 多行文本 → 岗位类别映射规则。
 *
 * 与清洗页的别名解析同一套写法（`features/cleaning/settingsText.ts`）：
 * 每行 `写法=类别`，没有 `=` 的行直接进「未生效」清单，**不猜**哪边是类别。
 * 逐行解析而不是让界面自己 `split`：界面各自解析会出现「两处对同一份文本理解不同」。
 */
export type PositionCategoryParseResult = {
  readonly rules: readonly PositionCategoryRule[]
  /** 没生效的行（原文，供界面如实列出原因，不回显整份映射） */
  readonly invalidLines: readonly string[]
}

export function parsePositionCategoryLines(text: string): PositionCategoryParseResult {
  const raw: PositionCategoryRule[] = []
  const invalidLines: string[] = []
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed === '') {
      continue
    }
    const separator = trimmed.indexOf('=')
    if (separator <= 0) {
      invalidLines.push(trimmed)
      continue
    }
    const keyword = trimmed.slice(0, separator).trim()
    const category = trimmed.slice(separator + 1).trim()
    if (keyword === '' || category === '') {
      invalidLines.push(trimmed)
      continue
    }
    raw.push({ keyword, category })
  }
  const rules = normalizePositionCategoryRules(raw)
  if (rules.length !== raw.length) {
    // 被规范化丢掉的行（类别太长 / 像编号 / 写法重复）也要如实列出
    const kept = new Set(rules.map((rule) => `${rule.keyword}=${rule.category}`))
    for (const rule of raw) {
      const key = `${rule.keyword}=${rule.category}`
      if (!kept.has(key) && !invalidLines.includes(key)) {
        invalidLines.push(key)
      }
    }
  }
  return { rules, invalidLines }
}

/** 规则 → 多行文本（回填用，与 `parsePositionCategoryLines` 一一对应） */
export function formatPositionCategoryLines(
  rules: readonly PositionCategoryRule[],
): string {
  return rules.map((rule) => `${rule.keyword}=${rule.category}`).join('\n')
}

