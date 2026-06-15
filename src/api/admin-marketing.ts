import { buildApiUrl } from './http'
import { readApiData } from './response'

export interface AdminMarketingOverview {
  membership: {
    levelCount: number
  }
  cdk: {
    batchCount: number
    codeCount: number
    usedCount: number
  }
  business: {
    totalRechargeAmount: number
    totalConsumePoints: number
    totalPointBalance: number
    activeMemberCount: number
  }
}

export interface MembershipLevelItem {
  id: string
  name: string
  level: number
  description: string | null
  iconUrl: string | null
  monthlyBonusPoints: number
  storageCapacity: string | number
  pointDiscountPercent: number
  benefitsJson: unknown
  isEnabled: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}


export interface MarketingUserPointItem {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  maskedEmail: string | null
  maskedPhone: string | null
  avatarUrl: string | null
  role: string
  status: string
  createdAt: string
  currentPointBalance: number
  activeSubscription: {
    status: string
    startTime: string | null
    endTime: string | null
    level: {
      id: string
      name: string
      level: number
    } | null
  } | null
}

export interface MarketingUserPointListResult {
  items: MarketingUserPointItem[]
  summary: {
    totalCount: number
    totalPages: number
    page: number
    pageSize: number
  }
}

export interface CardBatchItem {
  id: string
  name: string
  batchNo: string
  description: string | null
  rewardType: string
  rewardPoints: number
  rewardLevelId: string | null
  rewardDays: number | null
  totalCount: number
  usedCount: number
  expiresAt: string | null
  isEnabled: boolean
  metaJson: unknown
  rewardLevel?: MembershipLevelItem | null
  _count?: {
    cardCodes: number
    redeemRecords: number
  }
}

export interface CardCodeItem {
  id: string
  batchId: string
  code: string
  status: string
  usedByUserId: string | null
  rewardLevelId: string | null
  rewardSnapshotJson: unknown
  expiresAt: string | null
  usedAt: string | null
  usedByUser?: {
    id: string
    name: string | null
    email: string | null
    phone: string | null
  } | null
}

export interface PointCompensationCandidateItem {
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

export interface PointCompensationCandidateResult {
  summary: {
    candidateCount: number
    totalPointCost: number
    windowDays: number
  }
  items: PointCompensationCandidateItem[]
}

export interface PointCompensationExecuteResult {
  refundedCount: number
  skippedCount: number
  refundedItems: Array<Record<string, unknown>>
  skippedItems: Array<Record<string, unknown>>
}

export interface AdminPointLogItem {
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
  // 对话按 token 分档结算的用量明细（仅结算流水有值）。
  usageInputTokens: number
  usageOutputTokens: number
  usageCachedTokens: number
  createdAt: string
  refunded: boolean
  canCompensate: boolean
  compensationReason: string
}

export interface AdminPointLogListResult {
  summary: {
    totalCount: number
    compensableCount: number
    refundCount: number
    windowDays: number
    page: number
    pageSize: number
    totalPages: number
  }
  items: AdminPointLogItem[]
}

const ADMIN_MARKETING_BASE_PATH = '/api/admin/marketing'
const OVERVIEW_PATH = `${ADMIN_MARKETING_BASE_PATH}/overview`
const MEMBERSHIP_LEVELS_PATH = `${ADMIN_MARKETING_BASE_PATH}/membership-levels`
const USER_POINTS_PATH = `${ADMIN_MARKETING_BASE_PATH}/user-points`
const CARD_BATCHES_PATH = `${ADMIN_MARKETING_BASE_PATH}/card-batches`
const POINT_LOGS_PATH = `${ADMIN_MARKETING_BASE_PATH}/point-logs`
const POINT_COMPENSATION_CANDIDATES_PATH = `${ADMIN_MARKETING_BASE_PATH}/point-compensation/candidates`
const POINT_COMPENSATION_EXECUTE_PATH = `${ADMIN_MARKETING_BASE_PATH}/point-compensation/execute`

interface MarketingRequestMessageOptions {
  showSuccessMessage?: boolean
  successMessage?: string
}

const requestJson = async <T>(url: string, options: RequestInit = {}, messageOptions: MarketingRequestMessageOptions = {}) => {
  const response = await fetch(buildApiUrl(url), {
    credentials: 'include',
    cache: 'no-store',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })

  return readApiData<T>(response, {
    showErrorMessage: true,
    showSuccessMessage: messageOptions.showSuccessMessage,
    successMessage: messageOptions.successMessage,
  })
}

// 查询营销中心概览。
export const getAdminMarketingOverview = () => requestJson<AdminMarketingOverview>(OVERVIEW_PATH, { method: 'GET' })

// 查询会员等级列表。
export const listMembershipLevels = () => requestJson<MembershipLevelItem[]>(MEMBERSHIP_LEVELS_PATH, { method: 'GET' })
export const createMembershipLevel = (payload: Partial<MembershipLevelItem>) => requestJson<MembershipLevelItem>(MEMBERSHIP_LEVELS_PATH, { method: 'POST', body: JSON.stringify(payload) }, { showSuccessMessage: true, successMessage: '会员等级已创建' })
export const updateMembershipLevel = (id: string, payload: Partial<MembershipLevelItem>) => requestJson<MembershipLevelItem>(`${MEMBERSHIP_LEVELS_PATH}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }, { showSuccessMessage: true, successMessage: '会员等级已更新' })
export const deleteMembershipLevel = (id: string) => requestJson<boolean>(`${MEMBERSHIP_LEVELS_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { showSuccessMessage: true, successMessage: '会员等级已删除' })

// 查询用户积分与会员订阅分页列表，支持关键词搜索。
export const listAdminMarketingUserPoints = (params: { keyword?: string; page?: number; pageSize?: number } = {}) => {
  const searchParams = new URLSearchParams()
  if (params.keyword) searchParams.set('keyword', params.keyword)
  if (params.page) searchParams.set('page', String(params.page))
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize))
  const suffix = searchParams.toString()
  return requestJson<MarketingUserPointListResult>(
    suffix ? `${USER_POINTS_PATH}?${suffix}` : USER_POINTS_PATH,
    { method: 'GET' },
  )
}

