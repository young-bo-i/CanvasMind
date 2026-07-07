import fs from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { safeFetch } from '../shared/safe-fetch'
import { resolveGatewayProviderUpstream } from '../vendor/service'
import { getUploadsDir } from '../storage/service'
import { normalizeGenerationErrorMessage } from '../../src/shared/generation-error'
import {
  applyCapabilityFlags,
  parseModelCapabilitySpec,
  type ModelCapabilityFlags,
} from '../../src/shared/provider-capability'
import {
  buildImageEditRequestFormData,
  normalizeImageGenerationRequestBody,
} from '../../src/shared/upstream-request-normalizer'
import {
  extractChatTextFromJsonPayload,
  extractChatReasoningFromJsonPayload,
  extractImageUrlsFromJsonResponse,
  extractImageUrlsFromText,
  parseChatChunkError,
  parseChatChunkText,
  parseChatChunkReasoning,
  parseChatChunkUsage,
  parseUpstreamStreamChunk,
} from '../../src/shared/upstream-stream-parser'

export {
  extractChatTextFromJsonPayload,
  extractChatReasoningFromJsonPayload,
  extractImageUrlsFromJsonResponse,
  extractImageUrlsFromText,
  parseChatChunkError,
  parseChatChunkText,
  parseChatChunkReasoning,
  parseChatChunkUsage,
  parseUpstreamStreamChunk,
} from '../../src/shared/upstream-stream-parser'
export type { ChatUsage } from '../../src/shared/upstream-stream-parser'

const BURST_RATE_RETRY_DELAYS = [1200, 2600, 5200]
// 网络层错误（TypeError: fetch failed / socket reset / TLS abort 等）的重试节奏。
// 与 BURST_RATE 分开计数：429 是上游显式拒绝，网络错是底层失败，二者重试策略不耦合。
const NETWORK_ERROR_RETRY_DELAYS = [1500, 4000]
// 单次上游请求的硬超时基线（毫秒）。按产品要求图片生成统一放宽到 10 分钟，给慢模型 / 排队留足余量。
// 一次请求 n>1 时由 resolveUpstreamFetchTimeoutMs 仍可按张数放宽，但已与基线同为上限 10 分钟。
const UPSTREAM_FETCH_TIMEOUT_BASE_MS = 600_000
const UPSTREAM_FETCH_TIMEOUT_PER_IMAGE_MS = 60_000
const UPSTREAM_FETCH_TIMEOUT_MAX_MS = 600_000

const resolveUpstreamFetchTimeoutMs = (imageCount?: number) => {
  const normalizedCount = Math.max(1, Math.floor(Number(imageCount) || 1))
  const computed = UPSTREAM_FETCH_TIMEOUT_BASE_MS + (normalizedCount - 1) * UPSTREAM_FETCH_TIMEOUT_PER_IMAGE_MS
  return Math.min(computed, UPSTREAM_FETCH_TIMEOUT_MAX_MS)
}
const UPLOADS_PUBLIC_PATH_PREFIX = '/uploads/'

type RetryState = {
  attempt: number
  waitDurationMs: number
  status: number
  errorPreview: string
  stage: string
}

type UpstreamLogger = (stage: string, detail: Record<string, unknown>) => void

type FetchWithBurstRateRetryInput = {
  url: string
  init: RequestInit
  signal: AbortSignal
  stage: string
  detail: Record<string, unknown>
  onRetry?: (retryState: RetryState) => Promise<void> | void
  logGenerationTask: UpstreamLogger
  // 单次请求的硬超时毫秒；缺省走基线 90s。多张图请求由调用方按 n 估算后传入。
  timeoutMs?: number
}

type RequestImageGenerationInput = {
  signal: AbortSignal
  providerId: string
  modelKey: string
  // 请求者 userId：内置厂商按其所属管理员作用域取 key（否则全落全局桶，租户串号）。
  userId?: string | null
  requestBody: Record<string, unknown>
  onRetry?: (retryState: RetryState) => Promise<void> | void
  fetchWithBurstRateRetry: (input: Omit<FetchWithBurstRateRetryInput, 'logGenerationTask'>) => Promise<Response>
}

type RequestImageEditInput = {
  signal: AbortSignal
  providerId: string
  modelKey: string
  userId?: string | null
  prompt: string
  size?: string
  count?: number
  referenceImages: string[]
  onRetry?: (retryState: RetryState) => Promise<void> | void
  fetchWithBurstRateRetry: (input: Omit<FetchWithBurstRateRetryInput, 'logGenerationTask'>) => Promise<Response>
}

// 参考图归一化上限：手机原图常达 40MP+（如实测 7952×5304）、带 EXIF 旋转，
// 上游（gpt-image-2 等）会直接判「Invalid image file or mode for image N」而整单失败。
// 统一 EXIF 旋正 + 压到该边长内 + 重编码（去 EXIF/ICC/异常色彩模式），兼容各上游且顺带削 base64 体积。
const MAX_REFERENCE_IMAGE_DIM = 2048

// 用 sharp 归一化参考图字节：旋正、限尺寸、重编码为 PNG(含透明) 或 JPEG(不含透明)。
// 解码失败时返回 null，由调用方回退原始字节，避免归一化本身造成新失败。
const normalizeReferenceImageBuffer = async (
  buffer: Buffer,
): Promise<{ data: Buffer; mimeType: string } | null> => {
  try {
    const meta = await sharp(buffer, { failOn: 'none' }).metadata()
    const hasAlpha = Boolean(meta.hasAlpha) || Number(meta.channels || 3) >= 4
    const pipeline = sharp(buffer, { failOn: 'none' })
      .rotate() // 依据 EXIF 方向旋正（原图 orientation=8 等）
      .resize(MAX_REFERENCE_IMAGE_DIM, MAX_REFERENCE_IMAGE_DIM, { fit: 'inside', withoutEnlargement: true })
    const data = hasAlpha ? await pipeline.png().toBuffer() : await pipeline.jpeg({ quality: 90 }).toBuffer()
    return { data, mimeType: hasAlpha ? 'image/png' : 'image/jpeg' }
  } catch {
    return null
  }
}

