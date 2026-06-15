import fs from 'node:fs/promises'
import path from 'node:path'
import { safeFetch } from '../shared/safe-fetch'
import { getPublicModelCatalog, resolveGatewayProviderUpstream, resolveProviderOwnerScope } from '../provider-config/service'
import { getUploadsDir } from '../storage/service'
import { buildAgentChatMessages } from '../../src/shared/agent-skills-core'
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
  requestBody: Record<string, unknown>
  onRetry?: (retryState: RetryState) => Promise<void> | void
  fetchWithBurstRateRetry: (input: Omit<FetchWithBurstRateRetryInput, 'logGenerationTask'>) => Promise<Response>
}

type RequestImageEditInput = {
  signal: AbortSignal
  providerId: string
  modelKey: string
  prompt: string
  size?: string
  count?: number
  referenceImages: string[]
  onRetry?: (retryState: RetryState) => Promise<void> | void
  fetchWithBurstRateRetry: (input: Omit<FetchWithBurstRateRetryInput, 'logGenerationTask'>) => Promise<Response>
}

const resolveServerReferenceImageBlob = async (imageValue: string) => {
  const normalizedValue = String(imageValue || '').trim()
  if (normalizedValue.startsWith(UPLOADS_PUBLIC_PATH_PREFIX)) {
    const uploadsDir = getUploadsDir()
    const relativePath = decodeURIComponent(normalizedValue.slice(UPLOADS_PUBLIC_PATH_PREFIX.length))
    const filePath = path.resolve(uploadsDir, relativePath)
    if (!filePath.startsWith(uploadsDir)) {
      throw new Error('参考图路径非法')
    }

    const fileBuffer = await fs.readFile(filePath)
    const mimeType = normalizedValue.toLowerCase().includes('.webp')
      ? 'image/webp'
      : normalizedValue.toLowerCase().includes('.gif')
        ? 'image/gif'
        : normalizedValue.toLowerCase().includes('.bmp')
          ? 'image/bmp'
          : normalizedValue.toLowerCase().includes('.svg')
            ? 'image/svg+xml'
            : normalizedValue.toLowerCase().includes('.jpg') || normalizedValue.toLowerCase().includes('.jpeg')
              ? 'image/jpeg'
              : 'image/png'
    return new Blob([fileBuffer], { type: mimeType })
  }

  // 参考图地址来自用户/模型输入(任意公网 URL)：禁止私网目标，防 SSRF。
  const response = await safeFetch(normalizedValue, {}, { allowPrivateHosts: false })
  if (!response.ok) {
    throw new Error(`参考图读取失败 (${response.status})`)
  }

  return response.blob()
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

// Gemini / Nano Banana 图片模型:走 Gemini 原生 generateContent 端点(支持 aspectRatio + imageSize 到 4K)。
// 优先看 capabilityJson.imageViaGemini;否则按 model id 识别 gemini*-image。
const isGeminiImageModel = (modelKey: string, capabilityJson: unknown): boolean => {
  if (capFlag(capabilityJson, 'imageViaGemini')) return true
  const key = String(modelKey || '').toLowerCase()
  return Boolean(key) && /gemini[\w.-]*-image/.test(key)
}

// 其它"经 OpenAI 兼容 chat 端点出图"的模型(gpt-4o-image、qwen-image 等);明确排除 gpt-image-*(走 /images/generations)与 gemini(走 generateContent)。
const isChatImageModel = (modelKey: string, capabilityJson: unknown): boolean => {
  if (capFlag(capabilityJson, 'imageViaChat')) return true
  const key = String(modelKey || '').toLowerCase()
  if (!key) return false
  if (/gpt-image/.test(key) || isGeminiImageModel(modelKey, capabilityJson)) return false
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
const deriveGeminiImageSize = (size?: string): string => {
  const matched = String(size || '').trim().match(/^(\d+)\s*[x×X]\s*(\d+)$/)
  if (!matched) return ''
  const longEdge = Math.max(Number(matched[1]) || 0, Number(matched[2]) || 0)
  if (!longEdge) return ''
  if (longEdge >= 3000) return '4K'
  if (longEdge >= 1800) return '2K'
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
      responseModalities: ['IMAGE'],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  }

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
      endpointType: 'image-gemini',
      aspectRatio: imageConfig.aspectRatio || '',
      imageSize: imageConfig.imageSize || '',
      referenceImageCount: (input.referenceImages || []).length,
    },
    onRetry: input.onRetry,
    init: { method: 'POST', headers, body: JSON.stringify(requestBody) },
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    throw new Error(normalizeGenerationErrorMessage(responseText, `图片生成失败 (${response.status})`))
  }

  const json: any = await response.json()
  const imageUrls: string[] = []
  for (const part of (json?.candidates?.[0]?.content?.parts || [])) {
    const idata = part?.inlineData || part?.inline_data
    if (idata?.data) {
      imageUrls.push(`data:${idata.mimeType || idata.mime_type || 'image/png'};base64,${idata.data}`)
    } else if (typeof part?.text === 'string') {
      for (const u of extractImageUrlsFromText(part.text)) {
        if (!imageUrls.includes(u)) imageUrls.push(u)
      }
    }
  }
  if (!imageUrls.length) {
    throw new Error('未能从 Gemini 响应中解析出图片')
  }

  const um = json?.usageMetadata || {}
  const num = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : 0 }
  const promptTokens = num(um.promptTokenCount)
  const completionTokens = num(um.candidatesTokenCount)
  const cachedTokens = num(um.cachedContentTokenCount)
  const usage = (promptTokens || completionTokens || cachedTokens) ? { promptTokens, completionTokens, cachedTokens } : null
  return { upstreamUrl, imageUrls, usage }
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

