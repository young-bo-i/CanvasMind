import type { GenerationTaskStartPayload, GenerationTaskStreamEvent } from './shared'
import type { GenerationRecordPayload } from '../generation-records/shared'
import type { GenerationTaskStrategyKey } from './strategy'
import { isGenerationTimeoutError } from '../../src/shared/generation-error'

export type TaskAbortReason = 'user_stop' | 'shared_stop' | 'execution_lock_lost'

type SettlementTask = {
  recordId: string
  userId: string
  strategyKey: string
}

type SettlementRecord = Record<string, unknown> & {
  content?: string
}

type EmitTaskProgressEvent = (recordId: string, event: {
  stage: string
  stopped?: boolean
  message?: string
}) => void

type EmitTaskStreamEvent = (recordId: string, event: GenerationTaskStreamEvent) => void

export interface GenerationTaskExecutionStrategyContext {
  executeImageGenerationTask: (task: SettlementTask, payload: GenerationTaskStartPayload) => Promise<void>
  executeVideoGenerationTask: (task: SettlementTask, payload: GenerationTaskStartPayload) => Promise<void>
  refundTaskPointsIfNeeded: (task: SettlementTask, reason: string) => Promise<void>
  markTaskExecutionState: (task: SettlementTask, input: {
    lastErrorAt?: string
    lastErrorMessage?: string
  }) => Promise<void>
  emitTaskProgressEvent: EmitTaskProgressEvent
  emitTaskStreamEvent: EmitTaskStreamEvent
  buildInitialRecordPayload: (payload: GenerationTaskStartPayload) => GenerationRecordPayload
  updateGenerationRecord: (recordId: string, payload: GenerationRecordPayload, currentUserId: string) => Promise<void>
  getGenerationRecordById: (recordId: string, currentUserId: string) => Promise<SettlementRecord>
  syncSharedTaskRuntime: (task: SettlementTask, status: 'stopped' | 'failed') => Promise<void>
  normalizeGenerationErrorMessage: (error: unknown, fallbackMessage: string) => string
  logGenerationTask: (stage: string, detail: Record<string, unknown>) => void
  logGenerationTaskError: (stage: string, error: unknown, detail: Record<string, unknown>) => void
}

export interface GenerationTaskExecutionStrategy {
  key: GenerationTaskStrategyKey
  execute: (
    task: SettlementTask,
    payload: GenerationTaskStartPayload,
    context: GenerationTaskExecutionStrategyContext,
  ) => Promise<void>
  handleStopped: (
    task: SettlementTask,
    payload: GenerationTaskStartPayload,
    context: GenerationTaskExecutionStrategyContext,
  ) => Promise<void>
  handleFailed: (
    task: SettlementTask,
    payload: GenerationTaskStartPayload,
    error: unknown,
    errorMessage: string,
    context: GenerationTaskExecutionStrategyContext,
  ) => Promise<void>
  resolveFailureMessage: (
    error: unknown,
    abortReason: TaskAbortReason | '',
    context: GenerationTaskExecutionStrategyContext,
  ) => string
}

// 图片/视频失败收口的退款策略：
//  - 真实异常（参数/审核/上游失败等）→ 照常退款；
//  - 我方轮询超时（GenerationTimeoutError）→ 【不退款】：先扣费已落账，且任务很可能仍在上游
//    处理中，用户可「重新查询」取回结果（完成后无退款记录则不补扣，幂等安全）。
const refundFailedTaskUnlessTimeout = async (
  task: SettlementTask,
  error: unknown,
  context: GenerationTaskExecutionStrategyContext,
) => {
  if (isGenerationTimeoutError(error)) {
    context.logGenerationTask('task_failed:timeout_no_refund', {
      recordId: task.recordId,
      userId: task.userId,
      strategyKey: task.strategyKey,
    })
    return
  }
  await context.refundTaskPointsIfNeeded(task, 'task_failed')
}

