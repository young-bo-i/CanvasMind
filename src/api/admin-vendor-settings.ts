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

export const listVendorSettings = () => adminGet<VendorSettingItem[]>('/api/vendor/settings')

export const updateVendorSetting = (vendorCode: string, payload: VendorSettingUpdatePayload) =>
  adminPut<VendorSettingItem[]>(`/api/vendor/settings/${encodeURIComponent(vendorCode)}`, payload)
