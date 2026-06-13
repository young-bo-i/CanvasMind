import type { GenerationRecordPayload } from '../generation-records/shared'
import type { LocalRunningGenerationTask } from './local-runtime'
import type { GenerationTaskStartPayload, GenerationTaskStreamEvent } from './shared'
import type { GenerationTaskStrategyKey } from './strategy'
import type { AgentRunState } from '../../src/types/agent'
import { GenerationTaskRequestError } from './shared'
import { readCapabilityFlagsFromRequestBody, type ModelCapabilityFlags } from '../../src/shared/provider-capability'

type RunningGenerationTask = LocalRunningGenerationTask & {
  strategyKey: GenerationTaskStrategyKey
}

type ConcurrencySlot = {
  scope: 'user' | 'skill' | 'provider'
  key: string
  limit: number
  currentCount: number
}

type CreatedRecord = {
  id: string
  type: string
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
  done: boolean
  stopped?: boolean
  images?: string[]
  agentRun?: AgentRunState | null
}

type BillingDetail = {
  pointCost: number
  modelName: string
}

interface TaskLifecycleContext {
  resolveGenerationTaskStrategy: (payload: GenerationTaskStartPayload) => {
    key: GenerationTaskStrategyKey
  }
  buildTaskSubmissionIdempotencyKey: (input: {
    userId: string
    strategyKey: string
    providerId: string
    modelKey: string
    skill: string
    prompt: string
    requestMode: string
    referenceImages: string[]
    requestBody: Record<string, unknown> | null
  }) => string
  claimIdempotencyKey: <T>(key: string) => Promise<{
    state: 'completed' | 'in_progress' | 'claimed'
    data?: T
    token: string
  }>
  completeIdempotencyKey: (key: string, token: string, data: { recordId: string }) => Promise<void>
  clearPendingIdempotencyKey: (key: string, token: string) => Promise<void>
  getGenerationRecordById: (recordId: string, currentUserId: string) => Promise<CreatedRecord>
  createGenerationRecord: (payload: GenerationRecordPayload, currentUserId: string) => Promise<CreatedRecord>
  updateGenerationRecord: (recordId: string, payload: GenerationRecordPayload, currentUserId: string) => Promise<void>
  attachGenerationPointRecordId: (input: {
    associationNo: string
    userId: string
    generationRecordId: string
  }) => Promise<void>
  resolveGenerationPointCost: (input: {
    providerId: string
    modelKey: string
    endpointType: 'chat' | 'image' | 'video'
    capabilityFlags?: ModelCapabilityFlags | null
    // 视频按秒计费：时长秒数，power 视为「每秒积分」。
    durationSeconds?: number
    // 图片按张计费：本次出图张数，power 视为「每张积分」。
    imageCount?: number
    // 会员折扣倍率（0,1]。
    membershipMultiplier?: number
  }) => Promise<BillingDetail>
  // 会员折扣倍率（0,1]，无有效会员为 1。
  getMembershipBillingMultiplier: (userId: string) => Promise<number>
  // 模型按会员等级解锁校验：返回是否允许 + 需要的等级名。
  checkUserModelMembershipAccess: (input: {
    userId: string
    providerId: string
    modelKey: string
    endpointType: 'chat' | 'image' | 'video'
  }) => Promise<{ allowed: boolean; requiredLevelNames: string[] }>
  consumeGenerationPoints: (input: {
    userId: string
    pointCost: number
    sourceId: string
    associationNo: string
    endpointType: 'chat' | 'image' | 'video'
    providerId: string
    modelKey: string
    modelName: string
    metaJson: Record<string, unknown>
    // 预扣幂等键:Redis 幂等失效(降级)时由 DB 唯一约束兜底,防止重复扣费。
    dedupeKey?: string
  }) => Promise<unknown>
  // 任务创建链路失败时的退款(与后台退款同源 dedupeKey,幂等互斥)。
  refundGenerationPoints: (input: {
    userId: string
    pointCost: number
    sourceId: string
    associationNo: string
    endpointType: 'chat' | 'image' | 'video'
    providerId: string
    modelKey: string
    modelName?: string
    dedupeKey?: string
    remark?: string
    metaJson?: Record<string, unknown>
  }) => Promise<unknown>
  // 基于幂等键 + 时间桶构造预扣 dedupeKey(时间桶与幂等窗口对齐,过窗后可再次生成)。
  buildConsumeDedupeKey: (idempotencyKey: string) => string
  acquireTaskConcurrencySlots: (input: {
    userId: string
    providerId: string
    skillKey: string
  }) => Promise<ConcurrencySlot[]>
  releaseTaskConcurrencySlots: (slots: ConcurrencySlot[]) => Promise<void>
  buildAgentPendingRun: (
    recordId: string,
    query: string,
    skill: string,
    referenceImages?: string[],
  ) => AgentRunState
  buildGatewayAssociationNo: () => string
  setLocalRunningTask: (task: RunningGenerationTask) => void
  syncSharedTaskRuntime: (
    task: RunningGenerationTask,
    status: 'queued' | 'running' | 'completed' | 'failed' | 'stopped',
    extra?: Record<string, unknown>,
  ) => Promise<void>
  emitTaskStreamEvent: (recordId: string, event: GenerationTaskStreamEvent) => void
  logGenerationTask: (stage: string, detail: Record<string, unknown>) => void
  runTaskInBackground: (task: RunningGenerationTask, payload: GenerationTaskStartPayload) => void
  resolveTaskRecordSnapshot: (recordId: string, currentUserId: string) => Promise<any>
  getLocalRunningTask: (recordId: string) => RunningGenerationTask | undefined
  getSharedTaskRuntime: (recordId: string) => Promise<{
    status?: string
  } | null>
  markSharedTaskAbortRequested: (recordId: string) => Promise<void>
  abortTaskWithReason: (task: RunningGenerationTask, reason: 'user_stop') => void
}

