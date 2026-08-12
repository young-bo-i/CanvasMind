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
import { readApiData } from './response'

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

// 生成受保护的原始媒体下载地址。浏览器直接导航到附件响应，后端会边读边传，
// 避免先 fetch + response.blob() 把 2K/4K 图片或视频完整缓冲进页面内存。
export const buildGenerationMediaDownloadUrl = (
  recordId: string,
  mediaKind: 'image' | 'video',
  mediaIndex: number,
): string => {
  const query = new URLSearchParams({
    type: mediaKind,
    index: String(mediaIndex),
  })
  return buildApiUrl(
    `${GENERATION_RECORDS_API_PATH}/${encodeURIComponent(recordId)}/download?${query.toString()}`,
  )
}

// 保留图片专用构造器，兼容现有图片卡片与大图预览调用。
export const buildGenerationImageDownloadUrl = (
  recordId: string,
  imageIndex: number,
): string => buildGenerationMediaDownloadUrl(recordId, 'image', imageIndex)

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