// 猜测原始 mime（仅在归一化失败、回退原始字节时用）。
const guessReferenceImageMime = (value: string): string => {
  const lower = value.toLowerCase()
  if (lower.includes('.webp')) return 'image/webp'
  if (lower.includes('.gif')) return 'image/gif'
  if (lower.includes('.bmp')) return 'image/bmp'
  if (lower.includes('.svg')) return 'image/svg+xml'
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'image/jpeg'
  return 'image/png'
}

export const resolveServerReferenceImageBlob = async (imageValue: string) => {
  const normalizedValue = String(imageValue || '').trim()
  let sourceBuffer: Buffer
  if (normalizedValue.startsWith(UPLOADS_PUBLIC_PATH_PREFIX)) {
    const uploadsDir = getUploadsDir()
    // 去掉可能的 ?w= 查询串，避免误当文件名的一部分。
    const relativePath = decodeURIComponent(normalizedValue.slice(UPLOADS_PUBLIC_PATH_PREFIX.length).split('?')[0])
    const filePath = path.resolve(uploadsDir, relativePath)
    if (!filePath.startsWith(uploadsDir)) {
      throw new Error('参考图路径非法')
    }
    sourceBuffer = await fs.readFile(filePath)
  } else {
    // 参考图地址来自用户/模型输入(任意公网 URL)：禁止私网目标，防 SSRF。
    const response = await safeFetch(normalizedValue, {}, { allowPrivateHosts: false })
    if (!response.ok) {
      throw new Error(`参考图读取失败 (${response.status})`)
    }
    sourceBuffer = Buffer.from(await response.arrayBuffer())
  }

  const normalized = await normalizeReferenceImageBuffer(sourceBuffer)
  if (normalized) {
    return new Blob([normalized.data], { type: normalized.mimeType })
  }
  // 归一化失败（非位图/解码失败）：回退原始字节 + 猜测 mime。
  return new Blob([sourceBuffer], { type: guessReferenceImageMime(normalizedValue) })
}

export interface AgentWorkspaceModelPlanResult {
  analysisLines: string[]
  workflowLabel?: string
  workflowParams?: Record<string, unknown>
  planItems?: string[]
  imageTasks?: Array<{
    label: string
    promptText: string
  }>
  submitLines: string[]
  rawTextPreview?: string
}

export const sleepWithAbortSignal = async (signal: AbortSignal, durationMs: number) => {
  if (durationMs <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', handleAbort)
      resolve()
    }, durationMs)

    const handleAbort = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', handleAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }

    signal.addEventListener('abort', handleAbort, { once: true })
  })
}

const parseRetryAfterMs = (response: Response) => {
  const retryAfterValue = String(response.headers.get('retry-after') || '').trim()
  if (!retryAfterValue) {
    return 0
  }

  const seconds = Number(retryAfterValue)
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000
  }

  const retryAt = Date.parse(retryAfterValue)
  if (Number.isFinite(retryAt)) {
    return Math.max(retryAt - Date.now(), 0)
  }

  return 0
}

const isBurstRateLimitedResponse = (status: number, responseText: string) => {
  if (status === 429) {
    return true
  }

  const normalizedText = String(responseText || '').trim()
  if (!normalizedText) {
    return false
  }

  return /limit_burst_rate/i.test(normalizedText)
    || /Request rate increased too quickly/i.test(normalizedText)
}