export const buildInitialRecordPayload = (payload: GenerationTaskStartPayload): GenerationRecordPayload => ({
  sessionId: String(payload.sessionId || '').trim() || undefined,
  source: String(payload.source || 'generate').trim() || 'generate',
  type: payload.type === 'research' || String(payload.skill || '').trim() === 'research-report'
    ? 'research'
    : payload.type,
  prompt: String(payload.prompt || '').trim(),
  content: '',
  error: '',
  model: String(payload.model || '').trim(),
  modelKey: String(payload.modelKey || '').trim(),
  ratio: String(payload.ratio || '').trim(),
  resolution: String(payload.resolution || '').trim(),
  duration: String(payload.duration || '').trim(),
  feature: String(payload.feature || '').trim(),
  skill: String(payload.skill || '').trim() || 'general',
  referenceImages: Array.isArray(payload.referenceImages) ? [...payload.referenceImages] : [],
  done: false,
  stopped: false,
  images: [],
})

const buildGenerationTaskIdempotencyKey = (
  payload: GenerationTaskStartPayload,
  userId: string,
  strategyKey: string,
  providerId: string,
  modelKey: string,
  context: TaskLifecycleContext,
) => {
  return context.buildTaskSubmissionIdempotencyKey({
    userId,
    strategyKey,
    providerId,
    modelKey,
    skill: String(payload.skill || '').trim(),
    prompt: String(payload.prompt || '').trim(),
    requestMode: String(payload.requestMode || '').trim(),
    referenceImages: Array.isArray(payload.referenceImages) ? payload.referenceImages : [],
    requestBody: payload.requestBody || null,
  })
}

const resolveTaskSkillKey = (payload: GenerationTaskStartPayload, strategyKey: GenerationTaskStrategyKey) => {
  return String(payload.skill || '').trim() || strategyKey || 'general'
}

// 视频按秒计费：从 "5s" / "5" / "5.0s" 解析出时长秒数，喂给 resolveGenerationPointCost。
// 解析失败返回 0，计费侧会退化为按次（乘数 1）。
const parseBilledDurationSeconds = (raw: unknown): number => {
  const matched = String(raw ?? '').match(/\d+(\.\d+)?/)
  const seconds = matched ? Number(matched[0]) : 0
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0
}

const resolveTaskBillingTarget = (
  payload: GenerationTaskStartPayload,
  strategyKey: GenerationTaskStrategyKey,
) => {
  const providerId = String((payload.requestBody || {}).providerId || '').trim()
  const modelKey = String(payload.modelKey || '').trim()
  const isImageTask = strategyKey === 'image'
  const isVideoTask = strategyKey === 'video'

  if (!providerId) {
    throw new GenerationTaskRequestError(400, '未匹配到后台模型配置，请先在后台配置可用模型')
  }

  if (!modelKey) {
    throw new GenerationTaskRequestError(
      400,
      isVideoTask ? '缺少视频模型标识' : isImageTask ? '缺少图片模型标识' : '缺少对话模型标识',
    )
  }

  return {
    providerId,
    modelKey,
  }
}

