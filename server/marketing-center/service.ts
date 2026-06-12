import prisma from '../db/prisma'
import { invalidateRedisCachePatterns, invalidateRedisCaches } from '../redis/cache-manager'
import { getOrSetJsonCache } from '../redis/json-cache'
import { redisKeys } from '../redis/keys'
import {
  applyCapabilityFlags,
  type ModelCapabilityFlags,
  type ModelCapabilitySpec,
} from '../../src/shared/provider-capability'

const MARKETING_CENTER_OVERVIEW_SCOPE = 'marketing-center-overview'
const MARKETING_CENTER_GUEST_OVERVIEW_CACHE_KEY = redisKeys.cache(MARKETING_CENTER_OVERVIEW_SCOPE, 'guest')
const MARKETING_CENTER_OVERVIEW_CACHE_PATTERN = redisKeys.cache(MARKETING_CENTER_OVERVIEW_SCOPE, '*')
const buildMarketingCenterUserOverviewCacheKey = (userId: string) => {
  return redisKeys.cache(MARKETING_CENTER_OVERVIEW_SCOPE, `user:${userId}`)
}

const buildSerialNo = (prefix: string) => {
  const now = new Date()
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  const timestamp = now.getFullYear()
    + pad(now.getMonth() + 1)
    + pad(now.getDate())
    + pad(now.getHours())
    + pad(now.getMinutes())
    + pad(now.getSeconds())
    + pad(now.getMilliseconds(), 3)
  const random = Math.random().toString(36).slice(2, 8).toUpperCase()
  return prefix + timestamp + random
}

const startOfToday = () => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

const formatDateKey = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

const formatMonthKey = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return date.getFullYear() + '-' + pad(date.getMonth() + 1)
}

