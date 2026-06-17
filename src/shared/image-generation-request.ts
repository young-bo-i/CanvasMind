/**
 * 图生图请求辅助工具
 * 统一工作流与主生成器的参考图排序、清洗和请求字段注入逻辑
 */

// 兼容 gpt-image / OpenAI 图片接口的合规像素尺寸（边长均为 16 的倍数）。
// 内置三档覆盖 方/横/竖，作为模型未配置 sizes 时的兜底。
const DEFAULT_IMAGE_PIXEL_SIZES = ['1024x1024', '1536x1024', '1024x1536']

// 把 "1:1" / "16:9" / "1024x1024" 统一解析出宽高比；解析不出（如 "auto"）返回 null。
const parseSizeAspect = (value: unknown): { raw: string; aspect: number } | null => {
  const raw = String(value || '').trim()
  const matched = raw.match(/^(\d+(?:\.\d+)?)\s*[:：x×X]\s*(\d+(?:\.\d+)?)$/)
  if (!matched) return null
  const w = Number(matched[1])
  const h = Number(matched[2])
  return w > 0 && h > 0 ? { raw, aspect: w / h } : null
}

// 各分辨率档位的目标「长边」像素（与 normalizeImageResolution / 前端 IMAGE_RESOLUTION_ORDER 对齐）。
// 4K 目标长边取 3840(UHD)而非 4096(DCI):gpt-image-2 等上游明确要求"最长边 ≤ 3840",
// 传 4096 会被 HTTP 400 "The longest edge must be less than or equal to 3840." 拒绝。
const RESOLUTION_TARGET_LONG_EDGE: Record<string, number> = {
  '0.5K': 512,
  '1K': 1024,
  '2K': 2048,
  '4K': 3840,
}

// 上游可接受的硬上限,作为最终下发前的安全夹取(与实测 gpt-image-2 对齐):
//  - 最长边 ≤ 3840
//  - 总像素 ≤ 3840x2160 = 8,294,400 (UHD 预算)
const MAX_UPSTREAM_LONG_EDGE = 3840
const MAX_UPSTREAM_PIXELS = 3840 * 2160

// 向下取整到 16 的倍数(夹取场景必须 floor 而非 round,否则可能回弹越过上限)。下限 16。
const floorTo16 = (value: number): number => Math.max(16, Math.floor(value / 16) * 16)

// 等比缩小 (w,h) 直到同时满足最长边与总像素上限;已在范围内则原样返回。
const clampToUpstreamLimits = (w: number, h: number): { w: number; h: number } => {
  let scale = 1
  const longEdge = Math.max(w, h)
  if (longEdge > MAX_UPSTREAM_LONG_EDGE) {
    scale = Math.min(scale, MAX_UPSTREAM_LONG_EDGE / longEdge)
  }
  if (w * h > MAX_UPSTREAM_PIXELS) {
    scale = Math.min(scale, Math.sqrt(MAX_UPSTREAM_PIXELS / (w * h)))
  }
  if (scale >= 1) {
    return { w, h }
  }
  return { w: floorTo16(w * scale), h: floorTo16(h * scale) }
}

// 把任意写法的分辨率归一到档位键（'高清 2K' / '2k' / '2048' → '2K'），无法识别返回 ''。
const normalizeResolutionTier = (value: unknown): string => {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!raw) return ''
  if (raw.includes('0.5K') || raw === '512' || raw === '512P') return '0.5K'
  if (raw.includes('4K')) return '4K'
  if (raw.includes('2K')) return '2K'
  if (raw.includes('1K')) return '1K'
  return ''
}

// 取像素级尺寸的长边（"4096x2304" → 4096）；非像素写法返回 0。
const pixelLongEdge = (raw: string): number => {
  const matched = raw.match(/^(\d+)\s*[x×X]\s*(\d+)$/)
  return matched ? Math.max(Number(matched[1]), Number(matched[2])) : 0
}

// 合规像素：四舍五入到 16 的倍数，且不小于 256（gpt-image 要求宽高均可被 16 整除）。
const roundTo16 = (value: number): number => Math.max(256, Math.round(value / 16) * 16)

