import type { GenerationTaskStartPayload, GenerationTaskStreamEvent } from './shared'
import type { GenerationRecordPayload } from '../generation-records/shared'
import type { ChatUsage } from '../../src/shared/upstream-stream-parser'
import {
  applyCapabilityFlags,
  CAPABILITY_FLAGS_REQUEST_FIELD,
  parseModelCapabilitySpec,
  readCapabilityFlagsFromRequestBody,
} from '../../src/shared/provider-capability'

type AgentChatExecutionTask = {
  recordId: string
  userId: string
  abortController: AbortController
  // 计费结算所需：运行时传入的是完整 RunningGenerationTask，故这些字段实际存在。
  associationNo?: string
  billedProviderId?: string
  billedModelKey?: string
  billedModelName?: string
  billedPointCost?: number
}

type AgentChatRetryState = {
  attempt: number
  waitDurationMs: number
  status: number
  errorPreview: string
  stage: string
}

type PersistState = {
  lastPersistAt: number
  lastPersistContentLength: number
}

export interface AgentChatTaskExecutorContext {
  syncSharedTaskRuntime: (task: AgentChatExecutionTask, status: 'running' | 'completed') => Promise<void>
  ensureTaskNotAborted: (task: AgentChatExecutionTask) => Promise<void>
  resolveGatewayProviderUpstream: (input: {
    providerId?: string
    endpointType?: 'chat' | 'image' | 'image-edit' | 'video'
    modelKey?: string
  }) => Promise<{
    baseUrl: string
    endpoint: string
    apiKey: string
    modelCapabilityJson?: unknown
  }>
  emitTaskProgressEvent: (recordId: string, input: {
    stage: string
    stopped?: boolean
    message?: string
  }) => void
  fetchWithBurstRateRetry: (input: {
    url: string
    init: RequestInit
    signal: AbortSignal
    stage: string
    detail: Record<string, unknown>
    onRetry?: (retryState: AgentChatRetryState) => Promise<void> | void
  }) => Promise<Response>
  markTaskRetryState: (task: AgentChatExecutionTask, input: AgentChatRetryState) => Promise<void>
  extractChatTextFromNonStreamResponse: (response: Response) => Promise<string>
  parseChatChunkError: (chunk: string) => string
  parseChatChunkText: (chunk: string) => string
  parseChatChunkReasoning: (chunk: string) => string
  parseChatChunkUsage: (chunk: string) => ChatUsage | null
  // 对话流结束后按真实 usage 对保底预扣做多退少补。
  settleChatPointsByUsage: (input: {
    userId: string
    associationNo: string
    sourceId: string
    providerId: string
    modelKey: string
    modelName?: string
    preChargedPoints: number
    usage: ChatUsage | null
    billingMultiplier?: number
  }) => Promise<unknown>
  extractChatTextFromJsonPayload: (result: any) => string
  extractChatReasoningFromJsonPayload: (result: any) => string
  emitTaskContentDeltaEvent: (recordId: string, input: {
    stage: string
    delta: string
    content: string
  }) => void
  emitTaskThinkingDeltaEvent: (recordId: string, input: {
    stage: string
    thinkingDelta: string
    thinkingContent: string
  }) => void
  persistAgentTaskContentIfNeeded: (input: {
    task: AgentChatExecutionTask
    payload: GenerationTaskStartPayload
    content: string
    thinkingContent?: string
    force?: boolean
  }, state: PersistState) => Promise<void>
  buildInitialRecordPayload: (payload: GenerationTaskStartPayload) => GenerationRecordPayload
  updateGenerationRecord: (recordId: string, payload: GenerationRecordPayload, currentUserId: string) => Promise<void>
  getGenerationRecordById: (recordId: string, currentUserId: string) => Promise<Record<string, unknown>>
  emitTaskStreamEvent: (recordId: string, event: GenerationTaskStreamEvent) => void
  logGenerationTask: (stage: string, detail: Record<string, unknown>) => void
}