// 查询卡密批次与卡密列表。
export const listCardBatches = () => requestJson<CardBatchItem[]>(CARD_BATCHES_PATH, { method: 'GET' })
export const createCardBatch = (payload: Partial<CardBatchItem>) => requestJson<CardBatchItem>(CARD_BATCHES_PATH, { method: 'POST', body: JSON.stringify(payload) }, { showSuccessMessage: true, successMessage: '卡密批次已创建' })
export const updateCardBatch = (id: string, payload: Partial<CardBatchItem>) => requestJson<CardBatchItem>(`${CARD_BATCHES_PATH}/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }, { showSuccessMessage: true, successMessage: '卡密批次已更新' })
export const deleteCardBatch = (id: string) => requestJson<boolean>(`${CARD_BATCHES_PATH}/${encodeURIComponent(id)}`, { method: 'DELETE' }, { showSuccessMessage: true, successMessage: '卡密批次已删除' })
export const listCardCodesByBatch = (id: string) => requestJson<CardCodeItem[]>(`${CARD_BATCHES_PATH}/${encodeURIComponent(id)}/codes`, { method: 'GET' })

// 查询后台积分流水明细，支持筛选与失败补偿标记。
export const listAdminPointLogs = (query?: {
  days?: number
  page?: number
  pageSize?: number
  action?: string
  sourceType?: string
  endpointType?: string
  refundStatus?: string
  keyword?: string
}) => {
  const searchParams = new URLSearchParams()
  if (query?.days) searchParams.set('days', String(query.days))
  if (query?.page) searchParams.set('page', String(query.page))
  if (query?.pageSize) searchParams.set('pageSize', String(query.pageSize))
  if (query?.action) searchParams.set('action', query.action)
  if (query?.sourceType) searchParams.set('sourceType', query.sourceType)
  if (query?.endpointType) searchParams.set('endpointType', query.endpointType)
  if (query?.refundStatus) searchParams.set('refundStatus', query.refundStatus)
  if (query?.keyword) searchParams.set('keyword', query.keyword)
  const suffix = searchParams.toString()
  return requestJson<AdminPointLogListResult>(
    suffix ? `${POINT_LOGS_PATH}?${suffix}` : POINT_LOGS_PATH,
    { method: 'GET' },
  )
}

// 查询失败未退款的生成积分候选列表。
export const listPointCompensationCandidates = (query?: {
  days?: number
  limit?: number
}) => {
  const searchParams = new URLSearchParams()
  if (query?.days) {
    searchParams.set('days', String(query.days))
  }
  if (query?.limit) {
    searchParams.set('limit', String(query.limit))
  }
  const suffix = searchParams.toString()
  return requestJson<PointCompensationCandidateResult>(
    suffix ? `${POINT_COMPENSATION_CANDIDATES_PATH}?${suffix}` : POINT_COMPENSATION_CANDIDATES_PATH,
    { method: 'GET' },
  )
}

// 执行一次人工积分补偿，支持按候选列表或手动输入编号补偿。
export const executePointCompensation = (payload: {
  associationNos: string[]
  note?: string
  forceManual?: boolean
}) => requestJson<PointCompensationExecuteResult>(
  POINT_COMPENSATION_EXECUTE_PATH,
  {
    method: 'POST',
    body: JSON.stringify(payload),
  },
  {
    showSuccessMessage: true,
    successMessage: '积分补偿已执行',
  },
)
