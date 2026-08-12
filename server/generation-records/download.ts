import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getUploadsDir } from '../storage/service'

export type DownloadMediaKind = 'image' | 'video'

export interface MediaDownloadSource {
  id: string
  createdAt: Date
  url: string
  mimeType?: string | null
  mediaKind: DownloadMediaKind
  mediaIndex?: number
  filenameBase?: string
}

interface GenerationImageDownloadSource {
  recordId: string
  createdAt: Date
  url: string
  mimeType?: string | null
  imageIndex: number
}

const DOWNLOAD_TIMEOUT_MS = Number.parseInt(
  process.env.ASSET_DOWNLOAD_TIMEOUT_MS || '120000',
  10,
)
const DOWNLOAD_MAX_BYTES = Number.parseInt(
  process.env.ASSET_DOWNLOAD_MAX_BYTES || String(150 * 1024 * 1024),
  10,
)

const MIME_EXTENSION_MAP: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv',
  'video/mpeg': 'mpeg',
  'video/ogg': 'ogv',
  'video/x-flv': 'flv',
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.qt': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.ogv': 'video/ogg',
  '.flv': 'video/x-flv',
}

export class MediaDownloadError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 502) {
    super(message)
    this.name = 'MediaDownloadError'
    this.statusCode = statusCode
  }
}

const normalizeMimeType = (value: unknown) => {
  const normalized = String(value || '').split(';')[0].trim().toLowerCase()
  if (normalized === 'image/jpg') {
    return 'image/jpeg'
  }
  if (normalized === 'video/mov') {
    return 'video/quicktime'
  }
  return normalized
}

const resolveMimeTypeFromPath = (value: string) => {
  try {
    const parsed = new URL(value, 'http://localhost')
    return EXTENSION_MIME_MAP[path.extname(parsed.pathname).toLowerCase()] || ''
  } catch {
    return EXTENSION_MIME_MAP[path.extname(value).toLowerCase()] || ''
  }
}

