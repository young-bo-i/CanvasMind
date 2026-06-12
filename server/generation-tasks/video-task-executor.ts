import type { GenerationTaskStartPayload, GenerationTaskStreamEvent } from './shared'
import type { GenerationRecordPayload } from '../generation-records/shared'

type VideoExecutionTask = {
  recordId: string
  userId: string
  abortController: AbortController
  // 断点续询所需：运行时传入的是完整 RunningGenerationTask，这些 billed* 字段实际存在。
  associationNo?: string
  billedPointCost?: number
  billedModelName?: string
}

// 提交成功后持久化进 GenerationRecord.metaJson.videoTask，供重启后续询恢复。
export interface SavedVideoTask {
  taskNo: string
  protocol: VideoProtocol
  providerId: string
  modelKey: string
  durationSeconds?: number
  associationNo?: string
  billedPointCost?: number
  billedModelName?: string
  startedAt: number
  pollTimeoutMs: number
  submittedAt: string
  resumeCount?: number
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
    progressPercent?: number
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
  // 提交成功后把 videoTask 元数据写进 GenerationRecord.metaJson（只改 metaJson 一列，不动 status/outputs）。
  persistVideoTaskMeta: (recordId: string, userId: string, videoTask: SavedVideoTask) => Promise<void>
  // 视频完成时调用：若此前超时已退款则按原金额补扣（幂等）；正常完成无退款记录则跳过。
  rechargeVideoIfRefundedForTask: () => Promise<unknown>
}

type VideoProtocol = 'openai-async' | 'chengmeng-async'

const DEFAULT_POLL_INTERVAL_MS = 3000
// 视频上游(尤其排队)常超过数十分钟；放宽默认超时，仍可经 extraJson.pollTimeoutMs 覆盖。
const DEFAULT_POLL_TIMEOUT_MS = 60 * 60 * 1000
// 轮询期间允许的连续错误次数（网络抖动 / 上游偶发 5xx）；超过才判任务失败。
const DEFAULT_MAX_POLL_ERRORS = 5

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

// 健壮提取视频结果 URL：递归在响应里找 URL 字段（兼容 data[0].url / video_url / content.video_url
// / output / result_url 等各家格式）。先找语义明确的视频 URL 键，再退到通用 url 键，避免误取封面图。
const findVideoResultUrl = (data: unknown): string => {
  const specificKeys = ['video_url', 'videoUrl', 'result_url', 'resultUrl', 'download_url', 'downloadUrl', 'output_url']
  const genericKeys = ['url']
  const visit = (node: unknown, keys: string[], depth: number): string => {
    if (!node || typeof node !== 'object' || depth > 6) return ''
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = visit(item, keys, depth + 1)
        if (found) return found
      }
      return ''
    }
    const obj = node as Record<string, unknown>
    for (const key of keys) {
      const v = obj[key]
      if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) return v.trim()
    }
    for (const key of Object.keys(obj)) {
      const found = visit(obj[key], keys, depth + 1)
      if (found) return found
    }
    return ''
  }
  // 两轮：先专找视频 URL 键，找不到再放宽到通用 url。
  return visit(data, specificKeys, 0) || visit(data, genericKeys, 0)
}

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
  // 生成功能（first-last-frame / multi-frame / omni-reference…），决定参考素材的 role 映射。
  feature: string
}

// 按 URL 后缀粗判参考素材类型，用于 content-array 模式分流图/视频/音频项。
const REF_VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|#|$)/i
const REF_AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/i
const detectRefKind = (url: string): 'image' | 'video' | 'audio' => {
  const u = String(url || '')
  if (REF_VIDEO_EXT.test(u) || /^data:video/i.test(u)) return 'video'
  if (REF_AUDIO_EXT.test(u) || /^data:audio/i.test(u)) return 'audio'
  return 'image'
}

