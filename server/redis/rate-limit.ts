import { REDIS_CONFIG, isRedisEnabled } from './config'
import { getRedisClient } from './client'
import { redisKeys } from './keys'

export interface RedisRateLimitResult {
  allowed: boolean
  key: string
  limit: number
  currentCount: number
  remaining: number
  retryAfterSeconds: number
  windowSeconds: number
}

// 先提供固定窗口限流，覆盖登录、提交任务、敏感后台接口等高频场景。
export const consumeFixedWindowRateLimit = async (input: {
  scope: string
  identifier: string
  limit?: number
  windowSeconds?: number
  // 当 Redis 已启用但暂时不可达时，是否"拒绝"(fail-closed)。
  // 登录/验证码等安全敏感场景应设 true：宁可短暂拒绝，也不要在 Redis 抖动时放开爆破/盗刷限流。
  // 默认 false：Redis 未启用(单实例)时一律放行，不影响可用性。
  failClosedOnUnavailable?: boolean
}): Promise<RedisRateLimitResult> => {
  const limit = input.limit || REDIS_CONFIG.taskSubmitRateLimit
  const windowSeconds = input.windowSeconds || REDIS_CONFIG.rateLimitWindowSeconds
  const key = redisKeys.rateLimit(input.scope, input.identifier)

  const allowResult: RedisRateLimitResult = {
    allowed: true,
    key,
    limit,
    currentCount: 1,
    remaining: Math.max(limit - 1, 0),
    retryAfterSeconds: 0,
    windowSeconds,
  }

  // Redis 未启用 = 有意的单实例部署，限流降级放行。
  if (!isRedisEnabled()) {
    return allowResult
  }

  const client = await getRedisClient()
  if (!client) {
    // Redis 启用但不可达：安全敏感场景 fail-closed(拒绝)，其余沿用放行。
    if (input.failClosedOnUnavailable) {
      return {
        ...allowResult,
        allowed: false,
        currentCount: limit + 1,
        remaining: 0,
        retryAfterSeconds: windowSeconds,
      }
    }
    return allowResult
  }

  const result = await client.eval(
    `
      local current = redis.call("incr", KEYS[1])
      if current == 1 then
        redis.call("expire", KEYS[1], ARGV[1])
      end
      local ttl = redis.call("ttl", KEYS[1])
      return {current, ttl}
    `,
    1,
    key,
    String(windowSeconds),
  ) as [number, number]

  const currentCount = Number(result?.[0] || 0)
  const retryAfterSeconds = Math.max(Number(result?.[1] || 0), 0)

  return {
    allowed: currentCount <= limit,
    key,
    limit,
    currentCount,
    remaining: Math.max(limit - currentCount, 0),
    retryAfterSeconds,
    windowSeconds,
  }
}
