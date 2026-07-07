/**
 * 模型配置与前端模型注册表
 * 统一从后台公开模型目录读取，不再使用前端静态模型清单。
 */

import { ref, watch } from 'vue'
import { buildApiUrl } from '@/api/http'
import { readApiData } from '@/api/response'
import { useAuthStore } from '@/stores/auth'

export interface SizeOption {
  label: string
  key: string
}

export interface QualityOption {
  label: string
  key: string
}

export interface DurationOption {
  label: string
  key: number
}

export interface BaseCatalogModel {
  id: string
  key: string
  label: string
  modelKey: string
  providerId: string
  providerCode: string
  providerName: string
  description: string
  capabilityJson: Record<string, any> | null
  defaultParams: Record<string, unknown>
  sortOrder: number
  isDefault: boolean
}

export interface ImageModel extends BaseCatalogModel {
  sizes: string[]
  tips?: string
  qualities?: QualityOption[]
  getSizesByQuality?: (quality: string) => SizeOption[]
  /**
   * 单次请求最多返回多少张图（对应上游 n 参数的硬上限）。
   * 由后台配置在 capabilityJson.maxImagesPerRequest 中提供；
   * 不同上游限制不一样（gpt-image-2 = 4，部分模型 = 1，少数 = 10）。
   * 前端步进器与后端 normalize 均会以此为上限 clamp。
   */
  maxImagesPerRequest: number
}

export interface VideoModel extends BaseCatalogModel {
  ratios: string[]
  durs: DurationOption[]
}

export interface ChatModel extends BaseCatalogModel {}

export interface PublicModelCatalogItem {
  id: string
  selectionKey: string
  providerId: string
  providerCode: string
  providerName: string
  category: 'CHAT' | 'IMAGE' | 'VIDEO'
  label: string
  modelKey: string
  description: string
  capabilityJson: Record<string, any> | null
  defaultParamsJson: Record<string, any> | null
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
  defaults: {
    chat: string
    image: string
    video: string
  }
}

// 内置厂商目录（内置模型 ⊕ 该管理员定价覆盖）。providerId 现为厂商 code（cometapi/chengmeng）。
const MODEL_CATALOG_API_PATH = '/api/vendor/catalog'

// 豆包图片尺寸选项
export const SEEDREAM_SIZE_OPTIONS: SizeOption[] = [
  { label: '21:9', key: '3024x1296' },
  { label: '16:9', key: '2560x1440' },
  { label: '4:3', key: '2304x1728' },
  { label: '3:2', key: '2496x1664' },
  { label: '1:1', key: '2048x2048' },
  { label: '2:3', key: '1664x2496' },
  { label: '3:4', key: '1728x2304' },
  { label: '9:16', key: '1440x2560' },
  { label: '9:21', key: '1296x3024' },
]

export const SEEDREAM_4K_SIZE_OPTIONS: SizeOption[] = [
  { label: '21:9', key: '6198x2656' },
  { label: '16:9', key: '5404x3040' },
  { label: '4:3', key: '4694x3520' },
  { label: '3:2', key: '4992x3328' },
  { label: '1:1', key: '4096x4096' },
  { label: '2:3', key: '3328x4992' },
  { label: '3:4', key: '3520x4694' },
  { label: '9:16', key: '3040x5404' },
  { label: '9:21', key: '2656x6198' },
]

export const SEEDREAM_QUALITY_OPTIONS: QualityOption[] = [
  { label: '标准画质', key: 'standard' },
  { label: '4K 高清', key: '4k' },
]

export const BANANA_SIZE_OPTIONS: SizeOption[] = [
  { label: '21:9', key: '21x9' },
  { label: '16:9', key: '16x9' },
  { label: '4:3', key: '4x3' },
  { label: '3:2', key: '3x2' },
  { label: '1:1', key: '1x1' },
  { label: '2:3', key: '2x3' },
  { label: '3:4', key: '3x4' },
  { label: '9:16', key: '9x16' },
  { label: '9:21', key: '9x21' },
]

export const VIDEO_RATIO_LIST: SizeOption[] = [
  { label: '16:9 (横版)', key: '16x9' },
  { label: '4:3', key: '4x3' },
  { label: '1:1 (方形)', key: '1x1' },
  { label: '3:4', key: '3x4' },
  { label: '9:16 (竖版)', key: '9x16' },
]