const formatWeekKey = (date: Date) => {
  const current = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNumber = current.getUTCDay() || 7
  current.setUTCDate(current.getUTCDate() + 4 - dayNumber)
  const yearStart = new Date(Date.UTC(current.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil((((current.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return String(current.getUTCFullYear()) + '-W' + String(weekNo).padStart(2, '0')
}

// Prisma Decimal 在用户侧接口里也统一转成字符串金额，保证与后台返回格式一致。
const isDecimalLike = (value: unknown): value is { toNumber?: () => number; toString: () => string } => {
  return Boolean(
    value
    && typeof value === 'object'
    && (
      typeof (value as { toNumber?: () => number }).toNumber === 'function'
      || (value as { constructor?: { name?: string } }).constructor?.name === 'Decimal'
    ),
  )
}

// 将用户侧营销接口返回中的 BigInt / Decimal 递归转换为可序列化值。
const serializeMarketingCenterRecord = <T>(value: T): T => {
  if (typeof value === 'bigint') {
    return Number(value) as T
  }

  if (isDecimalLike(value)) {
    return value.toString() as T
  }

  // Date 需要优先转成 ISO 字符串，否则继续走对象递归时会被展开成空对象。
  if (value instanceof Date) {
    return value.toISOString() as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeMarketingCenterRecord(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, serializeMarketingCenterRecord(item)]),
    ) as T
  }

  return value
}

const buildCyclePrefix = (cycleType: string, now = new Date()) => {
  if (cycleType === 'DAILY') return formatDateKey(now)
  if (cycleType === 'WEEKLY') return formatWeekKey(now)
  if (cycleType === 'MONTHLY') return formatMonthKey(now)
  return 'ONCE'
}

export const invalidateMarketingCenterOverviewCache = async (userId?: string | null) => {
  const normalizedUserId = String(userId || '').trim()
  if (normalizedUserId) {
    await invalidateRedisCaches([buildMarketingCenterUserOverviewCacheKey(normalizedUserId)])
    return
  }

  await invalidateRedisCachePatterns([MARKETING_CENTER_OVERVIEW_CACHE_PATTERN])
}

// BuildingAI 风格会员计费规则。
const parseMembershipPlanConfig = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    return {
      benefits: Array.isArray(record.benefits) ? record.benefits : [],
      billing: Array.isArray(record.billing) ? record.billing : [],
    }
  }

  return {
    benefits: Array.isArray(value) ? value : [],
    billing: [],
  }
}

const normalizeMembershipBillingRule = (item: Record<string, unknown>) => ({
  levelId: String(item.levelId || '').trim(),
  salesPrice: Number(item.salesPrice || 0),
  originalPrice: item.originalPrice === null || item.originalPrice === undefined || String(item.originalPrice || '').trim() === '' ? null : Number(item.originalPrice),
  label: String(item.label || '').trim() || null,
  status: item.status === false ? false : true,
})

// 一个计划可以展开为多个前台套餐卡片。
const expandMembershipPlansByBilling = (plans: any[], levels: any[]) => {
  const levelMap = new Map(levels.map((item) => [item.id, item]))

  return plans.flatMap((plan) => {
    const config = parseMembershipPlanConfig(plan.benefitsJson)
    const billingRules = (Array.isArray(config.billing) ? config.billing : [])
      .map((item) => normalizeMembershipBillingRule(item as Record<string, unknown>))
      .filter((item) => item.levelId && item.status)

    return billingRules.map((rule, index) => ({
      ...plan,
      id: `${plan.id}::${rule.levelId}`,
      planId: plan.id,
      levelId: rule.levelId,
      label: rule.label || plan.label,
      salesPrice: rule.salesPrice,
      originalPrice: rule.originalPrice,
      level: levelMap.get(rule.levelId) || null,
      benefitsJson: config.benefits,
      billingIndex: index,
      billingRules,
    }))
  })
}

const parsePlanPurchaseSelection = (value: string) => {
  const [planId, levelId] = String(value || '').split('::')
  return {
    planId: String(planId || '').trim(),
    levelId: String(levelId || '').trim(),
  }
}

const readCurrentPointBalance = async (userId: string, tx: typeof prisma | any = prisma) => {
  const latestLog = await tx.pointAccountLog.findFirst({
    where: { userId },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  })
  return latestLog?.balanceAfter || 0
}

// 在事务内对用户主表加行锁，串行化同一用户的积分账本写入。
// 必须在事务开头调用，且后续的余额读取/写入必须使用同一个 tx。
// 解决问题：原实现仅靠 prisma.$transaction 的原子性，并发扣点会读到相同 balanceAfter 导致超扣。
// 串行化某用户的积分账本写入：事务开头对其 app_users 行加 FOR UPDATE 行锁。
// 消费/退款/结算与后台调账都应先调用它，避免并发下 balanceAfter 链断裂。
export const lockUserBillingRow = async (tx: any, userId: string) => {
  await tx.$queryRaw`SELECT id FROM app_users WHERE id = ${userId} FOR UPDATE`
}

const appendPointLog = async (tx: any, input: {
  userId: string
  changeType: any
  action: any
  changeAmount: number
  sourceType: any
  sourceId?: string | null
  rechargeOrderId?: string | null
  subscriptionId?: string | null
  associationNo?: string | null
  remark?: string | null
  metaJson?: unknown
  // 幂等去重键：唯一，写重复直接抛 P2002（由调用方决定是否静默吞掉）。
  dedupeKey?: string | null
}) => {
  const currentBalance = await readCurrentPointBalance(input.userId, tx)
  const nextBalance = input.action === 'DECREASE'
    ? currentBalance - Math.abs(input.changeAmount)
    : currentBalance + Math.abs(input.changeAmount)

  return tx.pointAccountLog.create({
    data: {
      userId: input.userId,
      subscriptionId: input.subscriptionId || null,
      rechargeOrderId: input.rechargeOrderId || null,
      accountNo: buildSerialNo('PTS'),
      changeType: input.changeType,
      action: input.action,
      changeAmount: Math.abs(input.changeAmount),
      balanceAfter: nextBalance,
      availableAmount: nextBalance,
      sourceType: input.sourceType,
      sourceId: input.sourceId || null,
      associationNo: input.associationNo || null,
      remark: input.remark || null,
      dedupeKey: input.dedupeKey || null,
      metaJson: (input.metaJson ?? null) as any,
    },
  })
}


// 对话按 token 分档单价（积分 / 1k token）+ 按次保底 power。
export interface ModelBillingRule {
  power: number
  inputPricePer1k: number
  outputPricePer1k: number
  cachedPricePer1k: number
}

// 从模型 defaultParamsJson.billingRule 解析出归一化计费规则；缺失字段一律按 0。
export const readModelBillingRule = (value: unknown): ModelBillingRule => {
  const empty: ModelBillingRule = { power: 0, inputPricePer1k: 0, outputPricePer1k: 0, cachedPricePer1k: 0 }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return empty
  }
  const billingRule = (value as Record<string, unknown>).billingRule
  if (!billingRule || typeof billingRule !== 'object' || Array.isArray(billingRule)) {
    return empty
  }
  const rule = billingRule as Record<string, unknown>
  const num = (v: unknown) => Math.max(0, Number(v || 0) || 0)
  return {
    power: num(rule.power),
    inputPricePer1k: num(rule.inputPricePer1k),
    outputPricePer1k: num(rule.outputPricePer1k),
    cachedPricePer1k: num(rule.cachedPricePer1k),
  }
}

const readModelBillingPower = (value: unknown) => readModelBillingRule(value).power

// 对话按真实 usage 分档计费：非缓存输入 / 输出 / 缓存命中 各自单价。
// 语义按 OpenAI：cachedTokens 是 promptTokens 的子集，故非缓存输入 = prompt - cached（clamp >=0）。
// 任一单价缺省为 0（如缓存档未配或上游未返回缓存数）则该档免费，自动降级。
export const resolveChatPointCostByUsage = (input: {
  usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number } | null
  billingRule: ModelBillingRule
  billingMultiplier?: number
}) => {
  const usage = input.usage || {}
  const rule = input.billingRule
  const mult = input.billingMultiplier && input.billingMultiplier > 0 ? input.billingMultiplier : 1

  const promptTokens = Math.max(0, Number(usage.promptTokens || 0))
  const completionTokens = Math.max(0, Number(usage.completionTokens || 0))
  const cachedTokens = Math.min(promptTokens, Math.max(0, Number(usage.cachedTokens || 0)))
  const nonCachedInput = Math.max(0, promptTokens - cachedTokens)

  const inputPoints = (nonCachedInput / 1000) * rule.inputPricePer1k
  const cachePoints = (cachedTokens / 1000) * rule.cachedPricePer1k
  const outputPoints = (completionTokens / 1000) * rule.outputPricePer1k
  const pointCost = Math.max(0, Math.ceil((inputPoints + cachePoints + outputPoints) * mult))

  return {
    pointCost,
    breakdown: {
      inputTokens: nonCachedInput,
      cachedTokens,
      outputTokens: completionTokens,
      inputPoints: Math.round(inputPoints * mult * 100) / 100,
      cachePoints: Math.round(cachePoints * mult * 100) / 100,
      outputPoints: Math.round(outputPoints * mult * 100) / 100,
    },
  }
}

// 读取后台模型配置中的积分消耗规则，统一给生成链路使用。
// capabilityFlags 用于"联网搜索 / 深度思考"等扩展能力开关，按 capabilityJson 配置的
// billingMultiplier 放大基础点数，让额外成本能反映在用户扣点上。
// 查询用户「当前有效会员等级」：状态 ACTIVE 且未到期，取等级最高的一条。无则 null。
export const getUserActiveMembership = async (userId: string) => {
  const uid = String(userId || '').trim()
  if (!uid) return null
  const subscription = await prisma.userSubscription.findFirst({
    where: { userId: uid, status: 'ACTIVE', endTime: { gt: new Date() } },
    orderBy: { level: { level: 'desc' } },
    select: {
      levelId: true,
      level: {
        select: { id: true, name: true, level: true, pointDiscountPercent: true },
      },
    },
  })
  if (!subscription?.level) return null
  const percent = Math.min(100, Math.max(0, Number(subscription.level.pointDiscountPercent || 0)))
  return {
    levelId: subscription.level.id,
    levelName: subscription.level.name,
    levelValue: subscription.level.level,
    pointDiscountPercent: percent,
    // 折扣倍率：减免 percent% → 实扣 (100-percent)/100。
    discountMultiplier: (100 - percent) / 100,
  }
}

