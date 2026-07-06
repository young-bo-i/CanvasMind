import { adminGet, adminPut } from './admin-request'

export interface VendorModelBillingRule {
  power?: number
  imageBillingMode?: string
  imageResolutionPrices?: Record<string, number>
  imageInputPricePer1M?: number
  imageOutputPricePer1M?: number
  videoBillingMode?: string
  videoResolutionPrices?: Record<string, number>
  [key: string]: unknown
}

export interface VendorModelSetting {
  modelKey: string
  name: string
  category: 'IMAGE' | 'VIDEO'
  sortOrder: number
  defaultBillingRule: VendorModelBillingRule | null
  override: {
    enabled?: boolean
    billingRule?: VendorModelBillingRule | null
    membershipLevels?: unknown[]
  } | null
}

export interface VendorSettingItem {
  vendorCode: string
  name: string
  baseUrl: string
  supportedTypes: string[]
  hasApiKey: boolean
  apiKeyHint: string
  isEnabled: boolean
  models: VendorModelSetting[]
}

export interface VendorSettingUpdatePayload {
  apiKey?: string | null
  isEnabled?: boolean
  pricing?: Record<string, { enabled?: boolean; billingRule?: VendorModelBillingRule } | null>
}

export interface VendorScopeOption {
  scopeId: string | null
  label: string
}

// 超管可管理的作用域清单（全局 + 各普通管理员）；普管返回空。
export const listVendorScopes = () => adminGet<VendorScopeOption[]>('/api/vendor/settings/scopes')

// scope: 'global' 或 管理员 id（超管代配时用）；普管传不传都锁定自己。
export const listVendorSettings = (scope?: string) =>
  adminGet<VendorSettingItem[]>('/api/vendor/settings', scope ? { query: { scope } } : {})

export const updateVendorSetting = (vendorCode: string, payload: VendorSettingUpdatePayload, scope?: string) =>
  adminPut<VendorSettingItem[]>(
    `/api/vendor/settings/${encodeURIComponent(vendorCode)}`,
    scope ? { ...payload, scope } : payload,
  )
