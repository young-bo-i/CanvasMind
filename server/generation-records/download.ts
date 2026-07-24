import fs from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { getUploadsDir } from '../storage/service'

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
}

class GenerationImageDownloadError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 502) {
    super(message)
    this.name = 'GenerationImageDownloadError'
    this.statusCode = statusCode
  }
}

const normalizeMimeType = (value: unknown) => {
  const normalized = String(value || '').split(';')[0].trim().toLowerCase()
  if (normalized === 'image/jpg') {
    return 'image/jpeg'
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

// 读取文件头识别最常见的生成图片格式。返回空字符串时再退回可信 MIME/扩展名。
const detectImageMimeType = (header: Uint8Array) => {
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
    && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
  ) {
    return 'image/webp'
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
  }
  return ''
}

const looksLikeWebDocument = (header: Uint8Array) => {
  const text = Buffer.from(header)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
    .slice(0, 80)
    .toLowerCase()
  return text.startsWith('<!doctype html')
    || text.startsWith('<html')
    || text.startsWith('<head')
    || text.startsWith('<body')
    || text.startsWith('{"message"')
    || text.startsWith('{"error"')
}

const resolveDownloadMimeType = (
  header: Uint8Array,
  responseMimeType: string,
  storedMimeType: string,
  sourceUrl: string,
) => {
  if (looksLikeWebDocument(header)) {
    throw new GenerationImageDownloadError('原图资源返回了网页内容，下载已终止，请稍后重试')
  }

  const detectedMimeType = detectImageMimeType(header)
  const normalizedResponseMimeType = normalizeMimeType(responseMimeType)
  const normalizedStoredMimeType = normalizeMimeType(storedMimeType)
  const pathMimeType = resolveMimeTypeFromPath(sourceUrl)
  const resolvedMimeType = detectedMimeType
    || (normalizedResponseMimeType.startsWith('image/') ? normalizedResponseMimeType : '')
    || (normalizedStoredMimeType.startsWith('image/') ? normalizedStoredMimeType : '')
    || pathMimeType

  if (!resolvedMimeType.startsWith('image/')) {
    throw new GenerationImageDownloadError('原图资源格式无效，未执行下载')
  }
  return resolvedMimeType
}

const buildDownloadFilename = (
  source: GenerationImageDownloadSource,
  mimeType: string,
) => {
  const date = source.createdAt instanceof Date && !Number.isNaN(source.createdAt.getTime())
    ? source.createdAt.toISOString().slice(0, 10).replace(/-/g, '')
    : new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const extension = MIME_EXTENSION_MAP[mimeType] || 'img'
  return `canana-image-${date}-${source.imageIndex + 1}.${extension}`
}

const applyDownloadHeaders = (
  res: any,
  source: GenerationImageDownloadSource,
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

  const uploadsDir = getUploadsDir()
  const parsed = new URL(sourceUrl, 'http://localhost')
  const relativePath = decodeURIComponent(parsed.pathname.slice('/uploads/'.length))
  const filePath = path.resolve(uploadsDir, relativePath)
  if (filePath !== uploadsDir && !filePath.startsWith(uploadsDir + path.sep)) {
    throw new GenerationImageDownloadError('原图文件路径无效', 404)
  }
  return filePath
}

const sendLocalImage = async (
  res: any,
  source: GenerationImageDownloadSource,
  filePath: string,
) => {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    throw new GenerationImageDownloadError('原图文件不存在', 404)
  }
  if (!stat.isFile() || stat.size <= 0) {
    throw new GenerationImageDownloadError('原图文件不存在', 404)
  }
  if (stat.size > DOWNLOAD_MAX_BYTES) {
    throw new GenerationImageDownloadError('原图文件过大，无法下载', 413)
  }

  const handle = await fs.open(filePath, 'r')
  const headerBuffer = Buffer.alloc(Math.min(64, stat.size))
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
  )
  applyDownloadHeaders(res, source, mimeType, stat.size)
  await pipeline(createReadStream(filePath), res)
}

const sendRemoteImage = async (
  res: any,
  source: GenerationImageDownloadSource,
) => {
  if (!/^https?:\/\//i.test(source.url)) {
    throw new GenerationImageDownloadError('原图资源地址无效', 404)
  }

  const controller = new AbortController()
  const timeoutTimer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      redirect: 'follow',
    })
    if (!response.ok || !response.body) {
      throw new GenerationImageDownloadError(`原图资源读取失败（${response.status}）`)
    }

    const declaredSize = Number(response.headers.get('content-length') || 0)
    if (declaredSize > DOWNLOAD_MAX_BYTES) {
      throw new GenerationImageDownloadError('原图文件过大，无法下载', 413)
    }

    const reader = response.body.getReader()
    const firstRead = await reader.read()
    if (firstRead.done || !firstRead.value?.byteLength) {
      throw new GenerationImageDownloadError('原图文件为空')
    }

    const mimeType = resolveDownloadMimeType(
      firstRead.value.slice(0, 64),
      String(response.headers.get('content-type') || ''),
      String(source.mimeType || ''),
      source.url,
    )

    let downloadedBytes = firstRead.value.byteLength
    const body = Readable.from((async function* () {
      yield firstRead.value
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
          throw new GenerationImageDownloadError('原图文件过大，下载已终止', 413)
        }
        yield chunk.value
      }
    })())

    applyDownloadHeaders(res, source, mimeType, declaredSize || undefined)
    await pipeline(body, res)
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new GenerationImageDownloadError('原图下载超时，请稍后重试', 504)
    }
    throw error
  } finally {
    clearTimeout(timeoutTimer)
  }
}

export const sendGenerationImageDownload = async (
  res: any,
  source: GenerationImageDownloadSource,
) => {
  const localFilePath = resolveLocalUploadPath(String(source.url || '').trim())
  if (localFilePath) {
    await sendLocalImage(res, source, localFilePath)
    return
  }

  await sendRemoteImage(res, source)
}

export const resolveGenerationImageDownloadStatus = (error: unknown) => {
  const statusCode = Number((error as any)?.statusCode || 0)
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599
    ? statusCode
    : 500
}