// 会员折扣倍率：无有效会员或无折扣时为 1。用于乘进扣点。
export const getMembershipBillingMultiplier = async (userId: string): Promise<number> => {
  const membership = await getUserActiveMembership(userId)
  return membership ? membership.discountMultiplier : 1
}

// 模型按会员等级解锁：读 model.defaultParamsJson.membershipLevels（等级名/等级值数组，空=不限）。
// 命中用户当前等级名(忽略大小写) 或 等级数值 即放行。
export const checkUserModelMembershipAccess = async (input: {
  userId: string
  providerId: string
  modelKey: string
  endpointType: 'chat' | 'image' | 'video'
}): Promise<{ allowed: boolean; requiredLevelNames: string[] }> => {
  const providerId = String(input.providerId || '').trim()
  const modelKey = String(input.modelKey || '').trim()
  const category = String(input.endpointType || '').trim().toUpperCase()
  if (!providerId || !modelKey) return { allowed: true, requiredLevelNames: [] }

  const model = await prisma.aiModel.findFirst({
    where: { providerId, modelKey, category: category as any, isEnabled: true },
    select: { defaultParamsJson: true },
  })
  const raw = (model?.defaultParamsJson as Record<string, unknown> | null)?.membershipLevels
  const requiredLevelNames = Array.isArray(raw)
    ? raw.map((v) => String(v || '').trim()).filter(Boolean)
    : []
  if (!requiredLevelNames.length) {
    return { allowed: true, requiredLevelNames: [] }
  }

  const membership = await getUserActiveMembership(input.userId)
  if (!membership) {
    return { allowed: false, requiredLevelNames }
  }
  const userLevelName = membership.levelName.trim().toLowerCase()
  const userLevelValue = String(membership.levelValue)
  const allowed = requiredLevelNames.some((name) => name.toLowerCase() === userLevelName || name === userLevelValue)
  return { allowed, requiredLevelNames }
}

export const resolveGenerationPointCost = async (input: {
  providerId: string
  modelKey: string
  endpointType: 'chat' | 'image' | 'video'
  capabilityFlags?: ModelCapabilityFlags | null
  // 视频按秒计费：传入时长秒数，power 视为「每秒积分」并乘以秒数。
  // 不传 / 非视频时按次（乘数为 1），与图片、对话行为一致。
  durationSeconds?: number
  // 图片按张计费：本次出图张数，power 视为「每张积分」并乘以张数（服务端按 maxImagesPerRequest clamp）。
  imageCount?: number
  // 会员折扣倍率（0,1]：例如 8 折传 0.8。缺省 1（无折扣）。
  membershipMultiplier?: number
}) => {
  const providerId = String(input.providerId || '').trim()
  const modelKey = String(input.modelKey || '').trim()
  const category = String(input.endpointType || '').trim().toUpperCase()

  if (!providerId || !modelKey || (category !== 'CHAT' && category !== 'IMAGE' && category !== 'VIDEO')) {
    return {
      pointCost: 0,
      modelId: '',
      modelName: '',
    }
  }

  const model = await prisma.aiModel.findFirst({
    where: {
      providerId,
      modelKey,
      category: category as any,
      isEnabled: true,
    },
    select: {
      id: true,
      name: true,
      defaultParamsJson: true,
      capabilityJson: true,
    },
  })

  if (!model) {
    return {
      pointCost: 0,
      modelId: '',
      modelName: '',
    }
  }

  // 基础点数。
  const basePointCost = readModelBillingPower(model.defaultParamsJson)

  // 应用能力开关倍率（联网/深度思考通常更贵），未配置或不支持则倍率为 1。
  const capabilitySpec = (() => {
    const value = model.capabilityJson
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as ModelCapabilitySpec
  })()
  const applied = applyCapabilityFlags(input.capabilityFlags || null, capabilitySpec)

  // 视频按秒计费：power 为「每秒积分」，乘以本次时长（秒）。
  // 对话维持按次（乘数为 1）。秒数做安全 clamp 到 [1, 60]，缺失则退化为 1（按次）。
  const durationMultiplier = category === 'VIDEO'
    ? Math.min(60, Math.max(1, Math.round(Number(input.durationSeconds) || 1)))
    : 1

  // 图片按张计费：power 为「每张积分」，乘以本次出图张数。
  // 张数服务端 clamp 到 [1, maxImagesPerRequest]（不信任前端），未配置上限按 1（即按次）。
  const maxImagesPerRequest = (() => {
    const value = (model.capabilityJson as Record<string, unknown> | null)?.maxImagesPerRequest
    const num = Number(value)
    return Number.isFinite(num) && num >= 1 ? Math.floor(num) : 1
  })()
  const imageMultiplier = category === 'IMAGE'
    ? Math.min(maxImagesPerRequest, Math.max(1, Math.round(Number(input.imageCount) || 1)))
    : 1

  // 会员折扣倍率（0,1]，缺省 1。
  const membershipMultiplier = input.membershipMultiplier && input.membershipMultiplier > 0
    ? Math.min(1, input.membershipMultiplier)
    : 1
  const finalPointCost = Math.max(0, Math.ceil(basePointCost * durationMultiplier * imageMultiplier * (applied.billingMultiplier || 1) * membershipMultiplier))

  return {
    pointCost: finalPointCost,
    modelId: model.id,
    modelName: model.name,
  }
}

