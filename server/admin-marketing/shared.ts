import { readJsonBody, sendJson } from '../ai-gateway/shared'

export interface MarketingMembershipLevelPayload {
  name?: string
  level?: number
  description?: string
  iconUrl?: string
  monthlyBonusPoints?: number
  storageCapacity?: number
  // 会员积分消耗减免百分比(0-100)。
  pointDiscountPercent?: number
  benefitsJson?: unknown
  isEnabled?: boolean
  sortOrder?: number
}

export interface MarketingCardBatchPayload {
  name?: string
  batchNo?: string
  description?: string
  rewardType?: string
  rewardPoints?: number
  rewardLevelId?: string
  rewardDays?: number | null
  totalCount?: number
  expiresAt?: string
  isEnabled?: boolean
  metaJson?: unknown
}

export interface MarketingPointCompensationQueryPayload {
  days?: number
  limit?: number
}

export interface MarketingPointLogQueryPayload {
  days?: number
  page?: number
  pageSize?: number
  action?: string
  sourceType?: string
  endpointType?: string
  refundStatus?: string
  keyword?: string
}

export interface MarketingPointCompensationExecutePayload {
  associationNos?: string[]
  note?: string
  forceManual?: boolean
}

// 读取营销中心请求体。
export const readMarketingBody = async <T = Record<string, unknown>>(req: any) => {
  const payload = await readJsonBody(req)
  return payload as T
}

// 返回统一的营销中心错误。
export const sendMarketingError = (res: any, statusCode: number, message: string) => {
  sendJson(res, statusCode, {
    message,
    error: {
      type: 'admin_marketing_error',
      message,
    },
  })
}
