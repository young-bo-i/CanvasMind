import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeGenerationErrorMessage } from '../src/shared/generation-error'

const cases: Array<{
  name: string
  input: string
  expected: string
}> = [
  {
    name: '内容安全审核拒绝',
    input: '{"error":{"message":"Your request was rejected by the safety system. safety_violations=[sexual].","type":"image_generation_user_error","param":"","code":"moderation_blocked"}}',
    expected: '生成请求未通过上游内容安全审核。请调整提示词或更换参考素材；如果内容本身合规，可稍后重试或切换其他模型。',
  },
  {
    name: '参考图格式或颜色模式不支持',
    input: '{"error":{"message":"Invalid image file or mode for image 3, please check your image file.","type":"image_generation_user_error","param":"","code":"invalid_image_file"}}',
    expected: '第 3 张参考图无法被上游读取，可能是文件损坏、格式或颜色模式不受支持。请重新上传 JPG、PNG 或 WebP 图片后重试。',
  },
  {
    name: '图片最长边超过模型上限',
    input: '{"error":{"message":"Invalid size \'4096x4096\'. The longest edge must be less than or equal to 3840.","type":"image_generation_user_error","param":"size","code":"invalid_value"}}',
    expected: '图片尺寸 4096x4096 超过当前模型上限，请将最长边调整到 3840 像素以内。',
  },
  {
    name: '图片像素低于模型下限',
    input: '{"error":{"message":"Invalid size \'576x1024\'. Requested resolution is below the current minimum pixel budget.","type":"image_generation_user_error","param":"size","code":"invalid_value"}}',
    expected: '图片尺寸 576x1024 低于当前模型的最小要求，请提高分辨率或选择更大的尺寸。',
  },
  {
    name: '模型繁忙',
    input: '{"error":{"message":"The model is currently busy, please try again later","type":"bad_response_status_code","code":"bad_response_status_code"}}',
    expected: '当前模型正在繁忙或排队，请稍后重试，也可以切换其他模型。',
  },
  {
    name: '厂商通道不支持模型',
    input: '{"error":{"message":"not supported model for image generation, only imagen models are supported","type":"comet_api_error","code":"convert_request_failed"}}',
    expected: '当前厂商接口不支持所选模型，请切换其他模型，或联系管理员检查模型与接口通道配置。',
  },
  {
    name: '网络连接失败',
    input: 'fetch failed',
    expected: '暂时无法连接上游服务，请稍后重试。若持续失败，请联系管理员检查厂商接口地址和网络状态。',
  },
  {
    name: '上游响应头超时',
    input: '等待响应头超过 90000 ms',
    expected: '上游服务响应超时，请稍后重试；如果是视频任务，可稍后使用“重新查询”获取结果。',
  },
  {
    name: '上游无法下载参考素材',
    input: '视频生成失败（上游状态：failed）：Failed to download the file. Please check if the URL is accessible and try again. (file_download_error)',
    expected: '上游无法下载参考素材，请确认素材仍可访问后重新上传，再发起生成。',
  },
  {
    name: '提示词缺失',
    input: '视频任务提交失败（400）：{"code":"invalid_request","message":"prompt is required"}',
    expected: '提示词不能为空，请输入生成要求后重试。',
  },
  {
    name: 'FastAPI 必填参数缺失',
    input: '{"detail":[{"type":"missing","loc":["body","image"],"msg":"Field required","input":null}]}',
    expected: '请求缺少必填项“参考图”，请补充后重试。',
  },
  {
    name: '上游仅返回缺少必填字段',
    input: '视频生成失败（上游状态：failed）：Field required (missing)',
    expected: '请求缺少上游必填项，请检查生成设置后重试。',
  },
  {
    name: '视频任务失败但未返回原因',
    input: '视频生成失败（上游状态：failed）：{"id":"task_123","status":"failed","progress":100}',
    expected: '上游视频任务生成失败，但没有返回具体原因。请稍后重试，或切换其他视频模型。',
  },
  {
    name: '图片响应没有结果',
    input: '未能从 Gemini 响应中解析出图片（finishReason=STOP）',
    expected: '上游已完成响应，但没有返回可用图片。请稍后重试或切换其他图片模型。',
  },
  {
    name: '生成结果超过数据库或网关大小',
    input: "Got a packet bigger than 'max_allowed_packet' bytes",
    expected: '生成结果文件过大，保存时失败。请降低分辨率或减少单次生成数量后重试。',
  },
  {
    name: '上游限流',
    input: '{"error":{"message":"Too many requests","code":"rate_limit_exceeded"}}',
    expected: '当前请求较多，已触发上游限流。请稍等片刻后重试，避免连续快速提交。',
  },
  {
    name: '上游服务端异常',
    input: '视频任务查询失败（502）',
    expected: '上游服务暂时异常，请稍后重试。若持续失败，可切换其他模型或联系管理员。',
  },
  {
    name: '无法识别的英文异常不直接透传',
    input: '{"error":{"message":"An opaque provider diagnostic with request id req_123","code":"unknown_provider_error"}}',
    expected: '图片生成失败：上游服务暂时无法完成请求，请稍后重试。若持续失败，请联系管理员查看任务日志。',
  },
  {
    name: '已有可读中文业务错误保持原样',
    input: '缺少视频模型标识',
    expected: '缺少视频模型标识',
  },
]

for (const item of cases) {
  test(item.name, () => {
    assert.equal(normalizeGenerationErrorMessage(item.input, '图片生成失败'), item.expected)
  })
}

test('普通 API 的 401 不误报为上游密钥错误', () => {
  assert.equal(
    normalizeGenerationErrorMessage('请求失败 (401)', '请求失败 (401)', { source: 'api' }),
    '登录状态已失效，请重新登录后再试。',
  )
})

test('普通 API 的未知英文异常不提及上游', () => {
  assert.equal(
    normalizeGenerationErrorMessage('opaque internal diagnostic', '操作失败', { source: 'api' }),
    '操作失败：服务暂时无法完成请求，请稍后重试。',
  )
})
