import type { AgentRunState } from '@/types/agent'
import type { CreationType } from '@/components/generate/selectors'
import type {
  ResearchEvidence,
  ResearchFact,
  ResearchOutlineSection,
  ResearchTokenUsage,
  ResearchVerificationResult,
} from '@/shared/research/research-types'
import type {
  ResearchSearchGroupViewItem,
  ResearchTimelineViewItem,
} from '@/views/generate/components/research-report-record.types'
import { buildApiUrl } from './http'
import {
  ApiResponseError,
  handleUnauthorizedResponse,
  readApiData,
  readApiErrorMessage,
} from './response'

export type GenerationRecordType = CreationType | 'research'

export interface PersistedResearchRuntimeMeta {
  version: 1
  timeline?: ResearchTimelineViewItem[]
  searchGroups?: ResearchSearchGroupViewItem[]
  evidences?: ResearchEvidence[]
  facts?: ResearchFact[]
  outlineSections?: ResearchOutlineSection[]
  verification?: ResearchVerificationResult | null
  tokenUsage?: ResearchTokenUsage | null
}

// 后端返回的持久化生成记录结构
export interface PersistedGenerationRecord {
  id: string
  sessionId: string
  sessionTitle?: string
  source?: string
  type: GenerationRecordType
  prompt: string
  content: string
  /** 模型的思考过程（reasoning_content / thinking block）。可能为空字符串。 */
  thinkingContent?: string
  error: string
  model: string
  modelKey: string
  ratio: string
  resolution: string
  duration: string
  feature: string
  skill: string
  referenceImages?: string[]
  done: boolean
  stopped?: boolean
  agentTaskId?: string
  createdAt: string
  images: string[]
  outputs: Array<{
    outputType: string
    url?: string
    textContent?: string
    sortOrder?: number
  }>
  agentRun?: AgentRunState
  research?: PersistedResearchRuntimeMeta | null
}

// 前端提交给后端的生成记录写入结构
export interface GenerationRecordUpsertPayload {
  sessionId?: string
  source?: string
  type: GenerationRecordType
  prompt: string
  content: string
  error: string
  model: string
  modelKey: string
  ratio: string
  resolution: string
  duration: string
  feature: string
  skill: string
  referenceImages?: string[]
  done: boolean
  stopped?: boolean
  agentTaskId?: string
  images: string[]
  agentRun?: AgentRunState
  research?: PersistedResearchRuntimeMeta | null
}

const GENERATION_RECORDS_API_PATH = '/api/generation-records'

export interface DownloadedGenerationImage {
  blob: Blob
  filename: string
}

const resolveDownloadFilename = (response: Response, contentType: string) => {
  const contentDisposition = String(response.headers.get('content-disposition') || '')
  const encodedFilename = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition)?.[1]
  if (encodedFilename) {
    try {
      return decodeURIComponent(encodedFilename)
    } catch {
      // 编码异常时继续尝试普通 filename。
    }
  }

  const plainFilename = /filename="?([^";]+)"?/i.exec(contentDisposition)?.[1]?.trim()
  if (plainFilename) {
    return plainFilename
  }

  const extensionMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/svg+xml': 'svg',
  }
  const extension = extensionMap[contentType] || 'img'
  return `canana-image-${Date.now()}.${extension}`
}

// 从受保护的生成记录接口读取原始图片二进制；服务端会校验记录归属、拒绝 HTML，
// 并按实际图片类型下发文件名，避免浏览器把跨域展示地址保存成网页。
export const downloadGenerationImage = async (
  recordId: string,
  imageIndex: number,
): Promise<DownloadedGenerationImage> => {
  const response = await fetch(buildApiUrl(
    `${GENERATION_RECORDS_API_PATH}/${encodeURIComponent(recordId)}/download?index=${imageIndex}`,
  ), {
    method: 'GET',
    credentials: 'include',
  })

  if (!response.ok) {
    handleUnauthorizedResponse(response.status, 'generation-image-download')
    const { payload, message } = await readApiErrorMessage(response, '原图下载失败，请稍后重试')
    throw new ApiResponseError({
      status: response.status,
      type: payload?.error?.type,
      message,
      payload,
    })
  }

  const contentType = String(response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (!contentType.startsWith('image/')) {
    throw new Error('下载接口未返回有效图片，已停止保存')
  }

  const blob = await response.blob()
  if (!blob.size) {
    throw new Error('原图文件为空，请稍后重试')
  }

  return {
    blob,
    filename: resolveDownloadFilename(response, contentType),
  }
}

// 获取已持久化的生成记录
export const listGenerationRecords = async () => {
  const response = await fetch(buildApiUrl(GENERATION_RECORDS_API_PATH), {
    method: 'GET',
    credentials: 'include',
  })
  return readApiData<PersistedGenerationRecord[]>(response)
}

// 创建生成记录
export const createGenerationRecord = async (payload: GenerationRecordUpsertPayload) => {
  const response = await fetch(buildApiUrl(GENERATION_RECORDS_API_PATH), {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return readApiData<PersistedGenerationRecord>(response, {
    showErrorMessage: true,
  })
}

// 更新生成记录
export const updateGenerationRecord = async (id: string, payload: GenerationRecordUpsertPayload) => {
  const response = await fetch(buildApiUrl(`${GENERATION_RECORDS_API_PATH}/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  return readApiData<PersistedGenerationRecord>(response, {
    showErrorMessage: true,
  })
}

export const deleteGenerationRecord = async (id: string) => {
  const response = await fetch(buildApiUrl(`${GENERATION_RECORDS_API_PATH}/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
  })
  return readApiData<boolean>(response, {
    showErrorMessage: true,
  })
}
