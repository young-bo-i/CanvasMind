declare global {
  interface Window {
    __CANANA_RUNTIME_CONFIG__?: {
      VITE_API_BASE_URL?: string
      VITE_PROVIDER_DEFAULT_BASE_URL?: string
    }
  }
}

const readRuntimeApiBaseUrl = () => {
  if (typeof window === 'undefined') {
    return ''
  }

  return String(window.__CANANA_RUNTIME_CONFIG__?.VITE_API_BASE_URL || '').trim()
}

const readViteApiBaseUrl = () => {
  const viteEnv = typeof import.meta !== 'undefined'
    ? (import.meta as ImportMeta & { env?: Record<string, unknown> }).env
    : undefined

  return String(viteEnv?.VITE_API_BASE_URL || '').trim()
}

// 统一的前端后端接口基址。
export const API_BASE_URL = readRuntimeApiBaseUrl().replace(/\/+$/, '')
  || readViteApiBaseUrl().replace(/\/+$/, '')

// 将相对接口路径拼成可请求的完整地址。
export const buildApiUrl = (path: string) => {
  // 绝对地址直接返回，避免重复拼接。
  if (/^https?:\/\//i.test(path)) {
    return path
  }

  // 没有配置基址时，保持相对路径请求。
  if (!API_BASE_URL) {
    return path
  }

  // 统一拼出完整接口地址。
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

// 将后端返回的资源地址统一解析成可直接访问的完整地址。
export const buildAssetUrl = (path: string) => {
  const normalizedPath = String(path || '').trim()

  // 空路径直接返回，交给上层兜底。
  if (!normalizedPath) {
    return ''
  }

  // 已经是 Data URL 或绝对地址时，直接复用。
  if (
    /^data:/i.test(normalizedPath)
    || /^https?:\/\//i.test(normalizedPath)
    || /^blob:/i.test(normalizedPath)
  ) {
    return normalizedPath
  }

  // 其余以站点 API 基址补全，解决 /uploads 相对路径命中前端端口的问题。
  return buildApiUrl(normalizedPath)
}

/**
 * 缩略图 URL：给同源 /uploads 图片追加 ?w=<width>，后端按需生成并缓存 webp 缩略图，
 * 用于资产网格/发现 feed/账户画廊/管理台等缩略场景（原图常是 4K，几 MB；缩略后传输/解码降 ~90%）。
 * data:/blob:/外链 或非 /uploads 资源原样返回；全屏预览/下载请用 buildAssetUrl 原图。
 */
export const buildThumbnailUrl = (url: string, width = 640) => {
  const normalized = String(url || '').trim()
  if (!normalized || /^data:/i.test(normalized) || /^blob:/i.test(normalized)) {
    return normalized
  }
  if (!normalized.includes('/uploads/') || /[?&]w=/.test(normalized)) {
    return normalized
  }
  const [base, hash] = normalized.split('#')
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}w=${width}${hash ? `#${hash}` : ''}`
}
