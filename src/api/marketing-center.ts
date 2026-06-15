import { buildApiUrl } from './http'
import { readApiData } from './response'

export interface MarketingCenterOverviewResponse {
  user: {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    role: string | null
    createdAt: string
  } | null
  points: {
    balance: number
    available: number
    logs: Array<Record<string, unknown>>
  }
  subscription: Record<string, unknown> | null
  cardRedeemRecords: Array<Record<string, unknown>>
}

const requestJson = async <T>(path: string, options: RequestInit = {}, successMessage = '') => {
  const response = await fetch(buildApiUrl(path), {
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
    showSuccessMessage: Boolean(successMessage),
    successMessage,
  })
}

// 查询用户营销中心总览。
export const getMarketingCenterOverview = async () => {
  return requestJson<MarketingCenterOverviewResponse>('/api/marketing/overview', { method: 'GET' })
}

// 执行卡密兑换。
export const redeemMarketingCardCode = (code: string) => requestJson('/api/marketing/card-redeem', {
  method: 'POST',
  body: JSON.stringify({ code }),
}, '卡密兑换成功')