export const fetchWithBurstRateRetry = async (input: FetchWithBurstRateRetryInput) => {
  let networkErrorAttempt = 0

  for (let attemptIndex = 0; attemptIndex <= BURST_RATE_RETRY_DELAYS.length; attemptIndex += 1) {
    // 超时只覆盖"等响应头"阶段：
    //   - fetch 返回 Response 之前若超过 headersTimeoutMs 仍未拿到头，主动 abort、按网络错重试。
    //   - fetch 返回后立即 clearTimeout，让 response.body 的流式读取可以慢慢走，避免 SSE 大模型
    //     n>1 顺序生成时 body 读到一半被同一 timer 误杀。
    //   - 外部 signal（用户停止任务）通过事件转发持续生效，body 阶段仍能被中断。
    const headersTimeoutMs = input.timeoutMs ?? UPSTREAM_FETCH_TIMEOUT_BASE_MS
    const fetchController = new AbortController()
    const forwardExternalAbort = () => fetchController.abort(input.signal.reason)
    if (input.signal.aborted) {
      forwardExternalAbort()
    } else {
      input.signal.addEventListener('abort', forwardExternalAbort, { once: true })
    }

    let headersTimedOut = false
    const headersTimeoutHandle = setTimeout(() => {
      headersTimedOut = true
      fetchController.abort(new DOMException(
        `等待响应头超过 ${headersTimeoutMs} ms`,
        'TimeoutError',
      ))
    }, headersTimeoutMs)

    let response: Response
    try {
      response = await fetch(input.url, {
        ...input.init,
        signal: fetchController.signal,
      })
    } catch (error) {
      clearTimeout(headersTimeoutHandle)
      // 区分三种异常：
      //   1) 外部主动 abort（用户停止任务）→ 直接抛出，不重试
      //   2) headers 阶段超时 → 视作网络错误，按 NETWORK_ERROR_RETRY_DELAYS 重试
      //   3) socket reset / TLS abort 等 TypeError → 同上
      if (input.signal.aborted) {
        throw error
      }

      const isTimeout = headersTimedOut
      const isNetworkError = isTimeout
        || error instanceof TypeError
        || (error instanceof DOMException && error.name === 'TimeoutError')

      if (!isNetworkError || networkErrorAttempt >= NETWORK_ERROR_RETRY_DELAYS.length) {
        throw error
      }

      const baseDelayMs = NETWORK_ERROR_RETRY_DELAYS[networkErrorAttempt]
      const jitterMs = Math.floor(Math.random() * 400)
      const waitDurationMs = baseDelayMs + jitterMs
      const errorMessage = error instanceof Error ? error.message : String(error)
      // undici 把真实底层错（ECONNRESET / UND_ERR_SOCKET / UND_ERR_HEADERS_TIMEOUT / EPROTO …）
      // 包在 TypeError.cause 里，仅看 message 永远只能看到 "fetch failed"。
      const causeRaw = (error as { cause?: unknown })?.cause
      const causeError = causeRaw instanceof Error ? causeRaw : null
      const causeCode = causeError && typeof (causeError as { code?: unknown }).code === 'string'
        ? String((causeError as { code?: unknown }).code)
        : null
      const causePreview = causeError
        ? `${causeError.name}: ${causeError.message}`
        : (causeRaw ? String(causeRaw) : null)

      input.logGenerationTask(`${input.stage}:network_error_retry`, {
        ...input.detail,
        attempt: networkErrorAttempt + 1,
        waitDurationMs,
        isTimeout,
        errorPreview: errorMessage.slice(0, 240),
        causeCode,
        causePreview: causePreview ? causePreview.slice(0, 240) : null,
      })

      await input.onRetry?.({
        attempt: networkErrorAttempt + 1,
        waitDurationMs,
        status: 0,
        errorPreview: [errorMessage, causePreview].filter(Boolean).join(' | ').slice(0, 240),
        stage: input.stage,
      })

      await sleepWithAbortSignal(input.signal, waitDurationMs)
      networkErrorAttempt += 1
      // 网络错重试时不消耗 burst rate 重试预算
      attemptIndex -= 1
      continue
    }

    // 拿到 Response 后立即关闭 headers timer；保留 external→fetchController 的转发，
    // 让 body 读取阶段仍能被用户停止任务中断。
    clearTimeout(headersTimeoutHandle)

    if (response.ok) {
      return response
    }

    const responseText = await response.clone().text().catch(() => '')
    const isBurstRateLimited = isBurstRateLimitedResponse(response.status, responseText)
    if (!isBurstRateLimited || attemptIndex >= BURST_RATE_RETRY_DELAYS.length) {
      return response
    }

    const retryAfterMs = parseRetryAfterMs(response)
    const baseDelayMs = BURST_RATE_RETRY_DELAYS[attemptIndex]
    const jitterMs = Math.floor(Math.random() * 400)
    const waitDurationMs = Math.max(retryAfterMs, baseDelayMs + jitterMs)

    input.logGenerationTask(`${input.stage}:burst_rate_retry`, {
      ...input.detail,
      status: response.status,
      attempt: attemptIndex + 1,
      waitDurationMs,
      errorPreview: responseText.slice(0, 240),
    })

    await input.onRetry?.({
      attempt: attemptIndex + 1,
      waitDurationMs,
      status: response.status,
      errorPreview: responseText.slice(0, 240),
      stage: input.stage,
    })

    await sleepWithAbortSignal(input.signal, waitDurationMs)
  }

  throw new Error('上游请求重试流程异常结束')
}

export const isChatCompletionsEndpoint = (endpoint: string) => {
  return /chat\/completions/i.test(String(endpoint || '').trim())
}

export const extractChatTextFromNonStreamResponse = async (response: Response) => {
  const result: any = await response.json().catch(() => null)
  const messageContent = result?.choices?.[0]?.message?.content
  if (typeof messageContent === 'string' && messageContent.trim()) {
    return messageContent
  }
  return ''
}

export const extractImageUrlsFromStreamResponse = async (response: Response, signal: AbortSignal) => {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('图片流式响应缺少可读数据')
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  const imageUrls: string[] = []

  while (!signal.aborted) {
    let readResult: ReadableStreamReadResult<Uint8Array>
    try {
      readResult = await reader.read()
    } catch {
      break
    }

    const { done, value } = readResult
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    let boundaryIndex = -1
    while ((boundaryIndex = buffer.indexOf('\n\n')) !== -1) {
      const message = buffer.slice(0, boundaryIndex)
      buffer = buffer.slice(boundaryIndex + 2)

      for (const line of message.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || !trimmed.startsWith('data:')) continue

        const chunk = trimmed.slice(5).trim()
        if (chunk === '[DONE]') continue

        const parsedChunk = parseUpstreamStreamChunk(chunk)
        if (parsedChunk.text) {
          fullContent += parsedChunk.text
        }
        if (parsedChunk.imageUrls.length) {
          imageUrls.push(...parsedChunk.imageUrls)
        }
      }
    }
  }

  imageUrls.push(...extractImageUrlsFromText(fullContent))

  return imageUrls
}

// 从图片接口响应解析 token usage(用于 gpt-image-2 等按 token 计价的结算)。
// 兼容 OpenAI 图像接口(input_tokens/output_tokens/input_tokens_details.cached_tokens)与 chat 风格(prompt_tokens/completion_tokens)。
const extractImageUsageFromPayload = (payload: unknown): { promptTokens: number; completionTokens: number; cachedTokens: number } | null => {
  const usage = payload && typeof payload === 'object' ? (payload as Record<string, any>).usage : null
  if (!usage || typeof usage !== 'object') return null
  const num = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const inputDetails = (usage.input_tokens_details || usage.prompt_tokens_details || {}) as Record<string, unknown>
  const promptTokens = num(usage.input_tokens ?? usage.prompt_tokens)
  const completionTokens = num(usage.output_tokens ?? usage.completion_tokens)
  const cachedTokens = num(inputDetails.cached_tokens)
  if (!promptTokens && !completionTokens && !cachedTokens) return null
  return { promptTokens, completionTokens, cachedTokens }
}

