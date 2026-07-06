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

export const readRawBuffer = (req: any): Promise<Buffer> => {
  // 用手动监听而非 for-await：超限时只 pause() 停止读取(内存仍有界)，
  // 不销毁 req —— req 与 res 共用底层 socket，过早 destroy 会让上层写不出 413 响应
  // (客户端只会收到 ECONNRESET)。让上层 catch 正常发完 413，Node 会在响应后关闭该连接。
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const cleanup = () => {
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
    }
    const onData = (chunk: any) => {
      if (settled) return
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      total += buf.length
      if (total > MAX_RAW_BODY_BYTES) {
        settled = true
        cleanup()
        // 停止继续读取(不再 push 到 chunks，内存有界)，但保留 socket 以便回 413。
        try {
          req.pause?.()
        } catch {
          // 忽略
        }
        reject(new RawBodyTooLargeError(MAX_RAW_BODY_BYTES))
        return
      }
      chunks.push(buf)
    }
    const onEnd = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks))
    }
    const onError = (err: any) => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
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