// 预置尺寸表：标准「分辨率档 × 比例」直接对应一组固定像素尺寸（边长均为 16 的倍数），
// 命中即原样下发给上游，不做任何"按模型 sizes 贴近/夹取"的计算。
// 4K 档需同时满足实测 gpt-image-2 的两条硬约束:最长边 ≤ 3840，且总像素 ≤ 3840x2160=8,294,400(UHD 预算)。
// 故只有 16:9 / 9:16 能用 3840 长边;1:1 / 4:3 / 3:4 必须缩到像素预算内(均已实测可出图,边长仍可被 16 整除):
//   1:1=2880x2880(=8.29M) 4:3=3264x2448(7.99M) 3:4=2448x3264 16:9=3840x2160(=8.29M) 9:16=2160x3840
// 传 4096x4096 会被 "longest edge must be ≤ 3840" 拒绝;传 3328x2496(8.31M) 会被 "exceeds pixel budget" 拒绝。
const IMAGE_PIXEL_SIZE_TABLE: Record<string, Record<string, string>> = {
  '0.5K': { '1:1': '512x512', '4:3': '512x384', '3:4': '384x512', '16:9': '512x288', '9:16': '288x512' },
  '1K': { '1:1': '1024x1024', '4:3': '1024x768', '3:4': '768x1024', '16:9': '1024x576', '9:16': '576x1024' },
  '2K': { '1:1': '2048x2048', '4:3': '2048x1536', '3:4': '1536x2048', '16:9': '2048x1152', '9:16': '1152x2048' },
  '4K': { '1:1': '2880x2880', '4:3': '3264x2448', '3:4': '2448x3264', '16:9': '3840x2160', '9:16': '2160x3840' },
}

/**
 * 把「宽高比 + 分辨率档位」解析成上游可接受的合规像素尺寸。
 * - 标准 比例×分辨率档(见 IMAGE_PIXEL_SIZE_TABLE)：直接查表原样下发，不计算、不按模型 sizes 夹取
 *   （CometAPI 等聚合上游可接受任意 16 整除尺寸，gpt-image-2 已实测支持到 4K 3840x2160）。
 * - 非标准比例/无档位时才回退：模型 sizes 就近 → 档位长边计算 → 内置兜底。
 * 绝不把 "1:1" 这类比例标签直接当 size 下发——否则会变成 "1x1"，被 gpt-image 以
 * “Width and height must both be divisible by 16” 拒绝。
 */
export const resolveImagePixelSize = (input: {
  ratio?: string | null
  resolution?: string | null
  modelSizes?: string[] | null
  defaultSize?: unknown
}): string => {
  const target = parseSizeAspect(input.ratio)?.aspect ?? 1
  const tier = normalizeResolutionTier(input.resolution)

  // 预置表优先：命中标准 档位×比例 即直接返回固定尺寸传给上游。
  const tabledSize = tier ? IMAGE_PIXEL_SIZE_TABLE[tier]?.[String(input.ratio || '').trim()] : ''
  if (tabledSize) {
    return tabledSize
  }

  const tierEdge = RESOLUTION_TARGET_LONG_EDGE[tier] || 0

  const rawConfigured = (Array.isArray(input.modelSizes) ? input.modelSizes : [])
    .map(item => String(item || '').trim())
    .filter(Boolean)
  const configured = rawConfigured
    .map(parseSizeAspect)
    .filter((item): item is { raw: string; aspect: number } => Boolean(item))

  // 模型配了 sizes 但都无法解析为比例/像素（如全是 "auto"）：尊重配置，原样用第一个。
  if (rawConfigured.length > 0 && configured.length === 0) {
    return rawConfigured[0]
  }

  // 模型配置了「像素级」尺寸：在允许范围内按 比例优先、长边贴近档位 挑选，绝不越界。
  if (configured.length && rawConfigured.some(raw => pixelLongEdge(raw) > 0)) {
    let best = configured[0]
    let bestScore = Infinity
    for (const candidate of configured) {
      const aspectDiff = Math.abs(candidate.aspect - target)
      const longEdge = pixelLongEdge(candidate.raw)
      const edgeDiff = tierEdge && longEdge ? Math.abs(longEdge - tierEdge) / tierEdge : 0
      const score = aspectDiff * 100 + edgeDiff
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }
    return best.raw
  }

  // 未配置像素 sizes 但选了分辨率档位：按 比例 + 档位长边 直接算合规像素。
  if (tierEdge) {
    const width = target >= 1 ? tierEdge : tierEdge * target
    const height = target >= 1 ? tierEdge / target : tierEdge
    return `${roundTo16(width)}x${roundTo16(height)}`
  }

  const candidates = (configured.length
    ? configured
    : [parseSizeAspect(input.defaultSize), ...DEFAULT_IMAGE_PIXEL_SIZES.map(parseSizeAspect)]
  ).filter((item): item is { raw: string; aspect: number } => Boolean(item))

  let best = candidates[0]
  let bestDiff = Infinity
  for (const candidate of candidates) {
    const diff = Math.abs(candidate.aspect - target)
    if (diff < bestDiff) {
      bestDiff = diff
      best = candidate
    }
  }
  return best?.raw || String(input.defaultSize || '').trim() || ''
}

