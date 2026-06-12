import { Readable } from 'node:stream'

export interface GatewayForwardBody {
  upstream?: {
    baseUrl?: string
    apiKey?: string
    endpoint?: string
    providerId?: string
    endpointType?: 'chat' | 'image' | 'image-edit' | 'video'
    modelKey?: string
  }
  request?: {
    method?: string
    headers?: Record<string, string>
    body?: unknown
  }
}

export const readJsonBody = async (req: any): Promise<GatewayForwardBody> => {
  const raw = await readRawBody(req)
  if (!raw) return {}

  return JSON.parse(raw) as GatewayForwardBody
}

export const readRawBody = async (req: any): Promise<string> => {
  return (await readRawBuffer(req)).toString('utf8').trim()
}

// 请求体安全上限：默认 200MB，远高于普通图片/短视频上传，仅用于拦截
// 异常/恶意的超大上传，避免把整段 body 读进内存撑爆进程。JSON 体远小于此值，不受影响。
export const MAX_RAW_BODY_BYTES = Number.parseInt(
  process.env.MAX_RAW_BODY_BYTES || String(200 * 1024 * 1024),
  10,
)

export class RawBodyTooLargeError extends Error {
  readonly statusCode = 413
  constructor(limit: number) {
    super(`请求体过大，超过上限 ${limit} 字节`)
    this.name = 'RawBodyTooLargeError'
  }
}

export const readRawBuffer = async (req: any): Promise<Buffer> => {
  const chunks: Buffer[] = []
  let total = 0

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > MAX_RAW_BODY_BYTES) {
      // 主动销毁连接，停止继续读取，避免边读边堆内存。
      try {
        req.destroy?.()
      } catch {
        // 已断开则忽略
      }
      throw new RawBodyTooLargeError(MAX_RAW_BODY_BYTES)
    }
    chunks.push(buf)
  }

  return Buffer.concat(chunks)
}

export const sendJson = (res: any, statusCode: number, data: unknown) => {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

export const toDebugSnippet = (value: string, maxLength = 320) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

export const setGatewayDebugHeaders = (res: any, input: {
  upstreamUrl: string
  upstreamMethod: string
  upstreamStatus?: number
}) => {
  // 默认关闭调试响应头，避免在浏览器网络面板暴露真实上游地址。
  if (String(process.env.AI_GATEWAY_DEBUG_HEADERS || '').trim() !== 'true') {
    return
  }
  res.setHeader('x-ai-gateway-upstream-url', input.upstreamUrl)
  res.setHeader('x-ai-gateway-upstream-method', input.upstreamMethod)
  if (typeof input.upstreamStatus === 'number') {
    res.setHeader('x-ai-gateway-upstream-status', String(input.upstreamStatus))
  }
}

export const joinUpstreamUrl = (baseUrl: string, endpoint: string) => {
  const normalizedEndpoint = endpoint.trim()
  if (/^https?:\/\//i.test(normalizedEndpoint)) {
    return normalizedEndpoint
  }

  return `${baseUrl.replace(/\/+$/, '')}/${normalizedEndpoint.replace(/^\/+/, '')}`
}

export const normalizeGatewayPayload = (payload: GatewayForwardBody) => {
  const baseUrl = payload.upstream?.baseUrl?.trim() || ''
  const endpoint = payload.upstream?.endpoint?.trim() || ''
  const providerId = payload.upstream?.providerId?.trim() || ''
  const endpointType = payload.upstream?.endpointType || undefined
  const modelKey = payload.upstream?.modelKey?.trim() || ''

  return {
    providerId,
    endpointType,
    modelKey,
    upstreamUrl: baseUrl && endpoint ? joinUpstreamUrl(baseUrl, endpoint) : '',
    apiKey: payload.upstream?.apiKey?.trim() || '',
    method: (payload.request?.method || 'GET').toUpperCase(),
    headers: payload.request?.headers || {},
    body: payload.request?.body,
  }
}

export const proxyUpstreamResponse = async (upstreamResponse: Response, res: any) => {
  res.statusCode = upstreamResponse.status

  upstreamResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'content-encoding') return
    if (key.toLowerCase() === 'content-length') return
    res.setHeader(key, value)
  })

  if (!upstreamResponse.body) {
    res.end()
    return
  }

  Readable.fromWeb(upstreamResponse.body as any).pipe(res)
}
