import type { GenerationTaskStartPayload, GenerationTaskStreamEvent } from './shared'
import type { GenerationRecordPayload } from '../generation-records/shared'
import { GenerationTimeoutError } from '../../src/shared/generation-error'

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
  // multipart/form-data 提交（cometapi-videos 走 /v1/videos + input_reference 文件直传）。可选：仅该协议需要。
  fetchUpstreamForm?: (input: {
    url: string
    apiKey?: string
    formData: FormData
    signal: AbortSignal
  }) => Promise<VideoUpstreamFetchResult>
  // 把参考图(公网 URL / uploads 相对路径 / data URI)解析为可直传的 Blob。可选：仅 cometapi-videos 协议需要。
  resolveReferenceBlob?: (url: string) => Promise<Blob>
}

type VideoProtocol = 'openai-async' | 'chengmeng-async' | 'cometapi-videos'

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

// ===== CometAPI /v1/videos 视频协议（cometapi-videos；seedance 等模型走这条）=====
// 重要：protocol 按「厂商的线格式」命名,不要按「模型」命名。同一个 seedance 模型在不同厂商,
// 端点/字段/参考图机制/JSON-vs-multipart 都可能有细微差别,必须各走各的 protocol 或各自的字段配置:
//   - 字段名级别的细微差异(seconds vs duration、input_reference vs image)→ 用下面的 extraJson 配置项吸收;
//   - 线格式根本不同(如火山引擎 Ark 原生 content 数组)→ 另起一个 protocol。
// 本 protocol = CometAPI /v1/videos(OpenAI-Sora 兼容 multipart),已对 doubao-seedance-2-0 实测通过。
const COMETAPI_VIDEO_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])

// 官方 seedance 尺寸表(分辨率档 × 比例 → 精确 WxH)。两列:1.0 系列(v1) vs 1.5Pro/2.0/2.0Fast(v2)。
// ⚠ 必须查表下发文档化的精确 WxH:自己按比例硬算(如 1:1/720p 得 720x720)是"未文档化"尺寸,
//   会被 seedance 静默归一成别的比例 → 出来的视频不是所选比例。
const SEEDANCE_SIZE_TABLE: Record<'v1' | 'v2', Record<string, Record<string, string>>> = {
  v1: {
    '480p': { '16:9': '864x480', '4:3': '736x544', '1:1': '640x640', '3:4': '544x736', '9:16': '480x864', '21:9': '960x416' },
    '720p': { '16:9': '1248x704', '4:3': '1120x832', '1:1': '960x960', '3:4': '832x1120', '9:16': '704x1248', '21:9': '1504x640' },
    '1080p': { '16:9': '1920x1088', '4:3': '1664x1248', '1:1': '1440x1440', '3:4': '1248x1664', '9:16': '1088x1920', '21:9': '2176x928' },
  },
  v2: {
    '480p': { '16:9': '864x496', '4:3': '752x560', '1:1': '640x640', '3:4': '560x752', '9:16': '496x864', '21:9': '992x432' },
    '720p': { '16:9': '1280x720', '4:3': '1112x834', '1:1': '960x960', '3:4': '834x1112', '9:16': '720x1280', '21:9': '1470x630' },
    '1080p': { '16:9': '1920x1080', '4:3': '1664x1248', '1:1': '1440x1440', '3:4': '1248x1664', '9:16': '1080x1920', '21:9': '2206x946' },
  },
}

// 据 model + 分辨率档 + 比例 查官方尺寸表得到精确 WxH;查不到再回退比例预设(默认 720p)。
const resolveCometapiVideoSize = (modelKey: string, ratio: string, resolution: string): string => {
  const r = String(ratio || '').trim().toLowerCase().replace(/x/g, ':')
  const resMatch = String(resolution || '').match(/(480|720|1080)/)
  const resKey = resMatch ? `${resMatch[1]}p` : ''
  // 1.0 系列(doubao-seedance-1-0-*)单独一列;1.5 Pro / 2.0 / 2.0 Fast 共用另一列。
  const column = /seedance-1-0/i.test(String(modelKey || '')) ? 'v1' : 'v2'
  const tabled = resKey ? SEEDANCE_SIZE_TABLE[column]?.[resKey]?.[r] : ''
  if (tabled) return tabled
  return COMETAPI_VIDEO_RATIOS.has(r) ? r : '16:9'
}