const capFlag = (capabilityJson: unknown, flag: string): boolean =>
  Boolean(capabilityJson && typeof capabilityJson === 'object' && (capabilityJson as Record<string, unknown>)[flag] === true)

// 出图路由统一遵循同一优先级:【显式 capabilityJson 标记】>【按 model id 正则推断】>【端点默认】。
// 这样"同一个 model id 在不同上游走不同协议"能由每个模型的配置写死,正则只作兜底默认。
//
// Gemini / Nano Banana 原生 generateContent 端点(支持 aspectRatio + imageSize 到 4K)。
// 注意:部分聚合上游(如 CometAPI)并不把 gemini-3 系列挂在 generateContent 通道上,
// 这类模型必须显式配 imageViaChat 走 chat 端点 —— 该显式标记优先级高于本函数的 gemini 正则。
const isGeminiImageModel = (modelKey: string, capabilityJson: unknown): boolean => {
  // 显式 chat 钉死 > 显式 gemini 钉死 > 正则推断:imageViaChat 一旦置真,就不再当作 gemini。
  if (capFlag(capabilityJson, 'imageViaChat')) return false
  if (capFlag(capabilityJson, 'imageViaGemini')) return true
  const key = String(modelKey || '').toLowerCase()
  return Boolean(key) && /gemini[\w.-]*-image/.test(key)
}

// 其它"经 OpenAI 兼容 chat 端点出图"的模型(gpt-4o-image、qwen-image、CometAPI 上的 nano-banana 等)。
// imageViaChat 显式标记优先;否则按 model id 兜底,但永远排除 gpt-image-*(走 /images/generations)。
const isChatImageModel = (modelKey: string, capabilityJson: unknown): boolean => {
  if (capFlag(capabilityJson, 'imageViaChat')) return true
  const key = String(modelKey || '').toLowerCase()
  if (!key) return false
  if (/gpt-image/.test(key)) return false
  return /(4o-image|qwen-image)/.test(key)
}

// 从 chat 响应解析内联图片:兼容 string 正文里的 ![](data:image..)/http、多模态 parts、message.images。
const extractImageUrlsFromChatPayload = (json: any): string[] => {
  const urls: string[] = []
  const push = (u: unknown) => {
    const value = String(u || '').trim()
    if (value && (value.startsWith('http') || value.startsWith('data:')) && !urls.includes(value)) {
      urls.push(value)
    }
  }
  const pushFromText = (text: unknown) => {
    if (typeof text !== 'string' || !text) return
    for (const u of extractImageUrlsFromText(text)) push(u)
  }
  const message = json?.choices?.[0]?.message
  const content = message?.content
  if (typeof content === 'string') {
    pushFromText(content)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') { pushFromText(part); continue }
      if (part && typeof part === 'object') {
        pushFromText(part.text)
        push(part.image_url?.url ?? part.image_url ?? part.url)
        if (part.inline_data?.data) push(`data:${part.inline_data.mime_type || 'image/png'};base64,${part.inline_data.data}`)
      }
    }
  }
  const images = message?.images
  if (Array.isArray(images)) {
    for (const it of images) {
      if (typeof it === 'string') { push(it); continue }
      const u = it?.image_url?.url ?? it?.url ?? it?.b64_json
      if (typeof u === 'string' && u) push(u.startsWith('http') || u.startsWith('data:') ? u : `data:image/png;base64,${u}`)
    }
  }
  return urls
}

// gemini chat 出图忽略 size/aspect_ratio 等参数(实测固定 ~1408x768),唯一能控比例的是 prompt 文本。
// 这里据所选尺寸(像素 WxH,由前端 resolveImagePixelSize 给出)反推出比例,拼一句中文比例提示到 prompt 末尾,
// 让 1:1 / 9:16 等选择真正生效(分辨率档位本身仅用于"按分辨率/按次"计费,实际像素由 gemini 决定)。
const buildAspectHint = (size?: string): string => {
  const matched = String(size || '').trim().match(/^(\d+)\s*[x×X]\s*(\d+)$/)
  if (!matched) return ''
  const w = Number(matched[1])
  const h = Number(matched[2])
  if (!w || !h) return ''
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const d = gcd(w, h) || 1
  const rw = Math.round(w / d)
  const rh = Math.round(h / d)
  const orient = w === h ? '正方形' : w > h ? '横版' : '竖版'
  return `（请严格按 ${rw}:${rh} ${orient}比例输出图片）`
}