export const VIDEO_DURATION_OPTIONS: DurationOption[] = [
  { label: '5 秒', key: 5 },
  { label: '10 秒', key: 10 },
]

// 兼容旧代码的导出，避免类型引用报错。
export const IMAGE_MODELS: ImageModel[] = []
export const VIDEO_MODELS: VideoModel[] = []
export const CHAT_MODELS: ChatModel[] = []
export const DEFAULT_IMAGE_MODEL = ''
export const DEFAULT_VIDEO_MODEL = ''
export const DEFAULT_CHAT_MODEL = ''

const emptyCatalog: PublicModelCatalogResult = {
  providers: [],
  models: {
    chat: [],
    image: [],
    video: [],
  },
  defaults: {
    chat: '',
    image: '',
    video: '',
  },
}

const modelCatalogRef = ref<PublicModelCatalogResult>(emptyCatalog)
let modelCatalogPromise: Promise<PublicModelCatalogResult> | null = null
// 内存 TTL：与后端 60s Redis 缓存对齐。命中期内非 force 调用直接返回内存数据，
// 避免每次进生成页 / 切图片↔视频工具栏 / 路由切换都重复拉同一份目录（响应无浏览器缓存头）。
let modelCatalogLoadedAt = 0
const MODEL_CATALOG_TTL_MS = 60_000

const toImageModel = (item: PublicModelCatalogItem): ImageModel => {
  const defaultParams = item.defaultParamsJson || {}
  const normalizedSize = String(defaultParams.size || '').trim().toLowerCase()
  const hasSeedreamSize = /\d+x\d+/.test(normalizedSize)
  const sizes = hasSeedreamSize
    ? SEEDREAM_SIZE_OPTIONS.map(option => option.key)
    : BANANA_SIZE_OPTIONS.map(option => option.key)

  // 单次出图最大张数：从 capabilityJson.maxImagesPerRequest 读取，未配置时缺省 1（最保守，
  // 防止跨上游误差直接打穿；管理员可在后台模型配置里覆写为对应上游的真实上限）。
  const capability = (item.capabilityJson || {}) as Record<string, unknown>
  const rawMaxImages = Number(capability.maxImagesPerRequest)
  const maxImagesPerRequest = Number.isFinite(rawMaxImages) && rawMaxImages >= 1
    ? Math.floor(rawMaxImages)
    : 1

  return {
    id: item.id,
    key: item.selectionKey,
    label: item.label,
    modelKey: item.modelKey,
    providerId: item.providerId,
    providerCode: item.providerCode,
    providerName: item.providerName,
    description: item.description,
    capabilityJson: item.capabilityJson,
    defaultParams,
    sortOrder: item.sortOrder,
    isDefault: item.isDefault,
    sizes,
    maxImagesPerRequest,
    qualities: hasSeedreamSize ? SEEDREAM_QUALITY_OPTIONS : undefined,
    getSizesByQuality: hasSeedreamSize
      ? (quality: string) => quality === '4k' ? SEEDREAM_4K_SIZE_OPTIONS : SEEDREAM_SIZE_OPTIONS
      : undefined,
    tips: sizes.length ? undefined : '当前模型请在提示词中描述尺寸',
  }
}

const toVideoModel = (item: PublicModelCatalogItem): VideoModel => ({
  id: item.id,
  key: item.selectionKey,
  label: item.label,
  modelKey: item.modelKey,
  providerId: item.providerId,
  providerCode: item.providerCode,
  providerName: item.providerName,
  description: item.description,
  capabilityJson: item.capabilityJson,
  defaultParams: item.defaultParamsJson || {},
  sortOrder: item.sortOrder,
  isDefault: item.isDefault,
  ratios: VIDEO_RATIO_LIST.map(option => option.key),
  durs: VIDEO_DURATION_OPTIONS,
})

const toChatModel = (item: PublicModelCatalogItem): ChatModel => ({
  id: item.id,
  key: item.selectionKey,
  label: item.label,
  modelKey: item.modelKey,
  providerId: item.providerId,
  providerCode: item.providerCode,
  providerName: item.providerName,
  description: item.description,
  capabilityJson: item.capabilityJson,
  defaultParams: item.defaultParamsJson || {},
  sortOrder: item.sortOrder,
  isDefault: item.isDefault,
})

