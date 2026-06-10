import type { GenerationTaskStartPayload, GenerationTaskStreamEvent } from './shared'
import type { GenerationRecordPayload } from '../generation-records/shared'

type VideoExecutionTask = {
  recordId: string
  userId: string
  abortController: AbortController
}

// 上游 JSON 请求的统一返回结构（由 service 注入实现，便于执行器保持纯净）。
export interface VideoUpstreamFetchResult {
  status: number
  ok: boolean
  data: any
  rawText: string
}

// 解析后的视频厂商上游配置。
export interface ResolvedVideoProviderUpstream {
  baseUrl: string
  apiKey: string
  videoEndpoint: string
  extraJson: Record<string, unknown> | null
  modelDefaultParams: Record<string, unknown> | null
}

export interface VideoTaskExecutorContext {
  syncSharedTaskRuntime: (task: VideoExecutionTask, status: 'running' | 'completed') => Promise<void>
  ensureTaskNotAborted: (task: VideoExecutionTask) => Promise<void>
  emitTaskProgressEvent: (recordId: string, input: {
    stage: string
    stopped?: boolean
    message?: string
  }) => void
  sleepWithAbortSignal: (signal: AbortSignal, durationMs: number) => Promise<void>
  resolveVideoProviderUpstream: (input: { providerId: string; modelKey: string }) => Promise<ResolvedVideoProviderUpstream>
  // 统一的上游 JSON 请求（带 Bearer、外部 signal 转发、JSON 解析）。
  fetchUpstreamJson: (input: {
    url: string
    method: 'GET' | 'POST'
    apiKey?: string
    body?: Record<string, unknown>
    signal: AbortSignal
  }) => Promise<VideoUpstreamFetchResult>
  buildInitialRecordPayload: (payload: GenerationTaskStartPayload) => GenerationRecordPayload
  updateGenerationRecord: (recordId: string, payload: GenerationRecordPayload, currentUserId: string) => Promise<void>
  getGenerationRecordById: (recordId: string, currentUserId: string) => Promise<Record<string, unknown>>
  emitTaskStreamEvent: (recordId: string, event: GenerationTaskStreamEvent) => void
  logGenerationTask: (stage: string, detail: Record<string, unknown>) => void
}

type VideoProtocol = 'openai-async' | 'chengmeng-async'

const DEFAULT_POLL_INTERVAL_MS = 3000
const DEFAULT_POLL_TIMEOUT_MS = 8 * 60 * 1000

// 安全读取嵌套字段，如 readPath(obj, 'data.task_no')。
const readPath = (source: unknown, path: string): unknown => {
  if (!path) return undefined
  return String(path).split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, source)
}

const toLowerStatus = (value: unknown) => String(value ?? '').trim().toLowerCase()

const readExtra = (extraJson: Record<string, unknown> | null, key: string): unknown => {
  if (!extraJson || typeof extraJson !== 'object') return undefined
  return extraJson[key]
}