// 经 chat 端点出图(非流式):构造 messages(prompt + 比例提示 + 可选参考图 image_url),解析内联图片 + token usage。
const performChatImageRequest = async (input: {
  upstream: { baseUrl: string; apiKey: string; chatEndpoint: string }
  modelKey: string
  prompt: string
  size?: string
  referenceImages?: string[]
  count?: number
  signal: AbortSignal
  fetchWithBurstRateRetry: RequestImageGenerationInput['fetchWithBurstRateRetry']
  onRetry?: (retryState: RetryState) => Promise<void> | void
  stage: string
}) => {
  const refs = (input.referenceImages || []).map(item => String(item || '').trim()).filter(Boolean)
  const aspectHint = buildAspectHint(input.size)
  const finalPrompt = aspectHint ? `${input.prompt} ${aspectHint}` : input.prompt
  const userContent: unknown = refs.length
    ? [
        { type: 'text', text: finalPrompt },
        ...refs.map(url => ({ type: 'image_url', image_url: { url } })),
      ]
    : finalPrompt

  const requestBody = {
    model: input.modelKey,
    messages: [{ role: 'user', content: userContent }],
    stream: false,
  }

  const chatEndpoint = String(input.upstream.chatEndpoint || '/chat/completions')
  const upstreamUrl = `${input.upstream.baseUrl.replace(/\/+$/, '')}/${chatEndpoint.replace(/^\/+/, '')}`
  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (input.upstream.apiKey) {
    headers.set('Authorization', `Bearer ${input.upstream.apiKey}`)
  }

  const response = await input.fetchWithBurstRateRetry({
    url: upstreamUrl,
    signal: input.signal,
    stage: input.stage,
    timeoutMs: resolveUpstreamFetchTimeoutMs(Math.max(1, Math.floor(Number(input.count) || 1))),
    detail: {
      modelKey: input.modelKey,
      endpointType: 'image-chat',
      referenceImageCount: refs.length,
    },
    onRetry: input.onRetry,
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    },
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    throw new Error(normalizeGenerationErrorMessage(responseText, `图片生成失败 (${response.status})`))
  }

  const json = await response.json()
  const imageUrls = extractImageUrlsFromChatPayload(json)
  if (!imageUrls.length) {
    throw new Error('未能从对话响应中解析出图片')
  }

  return { upstreamUrl, imageUrls, usage: extractImageUsageFromPayload(json) }
}

// chat 出图一次只返回一张:按 count 串行多次调用并合并图片、累加 token usage,
// 避免"按 N 张预扣却只拿到 1 张"。count<=1 时单次返回。
const performChatImageBatch = async (
  input: Parameters<typeof performChatImageRequest>[0],
): Promise<{ upstreamUrl: string; imageUrls: string[]; usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null }> => {
  const total = Math.max(1, Math.floor(Number(input.count) || 1))
  if (total <= 1) {
    return performChatImageRequest({ ...input, count: 1 })
  }
  const imageUrls: string[] = []
  let upstreamUrl = ''
  let hasUsage = false
  const sum = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
  for (let index = 0; index < total; index += 1) {
    const result = await performChatImageRequest({ ...input, count: 1 })
    upstreamUrl = result.upstreamUrl
    imageUrls.push(...result.imageUrls)
    if (result.usage) {
      hasUsage = true
      sum.promptTokens += result.usage.promptTokens
      sum.completionTokens += result.usage.completionTokens
      sum.cachedTokens += result.usage.cachedTokens
    }
  }
  return { upstreamUrl, imageUrls, usage: hasUsage ? sum : null }
}

// ===== Gemini / Nano Banana 原生 generateContent 出图 =====
// CometAPI 官方示例:走 /v1beta/models/{model}:generateContent,用 imageConfig.aspectRatio 控比例、imageSize 控分辨率(到 4K)。
// OpenAI 兼容的 /v1/images/generations 与 /v1/chat/completions 都无法控制比例/尺寸,故 gemini 专走这条。
const GEMINI_ASPECT_RATIOS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])

// 据所选像素尺寸(由前端预置表给出)反推 Gemini 接受的比例标签;不在白名单则返回 ''(让 gemini 用默认)。
const deriveGeminiAspectRatio = (size?: string): string => {
  const matched = String(size || '').trim().match(/^(\d+)\s*[x×X]\s*(\d+)$/)
  if (!matched) return ''
  const w = Number(matched[1])
  const h = Number(matched[2])
  if (!w || !h) return ''
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  const d = gcd(w, h) || 1
  const ratio = `${Math.round(w / d)}:${Math.round(h / d)}`
  return GEMINI_ASPECT_RATIOS.has(ratio) ? ratio : ''
}

// 据所选像素长边映射到 Gemini imageSize 档位(1K/2K/4K);0.5K 上调到 1K(gemini 无 0.5K)。
// 阈值对齐 IMAGE_PIXEL_SIZE_TABLE 的实际长边(4K 档为 gpt-image-2 像素预算所限已降到 2880~3840,
// 2K=2048,1K=1024):故 4K 阈值取 2600(兜住 2880),2K 取 1500(兜住 2048)。gemini 走原生
// generateContent 不受 gpt-image-2 的像素预算约束,4K 实际可出到 4096x4096。
const deriveGeminiImageSize = (size?: string): string => {
  const matched = String(size || '').trim().match(/^(\d+)\s*[x×X]\s*(\d+)$/)
  if (!matched) return ''
  const longEdge = Math.max(Number(matched[1]) || 0, Number(matched[2]) || 0)
  if (!longEdge) return ''
  if (longEdge >= 2600) return '4K'
  if (longEdge >= 1500) return '2K'
  return '1K'
}

