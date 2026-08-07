import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import { db } from '#server/database/client'
import { getClientIP } from './request-ip'

interface RateLimitOptions {
    /** Logical name; all calls with the same name share a bucket family. */
    name: string
    /** Fixed window, in milliseconds. */
    windowMs: number
    /** Requests allowed per window. */
    max: number
    /** Key override (e.g. authenticated user id). Falls back to trusted client IP. */
    key?: string
}

/** Named rate-limit policies keyed by use case. Tune limits here, not at call sites. */
export const RATE_LIMIT_POLICIES = {
    LOGIN: { windowMs: 15 * 60_000, max: 10 },
    SIGNUP: { windowMs: 60_000, max: 5 },
    PASSWORD_RESET: { windowMs: 60_000, max: 5 },
    RESET_CONSUME: { windowMs: 60_000, max: 10 },
    MFA_CHALLENGE: { windowMs: 60_000, max: 6 },
    VERIFY_EMAIL: { windowMs: 60_000, max: 3 },
    CHAT_MESSAGE: { windowMs: 60_000, max: 10 },
} as const

export type RateLimitPolicy = keyof typeof RATE_LIMIT_POLICIES

export interface RateLimitResult {
    allowed: boolean
    /** Seconds until the window resets. Only meaningful when `allowed` is false. */
    retryAfterSec: number
}

/**
 * Cross-replica rate limiting. Postgres, not Redis: it is the only store this scaffold guarantees, and its availability already gates auth
 * (DB-backed sessions), so it adds no new failure mode. `nuxt4:redis` can swap a breaker-backed store over the seam below; the table ships either way.
 */

export interface RateLimitPolicyInput {
    windowMs: number
    max: number
}

/** What any rate-limit backend must answer. `resetAt` is an absolute epoch-ms timestamp. */
export interface RateLimitCheck {
    allowed: boolean
    resetAt: number
}

/** The seam a second driver (`nuxt4:redis`) implements. Exported so that driver's own file can type against it without redeclaring it. */
export type RateLimitStore = (key: string, policy: RateLimitPolicyInput) => Promise<RateLimitCheck>

interface RateLimitRow {
    count: number
    window_start: string | Date
}

/**
 * ~1-in-100 calls also sweeps day-old windows. Probabilistic rather than a `lastSweep` timestamp because that
 * guard would itself need cross-replica shared state; piggybacking on traffic avoids both that and a cron.
 */
const SWEEP_PROBABILITY = 0.01

async function sweepExpired(): Promise<void> {
    await db.execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`)
}

/**
 * Atomic fixed-window counter: one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, so there is no read-then-write
 * gap for concurrent requests to race through. Fixed, not sliding, to keep that atomicity in a single round trip.
 */
export async function postgresRateLimitCheck(key: string, policy: RateLimitPolicyInput): Promise<RateLimitCheck> {
    const { windowMs, max } = policy
    const windowInterval = `${windowMs} milliseconds`
    const result = await db.execute(sql`
        INSERT INTO rate_limits (key, window_start, count)
        VALUES (${key}, now(), 1)
        ON CONFLICT (key) DO UPDATE SET
            count = CASE
                WHEN rate_limits.window_start < now() - ${windowInterval}::interval THEN 1
                ELSE rate_limits.count + 1
            END,
            window_start = CASE
                WHEN rate_limits.window_start < now() - ${windowInterval}::interval THEN now()
                ELSE rate_limits.window_start
            END
        RETURNING count, window_start
    `)
    const row = (result as unknown as RateLimitRow[])[0]

    if (Math.random() < SWEEP_PROBABILITY) void sweepExpired().catch(() => {})

    // `RETURNING` here always yields exactly one row; this guard is defensive, not an expected path.
    const windowStartMs = row ? new Date(row.window_start).getTime() : Date.now()
    const resetAt = windowStartMs + windowMs
    const allowed = !row || row.count <= max
    return { allowed, resetAt }
}

/**
 * `let`, not `const`: `setRateLimitStore` is the one sanctioned way to rebind it, at boot only, never per-request.
 * Wiring, not state; the counts live in whichever store is bound.
 */
let store: RateLimitStore = postgresRateLimitCheck

/** Lets `nuxt4:redis`'s boot plugin install a Redis store without this file ever importing `ioredis`. */
export function setRateLimitStore(next: RateLimitStore): void {
    store = next
}

/**
 * Per-instance denial cache. Module-level mutable state is allowed here only because it caches an immutable fact (`resetAt` never moves);
 * the store stays the source of truth. Do not make it hold counts: the old `Map` did, gave each replica its own, and multiplied the limit by N.
 */
const deniedUntil = new Map<string, number>()

function toRetryAfterSec(resetAt: number): number {
    return Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))
}

/** Rate-limit check for `key` under `policy`. No H3/Nitro dependency, so it unit-tests directly. */
export async function checkRateLimit(key: string, windowMs: number, max: number): Promise<RateLimitResult> {
    const cachedResetAt = deniedUntil.get(key)
    if (cachedResetAt !== undefined) {
        if (Date.now() < cachedResetAt) {
            return { allowed: false, retryAfterSec: toRetryAfterSec(cachedResetAt) }
        }
        deniedUntil.delete(key) // window has actually passed; re-check the store for the fresh one
    }

    const result = await store(key, { windowMs, max })
    if (!result.allowed) {
        deniedUntil.set(key, result.resetAt)
        return { allowed: false, retryAfterSec: toRetryAfterSec(result.resetAt) }
    }
    return { allowed: true, retryAfterSec: 0 }
}

/** Rate limit an H3 request. Throws 429 with `Retry-After` when the policy's limit is exceeded. */
export async function rateLimit(event: H3Event, opts: RateLimitOptions): Promise<void> {
    // `NUXT_RATE_LIMIT_DISABLED=true` keeps e2e runs, which all share one loopback IP, from exhausting the bucket. Never set it in
    // production; it removes brute-force protection. Read via `runtimeConfig`, not `process.env`, so a misspelled key is actually caught.
    const config = useRuntimeConfig(event)
    if (config.rateLimitDisabled === true) return

    const who = opts.key ?? getClientIP(event)
    const result = await checkRateLimit(`${opts.name}:${who}`, opts.windowMs, opts.max)
    if (!result.allowed) {
        setResponseHeader(event, 'Retry-After', result.retryAfterSec)
        throw createError({ statusCode: 429, statusMessage: 'Too Many Requests' })
    }
}