// 在真正发起对话/图片/视频生成前扣减积分，并落一条可追踪的消费流水。
export const consumeGenerationPoints = async (input: {
  userId: string
  pointCost: number
  sourceId: string
  associationNo: string
  endpointType: 'chat' | 'image' | 'video'
  providerId: string
  modelKey: string
  modelName?: string
  metaJson?: unknown
  // 结算补扣专用：内容已交付，余额不足也不应失败，允许扣成负值（schema 允许 balanceAfter 负）。
  allowNegativeBalance?: boolean
  // 覆盖默认流水备注（如"对话结算补扣"）。
  remark?: string
  // 幂等去重键（如 'gen-recharge:<associationNo>' / 'gen-settle-consume:<associationNo>'）：
  // 同一逻辑扣费至多一次；重复触发唯一冲突会被静默吞掉（返回 null），跨重试/续询/结算安全。
  dedupeKey?: string
}) => {
  const pointCost = Math.max(0, Number(input.pointCost || 0))
  if (pointCost <= 0) {
    return null
  }

  let result: unknown = null
  try {
    result = await prisma.$transaction(async (tx) => {
      // 行锁优先：锁住用户主表行，串行化该用户的积分账本写入。
      await lockUserBillingRow(tx, input.userId)

      const currentBalance = await readCurrentPointBalance(input.userId, tx)
      if (!input.allowNegativeBalance && currentBalance < pointCost) {
        const error = new Error(`积分不足，当前剩余 ${currentBalance}，需要 ${pointCost}`) as Error & {
          code?: string
          currentBalance?: number
          requiredPoints?: number
        }
        error.code = 'INSUFFICIENT_POINTS'
        error.currentBalance = currentBalance
        error.requiredPoints = pointCost
        throw error
      }

      return appendPointLog(tx, {
        userId: input.userId,
        changeType: 'CONSUME',
        action: 'DECREASE',
        changeAmount: pointCost,
        sourceType: 'GENERATION_CONSUME',
        sourceId: input.sourceId,
        associationNo: input.associationNo,
        dedupeKey: input.dedupeKey || null,
        remark: input.remark || (input.endpointType === 'video'
          ? '视频生成消耗积分'
          : input.endpointType === 'image'
            ? '图片生成消耗积分'
            : '对话消耗积分'),
        metaJson: {
          endpointType: input.endpointType,
          providerId: input.providerId,
          modelKey: input.modelKey,
          modelName: input.modelName || '',
          ...(input.metaJson && typeof input.metaJson === 'object' && !Array.isArray(input.metaJson)
            ? input.metaJson as Record<string, unknown>
            : {}),
        },
      })
    })
  } catch (error) {
    // P2002 = dedupeKey 唯一冲突 → 已扣过，静默成功（幂等）。其余错误（含 INSUFFICIENT_POINTS）抛出。
    if ((error as { code?: string })?.code === 'P2002') {
      return null
    }
    throw error
  }

  // 扣点后失效用户端营销中心总览缓存，避免余额显示最长 120s 滞后。
  await invalidateMarketingCenterOverviewCache(input.userId)
  return result
}

// 上游请求失败时自动退回本次生成消耗，避免用户为失败结果付费。
export const refundGenerationPoints = async (input: {
  userId: string
  pointCost: number
  sourceId: string
  associationNo: string
  endpointType: 'chat' | 'image' | 'video'
  providerId: string
  modelKey: string
  modelName?: string
  metaJson?: unknown
  // 覆盖默认流水备注（如"对话结算退差"）。
  remark?: string
  // 幂等去重键（如 'gen-refund:<associationNo>'）：同一任务退款至多一次。
  // 重复退款会触发唯一冲突，被静默吞掉（返回 null），跨重启/恢复/孤儿三条路径都安全。
  dedupeKey?: string
}) => {
  const pointCost = Math.max(0, Number(input.pointCost || 0))
  if (pointCost <= 0) {
    return null
  }

  let result: unknown = null
  try {
    result = await prisma.$transaction(async (tx) => {
      // 退款也走行锁：避免与并发扣点交错，让账本写入按事务严格串行。
      await lockUserBillingRow(tx, input.userId)

      return appendPointLog(tx, {
        userId: input.userId,
        changeType: 'REFUND',
        action: 'INCREASE',
        changeAmount: pointCost,
        sourceType: 'GENERATION_CONSUME',
        sourceId: input.sourceId,
        associationNo: input.associationNo,
        dedupeKey: input.dedupeKey || null,
        remark: input.remark || (input.endpointType === 'video'
          ? '视频生成失败，积分已退回'
          : input.endpointType === 'image'
            ? '图片生成失败，积分已退回'
            : '对话失败，积分已退回'),
        metaJson: {
          endpointType: input.endpointType,
          providerId: input.providerId,
          modelKey: input.modelKey,
          modelName: input.modelName || '',
          ...(input.metaJson && typeof input.metaJson === 'object' && !Array.isArray(input.metaJson)
            ? input.metaJson as Record<string, unknown>
            : {}),
        },
      })
    })
  } catch (error) {
    // P2002 = dedupeKey 唯一冲突 → 已退过，静默成功（幂等）。其余错误抛出。
    if ((error as { code?: string })?.code === 'P2002') {
      return null
    }
    throw error
  }

  await invalidateMarketingCenterOverviewCache(input.userId)
  return result
}