const performGeminiImageRequest = async (input: {
  upstream: { baseUrl: string; apiKey: string }
  modelKey: string
  prompt: string
  size?: string
  referenceImages?: string[]
  count?: number
  signal: AbortSignal
  fetchWithBurstRateRetry: RequestImageGenerationInput['fetchWithBurstRateRetry']
  onRetry?: (retryState: RetryState) => Promise<void> | void
  stage: string
}) => {
  // generateContent 在 API 根的 /v1beta 下,与 baseUrl 的 /v1 同级:剥掉 baseUrl 末尾的 /v1 或 /v1beta 再拼。
  const root = String(input.upstream.baseUrl || '').replace(/\/+$/, '').replace(/\/v1(beta)?$/i, '')
  const upstreamUrl = `${root}/v1beta/models/${encodeURIComponent(input.modelKey)}:generateContent`

  const parts: Array<Record<string, unknown>> = [{ text: input.prompt }]
  for (const ref of (input.referenceImages || []).map(item => String(item || '').trim()).filter(Boolean)) {
    const blob = await resolveServerReferenceImageBlob(ref)
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64')
    parts.push({ inlineData: { mimeType: blob.type || 'image/png', data: base64 } })
  }

  const imageConfig: Record<string, string> = {}
  const aspectRatio = deriveGeminiAspectRatio(input.size)
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio
  const imageSize = deriveGeminiImageSize(input.size)
  if (imageSize) imageConfig.imageSize = imageSize

  const requestBody = {
    contents: [{ parts }],
    generationConfig: {
      // 用 TEXT+IMAGE:nano-banana-pro(gemini-3-pro-image,thinking 图片模型)官方示例即如此,
      // 纯 IMAGE 下它会偶发只"思考"不出图;flash 也兼容(实测两者都稳定返图)。
      responseModalities: ['TEXT', 'IMAGE'],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  }

  const headers = new Headers({ 'Content-Type': 'application/json' })
  if (input.upstream.apiKey) {
    headers.set('Authorization', `Bearer ${input.upstream.apiKey}`)
  }

  const numToken = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0 }
  // requestBody 含 base64 参考图(可达数 MB)且各次尝试不变，序列化一次即可，别在重试循环内重复 stringify。
  const requestBodyJson = JSON.stringify(requestBody)
  // nano-banana-pro 是 thinking 图片模型,会偶发返回"无图"(安全软拦截 / 仅思考文本 / 空 candidate)。
  // 对这类瞬时空响应重试一次兜底;显式安全/内容拦截则不重试(重试也会被拦,避免无谓扣费)。
  const maxAttempts = 2
  let lastDiag = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await input.fetchWithBurstRateRetry({
      url: upstreamUrl,
      signal: input.signal,
      stage: input.stage,
      timeoutMs: resolveUpstreamFetchTimeoutMs(Math.max(1, Math.floor(Number(input.count) || 1))),
      detail: {
        modelKey: input.modelKey,
        endpointType: 'image-gemini',
        aspectRatio: imageConfig.aspectRatio || '',
        imageSize: imageConfig.imageSize || '',
        referenceImageCount: (input.referenceImages || []).length,
        attempt,
      },
      onRetry: input.onRetry,
      init: { method: 'POST', headers, body: requestBodyJson },
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(normalizeGenerationErrorMessage(responseText, `图片生成失败 (${response.status})`))
    }

    const json: any = await response.json()
    const candidate = json?.candidates?.[0]
    const imageUrls: string[] = []
    for (const part of (candidate?.content?.parts || [])) {
      const idata = part?.inlineData || part?.inline_data
      const fdata = part?.fileData || part?.file_data
      const fileUri = String(fdata?.fileUri || fdata?.file_uri || '').trim()
      if (idata?.data) {
        imageUrls.push(`data:${idata.mimeType || idata.mime_type || 'image/png'};base64,${idata.data}`)
      } else if (/^https?:\/\//i.test(fileUri)) {
        // 大图(如 4K)部分上游可能返回文件 URI 而非内联 base64。
        if (!imageUrls.includes(fileUri)) imageUrls.push(fileUri)
      } else if (typeof part?.text === 'string' && part?.thought !== true) {
        // 跳过 thinking 文本(thought=true);其余文本里尽量捞内联/外链图片。
        for (const u of extractImageUrlsFromText(part.text)) {
          if (!imageUrls.includes(u)) imageUrls.push(u)
        }
      }
    }

    if (imageUrls.length) {
      const um = json?.usageMetadata || {}
      const promptTokens = numToken(um.promptTokenCount)
      const completionTokens = numToken(um.candidatesTokenCount)
      const cachedTokens = numToken(um.cachedContentTokenCount)
      const usage = (promptTokens || completionTokens || cachedTokens) ? { promptTokens, completionTokens, cachedTokens } : null
      return { upstreamUrl, imageUrls, usage }
    }

    // 无图:取诊断信息;显式安全/内容拦截不重试,其余瞬时空响应重试。
    const finishReason = String(candidate?.finishReason || '')
    const blockReason = String(json?.promptFeedback?.blockReason || '')
    lastDiag = [finishReason && `finishReason=${finishReason}`, blockReason && `blockReason=${blockReason}`]
      .filter(Boolean).join(' ')
    const hardBlocked = /SAFETY|PROHIBITED|BLOCK|RECITATION/i.test(`${finishReason} ${blockReason}`)
    if (attempt >= maxAttempts || hardBlocked) {
      break
    }
  }
  throw new Error(`未能从 Gemini 响应中解析出图片${lastDiag ? `（${lastDiag}）` : ''}`)
}

// 多图:gemini 一次一张,按 count 串行多次并合并图片、累加 usage。
const performGeminiImageBatch = async (
  input: Parameters<typeof performGeminiImageRequest>[0],
): Promise<{ upstreamUrl: string; imageUrls: string[]; usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null }> => {
  const total = Math.max(1, Math.floor(Number(input.count) || 1))
  if (total <= 1) {
    return performGeminiImageRequest({ ...input, count: 1 })
  }
  const imageUrls: string[] = []
  let upstreamUrl = ''
  let hasUsage = false
  const sum = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }
  for (let index = 0; index < total; index += 1) {
    const result = await performGeminiImageRequest({ ...input, count: 1 })
    upstreamUrl = result.upstreamUrl
    imageUrls.push(...result.imageUrls)
    if (result.usage) {
      hasUsage = true
      sum.promptTokens += result.usage.promptTokens
      sum.completionTokens += result.usage.completionTokens
      sum.cachedTokens += result.usage.cachedTokens
    }
  }
  return { upstreamUrl, imageUrls, usage: hasUsage ? sum : null }
}