// 图片生成任务的收口逻辑相对固定，集中在这里，避免 service.ts 持续堆分支。
const imageTaskExecutionStrategy: GenerationTaskExecutionStrategy = {
  key: 'image',
  execute(task, payload, context) {
    return context.executeImageGenerationTask(task, payload)
  },
  async handleStopped(task, payload, context) {
    await context.refundTaskPointsIfNeeded(task, 'task_aborted')
    await context.markTaskExecutionState(task, {
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: '任务已收到停止指令',
    })
    context.emitTaskProgressEvent(task.recordId, {
      stage: 'stopping',
      stopped: true,
      message: '任务已收到停止指令，正在收口状态',
    })
    await context.updateGenerationRecord(task.recordId, {
      ...context.buildInitialRecordPayload(payload),
      done: true,
      stopped: true,
      error: '',
      images: [],
    }, task.userId)
    const stoppedRecord = await context.getGenerationRecordById(task.recordId, task.userId)
    await context.syncSharedTaskRuntime(task, 'stopped')
    context.emitTaskStreamEvent(task.recordId, {
      type: 'stopped',
      recordId: task.recordId,
      done: true,
      stopped: true,
      record: stoppedRecord,
      stage: 'stopped',
      message: '任务已停止',
    })
    context.logGenerationTask('image_task:stopped', {
      recordId: task.recordId,
      userId: task.userId,
    })
  },
  async handleFailed(task, payload, error, errorMessage, context) {
    await refundFailedTaskUnlessTimeout(task, error, context)
    await context.markTaskExecutionState(task, {
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: errorMessage,
    })
    context.emitTaskProgressEvent(task.recordId, {
      stage: 'failing',
      message: '任务执行异常，正在写入失败状态',
    })
    await context.updateGenerationRecord(task.recordId, {
      ...context.buildInitialRecordPayload(payload),
      done: true,
      stopped: false,
      error: errorMessage,
      images: [],
    }, task.userId)
    const failedRecord = await context.getGenerationRecordById(task.recordId, task.userId)
    await context.syncSharedTaskRuntime(task, 'failed')
    context.emitTaskStreamEvent(task.recordId, {
      type: 'failed',
      recordId: task.recordId,
      done: true,
      stopped: false,
      record: failedRecord,
      stage: 'failed',
      message: errorMessage,
    })
    context.logGenerationTaskError('image_task:failed', error, {
      recordId: task.recordId,
      userId: task.userId,
    })
  },
  resolveFailureMessage(error, abortReason, context) {
    if (abortReason === 'execution_lock_lost') {
      return '任务执行锁已失效，系统已中断本次生成'
    }

    return context.normalizeGenerationErrorMessage(error, '图片生成失败')
  },
}

// 视频生成任务：服务端 submit+poll，收口逻辑与图片一致（失败/中止自动退款）。
const videoTaskExecutionStrategy: GenerationTaskExecutionStrategy = {
  key: 'video',
  execute(task, payload, context) {
    return context.executeVideoGenerationTask(task, payload)
  },
  async handleStopped(task, payload, context) {
    await context.refundTaskPointsIfNeeded(task, 'task_aborted')
    await context.markTaskExecutionState(task, {
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: '任务已收到停止指令',
    })
    context.emitTaskProgressEvent(task.recordId, {
      stage: 'stopping',
      stopped: true,
      message: '任务已收到停止指令，正在收口状态',
    })
    await context.updateGenerationRecord(task.recordId, {
      ...context.buildInitialRecordPayload(payload),
      done: true,
      stopped: true,
      error: '',
      images: [],
      outputs: [],
    }, task.userId)
    const stoppedRecord = await context.getGenerationRecordById(task.recordId, task.userId)
    await context.syncSharedTaskRuntime(task, 'stopped')
    context.emitTaskStreamEvent(task.recordId, {
      type: 'stopped',
      recordId: task.recordId,
      done: true,
      stopped: true,
      record: stoppedRecord,
      stage: 'stopped',
      message: '任务已停止',
    })
    context.logGenerationTask('video_task:stopped', {
      recordId: task.recordId,
      userId: task.userId,
    })
  },
  async handleFailed(task, payload, error, errorMessage, context) {
    await refundFailedTaskUnlessTimeout(task, error, context)
    await context.markTaskExecutionState(task, {
      lastErrorAt: new Date().toISOString(),
      lastErrorMessage: errorMessage,
    })
    context.emitTaskProgressEvent(task.recordId, {
      stage: 'failing',
      message: '任务执行异常，正在写入失败状态',
    })
    await context.updateGenerationRecord(task.recordId, {
      ...context.buildInitialRecordPayload(payload),
      done: true,
      stopped: false,
      error: errorMessage,
      images: [],
      outputs: [],
    }, task.userId)
    const failedRecord = await context.getGenerationRecordById(task.recordId, task.userId)
    await context.syncSharedTaskRuntime(task, 'failed')
    context.emitTaskStreamEvent(task.recordId, {
      type: 'failed',
      recordId: task.recordId,
      done: true,
      stopped: false,
      record: failedRecord,
      stage: 'failed',
      message: errorMessage,
    })
    context.logGenerationTaskError('video_task:failed', error, {
      recordId: task.recordId,
      userId: task.userId,
    })
  },
  resolveFailureMessage(error, abortReason, context) {
    if (abortReason === 'execution_lock_lost') {
      return '任务执行锁已失效，系统已中断本次生成'
    }

    return context.normalizeGenerationErrorMessage(error, '视频生成失败')
  },
}

const EXECUTION_STRATEGY_REGISTRY: Record<GenerationTaskStrategyKey, GenerationTaskExecutionStrategy> = {
  image: imageTaskExecutionStrategy,
  video: videoTaskExecutionStrategy,
}

// 按策略键获取执行策略；当前优先承接停止/失败收口逻辑。
export const getGenerationTaskExecutionStrategy = (strategyKey: GenerationTaskStrategyKey) => {
  const strategy = EXECUTION_STRATEGY_REGISTRY[strategyKey]
  if (!strategy) {
    throw new Error('未找到对应的生成任务执行策略')
  }

  return strategy
}
