/**
 * 内置厂商 / 模型目录（写死，取代原后台可配置的 AiProvider / AiModel 体系）。
 *
 * 设计：
 * - 厂商与模型的「基础设施」参数（baseUrl、端点、图片适配器、视频协议、groupId、
 *   maxImagesPerRequest、默认定价）全部写死在本文件，管理员不可改。
 * - 管理员在后台只能：① 填自己那份 API Key（按 ownerAdminId 租户隔离）；
 *   ② 调各模型定价（billingRule）与启停、会员门槛。这两样存 VendorSetting 表，
 *   运行时以「内置默认 ⊕ 该管理员覆盖」合并（见 server/vendor/service.ts）。
 *
 * 字段形状刻意对齐旧 AiModel 行：
 * - capabilityJson：图片模型含 { maxImagesPerRequest, imageAdapter }；视频模型为 null。
 *   imageAdapter 显式声明，避开 upstream-helpers 里按模型名正则推断的歧义。
 * - defaultParams：含 billingRule（marketing-center/readModelBillingRule 直接读）、
 *   membershipLevels、以及视频的 videoProtocol / groupId 等（video-task-executor 读合并后的 extraJson）。
 *
 * 现网基线（2026-07-03 从生产库导出的全局作用域定价）作为内置默认值；
 * 各管理员的历史定价在迁移时灌入 VendorSetting.pricingJson。
 */

export type VendorCode = 'cometapi' | 'chengmeng'
export type BuiltinModelCategory = 'IMAGE' | 'VIDEO'
export type ImageAdapterKey = 'openai-images' | 'gemini-generatecontent' | 'chat'

export interface BuiltinModel {
  category: BuiltinModelCategory
  /** 展示名（写入 GenerationRecord.modelLabel 快照）。 */
  name: string
  /** 下发上游的模型 id。 */
  modelKey: string
  sortOrder: number
  /** 默认是否选中（同类目录里挑一个 default）。 */
  isDefault?: boolean
  /** 对齐旧 AiModel.capabilityJson：图片给 { maxImagesPerRequest, imageAdapter }，视频为 null。 */
  capabilityJson: Record<string, unknown> | null
  /** 对齐旧 AiModel.defaultParamsJson：billingRule + membershipLevels + 视频协议参数。 */
  defaultParams: Record<string, unknown>
}

export interface BuiltinVendor {
  code: VendorCode
  name: string
  baseUrl: string
  chatEndpoint: string
  imageEndpoint: string
  imageEditEndpoint: string
  videoEndpoint: string
  /** 厂商级视频扩展（submitPath/statusPath 等），运行时作为底、被模型 defaultParams 覆盖。 */
  videoExtraJson: Record<string, unknown>
  supportedTypes: BuiltinModelCategory[]
  models: BuiltinModel[]
}

// ── 图片：CometAPI（仅图片）─────────────────────────────────────────────────
const COMETAPI: BuiltinVendor = {
  code: 'cometapi',
  name: 'CometAPI',
  baseUrl: 'https://api.cometapi.com/v1',
  chatEndpoint: '/chat/completions',
  imageEndpoint: '/images/generations',
  imageEditEndpoint: '/images/edits',
  videoEndpoint: '/videos',
  videoExtraJson: {},
  supportedTypes: ['IMAGE'],
  models: [
    {
      category: 'IMAGE',
      name: 'Nano Banana Pro',
      modelKey: 'gemini-3-pro-image',
      sortOrder: 0,
      isDefault: true,
      capabilityJson: { maxImagesPerRequest: 1, imageAdapter: 'gemini-generatecontent' },
      defaultParams: {
        membershipLevels: [],
        // 成本(CometAPI)：1K/2K=$0.1072、4K=$0.192；×7.2 元 ×1.6 = ×11.52 → 60% 加价。
        billingRule: {
          imageBillingMode: 'per_resolution',
          imageResolutionPrices: { '1K': 1.23, '2K': 1.23, '4K': 2.21 },
        },
      },
    },
    {
      category: 'IMAGE',
      name: 'Nano Banana 2',
      modelKey: 'gemini-3.1-flash-image-preview',
      sortOrder: 1,
      capabilityJson: { maxImagesPerRequest: 1, imageAdapter: 'gemini-generatecontent' },
      defaultParams: {
        membershipLevels: [],
        billingRule: {
          imageBillingMode: 'per_resolution',
          imageResolutionPrices: { '0.5K': 0.19, '1K': 0.29, '2K': 0.44, '4K': 0.65 },
        },
      },
    },
    {
      category: 'IMAGE',
      name: 'GPT Image 2',
      modelKey: 'gpt-image-2',
      sortOrder: 2,
      capabilityJson: { maxImagesPerRequest: 1, imageAdapter: 'openai-images' },
      defaultParams: {
        membershipLevels: [],
        // per_token：预扣 power 保底，真实费用由执行器按 usage 结算（输入 7.5 / 输出 45 每 1M）。
        billingRule: {
          power: 0.2,
          imageBillingMode: 'per_token',
          imageInputPricePer1M: 7.5,
          imageOutputPricePer1M: 45,
        },
      },
    },
  ],
}