// ===========================================================================
// 图片"厂家适配器"层(按厂商/上游格式各自独立、参数写死)
// ---------------------------------------------------------------------------
// 每个上游图片格式 = 一个自包含适配器,自带「构造请求 + 调上游 + 解析结果」,互不影响。
// 模型在 capabilityJson.imageAdapter 里显式声明走哪个适配器(厂家格式);
// 新增一个奇葩厂家只需加一个适配器对象 + 在该模型上写 imageAdapter,不动分发主干。
// 未显式声明时按旧 flag/正则兜底推断,保证历史已配置模型不回归。
//
// 已接入(均按 CometAPI 实测对齐):
//   - 'openai-images'          : POST /images/generations(文生图) + /images/edits(图生图 multipart)。
//                                gpt-image-2 走这条;返回 data[].b64_json + token usage。
//   - 'chat'                   : POST /chat/completions,图片内联在 message.content 的 markdown 里。
//                                CometAPI 上的 nano-banana(gemini-3.x)、gpt-4o-image、qwen-image 走这条。
//   - 'gemini-generatecontent' : POST /v1beta/models/{m}:generateContent(原生比例 + 4K)。
//                                仅当上游确实把该模型挂在 generateContent 通道时可用。
// ===========================================================================

type ImageVendorResult = {
  upstreamUrl: string
  imageUrls: string[]
  usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null
}

type ResolvedImageUpstream = Awaited<ReturnType<typeof resolveGatewayProviderUpstream>>

type ImageAdapterContext = {
  upstream: ResolvedImageUpstream
  providerId: string
  modelKey: string
  prompt: string
  size?: string
  count: number
  referenceImages: string[]
  // 文生图原始请求体(已含 size/quality/n 等),openai-images 适配器需要它做 normalize 透传。
  requestBody?: Record<string, unknown>
  signal: AbortSignal
  fetchWithBurstRateRetry: RequestImageGenerationInput['fetchWithBurstRateRetry']
  onRetry?: (retryState: RetryState) => Promise<void> | void
}

interface ImageVendorAdapter {
  key: string
  label: string
  generate: (ctx: ImageAdapterContext) => Promise<ImageVendorResult>
  edit: (ctx: ImageAdapterContext) => Promise<ImageVendorResult>
}

