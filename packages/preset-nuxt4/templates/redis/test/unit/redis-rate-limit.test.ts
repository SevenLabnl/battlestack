import { describe, expect, it, vi } from 'vitest'
import { createRedisRateLimitStore } from '#server/utils/redis-rate-limit'
import type { RateLimitCheck, RateLimitPolicyInput } from '#server/utils/rate-limit'

/**
 * Pure logic test: `incr` and `fallback` are fakes, so every assertion is about the breaker's decisions, not either store's
 * correctness. It de-risks but does not replace an end-to-end run that kills a real Redis container mid-flight.
 */

const POLICY: RateLimitPolicyInput = { windowMs: 60_000, max: 3 }

function fakeClock(startAt = 0) {
    let t = startAt
    return {
        now: () => t,
        advance: (ms: number) => {
            t += ms
        },
    }
}

describe('createRedisRateLimitStore', () => {
    it('calls Redis while healthy and reports allowed/denied from its count', async () => {
        const incr = vi.fn(async (_key: string, windowMs: number) => ({ count: 1, ttlMs: windowMs }))
        const fallback = vi.fn(async (): Promise<RateLimitCheck> => ({ allowed: true, resetAt: 0 }))
        const store = createRedisRateLimitStore(incr, fallback)

        const result = await store('k', POLICY)

        expect(result.allowed).toBe(true)
        expect(incr).toHaveBeenCalledTimes(1)
        expect(fallback).not.toHaveBeenCalled()
    })

    it('denies once the Redis-reported count exceeds max, without touching the fallback', async () => {
        const incr = vi.fn(async () => ({ count: 4, ttlMs: 30_000 }))
        const fallback = vi.fn(async (): Promise<RateLimitCheck> => ({ allowed: true, resetAt: 0 }))
        const store = createRedisRateLimitStore(incr, fallback)

        const result = await store('k', POLICY)

        expect(result.allowed).toBe(false)
        expect(fallback).not.toHaveBeenCalled()
    })

    it('opens the breaker on the FIRST Redis failure and falls through immediately, with no retry-then-fallback delay', async () => {
        const incr = vi.fn(async () => {
            throw new Error('ECONNREFUSED')
        })
        const fallback = vi.fn(async (): Promise<RateLimitCheck> => ({ allowed: true, resetAt: 123 }))
        const store = createRedisRateLimitStore(incr, fallback)

        const result = await store('k', POLICY)

        expect(result).toEqual({ allowed: true, resetAt: 123 })
        expect(incr).toHaveBeenCalledTimes(1)
        expect(fallback).toHaveBeenCalledTimes(1)
    })

    it('while the breaker is open, skips Redis entirely on every subsequent call, proving it is a breaker and not a per-request fallback', async () => {
        const incr = vi.fn(async () => {
            throw new Error('ECONNREFUSED')
        })
        const fallback = vi.fn(async (): Promise<RateLimitCheck> => ({ allowed: true, resetAt: 0 }))
        const clock = fakeClock()
        const store = createRedisRateLimitStore(incr, fallback, { now: clock.now, openMs: 30_000 })

        await store('k', POLICY) // trips the breaker
        expect(incr).toHaveBeenCalledTimes(1)

        clock.advance(10_000) // still well inside the 30s open window
        await store('k', POLICY)
        await store('k', POLICY)

        // incr was NOT called again: every call while open goes straight to fallback.
        expect(incr).toHaveBeenCalledTimes(1)
        expect(fallback).toHaveBeenCalledTimes(3)
    })

    it('probes Redis again once openMs has elapsed, and CLOSES the breaker on a successful probe', async () => {
        let healthy = false
        const incr = vi.fn(async (_key: string, windowMs: number) => {
            if (!healthy) throw new Error('ECONNREFUSED')
            return { count: 1, ttlMs: windowMs }
        })
        const fallback = vi.fn(async (): Promise<RateLimitCheck> => ({ allowed: true, resetAt: 0 }))
        const clock = fakeClock()
        const store = createRedisRateLimitStore(incr, fallback, { now: clock.now, openMs: 30_000 })

        await store('k', POLICY) // trips the breaker (incr #1, fails)
        healthy = true // Redis "recovers", but the breaker doesn't know yet
        clock.advance(29_999)
        await store('k', POLICY) // still open, so it must NOT probe yet
        expect(incr).toHaveBeenCalledTimes(1)

        clock.advance(2) // now past openMs
        const recovered = await store('k', POLICY) // the half-open probe
        expect(incr).toHaveBeenCalledTimes(2)
        expect(recovered.allowed).toBe(true)

        // Breaker is closed again: the NEXT call must hit Redis directly, proving the probe's success closed it.
        await store('k', POLICY)
        expect(incr).toHaveBeenCalledTimes(3)
        // Two total: the original trip PLUS the "still open" check at t=29_999. Every call made while
        // the breaker is open goes to the fallback, not just the one that opened it.
        expect(fallback).toHaveBeenCalledTimes(2)
    })

    it('re-opens for another full openMs if the half-open probe itself fails', async () => {
        const incr = vi.fn(async () => {
            throw new Error('still down')
        })
        const fallback = vi.fn(async (): Promise<RateLimitCheck> => ({ allowed: true, resetAt: 0 }))
        const clock = fakeClock()
        const store = createRedisRateLimitStore(incr, fallback, { now: clock.now, openMs: 30_000 })

        await store('k', POLICY) // trip #1
        clock.advance(30_000)
        await store('k', POLICY) // probe #1 fails, re-opens
        expect(incr).toHaveBeenCalledTimes(2)

        clock.advance(29_999) // still inside the SECOND open window
        await store('k', POLICY)
        expect(incr).toHaveBeenCalledTimes(2) // no third attempt yet

        clock.advance(2)
        await store('k', POLICY) // probe #2
        expect(incr).toHaveBeenCalledTimes(3)
    })

    it('computes resetAt from the real clock plus the reported TTL', async () => {
        const incr = vi.fn(async () => ({ count: 1, ttlMs: 45_000 }))
        const fallback = vi.fn(async (): Promise<RateLimitCheck> => ({ allowed: true, resetAt: 0 }))
        const clock = fakeClock(1_000_000)
        const store = createRedisRateLimitStore(incr, fallback, { now: clock.now })

        const result = await store('k', POLICY)

        expect(result.resetAt).toBe(1_000_000 + 45_000)
    })
})
