import type { RateLimitCheck, RateLimitPolicyInput, RateLimitStore } from '#server/utils/rate-limit'

/** What a raw Redis INCR round trip reports back. `ttlMs` is the key's remaining TTL, read in the same round trip (see `redis-client.ts`'s Lua script) so no second command is needed. */
export interface RedisIncrResult {
    count: number
    ttlMs: number
}

/** The one thing this file needs from Redis. Deliberately not an `ioredis` import, so the breaker below is testable with a fake; `redis-client.ts` supplies the real one. */
export type RedisIncrFn = (key: string, windowMs: number) => Promise<RedisIncrResult>

export interface CircuitBreakerOptions {
    /** How long the breaker stays open before the next call probes Redis again. Default 30s: long enough not to hammer a struggling Redis, short enough to notice a real recovery. */
    openMs?: number
    /** Injectable clock, so tests drive the breaker's timing without real waits. */
    now?: () => number
}

const DEFAULT_BREAKER_OPEN_MS = 30_000

/**
 * Breaker, not per-request fallthrough: a wedged Redis would otherwise make every request pay `commandTimeout`, so the accelerator ends up
 * slower than no Redis at all. Accepted cost: the two stores count independently, so one flip can let through up to 2x `max` once, unattackable.
 */
export function createRedisRateLimitStore(
    incr: RedisIncrFn,
    fallback: RateLimitStore,
    opts: CircuitBreakerOptions = {},
): RateLimitStore {
    const openMs = opts.openMs ?? DEFAULT_BREAKER_OPEN_MS
    const now = opts.now ?? Date.now
    // A liveness signal about Redis from THIS process, never rate-limit state, so it needs no cross-replica
    // coordination. Closure-scoped, not module-scoped, so tests can run independent breakers side by side.
    let breakerOpenUntil = 0

    return async function redisRateLimitCheck(
        key: string,
        policy: RateLimitPolicyInput,
    ): Promise<RateLimitCheck> {
        const t = now()
        if (t < breakerOpenUntil) {
            // Breaker open: skip Redis entirely. This is the point of a breaker over a per-request fallback; no timeout is paid.
            return fallback(key, policy)
        }
        try {
            const { count, ttlMs } = await incr(key, policy.windowMs)
            breakerOpenUntil = 0 // a half-open probe's win must actually close the breaker
            const resetAt = t + (ttlMs > 0 ? ttlMs : policy.windowMs)
            return { allowed: count <= policy.max, resetAt }
        } catch {
            breakerOpenUntil = t + openMs
            return fallback(key, policy)
        }
    }
}