/**
 * 服务端防御性兜底：把「比例样式」的 size（如 "1x1" / "16x9" / "1:1"）纠正成合规像素尺寸，
 * 避免任意客户端（含浏览器旧缓存）误把比例当 size 下发，被上游以
 * “Width and height must both be divisible by 16” 拒绝。
 * - 已是合规像素（边长 ≥256 且能被 16 整除）→ 原样保留；
 * - "auto" 等非数值尺寸 → 原样保留；
 * - 其余（比例 / 过小 / 不合规像素）→ 按其宽高比映射成合规像素。
 */
export const coerceImageSizeToPixels = (size: unknown): string => {
  const raw = String(size || '').trim()
  if (!raw) return ''
  const matched = raw.match(/^(\d+(?:\.\d+)?)\s*[:：x×X]\s*(\d+(?:\.\d+)?)$/)
  if (!matched) return raw // "auto" 等非数值尺寸：原样保留
  const w = Number(matched[1])
  const h = Number(matched[2])
  if (w >= 256 && h >= 256 && w % 16 === 0 && h % 16 === 0) {
    // 已是合规像素；但若超出上游硬上限(最长边 3840 / 总像素 8.29M)则等比缩回范围内，
    // 避免被 "longest edge must be ≤ 3840" 或 "exceeds pixel budget" 之类 400 拒绝
    //（兜住旧前端缓存 / 后台默认 size / 伪造请求体）。
    const clamped = clampToUpstreamLimits(w, h)
    return `${clamped.w}x${clamped.h}`
  }
  return resolveImagePixelSize({ ratio: `${w}:${h}` }) || raw
}

/**
 * 单次允许的「参考图」张数上限（返回 0 表示不限）。前后端共用,口径一致。
 * - 显式 capabilityJson.maxReferenceImages 优先；
 * - 否则按出图适配器默认：openai-images(gpt-image-2 等)只支持单张参考图
 *   （CometAPI /v1/images/edits 只有单个 image 字段，多图会挂死超时）；chat / gemini 多图不限；
 * - 与服务端 resolveImageVendorAdapter 的路由口径保持一致（显式 imageAdapter > 旧 flag > 正则）。
 */
export const resolveImageReferenceLimit = (modelKey: unknown, capabilityJson: unknown): number => {
  const cap = capabilityJson && typeof capabilityJson === 'object'
    ? capabilityJson as Record<string, unknown>
    : null

  const explicit = Number(cap?.maxReferenceImages)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.floor(explicit)
  }

  const adapter = String(cap?.imageAdapter || '').trim()
  if (adapter === 'chat' || adapter === 'gemini-generatecontent') return 0
  if (adapter === 'openai-images') return 1
  // 旧 flag 兼容
  if (cap?.imageViaChat === true || cap?.imageViaGemini === true) return 0

  const key = String(modelKey || '').toLowerCase()
  if (/gemini[\w.-]*-image/.test(key) || /(4o-image|qwen-image)/.test(key)) return 0
  if (/gpt-image/.test(key)) return 1
  return 0
}

export interface OrderedImageReferenceInput {
  order?: number | null | undefined
  imageData?: string | null | undefined
}

const normalizeImageData = (value: string | null | undefined) => {
  const normalizedValue = String(value || '').trim()
  return normalizedValue || ''
}

const normalizeOrder = (value: number | null | undefined) => {
  const nextOrder = Number(value)
  return Number.isFinite(nextOrder) ? nextOrder : Number.MAX_SAFE_INTEGER
}

/**
 * 按顺序收集参考图，输出项目内统一使用的 `image: string[]` 结构
 */
export const collectOrderedImageReferences = (items: OrderedImageReferenceInput[]) => {
  return items
    .map(item => ({
      order: normalizeOrder(item.order),
      imageData: normalizeImageData(item.imageData),
    }))
    .filter(item => item.imageData)
    .sort((left, right) => left.order - right.order)
    .map(item => item.imageData)
}

/**
 * 将参考图注入图片生成请求体。
 * 约定：最终协议统一使用 `image: string[]`
 */
export const appendImageReferencesToRequestBody = <T extends Record<string, unknown>>(
  baseBody: T,
  references: string[] | null | undefined,
) => {
  const normalizedReferences = collectOrderedImageReferences(
    Array.isArray(references)
      ? references.map((imageData, index) => ({ order: index + 1, imageData }))
      : [],
  )

  if (!normalizedReferences.length) {
    return baseBody
  }

  return {
    ...baseBody,
    image: normalizedReferences,
  }
}
