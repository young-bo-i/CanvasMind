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
const RESOLUTION_TARGET_LONG_EDGE: Record<string, number> = {
  '0.5K': 512,
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
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

/**
 * 把「宽高比 + 分辨率档位」解析成上游可接受的合规像素尺寸。
 * - 模型配置了 sizes：尊重其允许的精确尺寸——先按「宽高比最接近」，再按「长边最接近所选档位」挑选，
 *   因此对只支持固定尺寸的模型不会下发非法尺寸（避免上游 422）。
 * - 模型未配 sizes 且给了分辨率档位：按 比例 + 档位长边 直接算像素（如 4K + 16:9 → 4096x2304）。
 * - 既无 sizes 又无档位：沿用模型默认 size + 内置兜底像素尺寸，挑比例最接近的（向后兼容）。
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
  const tierEdge = RESOLUTION_TARGET_LONG_EDGE[normalizeResolutionTier(input.resolution)] || 0

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
    return `${Math.round(w)}x${Math.round(h)}` // 已是合规像素
  }
  return resolveImagePixelSize({ ratio: `${w}:${h}` }) || raw
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
