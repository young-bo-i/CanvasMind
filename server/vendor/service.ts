/**
 * 内置厂商运行时服务。
 *
 * 取代原 server/provider-config 的 4 个解析函数与公开模型目录：
 * 数据源从「查 ai_providers / ai_models 行」换成「内置目录(builtin-catalog) ⊕ 该管理员的 VendorSetting 覆盖」。
 *
 * 租户语义沿用原 resolveProviderOwnerScope：
 *  - 超管 / 平台直属用户 → scope=null（全局桶 VendorSetting.owner_admin_id IS NULL）
 *  - 普通管理员本人 → 自己的 id
 *  - 普通用户 → 其 ownerAdminId（创建他的管理员）
 * 厂商与模型清单对所有作用域一致（写死）；每个作用域各自持有 API Key 与定价覆盖。
 */
import { isPrismaConfigured, prisma } from '../db/prisma'
import { decryptApiKey, encryptApiKey, maskApiKey } from '../shared/crypto'
import { getOrSetJsonCache, invalidateRedisCachePatterns, redisKeys } from '../redis'
import {
  type AiEndpointType,
  isAiEndpointType,
  resolveEndpointModelCategory,
  resolveProviderEndpointField,
} from '../../src/shared/provider-endpoint-strategy'
import {
  type BuiltinModel,
  type BuiltinModelCategory,
  type BuiltinVendor,
  type VendorCode,
  findBuiltinModel,
  getBuiltinVendor,
  isVendorCode,
  listBuiltinVendors,
} from './builtin-catalog'

// ── 作用域解析（与 provider-config/resolveProviderOwnerScope 同语义）──────────
export const resolveVendorScope = async (userId?: string | null): Promise<string | null> => {
  const id = String(userId || '').trim()
  if (!id) return null
  const user = await prisma.appUser.findUnique({
    where: { id },
    select: { id: true, role: true, ownerAdminId: true },
  })
  if (!user) return null
  if (user.role === 'SUPER_ADMIN') return null
  if (user.role === 'ADMIN') return user.id
  const adminId = String(user.ownerAdminId || '').trim()
  if (!adminId) return null
  const admin = await prisma.appUser.findUnique({ where: { id: adminId }, select: { role: true } })
  if (!admin || admin.role === 'SUPER_ADMIN') return null
  return adminId
}

// ── VendorSetting 行读取 ─────────────────────────────────────────────────────
type VendorSettingRow = {
  isEnabled: boolean
  apiKeyEncrypted: string | null
  apiKeyHint: string | null
  pricingJson: unknown
}

const getVendorSettingRow = async (
  scope: string | null,
  vendorCode: VendorCode,
): Promise<VendorSettingRow | null> => {
  if (!isPrismaConfigured()) return null
  // orderBy 保证确定性：全局桶(owner_admin_id IS NULL)在 MySQL 复合唯一下不去重，
  // 万一存在重复行也稳定取最新一条（写侧另需哨兵/加锁保唯一，见 upsertVendorSetting）。
  return prisma.vendorSetting.findFirst({
    where: { ownerAdminId: scope, vendorCode },
    select: { isEnabled: true, apiKeyEncrypted: true, apiKeyHint: true, pricingJson: true },
    orderBy: { updatedAt: 'desc' },
  })
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

const readModelOverride = (row: VendorSettingRow | null, modelKey: string): Record<string, unknown> | null => {
  const pricing = asRecord(row?.pricingJson)
  if (!pricing) return null
  return asRecord(pricing[modelKey])
}

// 分辨率单价子表：按档位逐键合并（内置为底、override 覆盖已给档），避免只改一档就丢掉其余档。
const RESOLUTION_PRICE_KEYS = ['imageResolutionPrices', 'videoResolutionPrices']

// billingRule 字段级深合并：内置为底，override 只覆盖它显式给出的字段。
// 关键：防止「部分覆盖」丢掉内置的 imageBillingMode/videoBillingMode/power
// 而被 readModelBillingRule 归一成 per_image/power=0 → 免费出图/漏计费。
export const deepMergeBillingRule = (
  base: unknown,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...(asRecord(base) || {}) }
  for (const [key, value] of Object.entries(override)) {
    if (RESOLUTION_PRICE_KEYS.includes(key)) {
      const overMap = asRecord(value)
      if (overMap) merged[key] = { ...(asRecord(merged[key]) || {}), ...overMap }
      else merged[key] = value
    } else {
      merged[key] = value
    }
  }
  return merged
}