export const startGenerationTask = async (
  payload: GenerationTaskStartPayload,
  currentUserId: string,
  context: TaskLifecycleContext,
) => {
  const strategy = context.resolveGenerationTaskStrategy(payload)
  const { providerId, modelKey } = resolveTaskBillingTarget(payload, strategy.key)
  const skillKey = resolveTaskSkillKey(payload, strategy.key)
  // 解析前端塞入的能力开关（联网搜索/深度思考），用于计费倍率联动。
  // 仅 agent-chat 链路读取；image / agent-workspace 暂时不接 capability 计费。
  const capabilityFlags = readCapabilityFlagsFromRequestBody(payload.requestBody)
  const idempotencyKey = buildGenerationTaskIdempotencyKey(
    payload,
    currentUserId,
    strategy.key,
    providerId,
    modelKey,
    context,
  )
  const idempotencyClaim = await context.claimIdempotencyKey<{ recordId?: string }>(idempotencyKey)

  if (idempotencyClaim.state === 'completed' && idempotencyClaim.data?.recordId) {
    return context.getGenerationRecordById(String(idempotencyClaim.data.recordId), currentUserId)
  }

  if (idempotencyClaim.state === 'in_progress') {
    throw new GenerationTaskRequestError(409, '检测到相同任务正在处理中，请稍候查看结果')
  }

  // 计费口径：image/video 各自，其余(对话/工作台/研究)按 chat。
  const billedEndpointType: 'chat' | 'image' | 'video' = strategy.key === 'image'
    ? 'image'
    : strategy.key === 'video'
      ? 'video'
      : 'chat'

  // 模型按会员等级解锁校验：未满足直接 403，不进入扣费与执行。
  const modelAccess = await context.checkUserModelMembershipAccess({
    userId: currentUserId,
    providerId,
    modelKey,
    endpointType: billedEndpointType,
  })
  if (!modelAccess.allowed) {
    throw new GenerationTaskRequestError(
      403,
      `该模型仅限 ${modelAccess.requiredLevelNames.join(' / ') || '指定'} 会员使用，请先开通对应会员`,
    )
  }

  // 会员折扣倍率：乘进本次扣点（含预扣与结算）。
  const membershipMultiplier = await context.getMembershipBillingMultiplier(currentUserId)

  // 预扣 dedupeKey:Redis 幂等降级时由 DB 唯一约束兜底,防重复扣费(H2)。
  const consumeDedupeKey = context.buildConsumeDedupeKey(idempotencyKey)

  let concurrencySlots: ConcurrencySlot[] = []
  // 已成功预扣的费用快照:任务进入后台前的任意步骤(建记录/attach/完成幂等)失败时,
  // 由 catch 据此幂等退款,杜绝「扣了钱但没产出也没退款」(H1)。
  let committedCharge: {
    associationNo: string
    pointCost: number
    endpointType: 'chat' | 'image' | 'video'
    providerId: string
    modelKey: string
    modelName?: string
  } | null = null

  try {
    if (strategy.key === 'agent-chat' || strategy.key === 'research-report') {
      concurrencySlots = await context.acquireTaskConcurrencySlots({
        userId: currentUserId,
        providerId,
        skillKey,
      })

      const billingDetail = await context.resolveGenerationPointCost({
        providerId,
        modelKey,
        endpointType: 'chat',
        capabilityFlags,
        membershipMultiplier,
      })
      const associationNo = context.buildGatewayAssociationNo()
      const pointLog = billingDetail.pointCost > 0
        ? await context.consumeGenerationPoints({
          userId: currentUserId,
          pointCost: billingDetail.pointCost,
          sourceId: associationNo,
          associationNo,
          endpointType: 'chat',
          providerId,
          modelKey,
          modelName: billingDetail.modelName,
          dedupeKey: consumeDedupeKey,
          metaJson: {
            source: 'generation-task',
            taskType: strategy.key,
          },
        })
        : null
      if (pointLog) {
        committedCharge = { associationNo, pointCost: billingDetail.pointCost, endpointType: 'chat', providerId, modelKey, modelName: billingDetail.modelName }
      }

      const createdRecord = await context.createGenerationRecord(buildInitialRecordPayload(payload), currentUserId)
      await context.attachGenerationPointRecordId({
        associationNo,
        userId: currentUserId,
        generationRecordId: createdRecord.id,
      })
      await context.completeIdempotencyKey(idempotencyKey, idempotencyClaim.token, {
        recordId: createdRecord.id,
      })

      const task: RunningGenerationTask = {
        recordId: createdRecord.id,
        userId: currentUserId,
        type: payload.type,
        strategyKey: strategy.key,
        abortController: new AbortController(),
        associationNo,
        billedEndpointType: 'chat',
        billedPointCost: pointLog ? billingDetail.pointCost : 0,
        billedProviderId: providerId,
        billedModelKey: modelKey,
        billedModelName: billingDetail.modelName || String(payload.model || '').trim(),
        refundCommitted: false,
        concurrencySlots,
      }

      context.setLocalRunningTask(task)
      await context.syncSharedTaskRuntime(task, 'queued', { skillKey })
      context.emitTaskStreamEvent(createdRecord.id, {
        type: 'progress',
        recordId: createdRecord.id,
        done: false,
        stopped: false,
        record: createdRecord,
        stage: 'queued',
        message: '任务已创建，等待服务端执行',
      })
      context.logGenerationTask('task_created', {
        recordId: createdRecord.id,
        userId: currentUserId,
        type: payload.type,
        strategyKey: strategy.key,
        providerId,
        modelKey,
      })
      context.runTaskInBackground(task, payload)
      return createdRecord
    }

    if (strategy.key === 'agent-workspace') {
      concurrencySlots = await context.acquireTaskConcurrencySlots({
        userId: currentUserId,
        providerId,
        skillKey,
      })

      const billingDetail = await context.resolveGenerationPointCost({
        providerId,
        modelKey,
        endpointType: 'chat',
        capabilityFlags,
        membershipMultiplier,
      })
      const associationNo = context.buildGatewayAssociationNo()
      const pointLog = billingDetail.pointCost > 0
        ? await context.consumeGenerationPoints({
          userId: currentUserId,
          pointCost: billingDetail.pointCost,
          sourceId: associationNo,
          associationNo,
          endpointType: 'chat',
          providerId,
          modelKey,
          modelName: billingDetail.modelName,
          dedupeKey: consumeDedupeKey,
          metaJson: {
            source: 'generation-task',
            taskType: 'agent-workspace',
            skill: String(payload.skill || '').trim(),
          },
        })
        : null
      if (pointLog) {
        committedCharge = { associationNo, pointCost: billingDetail.pointCost, endpointType: 'chat', providerId, modelKey, modelName: billingDetail.modelName }
      }

      const initialPayload = {
        ...buildInitialRecordPayload(payload),
        agentRun: context.buildAgentPendingRun(
          `record-${Date.now()}`,
          String(payload.prompt || '').trim(),
          String(payload.skill || '').trim() || 'general',
          Array.isArray(payload.referenceImages) ? payload.referenceImages : [],
        ),
      } satisfies GenerationRecordPayload
      const createdRecord = await context.createGenerationRecord(initialPayload, currentUserId)
      await context.attachGenerationPointRecordId({
        associationNo,
        userId: currentUserId,
        generationRecordId: createdRecord.id,
      })
      await context.completeIdempotencyKey(idempotencyKey, idempotencyClaim.token, {
        recordId: createdRecord.id,
      })

      const task: RunningGenerationTask = {
        recordId: createdRecord.id,
        userId: currentUserId,
        type: 'agent',
        strategyKey: strategy.key,
        abortController: new AbortController(),
        associationNo,
        billedEndpointType: 'chat',
        billedPointCost: pointLog ? billingDetail.pointCost : 0,
        billedProviderId: providerId,
        billedModelKey: modelKey,
        billedModelName: billingDetail.modelName || String(payload.model || '').trim(),
        refundCommitted: false,
        concurrencySlots,
      }

      context.setLocalRunningTask(task)
      await context.syncSharedTaskRuntime(task, 'queued', { skillKey })
      context.emitTaskStreamEvent(createdRecord.id, {
        type: 'progress',
        recordId: createdRecord.id,
        done: false,
        stopped: false,
        record: createdRecord,
        stage: 'queued',
        message: '技能任务已创建，等待服务端执行',
      })
      context.logGenerationTask('task_created', {
        recordId: createdRecord.id,
        userId: currentUserId,
        type: payload.type,
        strategyKey: strategy.key,
        skill: payload.skill,
        modelKey: payload.modelKey,
      })
      context.runTaskInBackground(task, payload)
      return createdRecord
    }

    if (strategy.key === 'video') {
      concurrencySlots = await context.acquireTaskConcurrencySlots({
        userId: currentUserId,
        providerId,
        skillKey,
      })

      // 视频按秒计费：解析时长秒数，power 视为「每秒积分」，扣费 = power × 秒数 × 能力倍率。
      const durationSeconds = parseBilledDurationSeconds(payload.duration)
      const billingDetail = await context.resolveGenerationPointCost({
        providerId,
        modelKey,
        endpointType: 'video',
        durationSeconds,
        membershipMultiplier,
      })
      const associationNo = context.buildGatewayAssociationNo()
      const pointLog = billingDetail.pointCost > 0
        ? await context.consumeGenerationPoints({
          userId: currentUserId,
          pointCost: billingDetail.pointCost,
          sourceId: associationNo,
          associationNo,
          endpointType: 'video',
          providerId,
          modelKey,
          modelName: billingDetail.modelName,
          dedupeKey: consumeDedupeKey,
          metaJson: {
            source: 'generation-task',
            taskType: 'video',
            durationSeconds: durationSeconds || undefined,
          },
        })
        : null
      if (pointLog) {
        committedCharge = { associationNo, pointCost: billingDetail.pointCost, endpointType: 'video', providerId, modelKey, modelName: billingDetail.modelName }
      }

      const createdRecord = await context.createGenerationRecord(buildInitialRecordPayload(payload), currentUserId)
      await context.attachGenerationPointRecordId({
        associationNo,
        userId: currentUserId,
        generationRecordId: createdRecord.id,
      })
      await context.completeIdempotencyKey(idempotencyKey, idempotencyClaim.token, {
        recordId: createdRecord.id,
      })

      const task: RunningGenerationTask = {
        recordId: createdRecord.id,
        userId: currentUserId,
        type: 'video',
        strategyKey: strategy.key,
        abortController: new AbortController(),
        associationNo,
        billedEndpointType: 'video',
        billedPointCost: pointLog ? billingDetail.pointCost : 0,
        billedProviderId: providerId,
        billedModelKey: modelKey,
        billedModelName: billingDetail.modelName,
        refundCommitted: false,
        concurrencySlots,
      }

      context.setLocalRunningTask(task)
      await context.syncSharedTaskRuntime(task, 'queued', { skillKey })
      context.emitTaskStreamEvent(createdRecord.id, {
        type: 'progress',
        recordId: createdRecord.id,
        done: false,
        stopped: false,
        record: createdRecord,
        stage: 'queued',
        message: '视频任务已创建，等待服务端执行',
      })
      context.logGenerationTask('task_created', {
        recordId: createdRecord.id,
        userId: currentUserId,
        type: payload.type,
        strategyKey: strategy.key,
        providerId,
        modelKey,
      })
      context.runTaskInBackground(task, payload)
      return createdRecord
    }

    concurrencySlots = await context.acquireTaskConcurrencySlots({
      userId: currentUserId,
      providerId,
      skillKey,
    })

    // 图片按张计费：从 requestBody.count / n 取本次出图张数（计费函数会按 maxImagesPerRequest 再 clamp）。
    const imageRequestBody = (payload.requestBody || {}) as Record<string, unknown>
    const imageCount = Math.max(1, Math.floor(Number(imageRequestBody.count ?? imageRequestBody.n) || 1))
    const billingDetail = await context.resolveGenerationPointCost({
      providerId,
      modelKey,
      endpointType: 'image',
      imageCount,
      membershipMultiplier,
    })
    const associationNo = context.buildGatewayAssociationNo()
    const pointLog = billingDetail.pointCost > 0
      ? await context.consumeGenerationPoints({
        userId: currentUserId,
        pointCost: billingDetail.pointCost,
        sourceId: associationNo,
        associationNo,
        endpointType: 'image',
        providerId,
        modelKey,
        modelName: billingDetail.modelName,
        dedupeKey: consumeDedupeKey,
        metaJson: {
          source: 'generation-task',
          imageCount,
        },
      })
      : null
    if (pointLog) {
      committedCharge = { associationNo, pointCost: billingDetail.pointCost, endpointType: 'image', providerId, modelKey, modelName: billingDetail.modelName }
    }

    const createdRecord = await context.createGenerationRecord(buildInitialRecordPayload(payload), currentUserId)
    await context.attachGenerationPointRecordId({
      associationNo,
      userId: currentUserId,
      generationRecordId: createdRecord.id,
    })
    await context.completeIdempotencyKey(idempotencyKey, idempotencyClaim.token, {
      recordId: createdRecord.id,
    })

    const task: RunningGenerationTask = {
      recordId: createdRecord.id,
      userId: currentUserId,
      type: 'image',
      strategyKey: strategy.key,
      abortController: new AbortController(),
      associationNo,
      billedEndpointType: 'image',
      billedPointCost: pointLog ? billingDetail.pointCost : 0,
      billedProviderId: providerId,
      billedModelKey: modelKey,
      billedModelName: billingDetail.modelName,
      refundCommitted: false,
      concurrencySlots,
    }

    context.setLocalRunningTask(task)
    await context.syncSharedTaskRuntime(task, 'queued', { skillKey })
    context.emitTaskStreamEvent(createdRecord.id, {
      type: 'progress',
      recordId: createdRecord.id,
      done: false,
      stopped: false,
      record: createdRecord,
      stage: 'queued',
      message: '任务已创建，等待服务端执行',
    })
    context.logGenerationTask('task_created', {
      recordId: createdRecord.id,
      userId: currentUserId,
      type: payload.type,
      strategyKey: strategy.key,
      providerId,
      modelKey,
    })
    context.runTaskInBackground(task, payload)
    return createdRecord
  } catch (error) {
    // H1:扣费成功但任务未进入后台(建记录/attach/完成幂等失败)→ 幂等退款,杜绝无主扣费。
    // dedupeKey 与后台 refundTaskPointsIfNeeded 同源(gen-refund:associationNo),互斥不会重复退。
    if (committedCharge) {
      try {
        await context.refundGenerationPoints({
          userId: currentUserId,
          pointCost: committedCharge.pointCost,
          sourceId: committedCharge.associationNo,
          associationNo: committedCharge.associationNo,
          endpointType: committedCharge.endpointType,
          providerId: committedCharge.providerId,
          modelKey: committedCharge.modelKey,
          modelName: committedCharge.modelName,
          dedupeKey: `gen-refund:${committedCharge.associationNo}`,
          remark: '任务创建失败，积分已退回',
          metaJson: { refundReason: 'task_setup_failed' },
        })
      } catch (refundError) {
        // 退款失败仅记录,不能吞掉原始错误(尤其 INSUFFICIENT_POINTS 的 code 需冒泡)。
        context.logGenerationTask('task_setup_refund_failed', {
          associationNo: committedCharge.associationNo,
          userId: currentUserId,
          errorMessage: refundError instanceof Error ? refundError.message : String(refundError || ''),
        })
      }
    }
    if (concurrencySlots.length) {
      await context.releaseTaskConcurrencySlots(concurrencySlots)
    }
    await context.clearPendingIdempotencyKey(idempotencyKey, idempotencyClaim.token)
    throw error
  }
}