// 按 Seedance 官方「通用」格式构造 content 数组：[{type:'text',text}, ...{type:'image_url',image_url:{url},role}]。
// role 与媒体项字段均可经 extraJson 配置，避免上游字段不一致导致 400；音频默认不下发（Seedance 视频不吃音频）。
const buildVideoContentArray = (
  body: Record<string, unknown>,
  params: VideoRequestParams,
  refs: string[],
  extraJson: Record<string, unknown> | null,
) => {
  const contentField = readStringExtra(extraJson, 'contentField', 'content')
  const firstFrameRole = readStringExtra(extraJson, 'firstFrameRole', 'first_frame')
  const lastFrameRole = readStringExtra(extraJson, 'lastFrameRole', 'last_frame')
  const referenceRole = readStringExtra(extraJson, 'referenceRole', 'reference_image')
  const audioRole = readStringExtra(extraJson, 'audioRole', 'audio_reference')
  // 视频参考默认接受、音频参考默认不下发；均可经 extraJson 覆盖。
  const acceptVideoRef = readExtra(extraJson, 'acceptVideoRef') !== false
  const acceptAudioRef = readExtra(extraJson, 'acceptAudioRef') === true
  const videoItemType = readStringExtra(extraJson, 'videoItemType', 'video_url')
  const audioItemType = readStringExtra(extraJson, 'audioItemType', 'input_audio')
  const paramsInPrompt = readExtra(extraJson, 'paramsInPrompt') === true

  // 文本项：可选把比例/分辨率/时长以 --params 形式拼进 prompt（部分厂商靠此解析）。
  let text = params.prompt
  if (paramsInPrompt) {
    const tokens: string[] = []
    if (params.ratio) tokens.push(`--ratio ${params.ratio}`)
    if (params.resolution) tokens.push(`--resolution ${params.resolution}`)
    if (params.durationSeconds) tokens.push(`--duration ${params.durationSeconds}`)
    if (tokens.length) text = `${text} ${tokens.join(' ')}`.trim()
  }

  const content: Array<Record<string, unknown>> = []
  if (text) content.push({ type: 'text', text })

  // 首尾帧按图片出现顺序定 role（仅统计图片项，避免被视频/音频项打乱）。
  const isFirstLast = params.feature === 'first-last-frame'
  let imageSeq = 0
  for (const url of refs) {
    const kind = detectRefKind(url)
    if (kind === 'audio') {
      if (!acceptAudioRef) continue
      content.push({ type: audioItemType, [audioItemType]: { url }, role: audioRole })
      continue
    }
    if (kind === 'video') {
      if (!acceptVideoRef) continue
      content.push({ type: videoItemType, [videoItemType]: { url }, role: referenceRole })
      continue
    }
    const role = isFirstLast ? (imageSeq === 0 ? firstFrameRole : lastFrameRole) : referenceRole
    imageSeq += 1
    content.push({ type: 'image_url', image_url: { url }, role })
  }

  body[contentField] = content
  // 默认保留顶层 prompt：CometAPI / new-api 等 OpenAI-video 兼容代理在提交校验时强制要 prompt。
  // 仅当显式 keepTopLevelPrompt:false（如火山引擎 Ark 原生只吃 content）才移除。
  if (readExtra(extraJson, 'keepTopLevelPrompt') === false) {
    delete body.prompt
  }
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

  // 参考素材如为本地 /uploads 相对路径，上游无法回源拉取，需拼成「公网可访问」的绝对地址；
  // 优先 extraJson.publicAssetBaseUrl，其次环境变量 PUBLIC_ASSET_BASE_URL / PUBLIC_BASE_URL；
  // 对象存储已是绝对 URL、http(s)/data: 原样透传。
  const assetBaseUrl = (readStringExtra(extraJson, 'publicAssetBaseUrl', '')
    || String(process.env.PUBLIC_ASSET_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim()
  ).replace(/\/+$/, '')
  const toUpstreamRef = (url: string): string => {
    const u = String(url || '').trim()
    if (!u) return ''
    if (/^(https?:|data:)/i.test(u)) return u
    if (!assetBaseUrl) return u
    return `${assetBaseUrl}/${u.replace(/^\/+/, '')}`
  }
  const upstreamRefs = params.images.map(toUpstreamRef).filter(Boolean)

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
    if (upstreamRefs.length) body.images = upstreamRefs

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
  // 视频比例(如 16:9)。字段名按厂商配置(extraJson.ratioField，默认 'ratio')；
  // 留空可关闭(ratioField='')。Seedance 等支持比例参数，不传则上游用默认/跟随参考图。
  const ratioField = readStringExtra(extraJson, 'ratioField', 'ratio')
  if (params.ratio && ratioField) body[ratioField] = params.ratio
  // OpenAI/Sora 兼容视频接口的 seconds 是字符串（如 "4"/"8"）；发数字会被上游拒绝(invalid_request)。
  if (params.durationSeconds) body.seconds = String(params.durationSeconds)

  // 参考素材下发模式：
  //  - input_reference（默认，OpenAI/Sora 兼容，仅单图）
  //  - content-array（Seedance 官方通用格式：content 数组 + image_url(role)）
  //  - images（直接数组）
  const referenceMode = readStringExtra(extraJson, 'referenceMode', 'input_reference')
  if (upstreamRefs.length && referenceMode === 'content-array') {
    buildVideoContentArray(body, params, upstreamRefs, extraJson)
  } else if (upstreamRefs.length && referenceMode === 'images') {
    body.images = upstreamRefs
  } else if (upstreamRefs.length) {
    body.input_reference = upstreamRefs[0]
  }

  const submitUrl = `${trimmedBase}/${endpoint.replace(/^\/+/, '')}`
  // 记录实际下发的「完整请求体」(不含 apiKey，apiKey 在 header)，便于对照上游所需字段定位 Field required 等问题。
  let bodyPreview = ''
  try {
    bodyPreview = JSON.stringify(body)
  } catch {
    bodyPreview = '[unserializable body]'
  }
  context.logGenerationTask('video_task:submit_body', {
    url: submitUrl,
    referenceMode,
    refCount: upstreamRefs.length,
    feature: params.feature || '(none)',
    assetBaseUrl: assetBaseUrl || '(none)',
    isRelativeRef: upstreamRefs.some(url => url.startsWith('/')),
    bodyKeys: Object.keys(body),
    body: bodyPreview.slice(0, 2500),
  })

  const result = await context.fetchUpstreamJson({
    url: submitUrl,
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
  failureReason?: string
  // 上游真实进度百分比(0-100)，如有则用于驱动前端进度条。
  progressPercent?: number
}

// 从上游响应里取进度百分比（兼容 progress / percent / data.progress 等），裁剪到 0-100。
const extractProgressPercent = (data: any): number | undefined => {
  const raw = data?.progress ?? data?.percent ?? data?.data?.progress ?? data?.data?.percent
  const num = Number(raw)
  if (!Number.isFinite(num)) return undefined
  return Math.max(0, Math.min(100, Math.round(num)))
}

// 从上游状态响应中尽力提取失败原因（兼容 error / error.message / failure_reason 等常见字段）。
const extractFailureReason = (data: any, rawText?: string): string => {
  if (data && typeof data === 'object') {
    const candidates = [
      data.error?.message,
      typeof data.error === 'string' ? data.error : undefined,
      data.error?.code,
      data.failure_reason,
      data.failureReason,
      data.fail_reason,
      data.status_reason,
      data.reason,
      data.detail,
      data.message,
      data.data?.error?.message,
      typeof data.data?.error === 'string' ? data.data?.error : undefined,
      data.data?.failure_reason,
      data.data?.fail_reason,
      data.data?.message,
    ]
    for (const candidate of candidates) {
      const text = String(candidate ?? '').trim()
      if (text) return text.slice(0, 300)
    }
  }
  return String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, 300)
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
    // 优先用配置的 resultField，取不到再退到递归健壮提取。
    const resultUrl = String(readPath(result.data, readStringExtra(extraJson, 'resultField', 'data.result_url')) ?? '').trim()
      || findVideoResultUrl(result.data)
    const completedStatuses = ['completed', 'succeeded', 'success', 'done', 'finished']
    const failedStatuses = ['failed', 'error', 'fail', 'cancelled', 'canceled', 'expired']
    if (completedStatuses.includes(status) && !resultUrl) {
      context.logGenerationTask('video_task:completed_no_url', {
        taskNo,
        status,
        rawSnippet: String(result.rawText || JSON.stringify(result.data) || '').slice(0, 800),
      })
    }
    const cmFailed = failedStatuses.includes(status)
    const cmFailureReason = cmFailed ? extractFailureReason(result.data, result.rawText) : undefined
    if (cmFailed) {
      context.logGenerationTask('video_task:upstream_failed', {
        taskNo,
        status,
        failureReason: cmFailureReason,
        rawSnippet: String(result.rawText || JSON.stringify(result.data) || '').slice(0, 1000),
      })
    }
    return {
      done: Boolean(resultUrl) && (completedStatuses.includes(status) || !status),
      failed: cmFailed,
      resultUrl,
      statusText: status,
      failureReason: cmFailureReason,
      progressPercent: extractProgressPercent(result.data),
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
  const resultUrl = findVideoResultUrl(result.data)
  const completedStatuses = ['completed', 'succeeded', 'success', 'done', 'finished']
  const failedStatuses = ['failed', 'error', 'fail', 'cancelled', 'canceled', 'expired']

  // 上游已报完成但没解析到 URL：打印原始响应，便于定位确切字段（可经 extraJson.resultField 兜底）。
  if (completedStatuses.includes(status) && !resultUrl) {
    context.logGenerationTask('video_task:completed_no_url', {
      taskNo,
      status,
      rawSnippet: String(result.rawText || JSON.stringify(result.data) || '').slice(0, 800),
    })
  }

  // 上游报失败：记录原始响应与失败原因，并向上抛出，便于定位（如参考图无法回源、内容审核等）。
  const failed = failedStatuses.includes(status)
  const failureReason = failed ? extractFailureReason(result.data, result.rawText) : undefined
  if (failed) {
    context.logGenerationTask('video_task:upstream_failed', {
      taskNo,
      status,
      failureReason,
      rawSnippet: String(result.rawText || JSON.stringify(result.data) || '').slice(0, 1000),
    })
  }

  return {
    done: Boolean(resultUrl) && (completedStatuses.includes(status) || !status),
    failed,
    resultUrl,
    statusText: status,
    failureReason,
    progressPercent: extractProgressPercent(result.data),
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
    feature: String(requestBody.feature || payload.feature || '').trim(),
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

  // 提交成功即持久化 taskNo 等元数据，供服务重启后续询恢复（只改 metaJson 一列）。
  await context.persistVideoTaskMeta(task.recordId, task.userId, {
    taskNo,
    protocol,
    providerId,
    modelKey,
    durationSeconds: params.durationSeconds || undefined,
    associationNo: task.associationNo,
    billedPointCost: task.billedPointCost,
    billedModelName: task.billedModelName,
    startedAt,
    pollTimeoutMs,
    submittedAt: new Date().toISOString(),
    resumeCount: 0,
  })

  await pollVideoTask(task, payload, params, { taskNo, protocol, upstream, pollIntervalMs, pollTimeoutMs, startedAt }, context)
}

// 轮询直到完成/失败/超时并写入结果。submit 与 resume 共用。连续抖动按 maxPollErrors 容忍。
const pollVideoTask = async (
  task: VideoExecutionTask,
  payload: GenerationTaskStartPayload,
  params: VideoRequestParams,
  poll: {
    taskNo: string
    protocol: VideoProtocol
    upstream: ResolvedVideoProviderUpstream
    pollIntervalMs: number
    pollTimeoutMs: number
    startedAt: number
  },
  context: VideoTaskExecutorContext,
) => {
  const { taskNo, protocol, upstream, pollIntervalMs, pollTimeoutMs, startedAt } = poll
  // 连续轮询错误容忍：单次网络抖动 / 上游偶发 5xx 不应判死整个任务，连续失败超过上限才放弃。
  const maxConsecutivePollErrors = readNumberExtra(upstream.extraJson, 'maxPollErrors', DEFAULT_MAX_POLL_ERRORS)
  let pollCount = 0
  let consecutivePollErrors = 0
  let resultUrl = ''

  // 轮询直到完成 / 失败 / 超时；每轮检查中止信号，超时抛错触发退款。
  while (true) {
    await context.ensureTaskNotAborted(task)

    let outcome: PollOutcome
    try {
      outcome = await queryVideoTask(protocol, taskNo, upstream, context, task.abortController.signal)
      consecutivePollErrors = 0
    } catch (pollError) {
      // 中止是用户/系统主动停止，不重试，直接抛出走停止/退款收口。
      if (task.abortController.signal.aborted) {
        throw pollError
      }
      consecutivePollErrors += 1
      if (Date.now() - startedAt > pollTimeoutMs) {
        throw new Error('视频生成超时')
      }
      if (consecutivePollErrors > maxConsecutivePollErrors) {
        throw pollError instanceof Error ? pollError : new Error('视频任务查询连续失败')
      }
      context.logGenerationTask('video_task:poll_retry', {
        recordId: task.recordId,
        userId: task.userId,
        consecutivePollErrors,
        maxConsecutivePollErrors,
        message: pollError instanceof Error ? pollError.message : String(pollError),
      })
      context.emitTaskProgressEvent(task.recordId, {
        stage: 'polling_upstream',
        message: `视频生成中…（网络波动重试 ${consecutivePollErrors}/${maxConsecutivePollErrors}）`,
      })
      await context.sleepWithAbortSignal(task.abortController.signal, pollIntervalMs)
      continue
    }

    if (outcome.failed) {
      const reasonSuffix = outcome.failureReason ? `：${outcome.failureReason}` : ''
      // 参考图为本地相对地址且未配置公网基址时，上游大概率因无法回源拉取而失败——给出可操作提示。
      const hasRelativeRef = params.images.some(url => String(url || '').startsWith('/'))
      const hasAssetBase = Boolean(
        String(readStringExtra(upstream.extraJson, 'publicAssetBaseUrl', '')).trim()
        || String(process.env.PUBLIC_ASSET_BASE_URL || process.env.PUBLIC_BASE_URL || '').trim(),
      )
      const refHint = hasRelativeRef && !hasAssetBase
        ? '（参考图为本地 /uploads 相对地址，云端上游无法回源拉取；请在厂商 extraJson 配 publicAssetBaseUrl，或设置环境变量 PUBLIC_ASSET_BASE_URL 为公网可访问地址）'
        : ''
      throw new Error(`视频生成失败（上游状态：${outcome.statusText || 'unknown'}）${reasonSuffix}${refHint}`)
    }
    if (outcome.done && outcome.resultUrl) {
      resultUrl = outcome.resultUrl
      break
    }

    pollCount += 1
    context.emitTaskProgressEvent(task.recordId, {
      stage: 'polling_upstream',
      message: `视频生成中…（第 ${pollCount} 次查询，状态：${outcome.statusText || 'pending'}）`,
      progressPercent: outcome.progressPercent,
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

  // 续询/重新查询拿到结果时：若此前超时已退款，按原金额补扣（幂等）；正常完成无退款则不补扣。
  try {
    await context.rechargeVideoIfRefundedForTask()
  } catch (rechargeError) {
    context.logGenerationTask('video_task:recharge_failed', {
      recordId: task.recordId,
      message: rechargeError instanceof Error ? rechargeError.message : String(rechargeError),
    })
  }

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

// 断点续询：跳过 submit，用已持久化的 savedVideoTask 直接进入轮询。
export const resumeVideoTask = async (
  task: VideoExecutionTask,
  payload: GenerationTaskStartPayload,
  savedVideoTask: SavedVideoTask,
  context: VideoTaskExecutorContext,
) => {
  await context.syncSharedTaskRuntime(task, 'running')
  await context.ensureTaskNotAborted(task)

  const providerId = String(savedVideoTask.providerId || '').trim()
  const modelKey = String(savedVideoTask.modelKey || payload.modelKey || '').trim()
  const taskNo = String(savedVideoTask.taskNo || '').trim()
  if (!providerId || !modelKey || !taskNo) {
    throw new Error('续询缺少必要的任务信息（providerId/modelKey/taskNo）')
  }

  const upstream = await context.resolveVideoProviderUpstream({ providerId, modelKey })
  const protocol: VideoProtocol = savedVideoTask.protocol === 'chengmeng-async' ? 'chengmeng-async' : 'openai-async'
  const pollIntervalMs = readNumberExtra(upstream.extraJson, 'pollIntervalMs', DEFAULT_POLL_INTERVAL_MS)
  const pollTimeoutMs = Number(savedVideoTask.pollTimeoutMs)
    || readNumberExtra(upstream.extraJson, 'pollTimeoutMs', DEFAULT_POLL_TIMEOUT_MS)
  // 剩余超时 = 原总预算 − 已耗时（用原始 startedAt）；≤0 直接判超时失败 → 退款。
  const startedAt = Number(savedVideoTask.startedAt) || Date.now()
  if (Date.now() - startedAt > pollTimeoutMs) {
    throw new Error('视频生成超时')
  }

  const params: VideoRequestParams = {
    modelKey,
    prompt: String(payload.prompt || '').trim(),
    ratio: String(payload.ratio || '').trim(),
    resolution: String(payload.resolution || '').trim(),
    durationSeconds: Number(savedVideoTask.durationSeconds) || 0,
    images: [],
    feature: String(payload.feature || '').trim(),
  }

  context.logGenerationTask('video_task:resume', {
    recordId: task.recordId,
    userId: task.userId,
    protocol,
    taskNo,
    elapsedMs: Date.now() - startedAt,
  })
  context.emitTaskProgressEvent(task.recordId, {
    stage: 'polling_upstream',
    message: '服务已恢复，正在继续查询视频生成结果…',
  })

  await pollVideoTask(task, payload, params, { taskNo, protocol, upstream, pollIntervalMs, pollTimeoutMs, startedAt }, context)
}