// 对话流结束后，按真实 usage 重新计费并对「保底预扣」做多退少补。
// - 实扣 > 预扣 → 补扣差额（allowNegativeBalance：内容已交付，余额不足不失败）
// - 实扣 < 预扣 → 退回差额
// 同一 associationNo 串起预扣与结算两条流水；分项明细写进 metaJson（phase:'settle'）。
// 拿不到 usage（理论上不会）则跳过，保留保底预扣，不报错。
export const settleChatPointsByUsage = async (input: {
  userId: string
  associationNo: string
  sourceId: string
  providerId: string
  modelKey: string
  modelName?: string
  preChargedPoints: number
  usage: { promptTokens?: number; completionTokens?: number; cachedTokens?: number } | null
  billingMultiplier?: number
}) => {
  if (!input.usage) {
    return null
  }

  const providerId = String(input.providerId || '').trim()
  const modelKey = String(input.modelKey || '').trim()
  if (!providerId || !modelKey) {
    return null
  }

  const model = await prisma.aiModel.findFirst({
    where: { providerId, modelKey, category: 'CHAT', isEnabled: true },
    select: { defaultParamsJson: true },
  })
  const billingRule = readModelBillingRule(model?.defaultParamsJson)

  // 三档单价全为 0（未配置分档计费）→ 不做按量结算，沿用保底预扣。
  if (!billingRule.inputPricePer1k && !billingRule.outputPricePer1k && !billingRule.cachedPricePer1k) {
    return null
  }

  // 会员折扣并入：实扣 = 能力倍率 × 会员折扣倍率。结算自查会员等级，保证与预扣口径一致。
  const membershipMultiplier = await getMembershipBillingMultiplier(input.userId)
  const combinedMultiplier = (input.billingMultiplier && input.billingMultiplier > 0 ? input.billingMultiplier : 1)
    * membershipMultiplier

  const real = resolveChatPointCostByUsage({
    usage: input.usage,
    billingRule,
    billingMultiplier: combinedMultiplier,
  })

  const preCharged = Math.max(0, Number(input.preChargedPoints || 0))
  const delta = real.pointCost - preCharged

  const metaJson = {
    phase: 'settle',
    preCharged,
    realCost: real.pointCost,
    ...real.breakdown,
  }

  if (delta > 0) {
    await consumeGenerationPoints({
      userId: input.userId,
      pointCost: delta,
      sourceId: input.sourceId,
      associationNo: input.associationNo,
      endpointType: 'chat',
      providerId,
      modelKey,
      modelName: input.modelName,
      allowNegativeBalance: true,
      remark: '对话结算补扣',
      // 幂等：同一对话的结算补扣至多一次，避免重复结束/重投导致重复扣费。
      dedupeKey: `gen-settle-consume:${input.associationNo}`,
      metaJson,
    })
  } else if (delta < 0) {
    await refundGenerationPoints({
      userId: input.userId,
      pointCost: -delta,
      sourceId: input.sourceId,
      associationNo: input.associationNo,
      endpointType: 'chat',
      providerId,
      modelKey,
      modelName: input.modelName,
      remark: '对话结算退差',
      // 幂等：同一对话的结算退差至多一次，避免重复结束/重投导致重复退差。
      dedupeKey: `gen-settle-refund:${input.associationNo}`,
      metaJson,
    })
  }

  await invalidateMarketingCenterOverviewCache(input.userId)
  return real
}

// 视频「超时退款」后，续询/重新查询最终拿到结果时调用：检查该 associationNo 是否退过款，
// 退过则补扣回积分（dedupeKey 幂等，重启/多次续询只补一次）。正常完成(未退过款)直接跳过、不补扣。
export const rechargeVideoIfRefunded = async (input: {
  userId: string
  associationNo: string
  pointCost: number
  providerId?: string
  modelKey?: string
  modelName?: string
}) => {
  const userId = String(input.userId || '').trim()
  const associationNo = String(input.associationNo || '').trim()
  const pointCost = Math.max(0, Number(input.pointCost || 0))
  if (!userId || !associationNo || pointCost <= 0) {
    return null
  }

  // 该 associationNo 是否退过款（如视频超时 handleFailed 退款）。没退过 → 原始扣费仍有效，不补扣。
  const refundLog = await prisma.pointAccountLog.findFirst({
    where: {
      userId,
      associationNo,
      changeType: 'REFUND',
      sourceType: 'GENERATION_CONSUME',
    },
    select: { id: true },
  })
  if (!refundLog) {
    return null
  }

  return consumeGenerationPoints({
    userId,
    pointCost,
    sourceId: associationNo,
    associationNo,
    endpointType: 'video',
    providerId: String(input.providerId || ''),
    modelKey: String(input.modelKey || ''),
    modelName: input.modelName,
    allowNegativeBalance: true, // 视频已交付，余额不足也补扣。
    remark: '视频续询完成补扣（此前超时已退款）',
    dedupeKey: `gen-recharge:${associationNo}`,
  })
}