const readStringExtra = (extraJson: Record<string, unknown> | null, key: string, fallback: string) => {
  const value = readExtra(extraJson, key)
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

const readNumberExtra = (extraJson: Record<string, unknown> | null, key: string, fallback: number) => {
  const value = Number(readExtra(extraJson, key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

// 把 '5s' / '10' 解析成数字秒。
const parseDurationSeconds = (raw: unknown): number => {
  const matched = String(raw ?? '').match(/\d+(\.\d+)?/)
  const seconds = matched ? Number(matched[0]) : 0
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

// 比例（21:9 / 16:9 / 4:3 / 1:1 / 3:4 / 9:16 ...）映射到 chengmeng 的 orientation。
// 优先用 extraJson.orientationMap 覆盖，否则按宽高数值自动判断横/竖/方。
const resolveOrientation = (ratio: string, extraJson: Record<string, unknown> | null): string => {
  const normalized = String(ratio || '').trim().toLowerCase().replace(/x/g, ':')
  const override = readExtra(extraJson, 'orientationMap')
  const map: Record<string, string> = override && typeof override === 'object'
    ? override as Record<string, string>
    : {}
  if (map[normalized]) {
    return map[normalized]
  }
  const [w, h] = normalized.split(':').map(Number)
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    if (w > h) return 'landscape'
    if (w < h) return 'portrait'
    return 'square'
  }
  return 'landscape'
}

interface VideoRequestParams {
  modelKey: string
  prompt: string
  ratio: string
  resolution: string
  durationSeconds: number
  images: string[]
}

// 提交任务，返回上游任务号。
const submitVideoTask = async (
  protocol: VideoProtocol,
  params: VideoRequestParams,
  upstream: ResolvedVideoProviderUpstream,
  context: VideoTaskExecutorContext,
  signal: AbortSignal,
): Promise<string> => {
  const { baseUrl, apiKey, videoEndpoint, extraJson } = upstream
  const trimmedBase = baseUrl.replace(/\/+$/, '')

  if (protocol === 'chengmeng-async') {
    const submitPath = readStringExtra(extraJson, 'submitPath', '/api/tasks')
    const groupId = String(readExtra(extraJson, 'groupId') ?? '').trim()
    const size = readStringExtra(extraJson, 'size', 'large')
    const minDuration = readNumberExtra(extraJson, 'minDuration', 5)
    const maxDuration = readNumberExtra(extraJson, 'maxDuration', 15)
    const duration = clampNumber(params.durationSeconds || minDuration, minDuration, maxDuration)
    const body: Record<string, unknown> = {
      model_id: params.modelKey,
      prompt: params.prompt,
      duration,
      values: {
        orientation: resolveOrientation(params.ratio, extraJson),
        size,
      },
    }
    if (groupId) body.group_id = groupId
    if (params.images.length) body.images = params.images

    const result = await context.fetchUpstreamJson({
      url: `${trimmedBase}/${submitPath.replace(/^\/+/, '')}`,
      method: 'POST',
      apiKey,
      body,
      signal,
    })
    if (!result.ok) {
      throw new Error(`视频任务提交失败（${result.status}）：${String(result.rawText || '').slice(0, 300)}`)
    }
    const taskNoField = readStringExtra(extraJson, 'taskNoField', 'data.task_no')
    const taskNo = String(readPath(result.data, taskNoField) ?? '').trim()
    if (!taskNo) {
      throw new Error('视频任务提交成功但未返回任务号')
    }
    return taskNo
  }

  // openai-async（默认）
  const endpoint = videoEndpoint && videoEndpoint.trim() ? videoEndpoint.trim() : '/videos'
  const body: Record<string, unknown> = {
    model: params.modelKey,
    prompt: params.prompt,
  }
  if (params.resolution) body.size = params.resolution
  if (params.durationSeconds) body.seconds = params.durationSeconds
  if (params.images.length) body.input_reference = params.images[0]

  const result = await context.fetchUpstreamJson({
    url: `${trimmedBase}/${endpoint.replace(/^\/+/, '')}`,
    method: 'POST',
    apiKey,
    body,
    signal,
  })
  if (!result.ok) {
    throw new Error(`视频任务提交失败（${result.status}）：${String(result.rawText || '').slice(0, 300)}`)
  }
  const taskNo = String(result.data?.id ?? result.data?.task_id ?? '').trim()
  if (!taskNo) {
    throw new Error('视频任务提交成功但未返回任务号')
  }
  return taskNo
}

interface PollOutcome {
  done: boolean
  failed: boolean
  resultUrl: string
  statusText: string
}

// 单次查询任务状态。
const queryVideoTask = async (
  protocol: VideoProtocol,
  taskNo: string,
  upstream: ResolvedVideoProviderUpstream,
  context: VideoTaskExecutorContext,
  signal: AbortSignal,
): Promise<PollOutcome> => {
  const { baseUrl, apiKey, videoEndpoint, extraJson } = upstream
  const trimmedBase = baseUrl.replace(/\/+$/, '')

  if (protocol === 'chengmeng-async') {
    const statusPath = readStringExtra(extraJson, 'statusPath', '/api/tasks/:taskNo')
      .replace(/:taskNo|\{taskNo\}/g, encodeURIComponent(taskNo))
    const result = await context.fetchUpstreamJson({
      url: `${trimmedBase}/${statusPath.replace(/^\/+/, '')}`,
      method: 'GET',
      apiKey,
      signal,
    })
    if (!result.ok) {
      throw new Error(`视频任务查询失败（${result.status}）`)
    }
    const status = toLowerStatus(readPath(result.data, readStringExtra(extraJson, 'statusField', 'data.status')))
    const resultUrl = String(readPath(result.data, readStringExtra(extraJson, 'resultField', 'data.result_url')) ?? '').trim()
    const completedStatuses = ['completed', 'succeeded', 'success', 'done', 'finished']
    const failedStatuses = ['failed', 'error', 'fail', 'cancelled', 'canceled', 'expired']
    return {
      done: Boolean(resultUrl) && (completedStatuses.includes(status) || !status),
      failed: failedStatuses.includes(status),
      resultUrl,
      statusText: status,
    }
  }

  // openai-async
  const endpoint = videoEndpoint && videoEndpoint.trim() ? videoEndpoint.trim() : '/videos'
  const result = await context.fetchUpstreamJson({
    url: `${trimmedBase}/${endpoint.replace(/^\/+/, '')}/${encodeURIComponent(taskNo)}`,
    method: 'GET',
    apiKey,
    signal,
  })
  if (!result.ok) {
    throw new Error(`视频任务查询失败（${result.status}）`)
  }
  const status = toLowerStatus(result.data?.status)
  const resultUrl = String(
    (Array.isArray(result.data?.data) ? result.data.data[0]?.url : undefined)
    || result.data?.url
    || '',
  ).trim()
  const completedStatuses = ['completed', 'succeeded', 'success', 'done', 'finished']
  const failedStatuses = ['failed', 'error', 'fail', 'cancelled', 'canceled', 'expired']
  return {
    done: Boolean(resultUrl) && (completedStatuses.includes(status) || !status),
    failed: failedStatuses.includes(status),
    resultUrl,
    statusText: status,
  }
}

// 视频任务执行主干：服务端 submit + poll，按厂商协议分支。抛错交由收口策略自动退款。
export const executeVideoTask = async (
  task: VideoExecutionTask,
  payload: GenerationTaskStartPayload,
  context: VideoTaskExecutorContext,
) => {
  await context.syncSharedTaskRuntime(task, 'running')
  await context.ensureTaskNotAborted(task)

  const modelKey = String(payload.modelKey || '').trim()
  if (!modelKey) {
    throw new Error('缺少视频模型标识')
  }
  const providerId = String((payload.requestBody || {}).providerId || '').trim()
  if (!providerId) {
    throw new Error('缺少视频厂商配置')
  }

  context.emitTaskProgressEvent(task.recordId, {
    stage: 'resolved_provider',
    message: '已解析厂商与模型配置，准备提交视频任务',
  })

  const upstream = await context.resolveVideoProviderUpstream({ providerId, modelKey })
  const protocol: VideoProtocol = readStringExtra(upstream.extraJson, 'videoProtocol', 'openai-async') === 'chengmeng-async'
    ? 'chengmeng-async'
    : 'openai-async'

  const requestBody = (payload.requestBody || {}) as Record<string, unknown>
  const referenceImages = Array.isArray(payload.referenceImages)
    ? payload.referenceImages.map(item => String(item || '').trim()).filter(Boolean)
    : []
  const params: VideoRequestParams = {
    modelKey,
    prompt: String(requestBody.prompt || payload.prompt || '').trim(),
    ratio: String(requestBody.ratio || payload.ratio || '').trim(),
    resolution: String(requestBody.resolution || payload.resolution || '').trim(),
    durationSeconds: parseDurationSeconds(requestBody.duration || payload.duration),
    images: referenceImages,
  }

  context.logGenerationTask('video_task:submit_start', {
    recordId: task.recordId,
    userId: task.userId,
    providerId,
    modelKey,
    protocol,
    imageCount: params.images.length,
  })
  context.emitTaskProgressEvent(task.recordId, {
    stage: 'submitting_upstream',
    message: '正在提交视频生成任务',
  })

  const taskNo = await submitVideoTask(protocol, params, upstream, context, task.abortController.signal)
  await context.ensureTaskNotAborted(task)

  context.logGenerationTask('video_task:submitted', {
    recordId: task.recordId,
    userId: task.userId,
    protocol,
    taskNo,
  })

  const pollIntervalMs = readNumberExtra(upstream.extraJson, 'pollIntervalMs', DEFAULT_POLL_INTERVAL_MS)
  const pollTimeoutMs = readNumberExtra(upstream.extraJson, 'pollTimeoutMs', DEFAULT_POLL_TIMEOUT_MS)
  const startedAt = Date.now()
  let pollCount = 0
  let resultUrl = ''

  // 轮询直到完成 / 失败 / 超时；每轮检查中止信号，超时抛错触发退款。
  while (true) {
    await context.ensureTaskNotAborted(task)

    const outcome = await queryVideoTask(protocol, taskNo, upstream, context, task.abortController.signal)
    if (outcome.failed) {
      throw new Error(`视频生成失败（上游状态：${outcome.statusText || 'unknown'}）`)
    }
    if (outcome.done && outcome.resultUrl) {
      resultUrl = outcome.resultUrl
      break
    }

    pollCount += 1
    context.emitTaskProgressEvent(task.recordId, {
      stage: 'polling_upstream',
      message: `视频生成中…（第 ${pollCount} 次查询，状态：${outcome.statusText || 'pending'}）`,
    })

    if (Date.now() - startedAt > pollTimeoutMs) {
      throw new Error('视频生成超时')
    }
    await context.sleepWithAbortSignal(task.abortController.signal, pollIntervalMs)
  }

  context.emitTaskProgressEvent(task.recordId, {
    stage: 'syncing_record',
    message: '视频已生成，正在同步记录与资源',
  })

  await context.updateGenerationRecord(task.recordId, {
    ...context.buildInitialRecordPayload(payload),
    done: true,
    stopped: false,
    outputs: [{
      outputType: 'video',
      url: resultUrl,
      durationSeconds: params.durationSeconds || undefined,
      metaJson: { taskNo, protocol },
    }],
  }, task.userId)

  const completedRecord = await context.getGenerationRecordById(task.recordId, task.userId)
  await context.syncSharedTaskRuntime(task, 'completed')
  context.emitTaskStreamEvent(task.recordId, {
    type: 'completed',
    recordId: task.recordId,
    done: true,
    stopped: false,
    record: completedRecord,
    stage: 'completed',
    message: '视频生成完成，结果已写入记录',
  })

  context.logGenerationTask('video_task:success', {
    recordId: task.recordId,
    userId: task.userId,
    protocol,
    taskNo,
    pollCount,
  })
}