// 读取文件头识别常见图片/视频格式，避免错误扩展名把网页或错误响应保存成本地文件。
const detectMediaMimeType = (header: Uint8Array) => {
  if (
    header.length >= 8
    && header[0] === 0x89
    && header[1] === 0x50
    && header[2] === 0x4e
    && header[3] === 0x47
    && header[4] === 0x0d
    && header[5] === 0x0a
    && header[6] === 0x1a
    && header[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    header.length >= 12
    && String.fromCharCode(...header.slice(0, 4)) === 'RIFF'
  ) {
    const riffType = String.fromCharCode(...header.slice(8, 12))
    if (riffType === 'WEBP') return 'image/webp'
    if (riffType === 'AVI ') return 'video/x-msvideo'
  }
  const prefix = String.fromCharCode(...header.slice(0, 6))
  if (prefix === 'GIF87a' || prefix === 'GIF89a') {
    return 'image/gif'
  }
  if (header.length >= 2 && header[0] === 0x42 && header[1] === 0x4d) {
    return 'image/bmp'
  }
  if (
    header.length >= 4
    && (
      (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2a && header[3] === 0x00)
      || (header[0] === 0x4d && header[1] === 0x4d && header[2] === 0x00 && header[3] === 0x2a)
    )
  ) {
    return 'image/tiff'
  }
  if (header.length >= 12 && String.fromCharCode(...header.slice(4, 8)) === 'ftyp') {
    const brand = String.fromCharCode(...header.slice(8, 12)).toLowerCase()
    if (brand === 'avif' || brand === 'avis') {
      return 'image/avif'
    }
    if (brand === 'qt  ') {
      return 'video/quicktime'
    }
    return 'video/mp4'
  }
  if (
    header.length >= 4
    && header[0] === 0x1a
    && header[1] === 0x45
    && header[2] === 0xdf
    && header[3] === 0xa3
  ) {
    // WebM 与 Matroska 共用 EBML 文件头，仅确认它是视频容器；具体类型交给 MIME/扩展名细分。
    return 'video/x-ebml'
  }
  if (header.length >= 4 && String.fromCharCode(...header.slice(0, 4)) === 'OggS') {
    return 'video/ogg'
  }
  if (header.length >= 3 && String.fromCharCode(...header.slice(0, 3)) === 'FLV') {
    return 'video/x-flv'
  }
  return ''
}

const looksLikeWebDocument = (header: Uint8Array) => {
  const text = Buffer.from(header)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .slice(0, 120)
    .toLowerCase()
  return text.startsWith('<!doctype html')
    || text.startsWith('<html')
    || text.startsWith('<head')
    || text.startsWith('<body')
    || text.startsWith('{')
    || text.startsWith('[')
}

const isMimeForKind = (mimeType: string, mediaKind: DownloadMediaKind) => (
  mimeType.startsWith(`${mediaKind}/`)
)

const resolveDownloadMimeType = (
  header: Uint8Array,
  responseMimeType: string,
  storedMimeType: string,
  sourceUrl: string,
  mediaKind: DownloadMediaKind,
) => {
  if (looksLikeWebDocument(header)) {
    throw new MediaDownloadError('原始资源返回了网页内容或错误内容，下载已终止，请稍后重试')
  }

  const detectedMimeType = detectMediaMimeType(header)
  const normalizedResponseMimeType = normalizeMimeType(responseMimeType)
  const normalizedStoredMimeType = normalizeMimeType(storedMimeType)
  const pathMimeType = resolveMimeTypeFromPath(sourceUrl)
  if (detectedMimeType && !isMimeForKind(detectedMimeType, mediaKind)) {
    throw new MediaDownloadError(`原${mediaKind === 'video' ? '视频' : '图'}资源类型与文件内容不匹配，未执行下载`)
  }
  const detectedResolvedMimeType = detectedMimeType === 'video/x-ebml'
    ? ([normalizedResponseMimeType, normalizedStoredMimeType, pathMimeType]
        .find(mimeType => mimeType === 'video/webm' || mimeType === 'video/x-matroska') || 'video/webm')
    : (isMimeForKind(detectedMimeType, mediaKind) ? detectedMimeType : '')
  const resolvedMimeType = detectedResolvedMimeType || (
    isMimeForKind(normalizedResponseMimeType, mediaKind) ? normalizedResponseMimeType : ''
  ) || (
    isMimeForKind(normalizedStoredMimeType, mediaKind) ? normalizedStoredMimeType : ''
  ) || (
    isMimeForKind(pathMimeType, mediaKind) ? pathMimeType : ''
  )

  if (!resolvedMimeType) {
    throw new MediaDownloadError(`原${mediaKind === 'video' ? '视频' : '图'}资源格式无效，未执行下载`)
  }
  return resolvedMimeType
}

const sanitizeFilenameBase = (value: string) => {
  return String(value || '')
    .trim()
    .replace(/[\x00-\x1f\x7f<>:"/\\|?*]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/[.\s-]+$/g, '')
    .slice(0, 120)
}

const buildDownloadFilename = (
  source: MediaDownloadSource,
  mimeType: string,
) => {
  const date = source.createdAt instanceof Date && !Number.isNaN(source.createdAt.getTime())
    ? source.createdAt.toISOString().slice(0, 10).replace(/-/g, '')
    : new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const mediaIndex = Number.isInteger(source.mediaIndex) && Number(source.mediaIndex) >= 0
    ? Number(source.mediaIndex) + 1
    : 1
  const fallbackBase = `canana-${source.mediaKind}-${date}-${mediaIndex}`
  const filenameBase = sanitizeFilenameBase(source.filenameBase || fallbackBase) || fallbackBase
  const extension = MIME_EXTENSION_MAP[mimeType] || (source.mediaKind === 'video' ? 'video' : 'img')
  return `${filenameBase}.${extension}`
}

const applyDownloadHeaders = (
  res: any,
  source: MediaDownloadSource,
  mimeType: string,
  contentLength?: number,
) => {
  res.statusCode = 200
  res.setHeader('Content-Type', mimeType)
  res.setHeader('Content-Disposition', `attachment; filename="${buildDownloadFilename(source, mimeType)}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'")
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, Content-Length')
  if (typeof contentLength === 'number' && Number.isFinite(contentLength) && contentLength >= 0) {
    res.setHeader('Content-Length', String(contentLength))
  }
}

const resolveLocalUploadPath = (sourceUrl: string) => {
  if (!sourceUrl.startsWith('/uploads/')) {
    return ''
  }
  let parsed: URL
  try {
    parsed = new URL(sourceUrl, 'http://localhost')
  } catch {
    return ''
  }
  if (!parsed.pathname.startsWith('/uploads/')) {
    throw new MediaDownloadError('原始文件路径无效', 404)
  }
  const uploadsDir = getUploadsDir()
  let relativePath = ''
  try {
    relativePath = decodeURIComponent(parsed.pathname.slice('/uploads/'.length))
  } catch {
    throw new MediaDownloadError('原始文件路径无效', 404)
  }
  const filePath = path.resolve(uploadsDir, relativePath)
  if (filePath !== uploadsDir && !filePath.startsWith(uploadsDir + path.sep)) {
    throw new MediaDownloadError('原始文件路径无效', 404)
  }
  return filePath
}

const sendLocalMedia = async (
  res: any,
  source: MediaDownloadSource,
  filePath: string,
) => {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    throw new MediaDownloadError('原始文件不存在', 404)
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new MediaDownloadError('原始文件不存在', 404)
  }
  if (stat.size > DOWNLOAD_MAX_BYTES) {
    throw new MediaDownloadError('原始文件过大，无法下载', 413)
  }

  const handle = await fs.open(filePath, 'r')
  const headerBuffer = Buffer.alloc(Math.min(128, stat.size))
  try {
    await handle.read(headerBuffer, 0, headerBuffer.length, 0)
  } finally {
    await handle.close()
  }

  const mimeType = resolveDownloadMimeType(
    headerBuffer,
    resolveMimeTypeFromPath(filePath),
    String(source.mimeType || ''),
    source.url,
    source.mediaKind,
  )
  applyDownloadHeaders(res, source, mimeType, stat.size)
  await pipeline(createReadStream(filePath), res)
}

const sendDataMedia = async (
  res: any,
  source: MediaDownloadSource,
) => {
  const matched = String(source.url || '').match(/^data:([^;,]*)(;base64)?,(.*)$/is)
  if (!matched) {
    throw new MediaDownloadError('原始资源地址无效', 404)
  }

  let buffer: Buffer
  try {
    buffer = matched[2]
      ? Buffer.from(matched[3], 'base64')
      : Buffer.from(decodeURIComponent(matched[3]), 'utf8')
  } catch {
    throw new MediaDownloadError('原始资源内容无效')
  }
  if (!buffer.byteLength) {
    throw new MediaDownloadError('原始文件为空')
  }
  if (buffer.byteLength > DOWNLOAD_MAX_BYTES) {
    throw new MediaDownloadError('原始文件过大，无法下载', 413)
  }

  const mimeType = resolveDownloadMimeType(
    buffer.subarray(0, 128),
    matched[1],
    String(source.mimeType || ''),
    source.url,
    source.mediaKind,
  )
  applyDownloadHeaders(res, source, mimeType, buffer.byteLength)
  await pipeline(Readable.from([buffer]), res)
}

const sendRemoteMedia = async (
  res: any,
  source: MediaDownloadSource,
) => {
  if (!/^https?:\/\//i.test(source.url)) {
    throw new MediaDownloadError('原始资源地址无效', 404)
  }

  const controller = new AbortController()
  const timeoutTimer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!response.ok || !response.body) {
      throw new MediaDownloadError(`原始资源读取失败（${response.status}）`)
    }

    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > DOWNLOAD_MAX_BYTES) {
      throw new MediaDownloadError('原始文件过大，无法下载', 413)
    }

    const reader = response.body.getReader()
    const initialChunks: Uint8Array[] = []
    let initialByteLength = 0
    let reachedEnd = false
    // Web Streams 不保证首个 chunk 足够容纳 8/12 字节 magic；累计至 128 bytes 后再识别，
    // 并把已读 chunks 原样回放，避免 CDN 极小分块导致合法媒体被误判。
    while (initialByteLength < 128) {
      const read = await reader.read()
      if (read.done) {
        reachedEnd = true
        break
      }
      if (!read.value?.byteLength) {
        continue
      }
      initialChunks.push(read.value)
      initialByteLength += read.value.byteLength
    }
    if (!initialByteLength) {
      throw new MediaDownloadError('原始文件为空')
    }
    if (initialByteLength > DOWNLOAD_MAX_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new MediaDownloadError('原始文件过大，无法下载', 413)
    }

    const initialHeader = Buffer.concat(
      initialChunks.map(chunk => Buffer.from(chunk)),
      initialByteLength,
    ).subarray(0, 128)

    const mimeType = resolveDownloadMimeType(
      initialHeader,
      String(response.headers.get('content-type') || ''),
      String(source.mimeType || ''),
      source.url,
      source.mediaKind,
    )

    let downloadedBytes = initialByteLength
    const body = Readable.from((async function* () {
      for (const initialChunk of initialChunks) {
        yield initialChunk
      }
      if (reachedEnd) {
        return
      }
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) {
          break
        }
        if (!chunk.value) {
          continue
        }
        downloadedBytes += chunk.value.byteLength
        if (downloadedBytes > DOWNLOAD_MAX_BYTES) {
          controller.abort()
          throw new MediaDownloadError('原始文件过大，下载已终止', 413)
        }
        yield chunk.value
      }
    })())

    // Node fetch 会透明解压 gzip/br 响应；此时上游 Content-Length 是压缩体长度，不能原样下发，
    // 否则浏览器会按错误长度截断或报告 ERR_CONTENT_LENGTH_MISMATCH。
    const contentEncoding = String(response.headers.get('content-encoding') || '').trim().toLowerCase()
    const safeContentLength = !contentEncoding || contentEncoding === 'identity'
      ? declaredSize || undefined
      : undefined
    applyDownloadHeaders(res, source, mimeType, safeContentLength)
    await pipeline(body, res)
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new MediaDownloadError('原始文件下载超时，请稍后重试', 504)
    }
    throw error
  } finally {
    clearTimeout(timeoutTimer)
  }
}

export const sendMediaDownload = async (
  res: any,
  source: MediaDownloadSource,
) => {
  const normalizedSource = {
    ...source,
    url: String(source.url || '').trim().split('#')[0],
  }
  const localFilePath = resolveLocalUploadPath(normalizedSource.url)
  if (localFilePath) {
    await sendLocalMedia(res, normalizedSource, localFilePath)
    return
  }
  if (/^data:/i.test(normalizedSource.url)) {
    await sendDataMedia(res, normalizedSource)
    return
  }

  await sendRemoteMedia(res, normalizedSource)
}

// 保留既有导出，兼容已经上线的生成图片下载调用与测试。
export const sendGenerationImageDownload = async (
  res: any,
  source: GenerationImageDownloadSource,
) => {
  await sendMediaDownload(res, {
    id: source.recordId,
    createdAt: source.createdAt,
    url: source.url,
    mimeType: source.mimeType,
    mediaKind: 'image',
    mediaIndex: source.imageIndex,
  })
}

export const resolveMediaDownloadStatus = (error: unknown) => {
  const statusCode = Number((error as any)?.statusCode || 0)
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500
}

export const resolveGenerationImageDownloadStatus = resolveMediaDownloadStatus