// ── 内置模型 ⊕ 覆盖合并 ──────────────────────────────────────────────────────
export interface MergedVendorModel {
  vendor: BuiltinVendor
  model: BuiltinModel
  category: BuiltinModelCategory
  /** 稳定合成 id（无数据库行），供旧接口的 modelId 字段沿用。 */
  modelId: string
  name: string
  modelKey: string
  capabilityJson: Record<string, unknown> | null
  /** 内置 defaultParams 为底，覆盖 billingRule / membershipLevels。 */
  defaultParamsJson: Record<string, unknown>
  isEnabled: boolean
}

const mergeModelWithRow = (
  vendor: BuiltinVendor,
  model: BuiltinModel,
  row: VendorSettingRow | null,
): MergedVendorModel => {
  const override = readModelOverride(row, model.modelKey)
  const defaultParamsJson: Record<string, unknown> = { ...model.defaultParams }
  if (override) {
    const overrideBilling = asRecord(override.billingRule)
    // 字段级深合并（而非整体替换），内置 billingRule 为底，避免部分覆盖丢模式导致免费出图。
    if (overrideBilling) {
      defaultParamsJson.billingRule = deepMergeBillingRule(model.defaultParams.billingRule, overrideBilling)
    }
    if (Array.isArray(override.membershipLevels)) defaultParamsJson.membershipLevels = override.membershipLevels
  }
  const isEnabled = override && typeof override.enabled === 'boolean' ? override.enabled : true
  return {
    vendor,
    model,
    category: model.category,
    modelId: `${vendor.code}::${model.modelKey}`,
    name: model.name,
    modelKey: model.modelKey,
    capabilityJson: model.capabilityJson,
    defaultParamsJson,
    isEnabled,
  }
}

export const resolveMergedModel = async (input: {
  vendorCode: string
  modelKey: string
  category?: BuiltinModelCategory
  scope?: string | null
}): Promise<MergedVendorModel | null> => {
  const found = findBuiltinModel(input.vendorCode, input.modelKey, input.category)
  if (!found) return null
  const row = await getVendorSettingRow(input.scope ?? null, found.vendor.code)
  return mergeModelWithRow(found.vendor, found.model, row)
}

// ── API Key 解析 ─────────────────────────────────────────────────────────────
export const resolveVendorApiKey = async (scope: string | null, vendorCode: VendorCode): Promise<string> => {
  const row = await getVendorSettingRow(scope, vendorCode)
  if (!row || !row.isEnabled || !row.apiKeyEncrypted) return ''
  return decryptApiKey(row.apiKeyEncrypted)
}

// ── 校验厂商标识（作用域不限制可用厂商，只限制用哪份 key；此处仅校验 code 合法）──
export const assertProviderInScope = async (providerId: string, _userId?: string | null): Promise<void> => {
  const code = String(providerId || '').trim()
  if (!code) return
  if (!isVendorCode(code)) {
    throw new Error('厂商不存在')
  }
}

// ── 图片单次最多出图张数（供服务端 clamp）──────────────────────────────────────
export const resolveImageModelMaxImagesPerRequest = async (
  providerId: string,
  modelKey: string,
): Promise<number | null> => {
  const found = findBuiltinModel(providerId, modelKey, 'IMAGE')
  if (!found) return null
  const cap = asRecord(found.model.capabilityJson)
  const value = Number(cap?.maxImagesPerRequest)
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : null
}

// ── 通用上游解析（chat/image/image-edit）──────────────────────────────────────
export const resolveGatewayProviderUpstream = async (input: {
  providerId?: string
  endpointType?: AiEndpointType
  modelKey?: string
  userId?: string | null
}) => {
  const vendorCode = String(input.providerId || '').trim()
  const endpointType = String(input.endpointType || '').trim().toLowerCase()

  if (!vendorCode) throw new Error('缺少厂商标识')
  if (!isAiEndpointType(endpointType)) throw new Error('缺少有效的上游接口类型')

  const vendor = getBuiltinVendor(vendorCode)
  if (!vendor) throw new Error('厂商不可用或未启用')

  const scope = await resolveVendorScope(input.userId)
  const apiKey = await resolveVendorApiKey(scope, vendor.code)
  if (!apiKey) throw new Error(`厂商 ${vendor.name} 未配置 API Key`)

  let modelCapabilityJson: unknown = null
  const modelKey = String(input.modelKey || '').trim()
  if (modelKey) {
    const category = resolveEndpointModelCategory(endpointType)
    if (category !== 'IMAGE' && category !== 'VIDEO') {
      throw new Error('模型不存在或未启用')
    }
    const merged = await resolveMergedModel({ vendorCode: vendor.code, modelKey, category, scope })
    if (!merged || !merged.isEnabled) throw new Error('模型不存在或未启用')
    modelCapabilityJson = merged.capabilityJson ?? null
  }

  const endpoint = vendor[resolveProviderEndpointField(endpointType)]

  return {
    baseUrl: vendor.baseUrl,
    apiKey,
    endpoint,
    chatEndpoint: vendor.chatEndpoint,
    modelCapabilityJson,
  }
}