// 独立承接 Agent 对话执行主干，便于后续继续从中心 service 中抽离。
export const executeAgentChatTaskFlow = async (
  task: AgentChatExecutionTask,
  payload: GenerationTaskStartPayload,
  context: AgentChatTaskExecutorContext,
) => {
  await context.syncSharedTaskRuntime(task, 'running')
  await context.ensureTaskNotAborted(task)
  const modelKey = String(payload.modelKey || '').trim()
  if (!modelKey) {
    throw new Error('缺少对话模型标识')
  }

  const providerId = String((payload.requestBody || {}).providerId || '').trim()
  if (!providerId) {
    throw new Error('未匹配到后台模型配置，请先在后台配置可用模型')
  }

  const upstream = await context.resolveGatewayProviderUpstream({
    providerId,
    endpointType: 'chat',
    modelKey,
  })
  context.emitTaskProgressEvent(task.recordId, {
    stage: 'resolved_provider',
    message: '已解析厂商与模型配置，准备请求上游对话模型',
  })

  const headers = new Headers({
    'Content-Type': 'application/json',
  })
  if (upstream.apiKey) {
    headers.set('Authorization', `Bearer ${upstream.apiKey}`)
  }

  // 解析前端开关 + 模型能力声明，注入联网搜索/深度思考等扩展字段。
  // 不支持的能力直接被忽略；__capabilities__ 仅作为前端→后端的传输容器，不应该发往上游。
  const capabilityFlags = readCapabilityFlagsFromRequestBody(payload.requestBody)
  const capabilitySpec = parseModelCapabilitySpec(upstream.modelCapabilityJson)
  const appliedCapability = applyCapabilityFlags(capabilityFlags, capabilitySpec)

  const requestBody = {
    ...(payload.requestBody || {}),
    ...appliedCapability.upstreamFields,
    model: modelKey,
    stream: true,
    // 要求上游在流式末尾返回 usage（含 prompt_tokens_details.cached_tokens），用于按真实 token 分档计费。
    stream_options: { include_usage: true },
  }
  delete (requestBody as Record<string, unknown>).providerId
  delete (requestBody as Record<string, unknown>)[CAPABILITY_FLAGS_REQUEST_FIELD]

  if (Object.keys(appliedCapability.upstreamFields).length) {
    context.logGenerationTask('agent_task:capabilities_applied', {
      recordId: task.recordId,
      userId: task.userId,
      effectiveFlags: appliedCapability.effectiveFlags,
      injectedFields: Object.keys(appliedCapability.upstreamFields),
      billingMultiplier: appliedCapability.billingMultiplier,
    })
  }

  const upstreamUrl = `${upstream.baseUrl.replace(/\/+$/, '')}/${upstream.endpoint.replace(/^\/+/, '')}`
  context.logGenerationTask('agent_task:request_start', {
    recordId: task.recordId,
    userId: task.userId,
    upstreamUrl,
    modelKey,
  })

  context.emitTaskProgressEvent(task.recordId, {
    stage: 'requesting_upstream',
    message: '已开始请求上游对话模型',
  })

  const response = await context.fetchWithBurstRateRetry({
    url: upstreamUrl,
    signal: task.abortController.signal,
    stage: 'agent_chat',
    detail: {
      recordId: task.recordId,
      userId: task.userId,
      providerId,
      modelKey,
      endpointType: 'chat',
    },
    onRetry: (retryState) => context.markTaskRetryState(task, retryState),
    init: {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    },
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '')
    throw new Error(responseText || `对话生成失败 (${response.status})`)
  }

  context.emitTaskProgressEvent(task.recordId, {
    stage: 'receiving_upstream_result',
    message: '上游已开始返回内容，正在持续生成对话',
  })

  const responseContentType = String(response.headers.get('content-type') || '').toLowerCase()
  context.logGenerationTask('agent_task:response_headers', {
    recordId: task.recordId,
    userId: task.userId,
    contentType: responseContentType,
  })

  if (!response.body) {
    const content = await context.extractChatTextFromNonStreamResponse(response)
    await context.updateGenerationRecord(task.recordId, {
      ...context.buildInitialRecordPayload(payload),
      content,
      done: true,
      stopped: false,
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
      message: '对话生成完成，结果已写入记录',
    })
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullThinking = ''
  let rawResponseText = ''
  let hasSseDelta = false
  let streamErrorMessage = ''
  // 流式末尾的 usage chunk（含输入/输出/缓存命中 token），用于结束后按量结算。
  let streamUsage: ChatUsage | null = null
  const rawDataSamples: string[] = []
  const persistState = {
    lastPersistAt: Date.now(),
    lastPersistContentLength: 0,
  }

  while (!task.abortController.signal.aborted) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    const decodedChunk = decoder.decode(value, { stream: true })
    rawResponseText += decodedChunk
    buffer += decodedChunk
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || !trimmed.startsWith('data:')) continue

      const chunk = trimmed.slice(5).trim()
      if (chunk === '[DONE]') {
        continue
      }

      if (rawDataSamples.length < 5) {
        rawDataSamples.push(chunk.slice(0, 500))
      }

      const chunkError = context.parseChatChunkError(chunk)
      if (chunkError) {
        streamErrorMessage = chunkError
        break
      }

      // 末尾 usage chunk（choices 常为空、仅含 usage），单独捕获供结束后按量计费。
      const chunkUsage = context.parseChatChunkUsage(chunk)
      if (chunkUsage) {
        streamUsage = chunkUsage
      }

      try {
        // 同一 chunk 可能同时包含思考与正式内容（罕见但合法），因此分别抽取后各自 emit
        const thinkingDelta = context.parseChatChunkReasoning(chunk)
        if (thinkingDelta) {
          hasSseDelta = true
          fullThinking += thinkingDelta
          context.emitTaskThinkingDeltaEvent(task.recordId, {
            stage: 'receiving_upstream_thinking',
            thinkingDelta,
            thinkingContent: fullThinking,
          })
          // 思考内容随主流程节流持久化（避免长思考过程刷库）
          await context.persistAgentTaskContentIfNeeded({
            task,
            payload,
            content: fullContent,
            thinkingContent: fullThinking,
          }, persistState)
        }

        const delta = context.parseChatChunkText(chunk)
        if (!delta) continue

        hasSseDelta = true
        fullContent += delta
        context.emitTaskContentDeltaEvent(task.recordId, {
          stage: 'receiving_upstream_result',
          delta,
          content: fullContent,
        })
        await context.persistAgentTaskContentIfNeeded({
          task,
          payload,
          content: fullContent,
          thinkingContent: fullThinking,
        }, persistState)
      } catch {
        // 跳过无效 SSE 数据块，继续处理后续消息。
      }
    }

    if (streamErrorMessage) {
      break
    }
  }

  if (streamErrorMessage) {
    throw new Error(streamErrorMessage)
  }

  if (!hasSseDelta && rawResponseText.trim()) {
    const trimmedText = rawResponseText.trim()
    const parsedFromWholeJson = (() => {
      try {
        return context.extractChatTextFromJsonPayload(JSON.parse(trimmedText))
      } catch {
        return ''
      }
    })()

    if (parsedFromWholeJson) {
      fullContent = parsedFromWholeJson
      context.emitTaskContentDeltaEvent(task.recordId, {
        stage: 'receiving_upstream_result',
        delta: parsedFromWholeJson,
        content: fullContent,
      })
    } else {
      const fallbackText = trimmedText
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map((line) => {
          if (line.startsWith('data:')) {
            return context.parseChatChunkText(line.slice(5).trim())
          }
          return ''
        })
        .join('')

      if (fallbackText) {
        fullContent = fallbackText
        context.emitTaskContentDeltaEvent(task.recordId, {
          stage: 'receiving_upstream_result',
          delta: fallbackText,
          content: fullContent,
        })
      }
    }
  }

  if (!fullContent.trim()) {
    context.logGenerationTask('agent_task:empty_stream_debug', {
      recordId: task.recordId,
      userId: task.userId,
      sampleCount: rawDataSamples.length,
      dataSamples: rawDataSamples,
      rawResponseSnippet: rawResponseText.slice(0, 1200),
    })
    throw new Error('上游未返回有效对话内容')
  }

  context.emitTaskProgressEvent(task.recordId, {
    stage: 'syncing_record',
    message: '对话内容已生成，正在同步记录',
  })

  await context.updateGenerationRecord(task.recordId, {
    ...context.buildInitialRecordPayload(payload),
    content: fullContent,
    thinkingContent: fullThinking,
    done: true,
    stopped: false,
  }, task.userId)

  // 按真实 usage 对「保底预扣」做多退少补。结算失败不影响已交付内容，仅记日志。
  if (streamUsage && task.associationNo) {
    try {
      await context.settleChatPointsByUsage({
        userId: task.userId,
        associationNo: task.associationNo,
        sourceId: task.associationNo,
        providerId: task.billedProviderId || providerId,
        modelKey: task.billedModelKey || modelKey,
        modelName: task.billedModelName,
        preChargedPoints: Number(task.billedPointCost || 0),
        usage: streamUsage,
        billingMultiplier: appliedCapability.billingMultiplier,
      })
    } catch (settleError) {
      context.logGenerationTask('agent_task:settle_failed', {
        recordId: task.recordId,
        userId: task.userId,
        message: settleError instanceof Error ? settleError.message : String(settleError),
      })
    }
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
    message: '对话生成完成，结果已写入记录',
  })

  context.logGenerationTask('agent_task:request_success', {
    recordId: task.recordId,
    userId: task.userId,
    contentLength: fullContent.length,
  })
}