const blobFileExt = (blob: Blob): string => {
  const t = String(blob.type || '').toLowerCase()
  if (t.includes('webp')) return 'webp'
  if (t.includes('jpeg') || t.includes('jpg')) return 'jpg'
  return 'png'
}

// CometAPI /v1/videos 提交：multipart/form-data + 文件直传参考图。字段名按 extraJson 可配,
// 用于吸收同类(Sora 兼容)厂商的细微字段差异。返回上游任务号。
const submitCometapiVideoTask = async (
  params: VideoRequestParams,
  upstream: ResolvedVideoProviderUpstream,
  context: VideoTaskExecutorContext,
  signal: AbortSignal,
): Promise<string> => {
  const { baseUrl, apiKey, videoEndpoint, extraJson } = upstream
  // 提前取出并断言注入能力,顺带让 TS 在 await/循环后仍保持非空收窄。
  const fetchForm = context.fetchUpstreamForm
  const resolveBlob = context.resolveReferenceBlob
  if (!fetchForm || !resolveBlob) {
    throw new Error('cometapi-videos 协议需要 multipart 提交能力（fetchUpstreamForm / resolveReferenceBlob）未注入')
  }
  const trimmedBase = baseUrl.replace(/\/+$/, '')
  const endpoint = videoEndpoint && videoEndpoint.trim() ? videoEndpoint.trim() : '/videos'
  const submitUrl = `${trimmedBase}/${endpoint.replace(/^\/+/, '')}`

  // 可配字段名:同类厂商若把 seconds 叫 duration、把 input_reference 叫 image 等,改这些配置即可,不改代码。
  const modelField = readStringExtra(extraJson, 'videoModelField', 'model')
  const promptField = readStringExtra(extraJson, 'videoPromptField', 'prompt')
  const secondsField = readStringExtra(extraJson, 'videoSecondsField', 'seconds')
  const sizeField = readStringExtra(extraJson, 'videoSizeField', 'size')
  const referenceField = readStringExtra(extraJson, 'videoReferenceField', 'input_reference')

  const minDuration = readNumberExtra(extraJson, 'minDuration', 4)
  const maxDuration = readNumberExtra(extraJson, 'maxDuration', 15)
  const defaultDuration = readNumberExtra(extraJson, 'defaultDuration', 5)
  const seconds = Math.round(clampNumber(params.durationSeconds || defaultDuration, minDuration, maxDuration))
  const size = resolveCometapiVideoSize(params.modelKey, params.ratio, params.resolution)
  const maxImages = readNumberExtra(extraJson, 'maxImages', 9)

  const form = new FormData()
  form.append(modelField, params.modelKey)
  form.append(promptField, params.prompt)
  form.append(secondsField, String(seconds))
  if (size) form.append(sizeField, size)

  // 仅图片参考走文件直传(CometAPI /v1/videos wrapper 仅支持图片;多图=全能参考,最多 maxImages)。
  // 直传文件而非 URL：本地 /uploads 参考图无需公网可达地址即可使用。
  const imageRefs = params.images.filter(url => detectRefKind(url) === 'image').slice(0, maxImages)
  let attached = 0
  for (const ref of imageRefs) {
    try {
      const blob = await resolveBlob(ref)
      form.append(referenceField, blob, `reference-${attached + 1}.${blobFileExt(blob)}`)
      attached += 1
    } catch (refError) {
      context.logGenerationTask('video_task:ref_resolve_failed', {
        ref: String(ref).slice(0, 160),
        message: refError instanceof Error ? refError.message : String(refError),
      })
    }
  }

  context.logGenerationTask('video_task:submit_body', {
    url: submitUrl,
    protocol: 'cometapi-videos',
    model: params.modelKey,
    seconds,
    size,
    referenceField,
    refCount: params.images.length,
    inputReferenceCount: attached,
  })

  const result = await fetchForm({ url: submitUrl, apiKey, formData: form, signal })
  context.logGenerationTask('video_task:submit_response', {
    url: submitUrl,
    httpOk: result.ok,
    status: result.status,
    response: (() => { try { return JSON.stringify(result.data).slice(0, 1500) } catch { return String(result.rawText || '').slice(0, 1500) } })(),
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

// 提交任务，返回上游任务号。
const submitVideoTask = async (
  protocol: VideoProtocol,
  params: VideoRequestParams,
  upstream: ResolvedVideoProviderUpstream,
  context: VideoTaskExecutorContext,
  signal: AbortSignal,
): Promise<string> => {
  // cometapi-videos 走独立的 multipart 提交(input_reference 文件直传)，与 JSON 协议完全分开。
  if (protocol === 'cometapi-videos') {
    return submitCometapiVideoTask(params, upstream, context, signal)
  }

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
    // group_id 文档为必填：优先 model/provider 配置(extraJson.groupId)，缺失则在提交前报清晰错误。
    const groupId = String(readExtra(extraJson, 'groupId') ?? '').trim()
    if (!groupId) {
      throw new Error('缺少 chengmeng group_id 配置（model 默认参数 JSON 或厂商 extraJson 的 groupId 必填）')
    }
    // 比例：限定在文档允许集合内，不匹配则回落默认 16:9，避免 400。
    const allowedRatios = ['1:1', '3:4', '4:3', '9:16', '16:9', '21:9']
    const defaultAspectRatio = readStringExtra(extraJson, 'defaultAspectRatio', '16:9')
    const requestedRatio = String(params.ratio || '').trim().toLowerCase().replace(/x/g, ':')
    const aspectRatio = allowedRatios.includes(requestedRatio) ? requestedRatio : defaultAspectRatio
    // 分辨率白名单优先级(统一小写 + 不匹配回落,避免上游 400):
    // 1) 显式 extraJson.allowedResolutions;
    // 2) 否则取该模型「按分辨率定价」配置的分辨率键(billingRule.videoResolutionPrices)——
    //    与计费/前端可选项联动:配了 720p/1080p 价就允许上游生成 720p/1080p,杜绝「按 1080P 计费但只生成 720p」的错配;
    // 3) 都没有则回落 ['720p']。
    const configuredResolutionKeys = (() => {
      const billingRule = readExtra(extraJson, 'billingRule')
      const prices = billingRule && typeof billingRule === 'object' && !Array.isArray(billingRule)
        ? (billingRule as Record<string, unknown>).videoResolutionPrices
        : null
      if (prices && typeof prices === 'object' && !Array.isArray(prices)) {
        return Object.keys(prices).map(v => String(v).toLowerCase()).filter(Boolean)
      }
      return []
    })()
    const allowedResolutions = Array.isArray(readExtra(extraJson, 'allowedResolutions'))
      ? (readExtra(extraJson, 'allowedResolutions') as unknown[]).map(v => String(v).toLowerCase()).filter(Boolean)
      : (configuredResolutionKeys.length ? configuredResolutionKeys : ['720p'])
    const defaultResolution = readStringExtra(extraJson, 'resolution', allowedResolutions[0] || '720p').toLowerCase()
    const requestedResolution = params.resolution.trim().toLowerCase()
    const resolution = allowedResolutions.includes(requestedResolution) ? requestedResolution : defaultResolution
    // 时长：1~15，默认 5。
    const minDuration = readNumberExtra(extraJson, 'minDuration', 1)
    const maxDuration = readNumberExtra(extraJson, 'maxDuration', 15)
    const defaultDuration = readNumberExtra(extraJson, 'defaultDuration', 5)
    const duration = clampNumber(params.durationSeconds || defaultDuration, minDuration, maxDuration)
    // prompt 文档上限 1500 字，超出兜底截断(避免硬失败)。
    const maxPromptChars = readNumberExtra(extraJson, 'maxPromptChars', 1500)
    const prompt = params.prompt.length > maxPromptChars ? params.prompt.slice(0, maxPromptChars) : params.prompt

    // mode 必填：首尾帧功能 → frames，其余(全能参考/智能多帧) → references。
    const mode = params.feature === 'first-last-frame' ? 'frames' : 'references'

    const values: Record<string, unknown> = {
      mode,
      aspect_ratio: aspectRatio,
      duration,
      resolution,
    }
    const body: Record<string, unknown> = {
      model_id: params.modelKey,
      prompt,
      values,
    }
    body.group_id = groupId

    if (mode === 'frames') {
      // 首尾帧模式：仅发 values.first_frame / last_frame，禁止 images/videos/audioUrls。
      // first_frame 文档为必填，缺图时提交前报清晰错误，避免上游返回含糊的 Field required。
      const frameImages = upstreamRefs.filter(url => detectRefKind(url) === 'image')
      if (!frameImages[0]) {
        throw new Error('首尾帧模式需要至少提供首帧图片（first_frame）')
      }
      values.first_frame = frameImages[0]
      if (frameImages[1]) values.last_frame = frameImages[1]
    } else {
      // references 模式：按类型拆顶层 images / values.videos / values.audioUrls，按文档限额裁剪。
      const maxImages = readNumberExtra(extraJson, 'maxImages', 9)
      const maxVideos = readNumberExtra(extraJson, 'maxVideos', 3)
      const maxAudios = readNumberExtra(extraJson, 'maxAudios', 3)
      const images: string[] = []
      const videos: string[] = []
      const audioUrls: string[] = []
      for (const url of upstreamRefs) {
        const kind = detectRefKind(url)
        if (kind === 'video') videos.push(url)
        else if (kind === 'audio') audioUrls.push(url)
        else images.push(url)
      }
      if (images.length) body.images = images.slice(0, maxImages)
      if (videos.length) values.videos = videos.slice(0, maxVideos)
      if (audioUrls.length) values.audioUrls = audioUrls.slice(0, maxAudios)
    }

    const submitUrl = `${trimmedBase}/${submitPath.replace(/^\/+/, '')}`
    // 记录实际下发的完整请求体(不含 apiKey)，便于对照文档字段定位 mode/aspect_ratio 等问题。
    let cmBodyPreview = ''
    try {
      cmBodyPreview = JSON.stringify(body)
    } catch {
      cmBodyPreview = '[unserializable body]'
    }
    context.logGenerationTask('video_task:submit_body', {
      url: submitUrl,
      protocol: 'chengmeng-async',
      mode,
      refCount: upstreamRefs.length,
      feature: params.feature || '(none)',
      groupId: groupId || '(missing!)',
      assetBaseUrl: assetBaseUrl || '(none)',
      isRelativeRef: upstreamRefs.some(url => url.startsWith('/')),
      bodyKeys: Object.keys(body),
      body: cmBodyPreview.slice(0, 2500),
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
    // chengmeng 业务码：HTTP 200 但 code!=0 仍是逻辑失败，给出清晰错误而非含糊「未返回任务号」。
    const bizCode = readPath(result.data, 'code')
    if (bizCode !== undefined && bizCode !== null && Number(bizCode) !== 0) {
      const bizMsg = String(readPath(result.data, 'message') ?? '').trim() || '上游返回业务错误'
      throw new Error(`视频任务提交失败（code=${bizCode}）：${bizMsg.slice(0, 300)}`)
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
  // 「size」字段语义按厂商配置：
  //  - 默认(sizeMeansRatio!=true)：size 装像素分辨率(如 '720p'/'1080p')——OpenAI/Sora 兼容；比例走单独 ratioField。
  //  - Seedance 等(sizeMeansRatio=true)：size 装「宽高比」(如 '16:9')，CometAPI/Seedance 官方示例即 size="16:9"；
  //    分辨率改走 resolutionField(默认不下发，避免上游 400；seedance 的 720p/1080p 多由模型变体决定)。
  const sizeMeansRatio = readExtra(extraJson, 'sizeMeansRatio') === true
  // ratioField：默认场景为 'ratio'；size 已装比例时默认 ''（不再单独发，避免重复/被上游当未知字段）。
  const ratioField = readStringExtra(extraJson, 'ratioField', sizeMeansRatio ? '' : 'ratio')
  if (sizeMeansRatio) {
    if (params.ratio) body.size = params.ratio
    const resolutionField = readStringExtra(extraJson, 'resolutionField', '')
    if (resolutionField && params.resolution) body[resolutionField] = params.resolution
  } else if (params.resolution) {
    body.size = params.resolution
  }
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
    // OpenAI/Sora 兼容的 JSON 形态：input_reference 须为对象 { image_url: <url 或 data url> }（或 { file_id }），
    // 不能是裸字符串——否则兼容网关会把「类型不符」的字段静默丢弃，导致参考图被忽略(只按 prompt 生成)。
    // 个别上游若确实只认裸字符串 URL，可在 extraJson 配 inputReferenceAsObject=false 回退。
    const inputReferenceAsObject = readExtra(extraJson, 'inputReferenceAsObject') !== false
    body.input_reference = inputReferenceAsObject
      ? { image_url: upstreamRefs[0] }
      : upstreamRefs[0]
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
  // 记录上游响应（成功/失败都记），便于线上核对：上游是否认了 input_reference/参考字段、是否回显报错。
  let respPreview = ''
  try {
    respPreview = JSON.stringify(result.data)
  } catch {
    respPreview = String(result.rawText || '')
  }
  context.logGenerationTask('video_task:submit_response', {
    url: submitUrl,
    httpOk: result.ok,
    status: result.status,
    refCount: upstreamRefs.length,
    response: (respPreview || String(result.rawText || '')).slice(0, 2000),
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
    // 业务码守卫：HTTP 200 但 code!=0(如 taskNo 非法/鉴权失败/任务不存在)是逻辑失败。
    // 否则 data 为空 → status='' → 既不完成也不失败 → 会一路轮询到 60 分钟超时才收口。
    const cmBizCode = readPath(result.data, 'code')
    if (cmBizCode !== undefined && cmBizCode !== null && Number(cmBizCode) !== 0) {
      const cmBizMsg = String(readPath(result.data, 'message') ?? '').trim() || '上游返回查询业务错误'
      context.logGenerationTask('video_task:upstream_failed', {
        taskNo,
        status: `code=${cmBizCode}`,
        failureReason: cmBizMsg,
        rawSnippet: String(result.rawText || JSON.stringify(result.data) || '').slice(0, 1000),
      })
      return { done: false, failed: true, resultUrl: '', statusText: 'error', failureReason: cmBizMsg.slice(0, 300) }
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
      // 必须有明确的完成态才算 done：去掉 `|| !status` 兜底，避免空状态 + 递归 URL 兜底
      // 在降级响应里误命中某个 url 字段而提前“完成”（文档保证成功必带 status）。
      done: Boolean(resultUrl) && completedStatuses.includes(status),
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
  const rawProtocol = readStringExtra(upstream.extraJson, 'videoProtocol', 'openai-async')
  const protocol: VideoProtocol = rawProtocol === 'chengmeng-async'
    ? 'chengmeng-async'
    : rawProtocol === 'cometapi-videos'
      ? 'cometapi-videos'
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
  // 自适应退避：前期快查、后期拉长间隔，避免长任务(可达 60 分钟)用固定 3s 打上千次轮询、压上游+占 Event Loop。
  const maxPollIntervalMs = readNumberExtra(upstream.extraJson, 'maxPollIntervalMs', 15000)
  const nextPollInterval = (count: number) => Math.min(maxPollIntervalMs, pollIntervalMs + Math.floor(count / 5) * pollIntervalMs)
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
        throw new GenerationTimeoutError('视频生成超时')
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
    // 文案不再暴露「第 N 次查询/上游状态」;进度改由前端按时间匀速模拟(10 分钟→95%),
    // 故这里也不再上报 progressPercent(上游进度不准),只发一个稳定的"生成中"提示。
    context.emitTaskProgressEvent(task.recordId, {
      stage: 'polling_upstream',
      message: '视频生成中…',
    })

    if (Date.now() - startedAt > pollTimeoutMs) {
      throw new GenerationTimeoutError('视频生成超时')
    }
    await context.sleepWithAbortSignal(task.abortController.signal, nextPollInterval(pollCount))
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
  const protocol: VideoProtocol = savedVideoTask.protocol === 'chengmeng-async'
    ? 'chengmeng-async'
    : savedVideoTask.protocol === 'cometapi-videos'
      ? 'cometapi-videos'
      : 'openai-async'
  const pollIntervalMs = readNumberExtra(upstream.extraJson, 'pollIntervalMs', DEFAULT_POLL_INTERVAL_MS)
  const pollTimeoutMs = Number(savedVideoTask.pollTimeoutMs)
    || readNumberExtra(upstream.extraJson, 'pollTimeoutMs', DEFAULT_POLL_TIMEOUT_MS)
  // 剩余超时 = 原总预算 − 已耗时（用原始 startedAt）；≤0 直接判超时失败 → 退款。
  const startedAt = Number(savedVideoTask.startedAt) || Date.now()
  if (Date.now() - startedAt > pollTimeoutMs) {
    throw new GenerationTimeoutError('视频生成超时')
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