export const getGenerationTaskRecord = async (
  recordId: string,
  currentUserId: string,
  context: TaskLifecycleContext,
) => {
  return context.resolveTaskRecordSnapshot(recordId, currentUserId)
}

export const stopGenerationTask = async (
  recordId: string,
  currentUserId: string,
  context: TaskLifecycleContext,
) => {
  const task = context.getLocalRunningTask(recordId)

  if (task) {
    if (task.userId !== currentUserId) {
      throw new Error('无权停止当前生成任务')
    }
    context.abortTaskWithReason(task, 'user_stop')
  } else {
    const sharedRuntime = await context.getSharedTaskRuntime(recordId)
    if (sharedRuntime?.status === 'running') {
      await context.markSharedTaskAbortRequested(recordId)
      return context.getGenerationRecordById(recordId, currentUserId)
    }

    const currentRecord = await context.getGenerationRecordById(recordId, currentUserId)
    if (currentRecord.done) {
      return currentRecord
    }

    await context.updateGenerationRecord(recordId, {
      type: currentRecord.type,
      prompt: currentRecord.prompt,
      content: currentRecord.content,
      error: '',
      model: currentRecord.model,
      modelKey: currentRecord.modelKey,
      ratio: currentRecord.ratio,
      resolution: currentRecord.resolution,
      duration: currentRecord.duration,
      feature: currentRecord.feature,
      skill: currentRecord.skill,
      done: true,
      stopped: true,
      images: currentRecord.images,
      agentRun: currentRecord.agentRun,
    }, currentUserId)
    const stoppedRecord = await context.getGenerationRecordById(recordId, currentUserId)
    context.emitTaskStreamEvent(recordId, {
      type: 'stopped',
      recordId,
      done: true,
      stopped: true,
      record: stoppedRecord,
      stage: 'stopped',
      message: '任务已停止',
    })
  }

  return context.getGenerationRecordById(recordId, currentUserId)
}