// ── 视频：chengmeng.site（仅视频，chengmeng-async 协议）──────────────────────
const CHENGMENG: BuiltinVendor = {
  code: 'chengmeng',
  name: 'chengmeng',
  baseUrl: 'https://api.chengmeng.site/',
  chatEndpoint: '/chat/completions',
  imageEndpoint: '/images/generations',
  imageEditEndpoint: '/images/edits',
  videoEndpoint: '/videos',
  videoExtraJson: {
    submitPath: '/api/tasks',
    statusPath: '/api/tasks/:taskNo',
  },
  supportedTypes: ['VIDEO'],
  models: [
    // 标准版：chengmeng 模型 32「特价-sd2-4图-满血」，按次计费，默认分组 15，最多 4 张参考图。
    {
      category: 'VIDEO',
      name: '标准版（4图）',
      modelKey: '32',
      sortOrder: 0,
      isDefault: true,
      capabilityJson: null,
      defaultParams: {
        videoProtocol: 'chengmeng-async',
        groupId: '15',
        // 参考素材上限（真实规格：支持 4图 / 3视频 / 1音频）；执行器与前端据此裁剪。
        maxImages: 4,
        maxVideos: 3,
        maxAudios: 1,
        // 新接口按「全能参考」下发，隐藏首尾帧/智能多帧选择。
        videoFeatures: ['omni-reference'],
        membershipLevels: [],
        // 成本 4 元/次 × 1.6 = 6.4 分/次（60% 加价，1 积分=1 元）。分辨率同价（按次统一）。
        billingRule: {
          power: 6.4,
          videoBillingMode: 'per_count',
          videoResolutionPrices: { '720P': 6.4, '1080P': 6.4 },
        },
      },
    },
    // 极速版：chengmeng 模型 53「特价-sd2-4图-fast」，取代已下线的旧 fast 模型 31。按次计费，默认分组 15。
    {
      category: 'VIDEO',
      name: '极速版（4图）',
      modelKey: '53',
      sortOrder: 1,
      capabilityJson: null,
      defaultParams: {
        videoProtocol: 'chengmeng-async',
        groupId: '15',
        // 参考素材上限（真实规格：支持 4图 / 3视频 / 1音频）。
        maxImages: 4,
        maxVideos: 3,
        maxAudios: 1,
        videoFeatures: ['omni-reference'],
        membershipLevels: [],
        // 成本 3.3 元/次 × 1.6 = 5.28 分/次（60% 加价）。
        billingRule: {
          power: 5.28,
          videoBillingMode: 'per_count',
          videoResolutionPrices: { '720P': 5.28 },
        },
      },
    },
    // 高清版：chengmeng 模型 70「sd2-9图-满血」，支持 9 图参考 + 原生 4K/1080p/720p/480p。默认分组 18。
    // 按秒计费：成本 0.32 元/秒 × 1.6 = 0.512 分/秒（60% 加价，分辨率同价，chengmeng 按秒统一计费）。
    {
      category: 'VIDEO',
      name: '高清版（9图·原生4K）',
      modelKey: '70',
      sortOrder: 2,
      capabilityJson: null,
      defaultParams: {
        videoProtocol: 'chengmeng-async',
        groupId: '18',
        // 参考素材上限（9图-满血：9图 / 3视频 / 3音频）。
        maxImages: 9,
        maxVideos: 3,
        maxAudios: 3,
        videoFeatures: ['omni-reference'],
        membershipLevels: [],
        billingRule: {
          power: 0.512,
          videoBillingMode: 'per_second',
          videoResolutionPrices: { '480P': 0.512, '720P': 0.512, '1080P': 0.512, '4K': 0.512 },
        },
      },
    },
  ],
}

export const BUILTIN_VENDORS: BuiltinVendor[] = [COMETAPI, CHENGMENG]

const VENDOR_BY_CODE = new Map<string, BuiltinVendor>(BUILTIN_VENDORS.map(v => [v.code, v]))

export const isVendorCode = (value: unknown): value is VendorCode =>
  typeof value === 'string' && VENDOR_BY_CODE.has(value)

export const getBuiltinVendor = (code: string | null | undefined): BuiltinVendor | null =>
  VENDOR_BY_CODE.get(String(code || '').trim()) ?? null

export const listBuiltinVendors = (): BuiltinVendor[] => BUILTIN_VENDORS

/** 按厂商 code + modelKey 精确取模型（可选按类目过滤）。 */
export const findBuiltinModel = (
  vendorCode: string | null | undefined,
  modelKey: string | null | undefined,
  category?: BuiltinModelCategory,
): { vendor: BuiltinVendor; model: BuiltinModel } | null => {
  const vendor = getBuiltinVendor(vendorCode)
  if (!vendor) return null
  const key = String(modelKey || '').trim()
  const model = vendor.models.find(m => m.modelKey === key && (!category || m.category === category))
  return model ? { vendor, model } : null
}

/** 仅凭 modelKey 跨厂商定位（历史/回退场景；有 category 时限定类目，降低歧义）。 */
export const findBuiltinModelByKey = (
  modelKey: string | null | undefined,
  category?: BuiltinModelCategory,
): { vendor: BuiltinVendor; model: BuiltinModel } | null => {
  const key = String(modelKey || '').trim()
  if (!key) return null
  for (const vendor of BUILTIN_VENDORS) {
    const model = vendor.models.find(m => m.modelKey === key && (!category || m.category === category))
    if (model) return { vendor, model }
  }
  return null
}
