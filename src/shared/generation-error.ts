// 生成「轮询超时」错误：带稳定标记。用于收口计费区分——超时时任务很可能仍在上游处理中
// （用户可「重新查询」取回结果），因此【不退款】；而真实异常（参数/审核/上游失败等）仍照常退款。
export class GenerationTimeoutError extends Error {
  readonly isGenerationTimeout = true
  constructor(message = '生成超时') {
    super(message)
    this.name = 'GenerationTimeoutError'
  }
}

// 仅按稳定标记判定是否为「我方轮询超时」。刻意不做消息字符串匹配，避免把上游 504 /
// 文案含 timeout 的真实失败误判为超时，从而漏退款。
export const isGenerationTimeoutError = (error: unknown): boolean => {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as { isGenerationTimeout?: unknown }).isGenerationTimeout === true,
  )
}

interface ParsedUpstreamErrorDetail {
  type: string
  code: string
  message: string
  param: string
  status: number
}

interface FastApiValidationItem {
  type: string
  loc: string[]
  msg: string
  input?: unknown
  ctx?: Record<string, unknown>
}

export interface GenerationErrorNormalizeOptions {
  source?: 'upstream' | 'api'
}

const tryParseJson = (value: string): unknown => {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

const extractErrorObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

const readText = (...values: unknown[]) => {
  for (const value of values) {
    const text = typeof value === 'string' || typeof value === 'number'
      ? String(value).trim()
      : ''
    if (text) return text
  }
  return ''
}

// 上游异常常被包装成 "Error: {...}"、"视频任务提交失败（400）：{...}"，
// 或 data.error 再嵌一层。这里集中提取 JSON，后续规则只面对稳定字段。
const extractStructuredPayload = (input: string): Record<string, unknown> | null => {
  const normalizedText = String(input || '').trim().replace(/^Error:\s*/i, '')
  if (!normalizedText) return null

  const direct = extractErrorObject(tryParseJson(normalizedText))
  if (direct) return direct

  const objectStart = normalizedText.indexOf('{')
  if (objectStart >= 0) {
    const objectEnd = normalizedText.lastIndexOf('}')
    const candidate = objectEnd > objectStart
      ? normalizedText.slice(objectStart, objectEnd + 1)
      : normalizedText.slice(objectStart)
    const embedded = extractErrorObject(tryParseJson(candidate))
    if (embedded) return embedded
  }

  return null
}

const extractNestedError = (payload: Record<string, unknown>) => {
  const directError = extractErrorObject(payload.error)
  if (directError) return directError

  const data = extractErrorObject(payload.data)
  const dataError = extractErrorObject(data?.error)
  if (dataError) return dataError

  return payload
}

// FastAPI / Pydantic 校验错统一返回 { detail: [{ type, loc, msg, input?, ctx? }] }。
// 提取第一条用于翻译；非该结构返回 null。
const extractFastApiValidationItem = (input: string): FastApiValidationItem | null => {
  const trimmed = String(input || '').trim()
  if (!trimmed || !trimmed.includes('"detail"')) return null

  const parsed = extractStructuredPayload(trimmed)
  const detail = parsed?.detail
  if (!Array.isArray(detail) || detail.length === 0) return null

  const first = detail[0]
  if (!first || typeof first !== 'object') return null

  const candidate = first as Record<string, unknown>
  const loc = Array.isArray(candidate.loc) ? candidate.loc.map(item => String(item)) : []
  return {
    type: String(candidate.type || '').trim(),
    loc,
    msg: String(candidate.msg || '').trim(),
    input: candidate.input,
    ctx: candidate.ctx && typeof candidate.ctx === 'object' ? candidate.ctx as Record<string, unknown> : undefined,
  }
}

const FRIENDLY_FIELD_NAMES: Record<string, string> = {
  n: '生成数量',
  count: '生成数量',
  prompt: '提示词',
  image: '参考图',
  images: '参考图',
  size: '图片尺寸',
  resolution: '分辨率',
  ratio: '画面比例',
  aspect_ratio: '画面比例',
  duration: '视频时长',
  model: '模型',
}

const resolveFriendlyFieldName = (field: string) => FRIENDLY_FIELD_NAMES[field] || field

// 把单条 FastAPI 校验错翻译成用户能看懂的中文。
const buildFastApiValidationMessage = (item: FastApiValidationItem) => {
  const lastLoc = item.loc.length ? String(item.loc[item.loc.length - 1]) : ''
  const fieldName = resolveFriendlyFieldName(lastLoc)
  const inputDisplay = item.input === undefined || item.input === null ? '' : String(item.input)

  // n 参数超上限：图片接口最常见的 422，直接告诉用户上限和当前值
  if (item.type === 'less_than_equal' && lastLoc === 'n') {
    const upper = item.ctx?.le !== undefined ? String(item.ctx.le) : ''
    if (upper && inputDisplay) {
      return `该模型单次最多生成 ${upper} 张图，当前请求 ${inputDisplay} 张超出上限，请减少数量后重试。`
    }
    if (upper) {
      return `该模型单次最多生成 ${upper} 张图，请减少数量后重试。`
    }
    return '生成数量超过该模型的单次上限，请减少数量后重试。'
  }

  if (item.type === 'greater_than_equal' && lastLoc === 'n') {
    return '生成数量至少为 1，请重新设置。'
  }

  if (item.type === 'missing') {
    return lastLoc
      ? `请求缺少必填项“${fieldName}”，请补充后重试。`
      : '请求缺少上游必填项，请检查生成设置后重试。'
  }

  if (lastLoc) {
    return `“${fieldName}”不符合当前模型要求，请调整后重试。`
  }
  return '部分生成参数不符合当前模型要求，请调整设置后重试。'
}

const extractUpstreamErrorDetail = (input: string): ParsedUpstreamErrorDetail => {
  const normalizedText = String(input || '').trim()
  const emptyDetail: ParsedUpstreamErrorDetail = {
    type: '',
    code: '',
    message: '',
    param: '',
    status: 0,
  }

  if (!normalizedText) {
    return emptyDetail
  }

  const payload = extractStructuredPayload(normalizedText)
  if (!payload) return emptyDetail

  const detail = extractNestedError(payload)
  const payloadStatus = Number(payload.status || payload.statusCode || payload.status_code || 0)
  const detailStatus = Number(detail.status || detail.statusCode || detail.status_code || 0)
  const detailText = typeof detail.detail === 'string' ? detail.detail : ''

  return {
    type: readText(detail.type, payload.type),
    code: readText(detail.code, payload.code),
    message: readText(
      detail.message,
      detail.msg,
      detailText,
      payload.message,
      payload.msg,
      payload.error_description,
      typeof payload.error === 'string' ? payload.error : '',
    ),
    param: readText(detail.param, payload.param),
    status: Number.isFinite(detailStatus) && detailStatus > 0
      ? detailStatus
      : Number.isFinite(payloadStatus) && payloadStatus > 0
        ? payloadStatus
        : 0,
  }
}

const extractHttpStatus = (input: string, detail: ParsedUpstreamErrorDetail) => {
  if (detail.status >= 400 && detail.status <= 599) return detail.status
  const numericCode = Number(detail.code)
  if (numericCode >= 400 && numericCode <= 599) return numericCode

  const normalizedText = String(input || '')
  const statusPatterns = [
    /(?:HTTP|status(?:\s+code)?)[\s:=（(]*(4\d{2}|5\d{2})/i,
    /(?:提交|查询|生成|请求)失败\s*[（(](4\d{2}|5\d{2})[）)]/,
  ]
  for (const pattern of statusPatterns) {
    const matched = normalizedText.match(pattern)
    if (matched?.[1]) return Number(matched[1])
  }
  return 0
}

const buildContentPolicyViolationMessage = () => {
  return '生成内容触发了上游版权或内容政策限制。请减少对具体 IP、角色、官方素材或高度可识别形象的描述后重试。'
}

const buildModerationBlockedMessage = () => {
  return '生成请求未通过上游内容安全审核。请调整提示词或更换参考素材；如果内容本身合规，可稍后重试或切换其他模型。'
}

const buildProviderSecretDecryptMessage = () => {
  return '上游厂商密钥读取失败，请联系管理员重新保存厂商 API Key。'
}

const buildProviderCipherFormatMessage = () => {
  return '上游厂商密钥配置异常，请联系管理员重新保存厂商 API Key。'
}

const buildInvalidApiKeyMessage = () => {
  return '上游服务认证失败，请联系管理员检查厂商 API Key 或接口权限。'
}

const buildInsufficientQuotaMessage = () => {
  return '上游厂商额度不足或账户欠费，请联系管理员充值额度，或切换其他可用模型。'
}

const buildBurstRateLimitMessage = () => {
  return '当前请求较多，已触发上游限流。请稍等片刻后重试，避免连续快速提交。'
}

const buildModelBusyMessage = () => {
  return '当前模型正在繁忙或排队，请稍后重试，也可以切换其他模型。'
}

const buildNetworkErrorMessage = () => {
  return '暂时无法连接上游服务，请稍后重试。若持续失败，请联系管理员检查厂商接口地址和网络状态。'
}

const buildTimeoutMessage = () => {
  return '上游服务响应超时，请稍后重试；如果是视频任务，可稍后使用“重新查询”获取结果。'
}

const buildUnsupportedModelMessage = () => {
  return '当前厂商接口不支持所选模型，请切换其他模型，或联系管理员检查模型与接口通道配置。'
}

const buildMissingPromptMessage = () => {
  return '提示词不能为空，请输入生成要求后重试。'
}

const buildMissingParameterMessage = (param: string) => {
  const friendlyName = resolveFriendlyFieldName(param)
  return param
    ? `请求缺少必填项“${friendlyName}”，请补充后重试。`
    : '请求缺少上游必填项，请检查生成设置后重试。'
}

const buildInvalidImageMessage = (input: string) => {
  const matched = String(input || '').match(/image\s+(\d+)/i)
  const indexText = matched?.[1] ? `第 ${matched[1]} 张` : ''
  return `${indexText}参考图无法被上游读取，可能是文件损坏、格式或颜色模式不受支持。请重新上传 JPG、PNG 或 WebP 图片后重试。`
}

const buildReferenceDownloadMessage = () => {
  return '上游无法下载参考素材，请确认素材仍可访问后重新上传，再发起生成。'
}

const buildInvalidSizeMessage = (input: string) => {
  const raw = String(input || '')
  const size = raw.match(/Invalid size\s+['"]([^'"]+)['"]/i)?.[1] || ''
  const maxEdge = raw.match(/longest edge must be less than or equal to\s+(\d+)/i)?.[1] || ''
  const sizeSubject = size ? `图片尺寸 ${size}` : '图片尺寸'

  if (/below the current minimum pixel budget/i.test(raw)) {
    return `${sizeSubject} 低于当前模型的最小要求，请提高分辨率或选择更大的尺寸。`
  }
  if (maxEdge) {
    return `${sizeSubject} 超过当前模型上限，请将最长边调整到 ${maxEdge} 像素以内。`
  }
  return '图片尺寸或画面比例不符合当前模型要求，请调整后重试。'
}

const buildInvalidParameterMessage = (param: string) => {
  const friendlyName = resolveFriendlyFieldName(param)
  return param
    ? `“${friendlyName}”不符合当前模型要求，请调整后重试。`
    : '部分生成参数不符合当前模型要求，请调整设置后重试。'
}

const buildNoImageResultMessage = () => {
  return '上游已完成响应，但没有返回可用图片。请稍后重试或切换其他图片模型。'
}

const buildVideoFailureMessage = () => {
  return '上游视频任务生成失败，但没有返回具体原因。请稍后重试，或切换其他视频模型。'
}

const buildResultTooLargeMessage = () => {
  return '生成结果文件过大，保存时失败。请降低分辨率或减少单次生成数量后重试。'
}

const buildHttpStatusMessage = (status: number, source: 'upstream' | 'api') => {
  if (source === 'api') {
    if (status === 400 || status === 415 || status === 422) {
      return '提交内容有误，请检查填写内容和上传素材后重试。'
    }
    if (status === 401) return '登录状态已失效，请重新登录后再试。'
    if (status === 403) return '当前账号没有执行此操作的权限。'
    if (status === 404) return '请求的内容不存在或已被删除。'
    if (status === 408 || status === 504) return '服务响应超时，请稍后重试。'
    if (status === 413) return '上传或提交的内容过大，请缩小文件后重试。'
    if (status === 429) return '操作过于频繁，请稍等片刻后重试。'
    if (status >= 500) return '服务暂时异常，请稍后重试。'
    return ''
  }

  if (status === 400 || status === 415 || status === 422) {
    return '请求参数或素材不符合上游要求，请检查模型、尺寸、提示词和参考素材后重试。'
  }
  if (status === 401 || status === 403) return buildInvalidApiKeyMessage()
  if (status === 404) {
    return '上游接口或模型不存在，请切换其他模型，或联系管理员检查厂商接口配置。'
  }
  if (status === 408 || status === 504) return buildTimeoutMessage()
  if (status === 409) return buildModelBusyMessage()
  if (status === 413) return buildResultTooLargeMessage()
  if (status === 429) return buildBurstRateLimitMessage()
  if (status >= 500) {
    return '上游服务暂时异常，请稍后重试。若持续失败，可切换其他模型或联系管理员。'
  }
  return ''
}

const isReadableChineseMessage = (message: string) => {
  const normalized = String(message || '').trim()
  if (!normalized || normalized.length > 240) return false
  if (!/[\u3400-\u9fff]/.test(normalized)) return false
  if (/[{}\[\]]/.test(normalized)) return false
  if (/\b(?:error|failed|exception|request id|status|code)\b\s*[:=(]?/i.test(normalized)) return false
  return true
}

// 统一格式化生成链路中的异常，避免把原始 JSON、密文解密异常直接暴露给前端。
export const normalizeGenerationErrorMessage = (
  input: unknown,
  fallback = '任务执行失败',
  options: GenerationErrorNormalizeOptions = {},
) => {
  const source = options.source === 'api' ? 'api' : 'upstream'
  const rawMessage = typeof input === 'string'
    ? input.trim()
    : input instanceof Error
      ? String(input.message || '').trim()
      : ''

  if (!rawMessage) {
    return fallback
  }

  if (/Unsupported state or unable to authenticate data/i.test(rawMessage)) {
    return buildProviderSecretDecryptMessage()
  }

  if (/API Key 密文格式不正确/i.test(rawMessage)) {
    return buildProviderCipherFormatMessage()
  }

  // FastAPI / Pydantic 校验错（如上游对 n 参数硬上限）：优先识别，转成可读中文
  const validationItem = extractFastApiValidationItem(rawMessage)
  if (validationItem) {
    return buildFastApiValidationMessage(validationItem)
  }

  const detail = extractUpstreamErrorDetail(rawMessage)
  const combinedMessage = [
    rawMessage,
    detail.type,
    detail.code,
    detail.message,
    detail.param,
  ].filter(Boolean).join('\n')
  const httpStatus = extractHttpStatus(rawMessage, detail)

  if (
    detail.code === 'moderation_blocked'
    || /moderation_blocked/i.test(combinedMessage)
    || /rejected by the safety system/i.test(detail.message)
    || /safety_violations\s*=/i.test(combinedMessage)
  ) {
    return buildModerationBlockedMessage()
  }

  if (detail.code === 'content_policy_violation' || /content_policy_violation/i.test(combinedMessage)) {
    return buildContentPolicyViolationMessage()
  }

  if (
    detail.code === 'invalid_api_key'
    || /invalid[_ ]api[_ ]key|incorrect api key|api key.*(?:invalid|expired)|authentication failed/i.test(combinedMessage)
  ) {
    return buildInvalidApiKeyMessage()
  }

  if (
    detail.code === 'insufficient_quota'
    || /insufficient[_ ]quota|quota exceeded|billing limit|账户欠费|额度不足/i.test(combinedMessage)
  ) {
    return buildInsufficientQuotaMessage()
  }

  if (
    detail.code === 'limit_burst_rate'
    || /limit_burst_rate|Request rate increased too quickly|rate.?limit|too many requests/i.test(combinedMessage)
  ) {
    return buildBurstRateLimitMessage()
  }

  if (
    detail.code === 'invalid_image_file'
    || /invalid image file|unsupported image (?:format|mode)|cannot identify image/i.test(combinedMessage)
  ) {
    return buildInvalidImageMessage(combinedMessage)
  }

  if (
    detail.code === 'file_download_error'
    || /failed to download the file|file_download_error|参考图读取失败|参考素材下载失败/i.test(combinedMessage)
  ) {
    return buildReferenceDownloadMessage()
  }

  if (/prompt is required|prompt.*field required|提示词不能为空/i.test(combinedMessage)) {
    return buildMissingPromptMessage()
  }

  if (/Field required\s*\(missing\)|\bmissing required (?:field|parameter)\b/i.test(combinedMessage)) {
    return buildMissingParameterMessage(detail.param)
  }

  if (
    detail.param === 'size'
    || /Invalid size|minimum pixel budget|longest edge must be less than or equal/i.test(combinedMessage)
  ) {
    return buildInvalidSizeMessage(combinedMessage)
  }

  if (
    detail.code === 'convert_request_failed'
    || /not supported model|unsupported model|model.*not (?:found|available)|only .* models are supported/i.test(combinedMessage)
  ) {
    return buildUnsupportedModelMessage()
  }

  if (
    /model is currently busy|model.*overload|server is busy|service.*busy|try again later|排队过多|模型繁忙/i.test(combinedMessage)
  ) {
    return buildModelBusyMessage()
  }

  if (
    /等待响应头超过|timed?\s*out|timeout|ETIMEDOUT|headers timeout|生成超时/i.test(combinedMessage)
  ) {
    return buildTimeoutMessage()
  }

  if (
    /fetch failed|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|network error|socket hang up|connection (?:closed|refused)|TLS|certificate/i.test(combinedMessage)
  ) {
    return buildNetworkErrorMessage()
  }

  if (
    /未能从 (?:Gemini|对话)响应中解析出图片|未能获取到(?:生成|编辑)的图片|没有返回可用图片|finishReason=/i.test(combinedMessage)
  ) {
    return buildNoImageResultMessage()
  }

  if (
    /Got a packet bigger than|max_allowed_packet|生成结果过大|remote resource too large/i.test(combinedMessage)
  ) {
    return buildResultTooLargeMessage()
  }

  if (
    /视频生成失败（上游状态：failed）|["']status["']\s*:\s*["']failed["']/i.test(combinedMessage)
  ) {
    return buildVideoFailureMessage()
  }

  if (
    detail.code === 'invalid_value'
    || detail.code === 'invalid_request'
    || /invalid (?:value|request|parameter)|参数不合法/i.test(combinedMessage)
  ) {
    return buildInvalidParameterMessage(detail.param)
  }

  const httpStatusMessage = buildHttpStatusMessage(httpStatus, source)
  if (httpStatusMessage) return httpStatusMessage

  if (isReadableChineseMessage(detail.message)) return detail.message
  if (isReadableChineseMessage(rawMessage)) return rawMessage

  return source === 'api'
    ? `${fallback}：服务暂时无法完成请求，请稍后重试。`
    : `${fallback}：上游服务暂时无法完成请求，请稍后重试。若持续失败，请联系管理员查看任务日志。`
}
