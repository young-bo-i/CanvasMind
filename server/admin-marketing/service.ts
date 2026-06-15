import crypto from 'node:crypto'
import prisma from '../db/prisma'
import { refundGenerationPoints } from '../marketing-center/service'
import { listAdminUsers } from '../admin-users/service'
import type {
  MarketingCardBatchPayload,
  MarketingPointCompensationExecutePayload,
  MarketingPointLogQueryPayload,
  MarketingPointCompensationQueryPayload,
  MarketingMembershipLevelPayload,
} from './shared'

const toInt = (value: unknown, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? Math.round(numeric) : fallback
}

const toDecimal = (value: unknown, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

const toStringValue = (value: unknown, fallback = '') => String(value || fallback).trim()

const toNullableString = (value: unknown) => {
  const normalized = String(value || '').trim()
  return normalized || null
}

const toBoolean = (value: unknown, fallback = true) => {
  if (typeof value === 'boolean') return value
  if (value === 'false') return false
  if (value === 'true') return true
  return fallback
}

const toJsonValue = (value: unknown) => {
  if (value === undefined) return null
  return value as any
}

const toDateValue = (value: unknown) => {
  const normalized = String(value || '').trim()
  if (!normalized) return null
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

// Prisma Decimal 在 JSON 序列化前需要先拍平成字符串金额，否则前端会收到对象结构。
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

// 将 Prisma 返回结果中的 BigInt / Decimal 递归转换为可序列化值，金额统一返回字符串。
const serializeMarketingRecord = <T>(value: T): T => {
  if (typeof value === 'bigint') {
    return Number(value) as T
  }

  if (isDecimalLike(value)) {
    return value.toString() as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeMarketingRecord(item)) as T
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, serializeMarketingRecord(item)]),
    ) as T
  }

  return value
}


const createCardCode = () => {
  // 生成 12 位大写字母数字混合卡密，尽量贴近 BuildingAI 的使用习惯。
  return crypto.randomBytes(8).toString('base64url').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 12)
}

interface GenerationPointCompensationCandidate {
  associationNo: string
  sourceId: string
  userId: string
  pointCost: number
  endpointType: 'chat' | 'image' | 'video'
  providerId: string
  modelKey: string
  modelName: string
  taskType: string
  generationRecordId: string
  generationStatus: string
  generationPrompt: string
  generationErrorMessage: string
  consumedAt: string
  canCompensate: boolean
  compensationReason: string
}

interface AdminPointLogListItem {
  id: string
  userId: string
  userName: string
  userEmail: string
  userPhone: string
  accountNo: string
  changeType: string
  action: string
  changeAmount: number
  balanceAfter: number
  availableAmount: number
  sourceType: string
  sourceId: string
  associationNo: string
  remark: string
  endpointType: string
  providerId: string
  modelKey: string
  modelName: string
  generationRecordId: string
  generationStatus: string
  generationPrompt: string
  generationErrorMessage: string
  taskType: string
  // 对话按 token 分档结算的用量明细（仅结算流水有值，其余为 0）。
  usageInputTokens: number
  usageOutputTokens: number
  usageCachedTokens: number
  createdAt: string
  refunded: boolean
  canCompensate: boolean
  compensationReason: string
}

const readPointLogMeta = (value: unknown) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Record<string, unknown>
  }
  return value as Record<string, unknown>
}

const normalizeEndpointType = (value: unknown): 'chat' | 'image' | 'video' | '' => {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'chat' || normalized === 'image' || normalized === 'video') {
    return normalized
  }
  return ''
}

