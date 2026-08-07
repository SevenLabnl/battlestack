import Redis from 'ioredis'
import type { RedisIncrFn } from './redis-rate-limit'

/**
 * Tight on purpose: a slow-but-connected Redis must fail fast so the breaker opens and hands back to Postgres,
 * the actual floor. 200ms sits well above same-network Redis latency and well below what a user would notice.
 */
export const REDIS_COMMAND_TIMEOUT_MS = 200

/**
 * Atomic fixed-window counter in one round trip; Lua runs single-threaded, so nothing interleaves the INCR and PEXPIRE.
 * `PEXPIRE` fires only on the first hit: extending it per hit would make the window slide and never close under a trickle.
 */
const INCR_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return {count, ttl}
`

/** The shape `defineCommand('rlIncr', ...)` bolts onto the client below. ioredis cannot statically type a command it does not know about, so this is the one deliberate cast. */
interface WithRlIncr {
    rlIncr(key: string, windowMs: number): Promise<[number, number]>
}

/** Kept separate from `redis-rate-limit.ts` so the breaker's logic stays free of any `ioredis` import. */
export function createRedisIncr(url: string): RedisIncrFn {
    const client = new Redis(url, {
        commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
        // Fail fast: a retried command delays the failure signal the breaker needs, reinstating the outage tax it exists to avoid.
        maxRetriesPerRequest: 1,
        // Connection-level backoff, not per-command: this only governs re-establishing a dead TCP connection in the background.
        retryStrategy: (times: number) => Math.min(times * 200, 2_000),
        lazyConnect: false,
    })

    // Required, not optional: an `error` event with no listener crashes the process. Logging is all it should do; `retryStrategy` already reconnects.
    // `String(err)`, not `err.message`: verified against a real stopped-container outage where ioredis connection errors carried an empty `.message`.
    client.on('error', (err: Error) => {
        console.error('[redis-rate-limit] connection error:', String(err))
    })

    client.defineCommand('rlIncr', { numberOfKeys: 1, lua: INCR_SCRIPT })
    const withRlIncr = client as unknown as WithRlIncr

    return async (key: string, windowMs: number) => {
        const [count, ttlMs] = await withRlIncr.rlIncr(key, windowMs)
        return { count, ttlMs }
    }
}

/**
 * Strip credentials before this URL reaches a log line: a Redis connection string commonly carries a
 * password (`redis://:pw@host:port`), and the boot-time "which store is live" log must not leak it.
 */
export function redactRedisUrl(url: string): string {
    try {
        const parsed = new URL(url)
        if (parsed.username || parsed.password) {
            parsed.username = ''
            parsed.password = ''
        }
        return parsed.toString()
    } catch {
        return 'redis://<unparseable>'
    }
}
