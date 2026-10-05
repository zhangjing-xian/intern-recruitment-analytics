/**
 * 领域枚举字典（唯一来源；字段口径见 docs/PRD.md 4.1 / 5.3，附件取值建议见 0.2）。
 *
 * 约定：
 * - 存储值使用中文业务值，便于报告、导出与用户核对；英文只用于「标准字段内部键」和代码标识；
 * - 每个枚举都包含 `未知`（缺失或无法识别）；能识别但不进入核心口径的归 `其他`；
 * - 枚举只能由字典命中，未识别的原值必须保留并提示核实（见 ./valueMappings.ts）：
 *   例如「审批通过」**不等于**候选人接受，不得自行归入接受类状态；
 * - 字典随 DICTIONARY_VERSION 变化，用户可扩充（如渠道字典），扩充后需重新生成报告。
 */

/** 缺失 / 无法识别 */
export const UNKNOWN = '未知'
/** 已识别但不纳入核心口径 */
export const OTHER = '其他'

/** 三值语义：true = 是，false = 否，null = 未知（缺失**不能**当作「否」） */
export type TriState = boolean | null

/* ------------------------------------------------------------------ offer 状态 */

export const JOINED_STATUS = '已入职'
export const PENDING_JOINING_STATUS = '待入职'
/** 「已送审批」统一映射到该值（docs/PRD.md 0.2 / 5.3），不得映射为待入职 */
export const AWAITING_APPROVAL_STATUS = 'offer审批中'
export const REJECTED_OFFER_STATUS = '拒绝offer'
export const REJECTED_VERBALLY_STATUS = '拒绝口头offer'

export const OFFER_STATUSES = [
  JOINED_STATUS,
  PENDING_JOINING_STATUS,
  AWAITING_APPROVAL_STATUS,
  REJECTED_OFFER_STATUS,
  REJECTED_VERBALLY_STATUS,
  OTHER,
  UNKNOWN,
] as const

export type OfferStatus = (typeof OFFER_STATUSES)[number]

/** 统计分组，对应恒等式 N = J + P + A + R1 + R2 + U（docs/PRD.md 6.1） */
export type OfferStatusGroup =
  | 'joined'
  | 'pending'
  | 'approving'
  | 'rejectedOffer'
  | 'rejectedVerbally'
  | 'other'
  | 'unknown'

export const OFFER_STATUS_GROUP_OF: Readonly<Record<OfferStatus, OfferStatusGroup>> = {
  '已入职': 'joined',
  '待入职': 'pending',
  'offer审批中': 'approving',
  '拒绝offer': 'rejectedOffer',
  '拒绝口头offer': 'rejectedVerbally',
  '其他': 'other',
  '未知': 'unknown',
}

const OFFER_STATUS_SET: ReadonlySet<string> = new Set<string>(OFFER_STATUSES)

/** 运行时校验并收窄到字典值（用于读取历史数据、AI 回填等外部输入） */
export function isOfferStatus(value: string): value is OfferStatus {
  return OFFER_STATUS_SET.has(value)
}

/** 接受 offer：状态 ∈ {已入职, 待入职}（接受 ≠ 实际入职） */
export const ACCEPTED_STATUSES: readonly OfferStatus[] = [JOINED_STATUS, PENDING_JOINING_STATUS]
/** 拒绝 offer：R = R1 + R2 */
export const REJECTED_STATUSES: readonly OfferStatus[] = [
  REJECTED_OFFER_STATUS,
  REJECTED_VERBALLY_STATUS,
]
/** 核心分母 D = J + P + R：**排除**审批中、其他、未知（docs/PRD.md 6.1） */
export const CORE_DENOMINATOR_STATUSES: readonly OfferStatus[] = [
  JOINED_STATUS,
  PENDING_JOINING_STATUS,
  REJECTED_OFFER_STATUS,
  REJECTED_VERBALLY_STATUS,
]

const ACCEPTED_SET: ReadonlySet<OfferStatus> = new Set<OfferStatus>(ACCEPTED_STATUSES)
const REJECTED_SET: ReadonlySet<OfferStatus> = new Set<OfferStatus>(REJECTED_STATUSES)
const CORE_SET: ReadonlySet<OfferStatus> = new Set<OfferStatus>(CORE_DENOMINATOR_STATUSES)