// ── 视频上游解析（返回 extraJson 供 video-task-executor 做 submit+poll）─────────
export const resolveVideoProviderUpstream = async (input: {
  providerId: string
  modelKey: string
  userId?: string | null
}) => {
  const vendorCode = String(input.providerId || '').trim()
  if (!vendorCode) throw new Error('缺少厂商标识')

  const vendor = getBuiltinVendor(vendorCode)
  if (!vendor) throw new Error('厂商不可用或未启用')

  const scope = await resolveVendorScope(input.userId)
  const apiKey = await resolveVendorApiKey(scope, vendor.code)
  if (!apiKey) throw new Error(`厂商 ${vendor.name} 未配置 API Key`)

  const modelKey = String(input.modelKey || '').trim()
  let modelDefaultParams: Record<string, unknown> | null = null
  if (modelKey) {
    const merged = await resolveMergedModel({ vendorCode: vendor.code, modelKey, category: 'VIDEO', scope })
    if (!merged || !merged.isEnabled) throw new Error('视频模型不存在或未启用')
    modelDefaultParams = merged.defaultParamsJson
  }

  // 合并：厂商级视频扩展(submitPath/statusPath)为底，模型 defaultParams(协议/groupId/billingRule)覆盖在上。
  const extraJson: Record<string, unknown> = {
    ...vendor.videoExtraJson,
    ...(modelDefaultParams || {}),
  }

  return {
    baseUrl: vendor.baseUrl,
    apiKey,
    videoEndpoint: vendor.videoEndpoint,
    extraJson,
    modelDefaultParams,
  }
}

// ── 公开模型目录（内置 ⊕ 覆盖），形状对齐旧 getPublicModelCatalog ─────────────
export interface PublicModelCatalogItem {
  id: string
  selectionKey: string
  providerId: string
  providerCode: string
  providerName: string
  category: BuiltinModelCategory
  label: string
  modelKey: string
  description: string
  capabilityJson: Record<string, unknown> | null
  defaultParamsJson: Record<string, unknown> | null
  sortOrder: number
  isDefault: boolean
}

export interface PublicModelCatalogResult {
  providers: Array<{
    id: string
    code: string
    name: string
    iconUrl: string
    supportedTypes: string[]
    sortOrder: number
  }>
  models: {
    chat: PublicModelCatalogItem[]
    image: PublicModelCatalogItem[]
    video: PublicModelCatalogItem[]
  }
  defaults: { chat: string; image: string; video: string }
}

// 目录按作用域分键缓存 60s（对齐旧 provider-config 行为，避免每次目录加载多次查 VendorSetting）。
const buildCatalogCacheKey = (scope: string | null) => redisKeys.cache('vendor', `catalog:${scope || 'global'}`)
const CATALOG_CACHE_PATTERN = redisKeys.cache('vendor', 'catalog:*')

export const invalidateVendorCatalogCache = async () => {
  await invalidateRedisCachePatterns([CATALOG_CACHE_PATTERN])
}

export const getPublicVendorCatalog = async (scope: string | null = null): Promise<PublicModelCatalogResult> => {
  return getOrSetJsonCache({
    key: buildCatalogCacheKey(scope),
    ttlSeconds: 60,
    factory: () => buildPublicVendorCatalog(scope),
  })
}

const buildPublicVendorCatalog = async (scope: string | null): Promise<PublicModelCatalogResult> => {
  const providers: PublicModelCatalogResult['providers'] = []
  const image: PublicModelCatalogItem[] = []
  const video: PublicModelCatalogItem[] = []

  for (const vendor of listBuiltinVendors()) {
    const row = await getVendorSettingRow(scope, vendor.code)
    // 无 key / 已停用的厂商不出现在目录（与旧「未配置厂商 → 空目录」一致，避免用户选到必然失败的模型）。
    if (!row?.isEnabled || !row.apiKeyEncrypted) continue

    providers.push({
      id: vendor.code,
      code: vendor.code,
      name: vendor.name,
      iconUrl: '',
      supportedTypes: vendor.supportedTypes,
      sortOrder: 0,
    })

    for (const model of vendor.models) {
      const merged = mergeModelWithRow(vendor, model, row)
      if (!merged.isEnabled) continue
      const item: PublicModelCatalogItem = {
        id: merged.modelId,
        selectionKey: `${vendor.code}::${model.category}::${model.modelKey}`,
        providerId: vendor.code,
        providerCode: vendor.code,
        providerName: vendor.name,
        category: model.category,
        label: model.name,
        modelKey: model.modelKey,
        description: '',
        capabilityJson: merged.capabilityJson,
        defaultParamsJson: merged.defaultParamsJson,
        sortOrder: model.sortOrder,
        isDefault: Boolean(model.isDefault),
      }
      if (model.category === 'IMAGE') image.push(item)
      else if (model.category === 'VIDEO') video.push(item)
    }
  }

  const pickDefault = (items: PublicModelCatalogItem[]) =>
    items.find(item => item.isDefault)?.selectionKey || items[0]?.selectionKey || ''

  return {
    providers,
    models: { chat: [], image, video },
    defaults: { chat: '', image: pickDefault(image), video: pickDefault(video) },
  }
}