// 在生成任务记录创建完成后，把 generationRecordId 追写回积分消费流水，便于后续做失败补偿与审计。
// 按生成记录 ID 反查其预扣(CONSUME)流水，供断点续询/孤儿回收时退款（没存 videoTask 的任务靠它）。
export const findConsumeByRecordId = async (recordId: string) => {
  const id = String(recordId || '').trim()
  if (!id) return null
  const log = await prisma.pointAccountLog.findFirst({
    where: {
      changeType: 'CONSUME',
      sourceType: 'GENERATION_CONSUME',
      metaJson: { path: '$.generationRecordId', equals: id } as any,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { userId: true, associationNo: true, changeAmount: true, metaJson: true },
  })
  if (!log || !log.associationNo) return null
  const meta = (log.metaJson && typeof log.metaJson === 'object' && !Array.isArray(log.metaJson))
    ? log.metaJson as Record<string, unknown>
    : {}
  const endpointType = (meta.endpointType === 'video' || meta.endpointType === 'image' || meta.endpointType === 'chat')
    ? meta.endpointType
    : 'video'
  return {
    userId: String(log.userId || '').trim(),
    associationNo: String(log.associationNo || '').trim(),
    pointCost: Number(log.changeAmount || 0) || 0,
    providerId: String(meta.providerId || '').trim(),
    modelKey: String(meta.modelKey || '').trim(),
    modelName: String(meta.modelName || '').trim(),
    endpointType: endpointType as 'chat' | 'image' | 'video',
  }
}

export const attachGenerationPointRecordId = async (input: {
  associationNo: string
  userId: string
  generationRecordId: string
}) => {
  const associationNo = String(input.associationNo || '').trim()
  const userId = String(input.userId || '').trim()
  const generationRecordId = String(input.generationRecordId || '').trim()

  if (!associationNo || !userId || !generationRecordId) {
    return null
  }

  const pointLog = await prisma.pointAccountLog.findFirst({
    where: {
      associationNo,
      userId,
      sourceType: 'GENERATION_CONSUME',
      changeType: 'CONSUME',
    },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  })

  if (!pointLog) {
    return null
  }

  const currentMeta = pointLog.metaJson && typeof pointLog.metaJson === 'object' && !Array.isArray(pointLog.metaJson)
    ? pointLog.metaJson as Record<string, unknown>
    : {}

  if (String(currentMeta.generationRecordId || '').trim() === generationRecordId) {
    return pointLog
  }

  return prisma.pointAccountLog.update({
    where: { id: pointLog.id },
    data: {
      metaJson: {
        ...currentMeta,
        generationRecordId,
      } as any,
    },
  })
}

const addDuration = (startTime: Date, durationUnit: string, durationValue: number) => {
  const nextDate = new Date(startTime)
  const normalizedUnit = String(durationUnit || 'MONTH').toUpperCase()
  const value = Math.max(1, durationValue || 1)
  if (normalizedUnit === 'DAY') {
    nextDate.setDate(nextDate.getDate() + value)
    return nextDate
  }
  if (normalizedUnit === 'YEAR') {
    nextDate.setFullYear(nextDate.getFullYear() + value)
    return nextDate
  }
  nextDate.setMonth(nextDate.getMonth() + value)
  return nextDate
}

const activateMembership = async (tx: any, input: {
  userId: string
  levelId: string
  sourceType: any
  sourceId: string
  startTime?: Date
  durationDays?: number | null
  durationUnit?: string
  durationValue?: number
  bonusPoints?: number
  metaJson?: unknown
}) => {
  const now = input.startTime || new Date()
  const activeSubscription = await tx.userSubscription.findFirst({
    where: {
      userId: input.userId,
      levelId: input.levelId,
      status: 'ACTIVE',
      endTime: { gt: now },
    },
    orderBy: { endTime: 'desc' },
  })

  const subscriptionStartTime = activeSubscription?.endTime && activeSubscription.endTime > now
    ? activeSubscription.endTime
    : now

  const subscriptionEndTime = input.durationDays && input.durationDays > 0
    ? new Date(subscriptionStartTime.getTime() + input.durationDays * 86400000)
    : addDuration(subscriptionStartTime, input.durationUnit || 'MONTH', input.durationValue || 1)

  await tx.userSubscription.updateMany({
    where: {
      userId: input.userId,
      status: 'ACTIVE',
      levelId: { not: input.levelId },
    },
    data: {
      status: 'EXPIRED',
    },
  })

  const subscription = await tx.userSubscription.upsert({
    where: {
      userId_levelId: {
        userId: input.userId,
        levelId: input.levelId,
      },
    },
    update: {
      status: 'ACTIVE',
      startTime: subscriptionStartTime,
      endTime: subscriptionEndTime,
      updatedAt: new Date(),
    },
    create: {
      userId: input.userId,
      levelId: input.levelId,
      status: 'ACTIVE',
      startTime: subscriptionStartTime,
      endTime: subscriptionEndTime,
    },
  })

  if ((input.bonusPoints || 0) > 0) {
    await appendPointLog(tx, {
      userId: input.userId,
      subscriptionId: subscription.id,
      changeType: 'MEMBERSHIP_BONUS',
      action: 'INCREASE',
      changeAmount: input.bonusPoints || 0,
      sourceType: 'MEMBERSHIP_ORDER',
      sourceId: input.sourceId,
      associationNo: input.sourceId,
      remark: '会员开通赠送积分',
      metaJson: input.metaJson,
    })
  }

  return subscription
}

const grantRewardByTrigger = async (tx: any, input: {
  userId: string
  triggerType: 'LOGIN_DAILY' | 'REGISTER_ONCE' | 'CHECKIN_DAILY'
  sourceId?: string | null
  remark?: string
  metaJson?: unknown
}) => {
  const rewardRules = await tx.rewardRule.findMany({
    where: {
      triggerType: input.triggerType,
      isEnabled: true,
    },
    orderBy: [
      { sortOrder: 'asc' },
      { createdAt: 'asc' },
    ],
  })

  const results: Array<{ ruleId: string; rewardPoints: number; claimId: string }> = []
  for (const rule of rewardRules) {
    const cyclePrefix = buildCyclePrefix(rule.cycleType)
    const claimedCount = await tx.rewardClaimRecord.count({
      where: {
        userId: input.userId,
        ruleId: rule.id,
        cycleKey: {
          startsWith: cyclePrefix,
        },
      },
    })

    if (claimedCount >= Math.max(1, rule.limitPerCycle || 1)) {
      continue
    }

    const claimRecord = await tx.rewardClaimRecord.create({
      data: {
        userId: input.userId,
        ruleId: rule.id,
        triggerType: rule.triggerType,
        cycleKey: cyclePrefix + '#' + String(claimedCount + 1),
        rewardPoints: rule.rewardPoints,
        claimStatus: 'SUCCESS',
        sourceId: input.sourceId || null,
        metaJson: (input.metaJson ?? null) as any,
      },
    })

    if ((rule.rewardPoints || 0) > 0) {
      await appendPointLog(tx, {
        userId: input.userId,
        changeType: 'REWARD',
        action: 'INCREASE',
        changeAmount: rule.rewardPoints,
        sourceType: rule.triggerType === 'CHECKIN_DAILY' ? 'CHECKIN' : 'REWARD_RULE',
        sourceId: claimRecord.id,
        associationNo: claimRecord.id,
        remark: input.remark || rule.name,
        metaJson: {
          triggerType: rule.triggerType,
          ruleCode: rule.code,
          ruleName: rule.name,
        },
      })
    }

    results.push({
      ruleId: rule.id,
      rewardPoints: rule.rewardPoints,
      claimId: claimRecord.id,
    })
  }

  return results
}

// 用户登录成功后触发每日登录奖励。
export const grantLoginReward = async (userId: string) => {
  const result = await prisma.$transaction(async (tx) => {
    return grantRewardByTrigger(tx, {
      userId,
      triggerType: 'LOGIN_DAILY',
      remark: '每日登录奖励',
    })
  })

  await invalidateMarketingCenterOverviewCache(userId)
  return result
}

// 新用户注册成功后发放一次性注册奖励。
export const grantRegisterReward = async (userId: string) => {
  const result = await prisma.$transaction(async (tx) => {
    return grantRewardByTrigger(tx, {
      userId,
      triggerType: 'REGISTER_ONCE',
      remark: '新用户注册奖励',
    })
  })

  await invalidateMarketingCenterOverviewCache(userId)
  return result
}

// 获取用户侧营销中心总览。
export const getMarketingCenterOverview = async (userId?: string | null) => {
  const normalizedUserId = String(userId || '').trim()
  const cacheKey = normalizedUserId
    ? buildMarketingCenterUserOverviewCacheKey(normalizedUserId)
    : MARKETING_CENTER_GUEST_OVERVIEW_CACHE_KEY

  return getOrSetJsonCache({
    key: cacheKey,
    ttlSeconds: normalizedUserId ? 120 : 600,
    factory: async () => {
      const [rawMembershipPlans, membershipLevels, rechargePackages, rewardRules] = await Promise.all([
        prisma.membershipPlan.findMany({
          where: { isEnabled: true },
          include: { level: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.membershipLevel.findMany({ where: { isEnabled: true } }),
        prisma.rechargePackage.findMany({
          where: { isEnabled: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
        prisma.rewardRule.findMany({
          where: { isEnabled: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        }),
      ])

      const membershipPlans = expandMembershipPlansByBilling(rawMembershipPlans, membershipLevels)

      if (!normalizedUserId) {
        return serializeMarketingCenterRecord({
          user: null,
          points: {
            balance: 0,
            available: 0,
            logs: [],
          },
          subscription: null,
          membershipPlans,
          rechargePackages,
          rewardRules,
          cardRedeemRecords: [],
          checkin: {
            checkedInToday: false,
            currentRecord: null,
          },
        })
      }

      const [currentUser, currentBalance, activeSubscription, recentPointLogs, recentRedeemRecords, todayCheckinRecord] = await Promise.all([
        prisma.appUser.findUnique({
          where: { id: normalizedUserId },
          select: { id: true, name: true, email: true, phone: true, role: true, createdAt: true },
        }),
        readCurrentPointBalance(normalizedUserId),
        prisma.userSubscription.findFirst({
          where: {
            userId: normalizedUserId,
            status: 'ACTIVE',
            endTime: { gt: new Date() },
          },
          include: { level: true },
          orderBy: { endTime: 'desc' },
        }),
        prisma.pointAccountLog.findMany({
          where: { userId: normalizedUserId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 10,
        }),
        prisma.cardRedeemRecord.findMany({
          where: { userId: normalizedUserId },
          include: { batch: true, rewardLevel: true },
          orderBy: [{ createdAt: 'desc' }],
          take: 10,
        }),
        prisma.userCheckinRecord.findUnique({
          where: {
            userId_checkinDate: {
              userId: normalizedUserId,
              checkinDate: formatDateKey(new Date()),
            },
          },
        }),
      ])

      return serializeMarketingCenterRecord({
        user: currentUser,
        points: {
          balance: currentBalance,
          available: currentBalance,
          logs: recentPointLogs,
        },
        subscription: activeSubscription,
        membershipPlans,
        rechargePackages,
        rewardRules,
        cardRedeemRecords: recentRedeemRecords,
        checkin: {
          checkedInToday: Boolean(todayCheckinRecord),
          currentRecord: todayCheckinRecord,
        },
      })
    },
  })
}

// 用户签到。
export const performUserCheckin = async (userId: string) => {
  const result = await prisma.$transaction(async (tx) => {
    const today = formatDateKey(new Date())
    const existing = await tx.userCheckinRecord.findUnique({
      where: {
        userId_checkinDate: {
          userId,
          checkinDate: today,
        },
      },
    })
    if (existing) {
      throw new Error('今天已经签到过了')
    }

    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = formatDateKey(yesterday)
    const previousRecord = await tx.userCheckinRecord.findUnique({
      where: {
        userId_checkinDate: {
          userId,
          checkinDate: yesterdayKey,
        },
      },
    })

    const rewardResults = await grantRewardByTrigger(tx, {
      userId,
      triggerType: 'CHECKIN_DAILY',
      remark: '每日签到奖励',
      metaJson: { checkinDate: today },
    })

    const rewardPoints = rewardResults.reduce((sum, item) => sum + item.rewardPoints, 0)
    const checkinRecord = await tx.userCheckinRecord.create({
      data: {
        userId,
        rewardClaimId: rewardResults[0]?.claimId || null,
        checkinDate: today,
        consecutiveDays: previousRecord ? previousRecord.consecutiveDays + 1 : 1,
        rewardPoints,
      },
    })

    return serializeMarketingCenterRecord({
      checkinRecord,
      rewardResults,
      currentBalance: await readCurrentPointBalance(userId, tx),
    })
  })

  await invalidateMarketingCenterOverviewCache(userId)
  return result
}

// 用户购买会员计划。
export const createMembershipPurchaseOrder = async (userId: string, selectedPlanId: string) => {
  const result = await prisma.$transaction(async (tx) => {
    const selection = parsePlanPurchaseSelection(selectedPlanId)
    const plan = await tx.membershipPlan.findFirst({
      where: { id: selection.planId, isEnabled: true },
      include: { level: true },
    })
    if (!plan) {
      throw new Error('会员计划不存在或已下架')
    }

    const planConfig = parseMembershipPlanConfig(plan.benefitsJson)
    const matchedBillingRule = (Array.isArray(planConfig.billing) ? planConfig.billing : [])
      .map((item) => normalizeMembershipBillingRule(item as Record<string, unknown>))
      .find((item) => item.levelId === selection.levelId && item.status)
    if (!matchedBillingRule) {
      throw new Error('当前会员计费规则不存在或已停用')
    }

    const now = new Date()
    const order = await tx.membershipOrder.create({
      data: {
        userId,
        levelId: matchedBillingRule.levelId,
        planId: plan.id,
        orderNo: buildSerialNo('VIP'),
        sourceType: 'DIRECT_PURCHASE',
        status: 'PAID',
        totalAmount: matchedBillingRule.salesPrice,
        paidAmount: matchedBillingRule.salesPrice,
        bonusPoints: plan.bonusPoints,
        startTime: now,
        endTime: addDuration(now, plan.durationUnit, plan.durationValue),
        paidAt: now,
        metaJson: {
          planName: plan.name,
          durationType: plan.durationType,
          durationValue: plan.durationValue,
          durationUnit: plan.durationUnit,
          billingLevelId: matchedBillingRule.levelId,
          billingLabel: matchedBillingRule.label,
        },
      },
    })

    const subscription = await activateMembership(tx, {
      userId,
      levelId: matchedBillingRule.levelId,
      sourceType: 'DIRECT_PURCHASE',
      sourceId: order.id,
      startTime: now,
      durationUnit: plan.durationUnit,
      durationValue: plan.durationValue,
      bonusPoints: plan.bonusPoints,
      metaJson: { orderNo: order.orderNo, planId: plan.id, levelId: matchedBillingRule.levelId },
    })

    await tx.membershipOrder.update({
      where: { id: order.id },
      data: {
        startTime: subscription.startTime,
        endTime: subscription.endTime,
      },
    })

    return serializeMarketingCenterRecord({
      order: await tx.membershipOrder.findUnique({ where: { id: order.id } }),
      subscription,
      currentBalance: await readCurrentPointBalance(userId, tx),
    })
  })

  await invalidateMarketingCenterOverviewCache(userId)
  return result
}

// 用户创建充值订单并立即入账。
export const createRechargePurchaseOrder = async (userId: string, rechargePackageId: string) => {
  const result = await prisma.$transaction(async (tx) => {
    const rechargePackage = await tx.rechargePackage.findFirst({
      where: { id: rechargePackageId, isEnabled: true },
    })
    if (!rechargePackage) {
      throw new Error('充值套餐不存在或已下架')
    }

    const totalPoints = (rechargePackage.points || 0) + (rechargePackage.bonusPoints || 0)
    const now = new Date()
    const order = await tx.rechargeOrder.create({
      data: {
        userId,
        rechargePackageId: rechargePackage.id,
        orderNo: buildSerialNo('RCH'),
        payChannel: 'MANUAL',
        payStatus: 'PAID',
        refundStatus: 'NONE',
        points: rechargePackage.points,
        bonusPoints: rechargePackage.bonusPoints,
        totalAmount: rechargePackage.price,
        paidAmount: rechargePackage.price,
        packageSnapshotJson: {
          name: rechargePackage.name,
          label: rechargePackage.label,
          price: rechargePackage.price,
        },
        paidAt: now,
      },
    })

    await appendPointLog(tx, {
      userId,
      rechargeOrderId: order.id,
      changeType: 'RECHARGE',
      action: 'INCREASE',
      changeAmount: totalPoints,
      sourceType: 'RECHARGE_ORDER',
      sourceId: order.id,
      associationNo: order.orderNo,
      remark: '积分充值到账',
      metaJson: {
        points: rechargePackage.points,
        bonusPoints: rechargePackage.bonusPoints,
      },
    })

    return serializeMarketingCenterRecord({
      order,
      currentBalance: await readCurrentPointBalance(userId, tx),
    })
  })

  await invalidateMarketingCenterOverviewCache(userId)
  return result
}

// 用户兑换卡密。
export const redeemCardCode = async (userId: string, code: string) => {
  const result = await prisma.$transaction(async (tx) => {
    const normalizedCode = String(code || '').trim().toUpperCase()
    if (!normalizedCode) {
      throw new Error('请输入卡密')
    }

    const cardCode = await tx.cardCode.findFirst({
      where: { code: normalizedCode },
      include: {
        batch: true,
        rewardLevel: true,
      },
    })

    if (!cardCode) {
      throw new Error('卡密不存在')
    }
    if (cardCode.status !== 'UNUSED') {
      throw new Error('该卡密已使用或不可用')
    }
    if (!cardCode.batch.isEnabled) {
      throw new Error('当前卡密批次已停用')
    }
    if (cardCode.expiresAt && cardCode.expiresAt.getTime() < Date.now()) {
      await tx.cardCode.update({
        where: { id: cardCode.id },
        data: { status: 'EXPIRED' },
      })
      throw new Error('该卡密已过期')
    }

    const redeemRecord = await tx.cardRedeemRecord.create({
      data: {
        cardCodeId: cardCode.id,
        batchId: cardCode.batchId,
        userId,
        rewardType: cardCode.batch.rewardType,
        rewardPoints: cardCode.batch.rewardPoints,
        rewardLevelId: cardCode.batch.rewardLevelId,
        rewardDays: cardCode.batch.rewardDays,
        remark: '卡密兑换成功',
      },
    })

    await tx.cardCode.update({
      where: { id: cardCode.id },
      data: {
        status: 'USED',
        usedByUserId: userId,
        usedAt: new Date(),
      },
    })

    await tx.cardBatch.update({
      where: { id: cardCode.batchId },
      data: {
        usedCount: {
          increment: 1,
        },
      },
    })

    let subscription = null
    if (cardCode.batch.rewardType === 'POINTS') {
      await appendPointLog(tx, {
        userId,
        changeType: 'CARD_REDEEM',
        action: 'INCREASE',
        changeAmount: cardCode.batch.rewardPoints,
        sourceType: 'CARD_REDEEM',
        sourceId: redeemRecord.id,
        associationNo: cardCode.code,
        remark: '卡密兑换积分到账',
        metaJson: {
          batchId: cardCode.batchId,
          cardCodeId: cardCode.id,
        },
      })
    } else if (cardCode.batch.rewardType === 'MEMBERSHIP') {
      // 会员卡密缺等级时直接抛错回滚（卡密不被消费），避免静默吞掉奖励。
      if (!cardCode.batch.rewardLevelId) {
        throw new Error('该会员卡密未配置会员等级，无法兑换，请联系管理员')
      }
      const order = await tx.membershipOrder.create({
        data: {
          userId,
          levelId: cardCode.batch.rewardLevelId,
          planId: null,
          orderNo: buildSerialNo('CDK'),
          sourceType: 'CARD_REDEEM',
          status: 'PAID',
          totalAmount: 0,
          paidAmount: 0,
          bonusPoints: 0,
          paidAt: new Date(),
          metaJson: {
            redeemRecordId: redeemRecord.id,
            cardCode: cardCode.code,
          },
        },
      })

      subscription = await activateMembership(tx, {
        userId,
        levelId: cardCode.batch.rewardLevelId,
        sourceType: 'CARD_REDEEM',
        sourceId: order.id,
        durationDays: cardCode.batch.rewardDays || 30,
        bonusPoints: 0,
        metaJson: { redeemRecordId: redeemRecord.id },
      })

      await tx.membershipOrder.update({
        where: { id: order.id },
        data: {
          startTime: subscription.startTime,
          endTime: subscription.endTime,
        },
      })
    }

    return {
      redeemRecord,
      subscription,
      currentBalance: await readCurrentPointBalance(userId, tx),
    }
  })

  await invalidateMarketingCenterOverviewCache(userId)
  return result
}
