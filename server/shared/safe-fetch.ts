// 统一的"安全外呼"封装：给所有"服务端发起的 HTTP 请求"提供
// (1) SSRF 防护：解析目标主机的所有 IP，拒绝私网/环回/链路本地/保留地址（含云元数据 169.254.169.254）；
// (2) 超时：每跳都有 AbortController 超时，避免被慢/挂死的上游长时间占用连接；
// (3) 重定向再校验：手动跟随重定向并对每一跳重新做 SSRF 校验（防 DNS rebinding / 重定向绕过）。
//
// allowPrivateHosts=true 仅用于"管理员可信的上游"（如自建本地模型 http://127.0.0.1:11434）；
// 对"读取用户/模型/搜索结果给出的任意 URL"（联网研究阅读、参考图抓取、自定义上游）必须为 false。
import dns from 'node:dns/promises'
import net from 'node:net'

const DEFAULT_TIMEOUT_MS = Number.parseInt(process.env.UPSTREAM_FETCH_TIMEOUT_MS || '120000', 10)

export interface SafeFetchOptions {
  allowPrivateHosts?: boolean
  timeoutMs?: number
  maxRedirects?: number
}

const isPrivateIpv4 = (ip: string) => {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true
  }
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // 链路本地（含云元数据 169.254.169.254）
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // 组播 / 保留
  return false
}

const isPrivateIpv6 = (ip: string) => {
  const lower = ip.toLowerCase()
  if (lower === '::1' || lower === '::') return true
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // ULA
  if (lower.startsWith('fe80')) return true // 链路本地
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return isPrivateIpv4(mapped[1])
  return false
}

const isPrivateAddress = (ip: string) => {
  const family = net.isIP(ip)
  if (family === 4) return isPrivateIpv4(ip)
  if (family === 6) return isPrivateIpv6(ip)
  return true // 无法识别一律按不安全
}

const assertSafeUrl = async (rawUrl: string, allowPrivateHosts: boolean) => {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('上游地址非法')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`不支持的请求协议：${parsed.protocol}`)
  }

  if (allowPrivateHosts) {
    return
  }

  const host = parsed.hostname
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error('禁止访问内网/保留地址')
    return
  }

  let addresses: Array<{ address: string }>
  try {
    addresses = await dns.lookup(host, { all: true })
  } catch {
    throw new Error('上游域名解析失败')
  }

  if (!addresses.length) {
    throw new Error('上游域名解析失败')
  }

  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error('禁止访问内网/保留地址')
    }
  }
}

export const safeFetch = async (
  rawUrl: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {},
): Promise<Response> => {
  const allowPrivateHosts = options.allowPrivateHosts === true
  const timeoutMs = options.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const maxRedirects = options.maxRedirects ?? (allowPrivateHosts ? 5 : 3)

  let currentUrl = rawUrl
  let method = String(init.method || 'GET').toUpperCase()
  let body = init.body
  const parentSignal = init.signal as AbortSignal | undefined

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    await assertSafeUrl(currentUrl, allowPrivateHosts)

    const controller = new AbortController()
    const onParentAbort = () => controller.abort()
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort()
      else parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let response: Response
    try {
      response = await fetch(currentUrl, {
        ...init,
        method,
        body,
        redirect: 'manual',
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort)
    }

    const status = response.status
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      const location = response.headers.get('location')
      if (!location) return response

      const nextUrl = new URL(location, currentUrl).toString()
      // 按浏览器语义：303 及 301/302 对非 GET/HEAD 请求降级为 GET 并丢弃 body。
      if (status === 303 || ((status === 301 || status === 302) && method !== 'GET' && method !== 'HEAD')) {
        method = 'GET'
        body = undefined
      }
      currentUrl = nextUrl
      continue
    }

    return response
  }

  throw new Error('上游重定向次数过多')
}
