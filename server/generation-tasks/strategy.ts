import type { GenerationTaskStartPayload } from './shared'

export type GenerationTaskStrategyKey = 'image' | 'video'

export interface GenerationTaskStrategy {
  key: GenerationTaskStrategyKey
  matches: (payload: GenerationTaskStartPayload) => boolean
}

const strategies: GenerationTaskStrategy[] = [
  {
    key: 'image',
    matches: payload => String(payload.type || '').trim() === 'image',
  },
  {
    key: 'video',
    matches: payload => String(payload.type || '').trim() === 'video',
  },
]

export const resolveGenerationTaskStrategy = (payload: GenerationTaskStartPayload): GenerationTaskStrategy => {
  const strategy = strategies.find(item => item.matches(payload))
  if (!strategy) {
    throw new Error('未找到可用的生成任务策略')
  }
  return strategy
}
