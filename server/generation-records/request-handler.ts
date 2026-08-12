import { sendJson } from '../shared/http'
import { requireCurrentSessionUser } from '../auth/session'
import { isPrismaConfigured } from '../db/prisma'
import {
  createGenerationRecord,
  deleteGenerationRecord,
  getGenerationMediaOutputForDownload,
  getGenerationRecordById,
  listGenerationRecords,
  updateGenerationRecord,
} from './service'
import { GENERATION_RECORDS_BASE_PATH } from './constants'
import { readGenerationRecordBody, sendGenerationRecordError } from './shared'
import { writeScopedLog } from '../shared/logging'
import type { GenerationRecordPayload } from './shared'
import {
  resolveMediaDownloadStatus,
  sendMediaDownload,
} from './download'

// 统一输出生成记录接口的异常诊断日志，便于线上定位具体失败分支。
const logGenerationRecordsRequestError = (detail: Record<string, unknown>) => {
  writeScopedLog('error', '生成记录', '请求异常', detail)
}

// 请求体尚未读完就被客户端中断时，单独记录为链路中断，避免误判成业务写库异常。
const logGenerationRecordsRequestAbort = (detail: Record<string, unknown>) => {
  writeScopedLog('warn', '生成记录', '请求中断', detail)
}

// 把记录请求体摘要统一收敛，避免日志里散落一堆 any 判断。
const buildPayloadSummary = (payload: GenerationRecordPayload) => ({
  sessionId: payload.sessionId || null,
  source: payload.source || null,
  type: payload.type,
  done: Boolean(payload.done),
  imageCount: Array.isArray(payload.images) ? payload.images.length : 0,
  referenceImageCount: Array.isArray(payload.referenceImages) ? payload.referenceImages.length : 0,
  outputCount: Array.isArray(payload.outputs) ? payload.outputs.length : 0,
  hasAgentRun: Boolean(payload.agentRun),
  stepCount: Array.isArray(payload.agentRun?.steps) ? payload.agentRun.steps.length : 0,
  processSectionCount: Array.isArray(payload.agentRun?.processSections) ? payload.agentRun.processSections.length : 0,
})

// 处理生成记录的列表、创建与更新请求
export const handleGenerationRecordsRequest = async (req: any, res: any) => {
  const parsedRequestUrl = new URL(String(req.url || ''), 'http://localhost')
  const requestUrl = parsedRequestUrl.pathname
  const relativeRequestPath = requestUrl.startsWith(`${GENERATION_RECORDS_BASE_PATH}/`)
    ? requestUrl.slice(GENERATION_RECORDS_BASE_PATH.length + 1)
    : ''
  const requestPathSegments = relativeRequestPath
    .split('/')
    .map(segment => decodeURIComponent(segment))
    .filter(Boolean)
  const recordId = requestPathSegments[0] || ''
  const action = requestPathSegments[1] || ''
  let currentUser: { id?: string | null } | null = null
  let payloadSummary: Record<string, unknown> | null = null

  try {
    if (!isPrismaConfigured()) {
      sendGenerationRecordError(res, 500, '缺少 DATABASE_URL，暂时无法使用生成记录存储。')
      return
    }

    currentUser = await requireCurrentSessionUser(req, res)
    if (!currentUser) {
      return
    }

    if (req.method === 'GET' && requestUrl === GENERATION_RECORDS_BASE_PATH) {
      const data = await listGenerationRecords(currentUser.id)
      sendJson(res, 200, { data })
      return
    }

    if (req.method === 'GET' && recordId && action === 'download') {
      const rawMediaKind = String(
        parsedRequestUrl.searchParams.get('type')
        || parsedRequestUrl.searchParams.get('kind')
        || 'image',
      ).trim().toLowerCase()
      if (rawMediaKind !== 'image' && rawMediaKind !== 'video') {
        sendGenerationRecordError(res, 400, '媒体类型无效')
        return
      }
      const mediaIndex = Number(parsedRequestUrl.searchParams.get('index') || 0)
      if (!Number.isInteger(mediaIndex) || mediaIndex < 0) {
        sendGenerationRecordError(res, 400, '媒体序号无效')
        return
      }

      const output = await getGenerationMediaOutputForDownload(
        recordId,
        String(currentUser.id || ''),
        rawMediaKind,
        mediaIndex,
      )
      if (!output) {
        sendGenerationRecordError(res, 404, `生成${rawMediaKind === 'video' ? '视频' : '图片'}不存在或无权下载`)
        return
      }

      await sendMediaDownload(res, output)
      return
    }

    if (req.method === 'GET' && recordId && !action) {
      const data = await getGenerationRecordById(recordId, currentUser.id)
      sendJson(res, 200, { data })
      return
    }

    if (req.method === 'POST' && requestUrl === GENERATION_RECORDS_BASE_PATH) {
      const payload = await readGenerationRecordBody(req)
      payloadSummary = buildPayloadSummary(payload)
      const data = await createGenerationRecord(payload, currentUser.id)
      sendJson(res, 200, { data })
      return
    }

    if (req.method === 'PATCH' && recordId && !action) {
      const payload = await readGenerationRecordBody(req)
      payloadSummary = buildPayloadSummary(payload)
      const data = await updateGenerationRecord(recordId, payload, currentUser.id)
      sendJson(res, 200, { data })
      return
    }

    if (req.method === 'DELETE' && recordId && !action) {
      const data = await deleteGenerationRecord(recordId, currentUser.id)
      sendJson(res, 200, { data })
      return
    }

    sendGenerationRecordError(res, 405, 'Method Not Allowed')
  } catch (error: any) {
    const detail = {
      method: req.method,
      requestUrl,
      recordId: recordId || null,
      currentUserId: currentUser?.id || null,
      payloadSummary,
      errorMessage: error?.message || '处理生成记录失败',
      errorStack: error?.stack || null,
    }

    if (error?.message === 'aborted') {
      logGenerationRecordsRequestAbort(detail)
      return
    }

    logGenerationRecordsRequestError(detail)
    if (res.writableEnded) {
      return
    }
    if (res.headersSent) {
      try {
        res.destroy()
      } catch {
        // 响应已经开始流式输出，无法再返回 JSON。
      }
      return
    }
    sendGenerationRecordError(
      res,
      action === 'download' ? resolveMediaDownloadStatus(error) : 500,
      error?.message || (action === 'download' ? '原始媒体下载失败' : '处理生成记录失败'),
    )
  }
}
