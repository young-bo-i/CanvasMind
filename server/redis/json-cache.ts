import { REDIS_CONFIG, isRedisEnabled } from './config'
import { getRedisClient } from './client'
import { acquireRedisLock, releaseRedisLock } from './lock'
import { recordCacheHitMetric, recordCacheMissMetric, recordCacheWriteMetric } from './metrics'

interface JsonCacheOptions<T> {
  key: string
  ttlSeconds?: number
  factory: () => Promise<T>
}

// 防击穿(stampede)相关参数。
const CACHE_LOCK_TTL_MS = Number.parseInt(process.env.CACHE_STAMPEDE_LOCK_TTL_MS || '10000', 10)
const CACHE_WAIT_TOTAL_MS = Number.parseInt(process.env.CACHE_STAMPEDE_WAIT_MS || '1000', 10)
const CACHE_WAIT_POLL_MS = 50

// 进程内单飞：同一 key 同时多个 miss 时只让一个真正回源，其余复用同一 Promise。
const inflightFactories = new Map<string, Promise<unknown>>()

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// 没抢到回源锁时，轮询等待别的实例把缓存写好。
const waitForCachePopulated = async <T>(key: string, totalMs: number): Promise<T | null> => {
  const deadline = Date.now() + totalMs
  while (Date.now() < deadline) {
    await sleep(CACHE_WAIT_POLL_MS)
    const value = await readJsonCache<T>(key)
    if (value !== null) return value
  }
  return null
}

export const readJsonCache = async <T>(key: string): Promise<T | null> => {
  if (!isRedisEnabled()) {
    return null
  }

  const client = await getRedisClient()
  if (!client) {
    return null
  }

  const cachedValue = await client.get(key)
  if (!cachedValue) {
    return null
  }

  return JSON.parse(cachedValue) as T
}

export const writeJsonCache = async (key: string, value: unknown, ttlSeconds = REDIS_CONFIG.defaultTtlSeconds) => {
  if (!isRedisEnabled()) {
    return
  }

  const serializedValue = JSON.stringify(value)
  const client = await getRedisClient()
  if (!client) {
    return
  }

  await client.set(key, serializedValue, 'EX', ttlSeconds)
  await recordCacheWriteMetric(key, Buffer.byteLength(serializedValue))
}

export const deleteJsonCache = async (key: string) => {
  if (!isRedisEnabled()) {
    return
  }

  const client = await getRedisClient()
  if (!client) {
    return
  }

  await client.del(key)
}

// 统一封装“先读缓存，没有再回源”的通用读法。
// 防击穿：进程内单飞 + 跨实例 Redis 短锁，避免热点 key 失效瞬间大量请求同时回源压垮 DB。
export const getOrSetJsonCache = async <T>(options: JsonCacheOptions<T>): Promise<T> => {
  const cachedValue = await readJsonCache<T>(options.key)
  if (cachedValue !== null) {
    await recordCacheHitMetric(options.key)
    return cachedValue
  }

  await recordCacheMissMetric(options.key)

  // 进程内单飞：本进程已有同 key 回源在途时直接复用，避免本机内并发回源。
  const existing = inflightFactories.get(options.key)
  if (existing) {
    return existing as Promise<T>
  }

  const run = (async (): Promise<T> => {
    // 跨实例防击穿：尽量先拿短锁；拿不到说明别的实例在回源，轮询等待其写好缓存；
    // 等待超时仍无则自行回源(避免无限等待)。Redis 未启用时 lock 为 null，退化为仅进程内单飞。
    const lock = await acquireRedisLock(`lock:cache:${options.key}`, CACHE_LOCK_TTL_MS)
    try {
      if (!lock && isRedisEnabled()) {
        const waited = await waitForCachePopulated<T>(options.key, CACHE_WAIT_TOTAL_MS)
        if (waited !== null) return waited
      }
      const freshValue = await options.factory()
      await writeJsonCache(options.key, freshValue, options.ttlSeconds)
      return freshValue
    } finally {
      if (lock) await releaseRedisLock(lock)
    }
  })()

  inflightFactories.set(options.key, run)
  try {
    return await run
  } finally {
    inflightFactories.delete(options.key)
  }
}