// --- 适配器 1:OpenAI 图片接口(gpt-image-2) ---
const openaiImagesAdapter: ImageVendorAdapter = {
  key: 'openai-images',
  label: 'OpenAI 图片接口 /images/generations + /images/edits',
  async generate(ctx) {
    const headers = new Headers({ 'Content-Type': 'application/json' })
    if (ctx.upstream.apiKey) {
      headers.set('Authorization', `Bearer ${ctx.upstream.apiKey}`)
    }

    const requestBody = normalizeImageGenerationRequestBody({
      requestBody: ctx.requestBody || {},
      modelKey: ctx.modelKey,
    })
    const upstreamImageCount = Math.max(1, Math.floor(Number((requestBody as Record<string, unknown>).n) || 1))
    const upstreamUrl = `${ctx.upstream.baseUrl.replace(/\/+$/, '')}/${ctx.upstream.endpoint.replace(/^\/+/, '')}`
    const response = await ctx.fetchWithBurstRateRetry({
      url: upstreamUrl,
      signal: ctx.signal,
      stage: 'image_generation',
      timeoutMs: resolveUpstreamFetchTimeoutMs(upstreamImageCount),
      detail: {
        providerId: ctx.providerId,
        modelKey: ctx.modelKey,
        endpointType: 'image',
        imageCount: upstreamImageCount,
      },
      onRetry: ctx.onRetry,
      init: { method: 'POST', headers, body: JSON.stringify(requestBody) },
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(normalizeGenerationErrorMessage(responseText, `图片生成失败 (${response.status})`))
    }

    // 非流式 JSON 同时拿图片 + token usage;chat-completions 流式端点暂无 usage。
    let usage: ImageVendorResult['usage'] = null
    let imageUrls: string[]
    if (isChatCompletionsEndpoint(ctx.upstream.endpoint)) {
      imageUrls = await extractImageUrlsFromStreamResponse(response, ctx.signal)
    } else {
      const json = await response.json()
      imageUrls = extractImageUrlsFromJsonResponse(json)
      usage = extractImageUsageFromPayload(json)
    }
    if (!imageUrls.length) {
      throw new Error('未能获取到生成的图片')
    }
    return { upstreamUrl, imageUrls, usage }
  },
  async edit(ctx) {
    const editImageCount = Math.max(1, Math.floor(Number(ctx.count) || 1))
    const formData = await buildImageEditRequestFormData({
      modelKey: ctx.modelKey,
      prompt: ctx.prompt,
      size: ctx.size,
      count: editImageCount,
      referenceImages: ctx.referenceImages,
      fileNamePrefix: 'reference',
      resolveReferenceImageBlob: resolveServerReferenceImageBlob,
    })

    const headers = new Headers()
    if (ctx.upstream.apiKey) {
      headers.set('Authorization', `Bearer ${ctx.upstream.apiKey}`)
    }

    const upstreamUrl = `${ctx.upstream.baseUrl.replace(/\/+$/, '')}/${ctx.upstream.endpoint.replace(/^\/+/, '')}`
    const response = await ctx.fetchWithBurstRateRetry({
      url: upstreamUrl,
      signal: ctx.signal,
      stage: 'image_edit',
      timeoutMs: resolveUpstreamFetchTimeoutMs(editImageCount),
      detail: {
        providerId: ctx.providerId,
        modelKey: ctx.modelKey,
        endpointType: 'image-edit',
        referenceImageCount: ctx.referenceImages.length,
        imageCount: editImageCount,
      },
      onRetry: ctx.onRetry,
      init: { method: 'POST', headers, body: formData },
    })

    if (!response.ok) {
      const responseText = await response.text().catch(() => '')
      throw new Error(normalizeGenerationErrorMessage(responseText, `图片编辑失败 (${response.status})`))
    }

    const editJson = await response.json()
    const imageUrls = extractImageUrlsFromJsonResponse(editJson)
    if (!imageUrls.length) {
      throw new Error('未能获取到编辑后的图片')
    }
    return { upstreamUrl, imageUrls, usage: extractImageUsageFromPayload(editJson) }
  },
}

// --- 适配器 2:经 chat/completions 出图(nano-banana / 4o-image / qwen-image) ---
const chatImageAdapter: ImageVendorAdapter = {
  key: 'chat',
  label: '经 chat/completions 出图(图片内联在 message.content)',
  generate(ctx) {
    return performChatImageBatch({
      upstream: { baseUrl: ctx.upstream.baseUrl, apiKey: ctx.upstream.apiKey, chatEndpoint: ctx.upstream.chatEndpoint },
      modelKey: ctx.modelKey,
      prompt: ctx.prompt,
      size: ctx.size,
      count: ctx.count,
      signal: ctx.signal,
      fetchWithBurstRateRetry: ctx.fetchWithBurstRateRetry,
      onRetry: ctx.onRetry,
      stage: 'image_generation',
    })
  },
  edit(ctx) {
    return performChatImageBatch({
      upstream: { baseUrl: ctx.upstream.baseUrl, apiKey: ctx.upstream.apiKey, chatEndpoint: ctx.upstream.chatEndpoint },
      modelKey: ctx.modelKey,
      prompt: ctx.prompt,
      size: ctx.size,
      referenceImages: ctx.referenceImages,
      count: ctx.count,
      signal: ctx.signal,
      fetchWithBurstRateRetry: ctx.fetchWithBurstRateRetry,
      onRetry: ctx.onRetry,
      stage: 'image_edit',
    })
  },
}

// --- 适配器 3:Gemini 原生 generateContent(原生比例 + 4K) ---
const geminiGenerateContentAdapter: ImageVendorAdapter = {
  key: 'gemini-generatecontent',
  label: 'Gemini 原生 generateContent',
  generate(ctx) {
    return performGeminiImageBatch({
      upstream: ctx.upstream,
      modelKey: ctx.modelKey,
      prompt: ctx.prompt,
      size: ctx.size,
      count: ctx.count,
      signal: ctx.signal,
      fetchWithBurstRateRetry: ctx.fetchWithBurstRateRetry,
      onRetry: ctx.onRetry,
      stage: 'image_generation',
    })
  },
  edit(ctx) {
    return performGeminiImageBatch({
      upstream: ctx.upstream,
      modelKey: ctx.modelKey,
      prompt: ctx.prompt,
      size: ctx.size,
      referenceImages: ctx.referenceImages,
      count: ctx.count,
      signal: ctx.signal,
      fetchWithBurstRateRetry: ctx.fetchWithBurstRateRetry,
      onRetry: ctx.onRetry,
      stage: 'image_edit',
    })
  },
}

const IMAGE_VENDOR_ADAPTERS: Record<string, ImageVendorAdapter> = {
  [openaiImagesAdapter.key]: openaiImagesAdapter,
  [chatImageAdapter.key]: chatImageAdapter,
  [geminiGenerateContentAdapter.key]: geminiGenerateContentAdapter,
}

// 选适配器:显式 capabilityJson.imageAdapter 优先(每个厂家写死自己的格式),
// 未声明再按旧 flag/正则兜底,最后默认 openai-images。
const resolveImageVendorAdapter = (modelKey: string, capabilityJson: unknown): ImageVendorAdapter => {
  const explicit = capabilityJson && typeof capabilityJson === 'object'
    ? String((capabilityJson as Record<string, unknown>).imageAdapter || '').trim()
    : ''
  if (explicit && IMAGE_VENDOR_ADAPTERS[explicit]) {
    return IMAGE_VENDOR_ADAPTERS[explicit]
  }
  if (isGeminiImageModel(modelKey, capabilityJson)) return geminiGenerateContentAdapter
  if (isChatImageModel(modelKey, capabilityJson)) return chatImageAdapter
  return openaiImagesAdapter
}

export const requestImageGeneration = async (input: RequestImageGenerationInput) => {
  const upstream = await resolveGatewayProviderUpstream({
    providerId: input.providerId,
    endpointType: 'image',
    modelKey: input.modelKey,
    userId: input.userId,
  })
  const adapter = resolveImageVendorAdapter(input.modelKey, upstream.modelCapabilityJson)
  const body = (input.requestBody || {}) as Record<string, unknown>
  return adapter.generate({
    upstream,
    providerId: input.providerId,
    modelKey: input.modelKey,
    prompt: String(body.prompt || '').trim(),
    size: String(body.size || '') || undefined,
    count: Math.max(1, Math.floor(Number(body.n) || 1)),
    referenceImages: [],
    requestBody: input.requestBody,
    signal: input.signal,
    fetchWithBurstRateRetry: input.fetchWithBurstRateRetry,
    onRetry: input.onRetry,
  })
}

export const requestImageEdit = async (input: RequestImageEditInput) => {
  const upstream = await resolveGatewayProviderUpstream({
    providerId: input.providerId,
    endpointType: 'image-edit',
    modelKey: input.modelKey,
    userId: input.userId,
  })
  const adapter = resolveImageVendorAdapter(input.modelKey, upstream.modelCapabilityJson)
  return adapter.edit({
    upstream,
    providerId: input.providerId,
    modelKey: input.modelKey,
    prompt: input.prompt,
    size: input.size,
    count: Math.max(1, Math.floor(Number(input.count) || 1)),
    referenceImages: input.referenceImages,
    signal: input.signal,
    fetchWithBurstRateRetry: input.fetchWithBurstRateRetry,
    onRetry: input.onRetry,
  })
}