const buildPointCompensationCandidate = (input: {
  consumeLog: any
  generationRecord?: any | null
}) => {
  const meta = readPointLogMeta(input.consumeLog.metaJson)
  const endpointType = normalizeEndpointType(meta.endpointType)
  const generationStatus = String(input.generationRecord?.status || '').trim()
  const hasRefund = false
  const generationRecordId = String(meta.generationRecordId || '').trim()
  const canCompensate = Boolean(
    !hasRefund
    && endpointType
    && generationRecordId
    && (generationStatus === 'FAILED' || generationStatus === 'STOPPED'),
  )

  return {
    associationNo: String(input.consumeLog.associationNo || input.consumeLog.sourceId || '').trim(),
    sourceId: String(input.consumeLog.sourceId || '').trim(),
    userId: String(input.consumeLog.userId || '').trim(),
    pointCost: Number(input.consumeLog.changeAmount || 0),
    endpointType: endpointType || 'chat',
    providerId: String(meta.providerId || '').trim(),
    modelKey: String(meta.modelKey || '').trim(),
    modelName: String(meta.modelName || '').trim(),
    taskType: String(meta.taskType || '').trim(),
    generationRecordId,
    generationStatus,
    generationPrompt: String(input.generationRecord?.prompt || '').trim(),
    generationErrorMessage: String(input.generationRecord?.errorMessage || '').trim(),
    consumedAt: input.consumeLog.createdAt instanceof Date
      ? input.consumeLog.createdAt.toISOString()
      : String(input.consumeLog.createdAt || ''),
    canCompensate,
    compensationReason: canCompensate
      ? '生成任务失败但未发现退款流水'
      : generationRecordId
        ? '当前记录未处于失败/停止状态'
        : '消费流水缺少生成记录关联，需走手动补偿',
  } satisfies GenerationPointCompensationCandidate
}

const buildAdminPointLogItem = (input: {
  pointLog: any
  refundedAssociationNos: Set<string>
  user?: any | null
  generationRecord?: any | null
}) => {
  const meta = readPointLogMeta(input.pointLog.metaJson)
  const endpointType = normalizeEndpointType(meta.endpointType)
  const associationNo = String(input.pointLog.associationNo || input.pointLog.sourceId || '').trim()
  const generationRecordId = String(meta.generationRecordId || '').trim()
  const generationStatus = String(input.generationRecord?.status || '').trim()
  const isConsumeLog = String(input.pointLog.changeType || '').toUpperCase() === 'CONSUME'
  const refunded = associationNo ? input.refundedAssociationNos.has(associationNo) : false
  const canCompensate = Boolean(
    isConsumeLog
    && !refunded
    && endpointType
    && generationRecordId
    && (generationStatus === 'FAILED' || generationStatus === 'STOPPED'),
  )

  return {
    id: String(input.pointLog.id || '').trim(),
    userId: String(input.pointLog.userId || '').trim(),
    userName: String(input.user?.name || '').trim(),
    userEmail: String(input.user?.email || '').trim(),
    userPhone: String(input.user?.phone || '').trim(),
    accountNo: String(input.pointLog.accountNo || '').trim(),
    changeType: String(input.pointLog.changeType || '').trim(),
    action: String(input.pointLog.action || '').trim(),
    changeAmount: Number(input.pointLog.changeAmount || 0),
    balanceAfter: Number(input.pointLog.balanceAfter || 0),
    availableAmount: Number(input.pointLog.availableAmount || 0),
    sourceType: String(input.pointLog.sourceType || '').trim(),
    sourceId: String(input.pointLog.sourceId || '').trim(),
    associationNo,
    remark: String(input.pointLog.remark || '').trim(),
    endpointType,
    providerId: String(meta.providerId || '').trim(),
    modelKey: String(meta.modelKey || '').trim(),
    modelName: String(meta.modelName || '').trim(),
    generationRecordId,
    generationStatus,
    generationPrompt: String(input.generationRecord?.prompt || '').trim(),
    generationErrorMessage: String(input.generationRecord?.errorMessage || '').trim(),
    taskType: String(meta.taskType || '').trim(),
    usageInputTokens: Math.max(0, Number(meta.inputTokens || 0) || 0),
    usageOutputTokens: Math.max(0, Number(meta.outputTokens || 0) || 0),
    usageCachedTokens: Math.max(0, Number(meta.cachedTokens || 0) || 0),
    createdAt: input.pointLog.createdAt instanceof Date
      ? input.pointLog.createdAt.toISOString()
      : String(input.pointLog.createdAt || ''),
    refunded,
    canCompensate,
    compensationReason: canCompensate
      ? '失败任务未退款，可直接补偿'
      : refunded
        ? '该关联号已存在退款流水'
        : generationRecordId
          ? '当前流水不可补偿'
          : '当前流水未关联生成记录',
  } satisfies AdminPointLogListItem
}

