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

/**
 * 把「宽高比」解析成上游可接受的合规尺寸。
 * - 优先在模型配置的 sizes 里按「宽高比最接近」挑选（尊重模型自身支持的尺寸/比例标签格式）；
 * - 模型未配 sizes 时，用模型默认 size + 内置合规像素尺寸做候选，挑最接近的；
 * 绝不把 "1:1" 这类比例标签直接当 size 下发——否则会变成 "1x1"，被 gpt-image 以
 * “Width and height must both be divisible by 16” 拒绝。
 */
export const resolveImagePixelSize = (input: {
  ratio?: string | null
  modelSizes?: string[] | null
  defaultSize?: unknown
}): string => {
  const target = parseSizeAspect(input.ratio)?.aspect ?? 1

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