const sortModels = <T extends BaseCatalogModel>(models: T[]) => [...models].sort((first, second) => {
  if (first.sortOrder !== second.sortOrder) {
    return first.sortOrder - second.sortOrder
  }
  return first.label.localeCompare(second.label)
})

const applyModelCatalog = (value?: PublicModelCatalogResult) => {
  modelCatalogRef.value = value || emptyCatalog
  return modelCatalogRef.value
}

export const loadPublicModelCatalog = async (force = false) => {
  if (!force && modelCatalogPromise) {
    return modelCatalogPromise
  }
  // TTL 命中：未过期直接复用内存目录。
  if (!force && modelCatalogLoadedAt && Date.now() - modelCatalogLoadedAt < MODEL_CATALOG_TTL_MS) {
    return modelCatalogRef.value
  }

  modelCatalogPromise = fetch(buildApiUrl(MODEL_CATALOG_API_PATH), {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
  })
    .then(response => readApiData<PublicModelCatalogResult>(response))
    .then((data) => {
      modelCatalogLoadedAt = Date.now() // 仅成功时打时间戳，失败不抑制后续重试
      return applyModelCatalog(data)
    })
    .catch(() => applyModelCatalog(emptyCatalog))
    .finally(() => {
      modelCatalogPromise = null
    })

  return modelCatalogPromise
}

// 模型目录现按"用户所属管理员"的厂商作用域返回（每个普管的用户只看到该管理员的模型）。
// 登录 / 登出 / 切换账号时强制重载，避免沿用上一个作用域的旧目录。
// 仅在 id 真正变化时 force：避免 currentUser 对象被替换但 id 未变（如资料刷新）时的无谓重拉。
let lastCatalogUserId = ''
watch(
  () => useAuthStore().currentUser.value?.id || '',
  (userId) => {
    if (userId === lastCatalogUserId) return
    lastCatalogUserId = userId
    void loadPublicModelCatalog(true)
  },
)

export const getPublicModelCatalog = () => modelCatalogRef.value

export const getAllImageModels = (): ImageModel[] => sortModels(modelCatalogRef.value.models.image.map(toImageModel))
export const getAllVideoModels = (): VideoModel[] => sortModels(modelCatalogRef.value.models.video.map(toVideoModel))
export const getAllChatModels = (): ChatModel[] => sortModels(modelCatalogRef.value.models.chat.map(toChatModel))

export const getDefaultImageModelKey = () => modelCatalogRef.value.defaults.image || getAllImageModels()[0]?.key || ''
export const getDefaultVideoModelKey = () => modelCatalogRef.value.defaults.video || getAllVideoModels()[0]?.key || ''
export const getDefaultChatModelKey = () => modelCatalogRef.value.defaults.chat || getAllChatModels()[0]?.key || ''

export const findCatalogModel = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const normalizedKey = String(key || '').trim()
  if (!normalizedKey) {
    return null
  }

  const groups = category
    ? [category === 'CHAT' ? modelCatalogRef.value.models.chat : category === 'IMAGE' ? modelCatalogRef.value.models.image : modelCatalogRef.value.models.video]
    : [modelCatalogRef.value.models.chat, modelCatalogRef.value.models.image, modelCatalogRef.value.models.video]

  for (const group of groups) {
    const matched = group.find(item => item.selectionKey === normalizedKey || item.modelKey === normalizedKey)
    if (matched) {
      return matched
    }
  }

  return null
}

export const resolveModelSelectionKey = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.selectionKey || ''
}

export const resolveRequestModelKey = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.modelKey || String(key || '').trim()
}

export const resolveRequestProviderId = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.providerId || ''
}

export const resolveModelLabel = (key: string, category?: 'CHAT' | 'IMAGE' | 'VIDEO') => {
  const matched = findCatalogModel(key, category)
  return matched?.label || String(key || '').trim()
}

export const getModelByName = (key: string) => {
  const matched = findCatalogModel(key)
  if (!matched) {
    return null
  }

  if (matched.category === 'IMAGE') {
    return toImageModel(matched)
  }

  if (matched.category === 'VIDEO') {
    return toVideoModel(matched)
  }

  return toChatModel(matched)
}