const buildAdminPointLogItems = async (pointLogs: any[]) => {
  const associationNos = Array.from(new Set(
    pointLogs
      .map((item) => String(item.associationNo || item.sourceId || '').trim())
      .filter(Boolean),
  ))

  const refundLogs = associationNos.length
    ? await prisma.pointAccountLog.findMany({
      where: {
        sourceType: 'GENERATION_CONSUME',
        changeType: 'REFUND',
        associationNo: {
          in: associationNos,
        },
      },
      select: {
        associationNo: true,
      },
    })
    : []

  const refundedAssociationNos = new Set(
    refundLogs.map((item) => String(item.associationNo || '').trim()).filter(Boolean),
  )

  const generationRecordIds = Array.from(new Set(
    pointLogs
      .map((item) => String(readPointLogMeta(item.metaJson).generationRecordId || '').trim())
      .filter(Boolean),
  ))

  const generationRecords = generationRecordIds.length
    ? await prisma.generationRecord.findMany({
      where: {
        id: {
          in: generationRecordIds,
        },
      },
      select: {
        id: true,
        status: true,
        prompt: true,
        errorMessage: true,
      },
    })
    : []

  const generationRecordMap = new Map(generationRecords.map((item) => [item.id, item]))
  const userIds = Array.from(new Set(
    pointLogs
      .map((item) => String(item.userId || '').trim())
      .filter(Boolean),
  ))
  const users = userIds.length
    ? await prisma.appUser.findMany({
      where: {
        id: {
          in: userIds,
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
      },
    })
    : []
  const userMap = new Map(users.map((item) => [item.id, item]))

  return pointLogs.map((pointLog) => {
    const generationRecordId = String(readPointLogMeta(pointLog.metaJson).generationRecordId || '').trim()
    const userId = String(pointLog.userId || '').trim()
    return buildAdminPointLogItem({
      pointLog,
      refundedAssociationNos,
      user: userId ? userMap.get(userId) || null : null,
      generationRecord: generationRecordId ? generationRecordMap.get(generationRecordId) || null : null,
    })
  })
}

const matchesAdminPointLogFilters = (
  item: AdminPointLogListItem,
  filters: {
    endpointType: ReturnType<typeof normalizeEndpointType>
    refundStatus: string
    keyword: string
  },
) => {
  if (filters.endpointType && item.endpointType !== filters.endpointType) {
    return false
  }
  if (filters.refundStatus === 'compensable' && !item.canCompensate) {
    return false
  }
  if (filters.refundStatus === 'refunded' && !item.refunded) {
    return false
  }
  if (filters.refundStatus === 'unrefunded' && item.refunded) {
    return false
  }
  if (filters.keyword) {
    const haystack = [
      item.accountNo,
      item.associationNo,
      item.sourceId,
      item.userId,
      item.userName,
      item.userEmail,
      item.userPhone,
      item.remark,
      item.modelName,
      item.modelKey,
      item.generationPrompt,
      item.generationErrorMessage,
    ].join(' ').toLowerCase()
    if (!haystack.includes(filters.keyword)) {
      return false
    }
  }
  return true
}

// 查询后台积分流水明细，支持按动作、来源、终端类型、退款状态和关键词筛选。
export const listAdminPointLogs = async (
  query: MarketingPointLogQueryPayload = {},
  viewer?: { id: string; role: string },
) => {
  // 归属隔离：普通管理员只看自己名下用户的积分流水；超管全量。
  const ownerScope = viewer && viewer.role !== 'SUPER_ADMIN' ? { user: { ownerAdminId: viewer.id } } : {}
  const days = Math.min(180, Math.max(1, toInt(query.days, 30)))
  const page = Math.max(1, toInt(query.page, 1))
  const pageSize = Math.min(100, Math.max(10, toInt(query.pageSize, 10)))
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const action = toStringValue(query.action).toUpperCase()
  const sourceType = toStringValue(query.sourceType).toUpperCase()
  const endpointType = normalizeEndpointType(query.endpointType)
  const refundStatus = toStringValue(query.refundStatus).toLowerCase()
  const keyword = toStringValue(query.keyword).toLowerCase()

  const baseWhere = {
    createdAt: {
      gte: startTime,
    },
    ...(action ? { action: action as any } : {}),
    ...(sourceType ? { sourceType: sourceType as any } : {}),
    ...ownerScope,
  }
  const filters = { endpointType, refundStatus, keyword }
  const batchSize = Math.max(100, Math.min(500, pageSize * 10))
  const baseCount = await prisma.pointAccountLog.count({ where: baseWhere })

  const scanPointLogs = async (options: { page?: number } = {}) => {
    let totalCount = 0
    let compensableCount = 0
    let refundCount = 0
    const pageItems: AdminPointLogListItem[] = []
    const startIndex = options.page ? (options.page - 1) * pageSize : -1
    const endIndex = options.page ? startIndex + pageSize : -1

    for (let skip = 0; skip < baseCount; skip += batchSize) {
      const pointLogs = await prisma.pointAccountLog.findMany({
        where: baseWhere,
        orderBy: [
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        skip,
        take: batchSize,
      })
      const batchItems = await buildAdminPointLogItems(pointLogs)
      for (const item of batchItems) {
        if (!matchesAdminPointLogFilters(item, filters)) {
          continue
        }
        if (item.canCompensate) {
          compensableCount += 1
        }
        if (item.refunded) {
          refundCount += 1
        }
        if (options.page && totalCount >= startIndex && totalCount < endIndex) {
          pageItems.push(item)
        }
        totalCount += 1
      }
      if (options.page && pageItems.length >= pageSize) {
        break
      }
    }

    return {
      totalCount,
      compensableCount,
      refundCount,
      items: pageItems,
    }
  }

  const summaryScan = await scanPointLogs()
  const totalPages = Math.max(1, Math.ceil(summaryScan.totalCount / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageScan = await scanPointLogs({ page: currentPage })

  return serializeMarketingRecord({
    summary: {
      totalCount: summaryScan.totalCount,
      compensableCount: summaryScan.compensableCount,
      refundCount: summaryScan.refundCount,
      windowDays: days,
      page: currentPage,
      pageSize,
      totalPages,
    },
    items: pageScan.items,
  })
}

// 查询生成任务积分补偿候选列表，只返回失败/停止且尚未退款的可补偿任务。
export const listGenerationPointCompensationCandidates = async (
  query: MarketingPointCompensationQueryPayload = {},
  viewer?: { id: string; role: string },
) => {
  const days = Math.min(90, Math.max(1, toInt(query.days, 7)))
  const limit = Math.min(200, Math.max(1, toInt(query.limit, 50)))
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  // 归属隔离：普通管理员只看自己名下用户的可补偿流水；超管全量。
  const ownerScope = viewer && viewer.role !== 'SUPER_ADMIN' ? { user: { ownerAdminId: viewer.id } } : {}

  const consumeLogs = await prisma.pointAccountLog.findMany({
    where: {
      sourceType: 'GENERATION_CONSUME',
      changeType: 'CONSUME',
      createdAt: {
        gte: startTime,
      },
      ...ownerScope,
    },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit * 4,
  })

  const associationNos = consumeLogs
    .map((item) => String(item.associationNo || item.sourceId || '').trim())
    .filter(Boolean)

  const refundLogs = associationNos.length
    ? await prisma.pointAccountLog.findMany({
      where: {
        sourceType: 'GENERATION_CONSUME',
        changeType: 'REFUND',
        associationNo: {
          in: associationNos,
        },
      },
      select: {
        associationNo: true,
      },
    })
    : []

  const refundedAssociationNos = new Set(
    refundLogs
      .map((item) => String(item.associationNo || '').trim())
      .filter(Boolean),
  )

  const generationRecordIds = consumeLogs
    .map((item) => String(readPointLogMeta(item.metaJson).generationRecordId || '').trim())
    .filter(Boolean)

  const generationRecords = generationRecordIds.length
    ? await prisma.generationRecord.findMany({
      where: {
        id: {
          in: generationRecordIds,
        },
      },
      select: {
        id: true,
        status: true,
        prompt: true,
        errorMessage: true,
      },
    })
    : []

  const generationRecordMap = new Map(generationRecords.map((item) => [item.id, item]))

  const candidates = consumeLogs
    .filter((item) => {
      const associationNo = String(item.associationNo || item.sourceId || '').trim()
      return associationNo && !refundedAssociationNos.has(associationNo)
    })
    .map((item) => {
      const generationRecordId = String(readPointLogMeta(item.metaJson).generationRecordId || '').trim()
      return buildPointCompensationCandidate({
        consumeLog: item,
        generationRecord: generationRecordId ? generationRecordMap.get(generationRecordId) || null : null,
      })
    })
    .filter((item) => item.canCompensate)
    .slice(0, limit)

  return serializeMarketingRecord({
    summary: {
      candidateCount: candidates.length,
      totalPointCost: candidates.reduce((sum, item) => sum + item.pointCost, 0),
      windowDays: days,
    },
    items: candidates,
  })
}

// 手动执行一次生成积分补偿。默认只允许补偿失败/停止且未退款的任务；对历史遗留可通过 forceManual 手工补偿。
export const executeGenerationPointCompensation = async (
  payload: MarketingPointCompensationExecutePayload,
  currentUserId: string,
  viewer?: { id: string; role: string },
) => {
  const associationNos = Array.from(new Set(
    (Array.isArray(payload.associationNos) ? payload.associationNos : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  ))

  if (!associationNos.length) {
    throw new Error('请先选择需要补偿的流水编号')
  }

  const note = toNullableString(payload.note)
  const forceManual = toBoolean(payload.forceManual, false)
  // 归属隔离：普通管理员只能补偿自己名下用户的流水；非名下流水会落选 consumeLogMap，按“未找到对应消费流水”跳过。
  const ownerScope = viewer && viewer.role !== 'SUPER_ADMIN' ? { user: { ownerAdminId: viewer.id } } : {}
  const consumeLogs = await prisma.pointAccountLog.findMany({
    where: {
      sourceType: 'GENERATION_CONSUME',
      changeType: 'CONSUME',
      associationNo: {
        in: associationNos,
      },
      ...ownerScope,
    },
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
  })

  const consumeLogMap = new Map(
    consumeLogs.map((item) => [String(item.associationNo || item.sourceId || '').trim(), item]),
  )

  const refundLogs = await prisma.pointAccountLog.findMany({
    where: {
      sourceType: 'GENERATION_CONSUME',
      changeType: 'REFUND',
      associationNo: {
        in: associationNos,
      },
    },
    select: {
      associationNo: true,
    },
  })
  const refundedAssociationNos = new Set(
    refundLogs.map((item) => String(item.associationNo || '').trim()).filter(Boolean),
  )

  const generationRecordIds = consumeLogs
    .map((item) => String(readPointLogMeta(item.metaJson).generationRecordId || '').trim())
    .filter(Boolean)

  const generationRecords = generationRecordIds.length
    ? await prisma.generationRecord.findMany({
      where: {
        id: {
          in: generationRecordIds,
        },
      },
      select: {
        id: true,
        status: true,
        prompt: true,
        errorMessage: true,
      },
    })
    : []

  const generationRecordMap = new Map(generationRecords.map((item) => [item.id, item]))
  const refundedItems: Array<Record<string, unknown>> = []
  const skippedItems: Array<Record<string, unknown>> = []

  for (const associationNo of associationNos) {
    const consumeLog = consumeLogMap.get(associationNo)
    if (!consumeLog) {
      skippedItems.push({
        associationNo,
        reason: '未找到对应消费流水',
      })
      continue
    }

    if (refundedAssociationNos.has(associationNo)) {
      skippedItems.push({
        associationNo,
        reason: '当前流水已存在退款记录',
      })
      continue
    }

    const meta = readPointLogMeta(consumeLog.metaJson)
    const endpointType = normalizeEndpointType(meta.endpointType)
    const generationRecordId = String(meta.generationRecordId || '').trim()
    const generationRecord = generationRecordId ? generationRecordMap.get(generationRecordId) || null : null
    const generationStatus = String(generationRecord?.status || '').trim()

    if (!endpointType) {
      skippedItems.push({
        associationNo,
        reason: '流水缺少 endpointType，无法执行补偿',
      })
      continue
    }

    if (!forceManual && generationStatus !== 'FAILED' && generationStatus !== 'STOPPED') {
      skippedItems.push({
        associationNo,
        reason: generationRecordId
          ? '生成记录未处于失败或停止状态'
          : '流水缺少生成记录关联，请改用手动补偿模式',
      })
      continue
    }

    await refundGenerationPoints({
      userId: String(consumeLog.userId || '').trim(),
      pointCost: Number(consumeLog.changeAmount || 0),
      sourceId: String(consumeLog.sourceId || associationNo).trim(),
      associationNo,
      endpointType,
      providerId: String(meta.providerId || '').trim(),
      modelKey: String(meta.modelKey || '').trim(),
      modelName: String(meta.modelName || '').trim(),
      metaJson: {
        refundReason: forceManual ? 'admin_manual_compensation_force' : 'admin_manual_compensation',
        generationRecordId,
        originalConsumeLogId: consumeLog.id,
        compensatedByUserId: currentUserId,
        compensationNote: note || '',
      },
    })

    refundedItems.push({
      associationNo,
      pointCost: Number(consumeLog.changeAmount || 0),
      endpointType,
      generationRecordId,
      generationStatus,
    })
  }

  return serializeMarketingRecord({
    refundedCount: refundedItems.length,
    skippedCount: skippedItems.length,
    refundedItems,
    skippedItems,
  })
}

// 查询营销中心概览数据。
export const getAdminMarketingOverview = async (viewer?: { id: string; role: string }) => {
  const now = new Date()
  // 归属隔离：普通管理员的经营指标仅统计自己名下用户；超管全量。配置类计数(等级/套餐/卡密)是全局配置，不隔离。
  const ownerScope = viewer && viewer.role !== 'SUPER_ADMIN' ? { ownerAdminId: viewer.id } : undefined
  const userScope = ownerScope ? { user: ownerScope } : {}
  const [
    membershipLevelCount,
    cardBatchCount,
    cardCodeCount,
    usedCardCodeCount,
    rechargeAgg,
    consumeAgg,
    increaseAgg,
    decreaseAgg,
    activeMemberCount,
  ] = await Promise.all([
    prisma.membershipLevel.count(),
    prisma.cardBatch.count(),
    prisma.cardCode.count(),
    prisma.cardCode.count({ where: { status: 'USED' } }),
    // 总充值金额：已支付充值订单的实付金额合计。
    prisma.rechargeOrder.aggregate({ _sum: { paidAmount: true }, where: { payStatus: 'PAID', ...userScope } }),
    // 总消费积分：所有消费流水合计。
    prisma.pointAccountLog.aggregate({ _sum: { changeAmount: true }, where: { changeType: 'CONSUME', ...userScope } }),
    // 用户总余额 = 全部入账 - 全部出账（按 action 汇总有符号变动）。
    prisma.pointAccountLog.aggregate({ _sum: { changeAmount: true }, where: { action: 'INCREASE', ...userScope } }),
    prisma.pointAccountLog.aggregate({ _sum: { changeAmount: true }, where: { action: 'DECREASE', ...userScope } }),
    // 活跃会员：状态 ACTIVE 且未到期的订阅数。
    prisma.userSubscription.count({ where: { status: 'ACTIVE', endTime: { gt: now }, ...userScope } }),
  ])

  const toNum = (value: unknown) => (value == null ? 0 : Number((value as { toString(): string }).toString()))
  const totalRechargeAmount = toNum(rechargeAgg._sum.paidAmount)
  const totalConsumePoints = toNum(consumeAgg._sum.changeAmount)
  const totalPointBalance = toNum(increaseAgg._sum.changeAmount) - toNum(decreaseAgg._sum.changeAmount)

  return {
    membership: {
      levelCount: membershipLevelCount,
    },
    cdk: {
      batchCount: cardBatchCount,
      codeCount: cardCodeCount,
      usedCount: usedCardCodeCount,
    },
    // 经营指标：总充值金额(元)、总消费积分、用户总余额、活跃会员数。
    business: {
      totalRechargeAmount,
      totalConsumePoints,
      totalPointBalance,
      activeMemberCount,
    },
  }
}

// 查询会员等级列表。
export const listMembershipLevels = async () => {
  return serializeMarketingRecord(await prisma.membershipLevel.findMany({
    orderBy: [
      { sortOrder: 'asc' },
      { level: 'asc' },
      { createdAt: 'desc' },
    ],
  }))
}

// 保存会员等级。
export const saveMembershipLevel = async (payload: MarketingMembershipLevelPayload, id?: string) => {
  const data = {
    name: toStringValue(payload.name),
    level: toInt(payload.level, 1),
    description: toNullableString(payload.description),
    iconUrl: toNullableString(payload.iconUrl),
    monthlyBonusPoints: toInt(payload.monthlyBonusPoints, 0),
    storageCapacity: BigInt(toInt(payload.storageCapacity, 0)),
    pointDiscountPercent: Math.min(100, Math.max(0, Number(payload.pointDiscountPercent) || 0)),
    benefitsJson: toJsonValue(payload.benefitsJson),
    isEnabled: toBoolean(payload.isEnabled, true),
    sortOrder: toInt(payload.sortOrder, 0),
  }

  if (!data.name) {
    throw new Error('会员等级名称不能为空')
  }

  if (id) {
    return serializeMarketingRecord(await prisma.membershipLevel.update({ where: { id }, data }))
  }

  return serializeMarketingRecord(await prisma.membershipLevel.create({ data }))
}

export const deleteMembershipLevel = async (id: string) => {
  return prisma.membershipLevel.delete({ where: { id } })
}

// 用户积分/会员一览：复用 admin-users 的列表查询（已含当前积分余额 currentPointBalance、
// 活跃会员订阅 activeSubscription，并内置 ownerAdminId 归属隔离与缓存）。超管看全部、普通管理员仅看自己创建的用户。
export const listMarketingUserPoints = async (
  query: { keyword?: string; page?: number; pageSize?: number } = {},
  viewer?: { id: string; role: string },
) => {
  return listAdminUsers({
    keyword: toStringValue(query.keyword),
    role: 'ALL',
    status: 'ALL',
    page: toInt(query.page, 1),
    pageSize: toInt(query.pageSize, 10),
    viewerId: viewer?.id,
    viewerRole: viewer?.role as 'SUPER_ADMIN' | 'ADMIN' | 'USER' | undefined,
  })
}

// 查询卡密批次列表，同时带上部分卡密汇总。
export const listCardBatches = async () => {
  return serializeMarketingRecord(await prisma.cardBatch.findMany({
    include: {
      rewardLevel: true,
      _count: {
        select: {
          cardCodes: true,
          redeemRecords: true,
        },
      },
    },
    orderBy: [
      { createdAt: 'desc' },
    ],
  }))
}

// 查询单个批次下的卡密列表。
export const listCardCodesByBatch = async (batchId: string) => {
  return serializeMarketingRecord(await prisma.cardCode.findMany({
    where: { batchId },
    include: {
      usedByUser: true,
      rewardLevel: true,
    },
    orderBy: [
      { createdAt: 'desc' },
    ],
  }))
}

// 保存卡密批次，并可选自动批量生成卡密。
export const saveCardBatch = async (payload: MarketingCardBatchPayload, id?: string) => {
  const totalCount = Math.max(0, toInt(payload.totalCount, 0))
  const data = {
    name: toStringValue(payload.name),
    batchNo: toStringValue(payload.batchNo) || `BATCH-${Date.now()}`,
    description: toNullableString(payload.description),
    rewardType: (toStringValue(payload.rewardType, 'POINTS') || 'POINTS') as any,
    rewardPoints: toInt(payload.rewardPoints, 0),
    rewardLevelId: toNullableString(payload.rewardLevelId),
    rewardDays: payload.rewardDays === null ? null : toInt(payload.rewardDays, 0),
    totalCount,
    expiresAt: toDateValue(payload.expiresAt),
    isEnabled: toBoolean(payload.isEnabled, true),
    metaJson: toJsonValue(payload.metaJson),
  }

  if (!data.name) {
    throw new Error('卡密批次名称不能为空')
  }

  // 会员类卡密必须绑定等级，否则兑换时无奖励可发（避免静默吞掉奖励）。
  if (data.rewardType === 'MEMBERSHIP' && !data.rewardLevelId) {
    throw new Error('会员类卡密必须选择要赠送的会员等级')
  }
  // 积分类卡密必须配正积分。
  if (data.rewardType === 'POINTS' && data.rewardPoints <= 0) {
    throw new Error('积分类卡密的赠送积分必须大于 0')
  }

  if (id) {
    return prisma.cardBatch.update({ where: { id }, data })
  }

  return prisma.$transaction(async (tx) => {
    const createdBatch = await tx.cardBatch.create({ data })

    if (totalCount > 0) {
      const payloads = Array.from({ length: totalCount }, () => ({
        batchId: createdBatch.id,
        code: createCardCode(),
        rewardLevelId: data.rewardLevelId,
        rewardSnapshotJson: {
          rewardType: data.rewardType,
          rewardPoints: data.rewardPoints,
          rewardDays: data.rewardDays,
        },
        expiresAt: data.expiresAt,
      }))

      await tx.cardCode.createMany({ data: payloads as any })
    }

    return createdBatch
  })
}

export const deleteCardBatch = async (id: string) => {
  return prisma.cardBatch.delete({ where: { id } })
}
