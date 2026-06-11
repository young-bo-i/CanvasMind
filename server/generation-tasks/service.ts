import { getGenerationRecordById, createGenerationRecord, updateGenerationRecord, persistVideoTaskMeta, markGenerationRecordFailed } from '../generation-records/service'
import type { GenerationRecordPayload } from '../generation-records/shared'
import type { GenerationTaskStartPayload, GenerationTaskStreamEvent } from './shared'
import { prisma } from '../db/prisma'
import { acquireRedisLock, releaseRedisLock } from '../redis/lock'
import { isRedisEnabled } from '../redis/config'
import { redisKeys } from '../redis/keys'
import { resolveGatewayProviderUpstream, resolveVideoProviderUpstream } from '../provider-config/service'
import { resolveImageModelMaxImagesPerRequest } from '../provider-config/model-service'
import {
  attachGenerationPointRecordId,
  consumeGenerationPoints,
  refundGenerationPoints,
  resolveGenerationPointCost,
  settleChatPointsByUsage,
  getMembershipBillingMultiplier,
  checkUserModelMembershipAccess,
  findConsumeByRecordId,
} from '../marketing-center/service'
import { resolveGenerationTaskStrategy, type GenerationTaskStrategyKey } from './strategy'
import {
  AgentWorkspaceStoppedError,
  getAgentWorkspaceSkillMeta,
  buildWorkspaceCompletionSummary,
  getWorkspaceRandomDelay,
  planAgentWorkspace,
  sleepWithWorkspaceAbort,
  workspaceTimingProfile,
} from './agent-workspace-runtime'
import {
  applyAgentWorkspaceEvent,
  buildAgentErrorRun,
  buildAgentPendingRun,
  buildAgentStoppedRun,
  type AgentWorkspaceEvent,
} from '../../src/shared/agent-workspace'
import type { AgentImageResult, AgentRunState } from '../../src/types/agent'
import { normalizeGenerationErrorMessage } from '../../src/shared/generation-error'
import {
  deleteLocalRunningTask,
  getLocalRunningTask,
  setLocalRunningTask,
  type LocalRunningGenerationTask,
} from './local-runtime'
import {
  clearSharedTaskAbortRequested,
  getSharedTaskRuntime,
  markSharedTaskAbortRequested,
  setSharedTaskRuntime,
} from './runtime-store'
import {
  buildTaskSubmissionIdempotencyKey,
  claimIdempotencyKey,
  clearPendingIdempotencyKey,
  completeIdempotencyKey,
  getRedisRuntimeSettings,
  releaseTaskConcurrencySlots,
  tryAcquireProviderTaskSlot,
  tryAcquireSkillTaskSlot,
  tryAcquireUserTaskSlot,
  type RedisConcurrencySlot,
} from '../redis'
import { GenerationTaskRequestError } from './shared'
import { getGenerationTaskExecutionStrategy, type TaskAbortReason } from './execution-strategies'
import { executeImageTask } from './image-task-executor'
import { executeVideoTask, resumeVideoTask, type SavedVideoTask } from './video-task-executor'
import { executeAgentChatTaskFlow } from './agent-chat-task-executor'
import { executeAgentWorkspaceTaskFlow } from './agent-workspace-task-executor'
import { executeResearchTaskFlow } from '../research/executor'
import {
  emitTaskAgentEvent,
  emitTaskContentDeltaEvent,
  emitTaskThinkingDeltaEvent,
  emitTaskFailedEvent,
  emitTaskProgressEvent,
  emitTaskStreamEvent,
} from './task-event-emitter'
import {
  resolveTaskRecordSnapshot,
  subscribeGenerationTaskStream,
} from './task-stream-subscription'
import {
  buildInitialRecordPayload,
  getGenerationTaskRecord as getGenerationTaskRecordLifecycle,
  startGenerationTask as startGenerationTaskLifecycle,
  stopGenerationTask as stopGenerationTaskLifecycle,
} from './task-lifecycle-service'
import {
  ensureTaskNotAborted,
  markTaskExecutionState,
  markTaskRetryState,
  runTaskWithExecutionLock,
  syncSharedTaskRuntime,
} from './task-runtime-governor'
import {
  fetchWithBurstRateRetry,
  sleepWithAbortSignal,
  extractChatTextFromNonStreamResponse,
  extractChatTextFromJsonPayload,
  extractChatReasoningFromJsonPayload,
  parseChatChunkText,
  parseChatChunkReasoning,
  parseChatChunkError,
  parseChatChunkUsage,
  requestImageGeneration,
  requestImageEdit,
  resolveWorkspaceImageModel,
  requestAgentWorkspaceModelPlan,
} from './upstream-helpers'
import { writeScopedLog } from '../shared/logging'