export const requestImageGeneration = async (input: RequestImageGenerationInput) => {
  const upstream = await resolveGatewayProviderUpstream({
    providerId: input.providerId,
    endpointType: 'image',
    modelKey: input.modelKey,
  })

  // Gemini / Nano Banana:走原生 generateContent(支持比例 + 4K)。
  if (isGeminiImageModel(input.modelKey, upstream.modelCapabilityJson)) {
    const body = input.requestBody as Record<string, unknown>
    return performGeminiImageBatch({
      upstream,
      modelKey: input.modelKey,
      prompt: String(body.prompt || '').trim(),
      size: String(body.size || ''),
      count: Math.max(1, Math.floor(Number(body.n) || 1)),
      signal: input.signal,
      fetchWithBurstRateRetry: input.fetchWithBurstRateRetry,
      onRetry: input.onRetry,
      stage: 'image_generation',
    })
  }

  // 其它 chat 出图模型(gpt-4o-image / qwen-image 等):走 chat 端点(非流式),不走 /images/generations。
  if (isChatImageModel(input.modelKey, upstream.modelCapabilityJson)) {
    const body = input.requestBody as Record<string, unknown>
    return performChatImageBatch({
      upstream,
      modelKey: input.modelKey,
      prompt: String(body.prompt || '').trim(),
      size: String(body.size || ''),
      count: Math.max(1, Math.floor(Number(body.n) || 1)),
      signal: input.signal,
      fetchWithBurstRateRetry: input.fetchWithBurstRateRetry,
      onRetry: input.onRetry,
      stage: 'image_generation',
    })
  }

  const headers = new Headers({
    'Content-Type': 'application/json',
  })
  if (upstream.apiKey) {
    headers.set('Authorization', `Bearer ${upstream.apiKey}`)
  }

  const requestBody = normalizeImageGenerationRequestBody({
    requestBody: input.requestBody,
    modelKey: input.modelKey,
  })

  const upstreamImageCount = Math.max(1, Math.floor(Number((requestBody as Record<string, unknown>).n) || 1))
  const upstreamUrl = `${upstream.baseUrl.replace(/\/+$/, '')}/${upstream.endpoint.replace(/^\/+/, '')}`
  const response = await input.fetchWithBurstRateRetry({
    url: upstreamUrl,
    signal: input.signal,
    stage: 'image_generation',
    timeoutMs: resolveUpstreamFetchTimeoutMs(upstreamImageCount),
    detail: {
      providerId: input.providerId,
      modelKey: input.modelKey,
      endpointType: 'image',
      imageCount: upstreamImageCount,
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
    throw new Error(normalizeGenerationErrorMessage(
      responseText,
      `图片生成失败 (${response.status})`,
    ))
  }

  // 非流式 JSON 接口可同时拿到图片与 token usage(gpt-image-2 等按 token 计价用);chat-completions 流式暂无 usage。
  let usage: { promptTokens: number; completionTokens: number; cachedTokens: number } | null = null
  let imageUrls: string[]
  if (isChatCompletionsEndpoint(upstream.endpoint)) {
    imageUrls = await extractImageUrlsFromStreamResponse(response, input.signal)
  } else {
    const json = await response.json()
    imageUrls = extractImageUrlsFromJsonResponse(json)
    usage = extractImageUsageFromPayload(json)
  }

  if (!imageUrls.length) {
    throw new Error('未能获取到生成的图片')
  }

  return {
    upstreamUrl,
    imageUrls,
    usage,
  }
}

export const requestImageEdit = async (input: RequestImageEditInput) => {
  const upstream = await resolveGatewayProviderUpstream({
    providerId: input.providerId,
    endpointType: 'image-edit',
    modelKey: input.modelKey,
  })

  // Gemini / Nano Banana:图生图也走原生 generateContent,参考图作为 inlineData 传入。
  if (isGeminiImageModel(input.modelKey, upstream.modelCapabilityJson)) {
    return performGeminiImageBatch({
      upstream,
      modelKey: input.modelKey,
      prompt: input.prompt,
      size: input.size,
      referenceImages: input.referenceImages,
      count: input.count,
      signal: input.signal,
      fetchWithBurstRateRetry: input.fetchWithBurstRateRetry,
      onRetry: input.onRetry,
      stage: 'image_edit',
    })
  }

  // 其它 chat 出图模型(gpt-4o-image / qwen-image 等):图生图走 chat 端点,把参考图作为多模态 image_url 传入。
  if (isChatImageModel(input.modelKey, upstream.modelCapabilityJson)) {
    return performChatImageBatch({
      upstream,
      modelKey: input.modelKey,
      prompt: input.prompt,
      size: input.size,
      referenceImages: input.referenceImages,
      count: input.count,
      signal: input.signal,
      fetchWithBurstRateRetry: input.fetchWithBurstRateRetry,
      onRetry: input.onRetry,
      stage: 'image_edit',
    })
  }

  const editImageCount = Math.max(1, Math.floor(Number(input.count) || 1))
  const formData = await buildImageEditRequestFormData({
    modelKey: input.modelKey,
    prompt: input.prompt,
    size: input.size,
    count: editImageCount,
    referenceImages: input.referenceImages,
    fileNamePrefix: 'reference',
    resolveReferenceImageBlob: resolveServerReferenceImageBlob,
  })

  const headers = new Headers()
  if (upstream.apiKey) {
    headers.set('Authorization', `Bearer ${upstream.apiKey}`)
  }

  const upstreamUrl = `${upstream.baseUrl.replace(/\/+$/, '')}/${upstream.endpoint.replace(/^\/+/, '')}`
  const response = await input.fetchWithBurstRateRetry({
    url: upstreamUrl,
    signal: input.signal,
    stage: 'image_edit',
    timeoutMs: resolveUpstreamFetchTimeoutMs(editImageCount),
    detail: {
      providerId: input.providerId,
      modelKey: input.modelKey,
      endpointType: 'image-edit',
      referenceImageCount: input.referenceImages.length,
      imageCount: editImageCount,
    },
    onRetry: input.onRetry,
    init: {
      method: 'POST',
      headers,
      body: formData,
    },
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    throw new Error(normalizeGenerationErrorMessage(
      responseText,
      `图片编辑失败 (${response.status})`,
    ))
  }

  const editJson = await response.json()
  const imageUrls = extractImageUrlsFromJsonResponse(editJson)
  if (!imageUrls.length) {
    throw new Error('未能获取到编辑后的图片')
  }

  return {
    upstreamUrl,
    imageUrls,
    usage: extractImageUsageFromPayload(editJson),
  }
}

export const resolveWorkspaceImageModel = async (binding?: {
  providerId: string
  modelKey: string
}, requestUserId?: string) => {
  // 按请求者所属管理员的厂商作用域取目录：既保证能找到本租户的私有模型，也顺带拦截越权绑定。
  const scope = await resolveProviderOwnerScope(requestUserId)
  const catalog = await getPublicModelCatalog(scope)
  if (binding?.providerId && binding?.modelKey) {
    const matchedImageModel = catalog.models.image.find(item => {
      return item.providerId === binding.providerId && item.modelKey === binding.modelKey
    })
    if (!matchedImageModel) {
      throw new Error('当前技能绑定的图片模型不可用，请在后台技能配置中重新选择')
    }
    return matchedImageModel
  }

  const imageModel = catalog.models.image[0]
  if (!imageModel) {
    throw new Error('未配置可用图片模型，请先在后台启用图片模型')
  }

  return imageModel
}

const extractJsonObjectFromText = (text: string) => {
  const normalized = String(text || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  if (!normalized) {
    return ''
  }

  if (normalized.startsWith('{') && normalized.endsWith('}')) {
    return normalized
  }

  const startIndex = normalized.indexOf('{')
  if (startIndex === -1) {
    return ''
  }

  let depth = 0
  for (let index = startIndex; index < normalized.length; index += 1) {
    const currentChar = normalized[index]
    if (currentChar === '{') {
      depth += 1
    } else if (currentChar === '}') {
      depth -= 1
      if (depth === 0) {
        return normalized.slice(startIndex, index + 1)
      }
    }
  }

  return ''
}

const readChatResponseText = async (response: Response, signal: AbortSignal) => {
  if (!response.body) {
    return await extractChatTextFromNonStreamResponse(response)
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase()
  if (!contentType.includes('text/event-stream')) {
    const rawText = await response.text().catch(() => '')
    if (!rawText.trim()) {
      return ''
    }

    try {
      const parsed = JSON.parse(rawText)
      const extractedText = extractChatTextFromJsonPayload(parsed)
      return extractedText || rawText
    } catch {
      return rawText
    }
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let streamErrorMessage = ''

  while (!signal.aborted) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) {
        continue
      }

      const chunk = trimmed.slice(5).trim()
      if (!chunk || chunk === '[DONE]') {
        continue
      }

      const chunkError = parseChatChunkError(chunk)
      if (chunkError) {
        streamErrorMessage = chunkError
        break
      }

      fullContent += parseChatChunkText(chunk)
    }

    if (streamErrorMessage) {
      break
    }
  }

  if (streamErrorMessage) {
    throw new Error(streamErrorMessage)
  }

  return fullContent
}

export const requestAgentWorkspaceModelPlan = async (input: {
  signal: AbortSignal
  providerId: string
  modelKey: string
  capabilityFlags?: ModelCapabilityFlags | null
  skill: string
  skillLabel: string
  workspaceSkillKey: string
  dependencySkillKeys?: string[]
  prompt: string
  referenceImages?: string[]
  fetchWithBurstRateRetry: (input: Omit<FetchWithBurstRateRetryInput, 'logGenerationTask'>) => Promise<Response>
}) => {
  const upstream = await resolveGatewayProviderUpstream({
    providerId: input.providerId,
    endpointType: 'chat',
    modelKey: input.modelKey,
  })

  const headers = new Headers({
    'Content-Type': 'application/json',
  })
  if (upstream.apiKey) {
    headers.set('Authorization', `Bearer ${upstream.apiKey}`)
  }

  const capabilitySpec = parseModelCapabilitySpec(upstream.modelCapabilityJson)
  const appliedCapability = applyCapabilityFlags(input.capabilityFlags || null, capabilitySpec)

  const messages = [
    ...buildAgentChatMessages(input.skill, input.prompt, input.referenceImages),
    {
      role: 'system',
      content: [
        '你是一个 AI 技能工作流规划器。',
        '你需要先理解用户需求，再输出适合图片生成的结构化执行计划。',
        '必须返回纯 JSON，不要输出 Markdown，不要输出解释。',
        'JSON 字段固定为：analysis_lines, workflow_label, workflow_params, plan_items, image_tasks, submit_lines。',
        'analysis_lines 至少 3 条，用中文简洁说明：需求理解、技能匹配、执行策略。',
        `当前技能展示名：${input.skillLabel}。当前技能键：${input.workspaceSkillKey}。`,
        input.dependencySkillKeys?.length ? `依赖技能键：${input.dependencySkillKeys.join('、')}。` : '当前无依赖技能。',
        input.referenceImages?.length ? `当前还提供了 ${input.referenceImages.length} 张参考图，你必须结合这些参考图理解主体、风格、构图或保留要求。` : '当前没有提供参考图。',
        'workflow_params.workflow_type 当前仅允许 text_to_image。',
        'plan_items 和 image_tasks 默认给 4 项，并保持一一对应。',
        '每个 image_tasks 元素必须包含 label 和 promptText；promptText 要适合直接用于图片生成，必须中文，且彼此有明确差异。',
        'submit_lines 给 1 到 2 条，用于描述将如何提交并回传结果。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `用户需求：${input.prompt}`,
        '请基于当前技能生成结构化工作流计划。',
      ].join('\n'),
    },
  ]

  const upstreamUrl = `${upstream.baseUrl.replace(/\/+$/, '')}/${upstream.endpoint.replace(/^\/+/, '')}`
  const response = await input.fetchWithBurstRateRetry({
    url: upstreamUrl,
    signal: input.signal,
    stage: 'agent_workspace_planner',
    detail: {
      providerId: input.providerId,
      modelKey: input.modelKey,
      endpointType: 'chat',
      skill: input.skill,
    },
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...appliedCapability.upstreamFields,
        model: input.modelKey,
        stream: false,
        messages,
        temperature: 0.6,
      }),
    },
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    throw new Error(responseText || `规划模型调用失败 (${response.status})`)
  }

  const rawText = await readChatResponseText(response, input.signal)
  const jsonText = extractJsonObjectFromText(rawText)
  if (!jsonText) {
    throw new Error('规划模型未返回有效 JSON')
  }

  const parsed = JSON.parse(jsonText) as Record<string, unknown>
  const analysisLines = Array.isArray(parsed.analysis_lines)
    ? parsed.analysis_lines.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const submitLines = Array.isArray(parsed.submit_lines)
    ? parsed.submit_lines.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const planItems = Array.isArray(parsed.plan_items)
    ? parsed.plan_items.map((item) => {
        if (typeof item === 'string') {
          return item.trim()
        }

        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>
          return String(record.title || record.label || record.text || '').trim()
        }

        return ''
      }).filter(Boolean)
    : []
  const imageTasks = Array.isArray(parsed.image_tasks)
    ? parsed.image_tasks.map((item) => {
        const record = item as Record<string, unknown>
        return {
          label: String(record.label || '').trim(),
          promptText: String(record.promptText || record.prompt_text || '').trim(),
        }
      }).filter(item => item.label && item.promptText)
    : []

  const workflowParams = parsed.workflow_params && typeof parsed.workflow_params === 'object'
    ? parsed.workflow_params as Record<string, unknown>
    : undefined

  const hasUsablePlan = analysisLines.length >= 2
    || submitLines.length >= 1
    || planItems.length >= 2
    || imageTasks.length >= 2
    || Boolean(String(parsed.workflow_label || '').trim())

  if (!hasUsablePlan) {
    throw new Error(`规划模型返回内容不完整：${jsonText.slice(0, 240)}`)
  }

  if (workflowParams?.workflow_type && workflowParams.workflow_type !== 'text_to_image') {
    throw new Error(`规划模型返回了不支持的工作流类型：${String(workflowParams.workflow_type)}`)
  }

  return {
    analysisLines,
    workflowLabel: String(parsed.workflow_label || '').trim() || undefined,
    workflowParams,
    planItems,
    imageTasks,
    submitLines,
    rawTextPreview: rawText.slice(0, 400),
  } satisfies AgentWorkspaceModelPlanResult
}