// ── 后台：读取某作用域的厂商配置（供「填 key + 调价」页面）─────────────────────
// 返回内置厂商/模型清单 + 该作用域的 key 掩码/启停/定价覆盖（不回传明文 key）。
export const getAdminVendorSettings = async (scope: string | null) => {
  const result = []
  for (const vendor of listBuiltinVendors()) {
    const row = await getVendorSettingRow(scope, vendor.code)
    const pricing = asRecord(row?.pricingJson) || {}
    result.push({
      vendorCode: vendor.code,
      name: vendor.name,
      baseUrl: vendor.baseUrl,
      supportedTypes: vendor.supportedTypes,
      hasApiKey: Boolean(row?.apiKeyEncrypted),
      apiKeyHint: row?.apiKeyHint || '',
      isEnabled: row ? row.isEnabled : true,
      models: vendor.models.map((m) => {
        const override = asRecord(pricing[m.modelKey])
        return {
          modelKey: m.modelKey,
          name: m.name,
          category: m.category,
          sortOrder: m.sortOrder,
          // 内置默认（作为调价表单的默认值）+ 该作用域已存的覆盖。
          defaultBillingRule: asRecord((m.defaultParams as Record<string, unknown>).billingRule),
          override: override
            ? {
                enabled: typeof override.enabled === 'boolean' ? override.enabled : undefined,
                billingRule: asRecord(override.billingRule),
                membershipLevels: Array.isArray(override.membershipLevels) ? override.membershipLevels : undefined,
              }
            : null,
        }
      }),
    })
  }
  return result
}

export interface VendorSettingUpdatePayload {
  // 明文 key：不传=不改；空串=清空；有值=加密写入。
  apiKey?: string | null
  isEnabled?: boolean
  // 按 modelKey 的定价/启停覆盖；某项传 null=删除该模型覆盖（回落内置默认）。
  pricing?: Record<string, { enabled?: boolean; billingRule?: Record<string, unknown>; membershipLevels?: unknown[] } | null>
}

// ── 后台：写入某作用域某厂商的 key/定价 ──────────────────────────────────────
// 全局桶(scope=null)在 MySQL 复合唯一下不去重，故先查后写（而非依赖 upsert）：
// 有行则按 id 更新，无行则新建，避免产生重复全局行。
export const upsertVendorSetting = async (
  scope: string | null,
  vendorCode: string,
  payload: VendorSettingUpdatePayload,
): Promise<void> => {
  if (!isVendorCode(vendorCode)) {
    throw new Error('厂商不存在')
  }

  const existing = await prisma.vendorSetting.findFirst({
    where: { ownerAdminId: scope, vendorCode },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, pricingJson: true },
  })

  const data: Record<string, unknown> = {}

  if (payload.isEnabled !== undefined) {
    data.isEnabled = Boolean(payload.isEnabled)
  }

  if (payload.apiKey !== undefined) {
    const key = String(payload.apiKey || '').trim()
    if (key) {
      data.apiKeyEncrypted = encryptApiKey(key)
      data.apiKeyHint = maskApiKey(key)
    } else {
      data.apiKeyEncrypted = null
      data.apiKeyHint = null
    }
  }

  if (payload.pricing !== undefined) {
    const current = asRecord(existing?.pricingJson) || {}
    const next: Record<string, unknown> = { ...current }
    for (const [modelKey, override] of Object.entries(payload.pricing)) {
      if (override === null || override === undefined) delete next[modelKey]
      else next[modelKey] = override
    }
    data.pricingJson = next
  }

  if (existing) {
    await prisma.vendorSetting.update({ where: { id: existing.id }, data })
  } else {
    await prisma.vendorSetting.create({ data: { ownerAdminId: scope, vendorCode, ...data } })
  }

  await invalidateVendorCatalogCache()
}