type RunningGenerationTask = LocalRunningGenerationTask & {
  strategyKey: GenerationTaskStrategyKey
}

const GENERATION_TASK_STAGE_LABELS: Record<string, string> = {
  task_created: '任务已创建',
  'agent_task:request_start': '智能体对话任务开始请求',
  'agent_task:response_headers': '智能体对话任务收到响应头',
  'agent_task:request_success': '智能体对话任务请求成功',
  'image_task:request_start': '图片任务开始请求',
  'image_task:request_upstream': '图片任务请求上游',
  'image_task:request_success': '图片任务请求成功',
  'image_task:stopped': '图片任务已停止',
  'image_task:failed': '图片任务执行失败',
  'agent_task:failed': '智能体对话任务执行失败',
  'agent_workspace_task:failed': '智能体工作台任务执行失败',
  'research_task:completed': '研究任务执行完成',
  'research_task:failed': '研究任务执行失败',
  task_execution_lock_renew_failed: '任务执行锁续约失败',
  task_snapshot_cache_failed: '任务快照缓存失败',
  task_recent_event_cache_failed: '最近事件缓存失败',
  'agent_workspace:model_plan_success': '工作台模型规划成功',
  'agent_workspace:model_plan_failed': '工作台模型规划失败',
}

const translateGenerationTaskStage = (stage: string) => {
  return GENERATION_TASK_STAGE_LABELS[stage] || stage
}

// 统一输出生成任务日志，方便排查离页后任务是否仍在服务端继续执行。
const logGenerationTask = (stage: string, detail: Record<string, unknown>) => {
  writeScopedLog('log', '生成任务', translateGenerationTaskStage(stage), detail)
}

// 统一输出生成任务异常日志。
const logGenerationTaskError = (stage: string, error: unknown, detail: Record<string, unknown>) => {
  const err = error as { message?: string; stack?: string }
  writeScopedLog('error', '生成任务', `异常 ${translateGenerationTaskStage(stage)}`, {
    ...detail,
    errorMessage: err?.message || '未知异常',
    errorStack: err?.stack || null,
  })
}

const taskEventEmitterContext = {
  logGenerationTaskError,
}

// 统一给任务写入中断原因，避免把系统中断误判成用户主动停止。
const abortTaskWithReason = (task: RunningGenerationTask, reason: TaskAbortReason) => {
  task.abortController.abort(reason)
}

// 解析本次中断的真实原因，便于后续决定写成 stopped 还是 failed。
const resolveTaskAbortReason = (task: RunningGenerationTask): TaskAbortReason | '' => {
  const reason = task.abortController.signal.reason
  return typeof reason === 'string' ? reason as TaskAbortReason : ''
}