/** 是否接受 offer；其他 / 未知返回 null（既不是 true 也不是 false） */
export function isAcceptedStatus(status: OfferStatus): boolean | null {
  if (status === OTHER || status === UNKNOWN) {
    return null
  }
  return ACCEPTED_SET.has(status)
}

/** 是否拒 offer；其他 / 未知返回 null */
export function isRejectedStatus(status: OfferStatus): boolean | null {
  if (status === OTHER || status === UNKNOWN) {
    return null
  }
  return REJECTED_SET.has(status)
}

/** 是否计入核心分母 D（其他 / 未知 / 审批中一律为 false） */
export function countsTowardCoreDenominator(status: OfferStatus): boolean {
  return CORE_SET.has(status)
}

/* ------------------------------------------------------------------ 其它字段枚举 */

/** 需求类型：「替补/替换」不得自动拆分，统一落 `替补替换未拆分`（docs/PRD.md 0.2） */
export const UNSPLIT_REQUIREMENT_TYPE = '替补替换未拆分'

export const REQUIREMENT_TYPES = [
  '新增招聘',
  '替补',
  '替换',
  UNSPLIT_REQUIREMENT_TYPE,
  OTHER,
  UNKNOWN,
] as const
export type RequirementType = (typeof REQUIREMENT_TYPES)[number]

/** 招聘目标城市；其余城市归 `其他`，不静默并入三城（docs/PRD.md 0.2） */
export const TARGET_CITIES = ['上海', '广州', '杭州'] as const
export type TargetCity = (typeof TARGET_CITIES)[number]

export const CITIES = [...TARGET_CITIES, OTHER, UNKNOWN] as const
export type City = (typeof CITIES)[number]

/** Boss 渠道的标准写法（大小写统一，docs/PRD.md 0.2） */
export const BOSS_CHANNEL = 'Boss'

export const CHANNELS = ['官网', BOSS_CHANNEL, '实习僧', '内推', OTHER, UNKNOWN] as const
export type Channel = (typeof CHANNELS)[number]

/** 推荐类型与「渠道」是两个维度，禁止混同（docs/PRD.md 8 章） */
export const REFERRAL_TYPES = ['内推', 'HR推', OTHER, UNKNOWN] as const
export type ReferralType = (typeof REFERRAL_TYPES)[number]

export const HOUSING_NO_SUBSIDY = '无补贴'
export const HOUSING_CASH = '现金房补'
/** 住宿 ≠ 无补贴，也**不**折算成现金（docs/PRD.md 0.2 / 6.2） */
export const HOUSING_ACCOMMODATION = '提供住宿'

export const HOUSING_TYPES = [
  HOUSING_NO_SUBSIDY,
  HOUSING_CASH,
  HOUSING_ACCOMMODATION,
  OTHER,
  UNKNOWN,
] as const
export type HousingType = (typeof HOUSING_TYPES)[number]

export const HOUSING_PERIODS = ['月', '天', '次', OTHER] as const
export type HousingPeriod = (typeof HOUSING_PERIODS)[number]

export const EDUCATIONS = ['专科', '本科', '硕士', '博士', OTHER, UNKNOWN] as const
export type Education = (typeof EDUCATIONS)[number]

/** 导入页**必须**由用户确认的选项（docs/PRD.md 5.3） */
export const SALARY_UNIT_OPTIONS = ['人民币元/月', '人民币元/天', OTHER, '暂不确定'] as const
export type SalaryUnitOption = (typeof SALARY_UNIT_OPTIONS)[number]

/** 记录级计薪周期：混合单位不得直接聚合 */
export const SALARY_UNITS = ['元/月', '元/天', OTHER] as const
export type SalaryUnit = (typeof SALARY_UNITS)[number]

export const CURRENCIES = ['CNY', OTHER] as const
export type Currency = (typeof CURRENCIES)[number]

/** 导入模式：默认新建快照，不自动累计历史文件（docs/PRD.md 5.4） */
export const IMPORT_MODES = ['新建快照', '替换当前数据集', '追加'] as const
export type ImportMode = (typeof IMPORT_MODES)[number]

/** 去重策略：完全重复默认「每组保留首条」，但必须用户确认后才生效 */
export const DEDUP_STRATEGIES = ['保留全部', '确认后每组保留首条'] as const
export type DedupStrategy = (typeof DEDUP_STRATEGIES)[number]