const buildGatewayAssociationNo = () => {
  return `GTK${Date.now()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

// 统一构造任务执行策略上下文，先把停止/失败收口逻辑从中心 service 中迁出。
const buildTaskExecutionStrategyContext = () => ({
  executeImageGenerationTask,
  executeVideoGenerationTask,
  executeAgentChatTask,
  executeAgentWorkspaceTask,
  executeResearchReportTask,
  refundTaskPointsIfNeeded,
  markTaskExecutionState,
  emitTaskProgressEvent: (recordId: string, input: {
    stage: string
    stopped?: boolean
    message?: string
  }) => emitTaskProgressEvent(recordId, {
    stage: input.stage,
    stopped: input.stopped,
    message: input.message || '',
  }, taskEventEmitterContext),
  emitTaskStreamEvent: (recordId: string, event: GenerationTaskStreamEvent) => (
    emitTaskStreamEvent(recordId, event, taskEventEmitterContext)
  ),
  buildInitialRecordPayload,
  updateGenerationRecord,
  getGenerationRecordById,
  syncSharedTaskRuntime,
  buildAgentStoppedRun,
  buildAgentErrorRun,
  normalizeGenerationErrorMessage,
  logGenerationTask,
  logGenerationTaskError,
})


const executeImageGenerationTask = async (task: RunningGenerationTask, payload: GenerationTaskStartPayload) => {
  await executeImageTask(task, payload, {
    syncSharedTaskRuntime,
    ensureTaskNotAborted: (runningTask) => ensureTaskNotAborted(runningTask, { abortTaskWithReason }),
    emitTaskProgressEvent: (recordId, input) => emitTaskProgressEvent(recordId, input, taskEventEmitterContext),
    markTaskRetryState,
    resolveImageMaxImagesPerRequest: (providerId, modelKey) => resolveImageModelMaxImagesPerRequest(providerId, modelKey),
    requestImageGeneration: (input) => requestImageGeneration({
      ...input,
      fetchWithBurstRateRetry: (retryInput) => fetchWithBurstRateRetry({
        ...retryInput,
        logGenerationTask,
      }),
    }),
    requestImageEdit: (input) => requestImageEdit({
      ...input,
      fetchWithBurstRateRetry: (retryInput) => fetchWithBurstRateRetry({
        ...retryInput,
        logGenerationTask,
      }),
    }),
    buildInitialRecordPayload,
    updateGenerationRecord,
    getGenerationRecordById,
    emitTaskStreamEvent: (recordId, event) => emitTaskStreamEvent(recordId, event, taskEventEmitterContext),
    logGenerationTask,
  })
}

// 统一的视频上游 JSON 请求（带 Bearer、外部 signal 转发、JSON 解析）。
const fetchVideoUpstreamJson = async (input: {
  url: string
  method: 'GET' | 'POST'
  apiKey?: string
  body?: Record<string, unknown>
  signal: AbortSignal
}) => {
  const headers: Record<string, string> = {}
  if (input.apiKey) {
    headers.Authorization = `Bearer ${input.apiKey}`
  }
  if (input.method === 'POST') {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetch(input.url, {
    method: input.method,
    headers,
    body: input.method === 'POST' && input.body ? JSON.stringify(input.body) : undefined,
    signal: input.signal,
  })
  const rawText = await response.text().catch(() => '')
  let data: any = null
  try {
    data = rawText ? JSON.parse(rawText) : null
  } catch {
    data = null
  }
  return { status: response.status, ok: response.ok, data, rawText }
}

const executeVideoGenerationTask = async (task: RunningGenerationTask, payload: GenerationTaskStartPayload) => {
  const videoContext = {
    syncSharedTaskRuntime,
    ensureTaskNotAborted: (runningTask: RunningGenerationTask) => ensureTaskNotAborted(runningTask, { abortTaskWithReason }),
    emitTaskProgressEvent: (recordId: string, input: { stage: string; stopped?: boolean; message?: string }) => emitTaskProgressEvent(recordId, input, taskEventEmitterContext),
    sleepWithAbortSignal,
    resolveVideoProviderUpstream,
    fetchUpstreamJson: fetchVideoUpstreamJson,
    buildInitialRecordPayload,
    updateGenerationRecord,
    getGenerationRecordById,
    emitTaskStreamEvent: (recordId: string, event: GenerationTaskStreamEvent) => emitTaskStreamEvent(recordId, event, taskEventEmitterContext),
    logGenerationTask,
    persistVideoTaskMeta,
  }
  // 续询恢复：task 上挂了 resumeVideoTask 标志时走续询(skip submit)，否则正常 submit+poll。
  if (task.resumeVideoTask) {
    await resumeVideoTask(task, payload, task.resumeVideoTask, videoContext)
    return
  }
  await executeVideoTask(task, payload, videoContext)
}

const persistAgentTaskContentIfNeeded = async (input: {
  task: RunningGenerationTask
  payload: GenerationTaskStartPayload
  content: string
  thinkingContent?: string
  force?: boolean
}, state: {
  lastPersistAt: number
  lastPersistContentLength: number
}) => {
  const now = Date.now()
  const shouldPersist = Boolean(input.force)
    || (input.content.length - state.lastPersistContentLength >= 24)
    || (now - state.lastPersistAt >= 400)

  if (!shouldPersist) {
    return
  }

  await updateGenerationRecord(input.task.recordId, {
    ...buildInitialRecordPayload(input.payload),
    content: input.content,
    ...(typeof input.thinkingContent === 'string' ? { thinkingContent: input.thinkingContent } : {}),
    done: false,
    stopped: false,
  }, input.task.userId)

  state.lastPersistAt = now
  state.lastPersistContentLength = input.content.length
}

const executeAgentChatTask = async (task: RunningGenerationTask, payload: GenerationTaskStartPayload) => {
  await executeAgentChatTaskFlow(task, payload, {
    syncSharedTaskRuntime,
    ensureTaskNotAborted: (runningTask) => ensureTaskNotAborted(runningTask, { abortTaskWithReason }),
    resolveGatewayProviderUpstream,
    emitTaskProgressEvent: (recordId, input) => emitTaskProgressEvent(recordId, input, taskEventEmitterContext),
    fetchWithBurstRateRetry: (input) => fetchWithBurstRateRetry({
      ...input,
      logGenerationTask,
    }),
    markTaskRetryState,
    extractChatTextFromNonStreamResponse,
    parseChatChunkError,
    parseChatChunkText,
    parseChatChunkReasoning,
    parseChatChunkUsage,
    settleChatPointsByUsage,
    extractChatTextFromJsonPayload,
    extractChatReasoningFromJsonPayload,
    emitTaskContentDeltaEvent: (recordId, input) => emitTaskContentDeltaEvent(recordId, input, taskEventEmitterContext),
    emitTaskThinkingDeltaEvent: (recordId, input) => emitTaskThinkingDeltaEvent(recordId, input, taskEventEmitterContext),
    persistAgentTaskContentIfNeeded,
    buildInitialRecordPayload,
    updateGenerationRecord,
    getGenerationRecordById,
    emitTaskStreamEvent: (recordId, event) => emitTaskStreamEvent(recordId, event, taskEventEmitterContext),
    logGenerationTask,
  })
}

const persistAgentWorkspaceRecord = async (input: {
  task: RunningGenerationTask
  payload: GenerationTaskStartPayload
  agentRun: AgentRunState
  done?: boolean
  stopped?: boolean
  error?: string
}) => {
  const agentRunImages: AgentImageResult[] = Array.isArray(input.agentRun.result?.images)
    ? input.agentRun.result.images
    : []
  const currentRecord = await getGenerationRecordById(input.task.recordId, input.task.userId)
  const existingImageOutputs = Array.isArray(currentRecord.outputs)
    ? currentRecord.outputs.filter(output => output.outputType === 'image')
    : []

  // 已转存到本地的输出地址优先复用，避免工作台中间态与完成态反复下载同一张远程图。
  const resolvePersistedImageUrl = (image: AgentImageResult, index: number) => {
    const rawImageUrl = String(image.imageSrc || '').trim()
    if (!rawImageUrl) {
      return ''
    }

    const matchedByOriginalUrl = existingImageOutputs.find((output) => (
      String((output.metaJson as Record<string, unknown> | null)?.originalUrl || '').trim() === rawImageUrl
    ))
    if (String(matchedByOriginalUrl?.url || '').trim()) {
      return String(matchedByOriginalUrl?.url || '').trim()
    }

    const sameIndexOutput = existingImageOutputs[index]
    const sameIndexUrl = String(sameIndexOutput?.url || '').trim()
    const sameIndexPromptText = String((sameIndexOutput?.metaJson as Record<string, unknown> | null)?.promptText || '').trim()
    const currentPromptText = String(image.promptText || '').trim()
    if (sameIndexUrl.startsWith('/uploads/') && sameIndexPromptText === currentPromptText) {
      return sameIndexUrl
    }

    return rawImageUrl
  }

  await updateGenerationRecord(input.task.recordId, {
    ...buildInitialRecordPayload(input.payload),
    content: '',
    agentRun: input.agentRun,
    referenceImages: undefined,
    outputs: agentRunImages
      .filter((image) => String(image?.imageSrc || '').trim())
      .map((image, index) => ({
        outputType: 'image' as const,
        url: resolvePersistedImageUrl(image, index),
        sortOrder: index,
        metaJson: {
          promptText: String(image.promptText || '').trim(),
        },
      })),
    done: Boolean(input.done),
    stopped: Boolean(input.stopped),
    error: input.error || '',
  }, input.task.userId)

  return getGenerationRecordById(input.task.recordId, input.task.userId)
}

const executeAgentWorkspaceTask = async (task: RunningGenerationTask, payload: GenerationTaskStartPayload) => {
  await executeAgentWorkspaceTaskFlow(task, payload, {
    syncSharedTaskRuntime,
    ensureTaskNotAborted: (runningTask) => ensureTaskNotAborted(runningTask, { abortTaskWithReason }),
    getAgentWorkspaceSkillMeta,
    buildAgentPendingRun,
    applyAgentWorkspaceEvent: (currentRun, agentEvent) => applyAgentWorkspaceEvent(currentRun as AgentRunState, agentEvent),
    persistAgentWorkspaceRecord,
    emitTaskProgressEvent: (recordId, input) => emitTaskProgressEvent(recordId, input, taskEventEmitterContext),
    emitTaskAgentEvent: (recordId, input) => emitTaskAgentEvent(recordId, input, taskEventEmitterContext),
    sleepWithWorkspaceAbort,
    getWorkspaceRandomDelay,
    workspaceTimingProfile,
    planAgentWorkspace,
    requestAgentWorkspaceModelPlan: (input) => requestAgentWorkspaceModelPlan({
      ...input,
      fetchWithBurstRateRetry: (retryInput) => fetchWithBurstRateRetry({
        ...retryInput,
        logGenerationTask,
      }),
    }),
    logGenerationTask,
    logGenerationTaskError,
    resolveWorkspaceImageModel,
    requestImageEdit: (input) => requestImageEdit({
      ...input,
      fetchWithBurstRateRetry: (retryInput) => fetchWithBurstRateRetry({
        ...retryInput,
        logGenerationTask,
      }),
    }),
    requestImageGeneration: (input) => requestImageGeneration({
      ...input,
      fetchWithBurstRateRetry: (retryInput) => fetchWithBurstRateRetry({
        ...retryInput,
        logGenerationTask,
      }),
    }),
    markTaskRetryState,
    refundTaskPointsIfNeeded,
    normalizeGenerationErrorMessage,
    buildWorkspaceCompletionSummary,
    AgentWorkspaceStoppedError,
  })
}

  const executeResearchReportTask = async (task: RunningGenerationTask, payload: GenerationTaskStartPayload) => {
  await executeResearchTaskFlow(task, payload, {
    syncSharedTaskRuntime,
    ensureTaskNotAborted: (runningTask) => ensureTaskNotAborted(runningTask, { abortTaskWithReason }),
    buildInitialRecordPayload,
    updateGenerationRecord,
    getGenerationRecordById,
    emitTaskStreamEvent: (recordId, event) => emitTaskStreamEvent(recordId, event, taskEventEmitterContext),
    emitTaskProgressEvent: (recordId, input) => emitTaskProgressEvent(recordId, input, taskEventEmitterContext),
    logGenerationTask,
  })
}

const refundTaskPointsIfNeeded = async (task: RunningGenerationTask, reason: string) => {
  if (!task.billedPointCost || task.refundCommitted) {
    return
  }

  task.refundCommitted = true
  await refundGenerationPoints({
    userId: task.userId,
    pointCost: task.billedPointCost,
    sourceId: task.associationNo,
    associationNo: task.associationNo,
    endpointType: task.billedEndpointType,
    providerId: task.billedProviderId,
    modelKey: task.billedModelKey,
    modelName: task.billedModelName,
    // DB 级幂等：同一任务退款至多一次（跨重启/恢复/孤儿 reap 都安全）。
    dedupeKey: `gen-refund:${task.associationNo}`,
    metaJson: {
      refundReason: reason,
      generationRecordId: task.recordId,
    },
  })
}

// 统一按策略键分派后台执行器，避免图片/Agent 两套后台壳逻辑重复演化。
const runTaskInBackground = (task: RunningGenerationTask, payload: GenerationTaskStartPayload) => {
  void (async () => {
    let ownsExecution = false
    const executionStrategy = getGenerationTaskExecutionStrategy(task.strategyKey)
    const executionStrategyContext = buildTaskExecutionStrategyContext()

    try {
      ownsExecution = await runTaskWithExecutionLock(task, async () => {
        await executionStrategy.execute(task, payload, executionStrategyContext)
      }, {
        abortTaskWithReason,
        logGenerationTask,
        logGenerationTaskError,
      })
    } catch (error) {
      const isAbortError = error instanceof DOMException
        ? error.name === 'AbortError'
        : error instanceof Error && /abort/i.test(String(error.name || error.message || ''))
      const abortReason = resolveTaskAbortReason(task)
      const isStoppedAbort = task.abortController.signal.aborted
        && (abortReason === 'user_stop' || abortReason === 'shared_stop')

      // 收口策略本身不应再抛错，但若内部 emit/退点/写库失败也要兜底,
      // 避免异常冒泡到 IIFE 顶层成为 unhandledRejection，更要避免前端永远卡在“运行中”。
      try {
        if (isStoppedAbort || (isAbortError && (abortReason === 'user_stop' || abortReason === 'shared_stop'))) {
          await executionStrategy.handleStopped(task, payload, executionStrategyContext)
        } else {
          const errorMessage = executionStrategy.resolveFailureMessage(error, abortReason, executionStrategyContext)
          await executionStrategy.handleFailed(task, payload, error, errorMessage, executionStrategyContext)
        }
      } catch (fallbackError) {
        logGenerationTaskError('task_failure_handler_failed', fallbackError, {
          recordId: task.recordId,
          userId: task.userId,
          strategyKey: task.strategyKey,
          originalErrorMessage: error instanceof Error ? error.message : String(error || ''),
        })
        // 兜底发一次 failed 事件，确保前端订阅器能收到终止信号并停止 watchdog 重连。
        try {
          emitTaskFailedEvent(task.recordId, {
            errorCode: 'internal_error',
            errorReason: '任务收口处理失败',
            message: '任务收口处理失败',
            stage: 'failure_handler_failed',
          }, taskEventEmitterContext)
        } catch (emitError) {
          logGenerationTaskError('task_failure_emit_failed', emitError, {
            recordId: task.recordId,
          })
        }
      }
    } finally {
      deleteLocalRunningTask(task.recordId)
      await releaseTaskConcurrencySlots(task.concurrencySlots)
      if (ownsExecution) {
        await clearSharedTaskAbortRequested(task.recordId)
      }
    }
  })()
}

// 统一构造生命周期服务依赖，避免 start/get/stop 三个入口重复拼装同一批上下文。
const buildTaskLifecycleContext = () => ({
  resolveGenerationTaskStrategy,
  buildTaskSubmissionIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  clearPendingIdempotencyKey,
  getGenerationRecordById,
  createGenerationRecord: (recordPayload: GenerationRecordPayload, userId: string) => createGenerationRecord(recordPayload, userId),
  updateGenerationRecord: (recordId: string, recordPayload: GenerationRecordPayload, userId: string) => (
    updateGenerationRecord(recordId, recordPayload, userId)
  ),
  attachGenerationPointRecordId,
  resolveGenerationPointCost,
  consumeGenerationPoints,
  getMembershipBillingMultiplier,
  checkUserModelMembershipAccess,
  acquireTaskConcurrencySlots: async ({ userId, providerId, skillKey }: {
    userId: string
    providerId: string
    skillKey: string
  }) => {
    const acquiredSlots: RedisConcurrencySlot[] = []
    const runtimeSettings = await getRedisRuntimeSettings()
    const userResult = await tryAcquireUserTaskSlot(userId, runtimeSettings.taskUserConcurrencyLimit)
    if (!userResult.acquired || !userResult.slot) {
      throw new GenerationTaskRequestError(429, `当前账号正在执行的任务过多，请稍后再试（上限 ${userResult.limit}）`)
    }
    acquiredSlots.push(userResult.slot)

    try {
      const skillResult = await tryAcquireSkillTaskSlot(skillKey, runtimeSettings.taskSkillConcurrencyLimit)
      if (!skillResult.acquired || !skillResult.slot) {
        throw new GenerationTaskRequestError(429, `当前技能任务较多，请稍后再试（上限 ${skillResult.limit}）`)
      }
      acquiredSlots.push(skillResult.slot)

      if (providerId) {
        const providerResult = await tryAcquireProviderTaskSlot(providerId, runtimeSettings.taskProviderConcurrencyLimit)
        if (!providerResult.acquired || !providerResult.slot) {
          throw new GenerationTaskRequestError(429, `当前模型厂商任务较多，请稍后再试（上限 ${providerResult.limit}）`)
        }
        acquiredSlots.push(providerResult.slot)
      }

      return acquiredSlots
    } catch (error) {
      await releaseTaskConcurrencySlots(acquiredSlots)
      throw error
    }
  },
  releaseTaskConcurrencySlots,
  buildAgentPendingRun,
  buildGatewayAssociationNo,
  setLocalRunningTask,
  syncSharedTaskRuntime,
  emitTaskStreamEvent: (recordId: string, event: GenerationTaskStreamEvent) => (
    emitTaskStreamEvent(recordId, event, taskEventEmitterContext)
  ),
  logGenerationTask,
  runTaskInBackground,
  resolveTaskRecordSnapshot,
  getLocalRunningTask,
  getSharedTaskRuntime,
  markSharedTaskAbortRequested,
  abortTaskWithReason,
})

export const startGenerationTask = async (payload: GenerationTaskStartPayload, currentUserId: string) => {
  return startGenerationTaskLifecycle(payload, currentUserId, buildTaskLifecycleContext())
}

export const getGenerationTaskRecord = async (recordId: string, currentUserId: string) => {
  return getGenerationTaskRecordLifecycle(recordId, currentUserId, buildTaskLifecycleContext())
}

export const stopGenerationTask = async (recordId: string, currentUserId: string) => {
  return stopGenerationTaskLifecycle(recordId, currentUserId, buildTaskLifecycleContext())
}

// ===== 断点续询：服务重启后恢复在途视频任务 / 回收不可续询的孤儿 =====

const MAX_VIDEO_RESUME_COUNT = 3

const readVideoTaskMeta = (metaJson: unknown): SavedVideoTask | null => {
  if (!metaJson || typeof metaJson !== 'object' || Array.isArray(metaJson)) return null
  const vt = (metaJson as Record<string, unknown>).videoTask
  if (!vt || typeof vt !== 'object' || Array.isArray(vt)) return null
  return vt as SavedVideoTask
}

type ResumeRecordRow = {
  id: string
  userId: string
  prompt: string
  modelKey: string | null
  ratio: string | null
  resolution: string | null
  durationLabel: string | null
  feature: string | null
}

const buildResumePayload = (rec: ResumeRecordRow, videoTask: SavedVideoTask): GenerationTaskStartPayload => ({
  type: 'video',
  source: 'generate',
  prompt: String(rec.prompt || ''),
  model: String(rec.modelKey || ''),
  modelKey: String(rec.modelKey || videoTask.modelKey || ''),
  ratio: String(rec.ratio || ''),
  resolution: String(rec.resolution || ''),
  duration: String(rec.durationLabel || ''),
  feature: String(rec.feature || ''),
  requestBody: { providerId: videoTask.providerId },
})

// 回收不可续询的任务（未提交孤儿 / 续询超限 / image 孤儿）：退款一次（DB dedupeKey 幂等）+ 记录置失败。
const reapAbandonedTask = async (recordId: string, userId: string, reason: string) => {
  const consume = await findConsumeByRecordId(recordId)
  if (consume?.associationNo && consume.pointCost > 0) {
    await refundGenerationPoints({
      userId: consume.userId || userId,
      pointCost: consume.pointCost,
      sourceId: consume.associationNo,
      associationNo: consume.associationNo,
      endpointType: consume.endpointType,
      providerId: consume.providerId,
      modelKey: consume.modelKey,
      modelName: consume.modelName,
      dedupeKey: `gen-refund:${consume.associationNo}`,
      metaJson: { refundReason: reason, generationRecordId: recordId },
    })
  }
  await markGenerationRecordFailed(recordId, userId, reason)
}

const resumeInflightVideoTasks = async () => {
  const records = await prisma.generationRecord.findMany({
    where: { type: 'VIDEO', status: { in: ['PENDING', 'RUNNING'] }, finishedAt: null },
    select: {
      id: true, userId: true, prompt: true, modelKey: true,
      ratio: true, resolution: true, durationLabel: true, feature: true, metaJson: true,
    },
  })
  for (const rec of records) {
    if (getLocalRunningTask(rec.id)) continue
    const videoTask = readVideoTaskMeta(rec.metaJson)

    // 未提交上游就崩了 → 孤儿，退款 + 失败。
    if (!videoTask?.submittedAt || !videoTask?.taskNo) {
      await reapAbandonedTask(rec.id, rec.userId, '服务重启，任务已中断')
      logGenerationTask('task_resume:reap_unsubmitted_video', { recordId: rec.id })
      continue
    }

    // 续询次数超限 → 不再重试，退款 + 失败（避免坏 taskNo 每次重启都重试到超时）。
    if ((videoTask.resumeCount || 0) >= MAX_VIDEO_RESUME_COUNT) {
      await reapAbandonedTask(rec.id, rec.userId, '续询超过重试上限，任务已中断')
      logGenerationTask('task_resume:cap_exceeded', { recordId: rec.id, resumeCount: videoTask.resumeCount })
      continue
    }

    // 补全计费字段（老数据/缺失时按记录反查 CONSUME 流水）。
    let associationNo = String(videoTask.associationNo || '').trim()
    let billedPointCost = Number(videoTask.billedPointCost || 0)
    if (!associationNo) {
      const consume = await findConsumeByRecordId(rec.id)
      associationNo = String(consume?.associationNo || '').trim()
      billedPointCost = billedPointCost || Number(consume?.pointCost || 0)
    }

    const nextVideoTask: SavedVideoTask = {
      ...videoTask,
      resumeCount: (videoTask.resumeCount || 0) + 1,
      associationNo: associationNo || undefined,
      billedPointCost: billedPointCost || undefined,
    }
    await persistVideoTaskMeta(rec.id, rec.userId, nextVideoTask)

    const task: RunningGenerationTask = {
      recordId: rec.id,
      userId: rec.userId,
      type: 'video',
      strategyKey: 'video',
      abortController: new AbortController(),
      associationNo,
      billedEndpointType: 'video',
      billedPointCost,
      billedProviderId: String(videoTask.providerId || ''),
      billedModelKey: String(videoTask.modelKey || rec.modelKey || ''),
      billedModelName: String(videoTask.billedModelName || ''),
      refundCommitted: false,
      // 恢复不重占并发槽（旧 Redis 计数重启已不准）。
      concurrencySlots: [],
      resumeVideoTask: nextVideoTask,
    }
    setLocalRunningTask(task)
    logGenerationTask('task_resume:resume_video', { recordId: rec.id, taskNo: videoTask.taskNo, resumeCount: nextVideoTask.resumeCount })
    runTaskInBackground(task, buildResumePayload(rec, videoTask))
  }
}

// 手动「重新查询」：超时/失败后的视频记录，用户点按钮主动再查一次上游（可能只是排队慢）。
// 复用续询(resumeVideoTask)机制：复位记录为进行中 + 重新挂轮询，前端重订阅 SSE 看进度。
// 计费：超时已退款时，续询完成默认不二次扣费（属边界情况）；如需二次扣费另行处理。
export const requeryVideoGenerationTask = async (recordId: string, userId: string) => {
  const id = String(recordId || '').trim()
  if (!id) {
    throw new GenerationTaskRequestError(400, '缺少记录 ID')
  }

  // 已在执行则不重复触发，直接返回当前记录。
  if (getLocalRunningTask(id)) {
    return getGenerationRecordById(id, userId)
  }

  const rec = await prisma.generationRecord.findFirst({
    where: { id, userId, type: 'VIDEO' },
    select: {
      id: true, userId: true, prompt: true, modelKey: true,
      ratio: true, resolution: true, durationLabel: true, feature: true, metaJson: true,
    },
  })
  if (!rec) {
    throw new GenerationTaskRequestError(404, '未找到该视频记录')
  }

  const videoTask = readVideoTaskMeta(rec.metaJson)
  if (!videoTask?.taskNo) {
    throw new GenerationTaskRequestError(400, '该任务没有可查询的上游任务号，无法重新查询')
  }

  // 补全计费字段（沿用原 CONSUME 流水；缺失时按记录反查）。
  let associationNo = String(videoTask.associationNo || '').trim()
  let billedPointCost = Number(videoTask.billedPointCost || 0)
  if (!associationNo) {
    const consume = await findConsumeByRecordId(rec.id)
    associationNo = String(consume?.associationNo || '').trim()
    billedPointCost = billedPointCost || Number(consume?.pointCost || 0)
  }

  const nextVideoTask: SavedVideoTask = {
    ...videoTask,
    resumeCount: (videoTask.resumeCount || 0) + 1,
    associationNo: associationNo || undefined,
    billedPointCost: billedPointCost || undefined,
  }
  await persistVideoTaskMeta(rec.id, rec.userId, nextVideoTask)

  // 复位为进行中，让前端重新订阅 SSE 看续询进度（重启自动续询也能再接管）。
  await prisma.generationRecord.update({
    where: { id: rec.id },
    data: { status: 'RUNNING', finishedAt: null, errorMessage: null },
  })

  const task: RunningGenerationTask = {
    recordId: rec.id,
    userId: rec.userId,
    type: 'video',
    strategyKey: 'video',
    abortController: new AbortController(),
    associationNo,
    billedEndpointType: 'video',
    billedPointCost,
    billedProviderId: String(videoTask.providerId || ''),
    billedModelKey: String(videoTask.modelKey || rec.modelKey || ''),
    billedModelName: String(videoTask.billedModelName || ''),
    refundCommitted: false,
    concurrencySlots: [],
    resumeVideoTask: nextVideoTask,
  }
  setLocalRunningTask(task)
  logGenerationTask('task_requery:manual_video', { recordId: rec.id, taskNo: videoTask.taskNo, resumeCount: nextVideoTask.resumeCount })
  runTaskInBackground(task, buildResumePayload(rec, videoTask))

  return getGenerationRecordById(id, userId)
}

// image 任务不可续询（单次请求执行），崩在途会卡 RUNNING 且不退款；启动时一律回收。
const reapInflightImageTasks = async () => {
  const records = await prisma.generationRecord.findMany({
    where: { type: 'IMAGE', status: { in: ['PENDING', 'RUNNING'] }, finishedAt: null },
    select: { id: true, userId: true },
  })
  for (const rec of records) {
    if (getLocalRunningTask(rec.id)) continue
    await reapAbandonedTask(rec.id, rec.userId, '服务重启，任务已中断')
    logGenerationTask('task_resume:reap_image', { recordId: rec.id })
  }
}

// 启动钩子：扫描在途任务，恢复视频续询、回收孤儿。best-effort 全局扫描锁防多实例重复扫库；
// per-record 执行锁(runTaskWithExecutionLock)是去重的最终保证。
export const bootstrapTaskResume = async () => {
  try {
    let scanLock: Awaited<ReturnType<typeof acquireRedisLock>> = null
    if (isRedisEnabled()) {
      scanLock = await acquireRedisLock(redisKeys.cache('task-resume-scan', 'global'), 120_000)
      if (!scanLock) {
        logGenerationTask('task_resume:skip_other_instance', {})
        return
      }
    }
    try {
      await resumeInflightVideoTasks()
      await reapInflightImageTasks()
      logGenerationTask('task_resume:bootstrap_done', {})
    } finally {
      if (scanLock) await releaseRedisLock(scanLock)
    }
  } catch (error) {
    logGenerationTask('task_resume:bootstrap_failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

export { subscribeGenerationTaskStream }
