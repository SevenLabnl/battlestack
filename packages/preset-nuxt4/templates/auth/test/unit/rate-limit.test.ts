// MUST be the first import: its module body loads `.env` into `process.env`, which is where `NUXT_DATABASE_URL` comes from locally.
import '~~/test/helpers/setup'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * The property under test: one shared allowance across callers, where an in-memory bucket would give each replica its own and multiply the limit.
 * Both modules load lazily INSIDE the gate: `#server/database/client` throws from its module body, killing the file before any `skipIf` could run.
 */
let db!: typeof import('#server/database/client')['db']
let checkRateLimit!: typeof import('#server/utils/rate-limit')['checkRateLimit']

async function isDbUp(): Promise<boolean> {
    try {
        ;({ db } = await import('#server/database/client'))
        ;({ checkRateLimit } = await import('#server/utils/rate-limit'))
        await db.execute(sql`SELECT 1`)
        return true
    } catch {
        return false
    }
}

const dbUp = await isDbUp()

async function clearKey(key: string): Promise<void> {
    await db.execute(sql`DELETE FROM rate_limits WHERE key = ${key}`)
}

async function readCount(key: string): Promise<number | undefined> {
    const rows = await db.execute(sql`SELECT count FROM rate_limits WHERE key = ${key}`)
    return (rows as unknown as Array<{ count: number }>)[0]?.count
}

const TEST_KEYS = ['test:two-instances', 'test:retry-after', 'test:window-reset', 'test:no-double-count']

describe('checkRateLimit', () => {
    afterEach(async () => {
        if (!dbUp) return
        await Promise.all(TEST_KEYS.map(clearKey))
    })

    it.skipIf(!dbUp)(
        'enforces ONE shared limit across two independent callers hitting the same key, the property that catches an in-memory Map',
        async () => {
            const key = 'test:two-instances'
            const windowMs = 60_000
            const max = 10

            // Split 6/5 across two call sites rather than calling one closure 11 times,
            // so the test cannot pass merely by sharing a single JS-level call site.
            const instanceA = () => checkRateLimit(key, windowMs, max)
            const instanceB = () => checkRateLimit(key, windowMs, max)

            const results = []
            for (let i = 0; i < 6; i++) results.push(await instanceA())
            for (let i = 0; i < 5; i++) results.push(await instanceB())

            expect(results).toHaveLength(11)
            // Attempts 1-10 (across BOTH instances) allowed, 11th rejected.
            expect(results.slice(0, 10).every((r) => r.allowed)).toBe(true)
            expect(results[10]!.allowed).toBe(false)
        },
    )

    it.skipIf(!dbUp)('reports a positive, sane Retry-After once the limit is exceeded', async () => {
        const key = 'test:retry-after'
        const windowMs = 60_000
        const max = 1

        const first = await checkRateLimit(key, windowMs, max)
        expect(first.allowed).toBe(true)

        const second = await checkRateLimit(key, windowMs, max)
        expect(second.allowed).toBe(false)
        expect(second.retryAfterSec).toBeGreaterThan(0)
        expect(second.retryAfterSec).toBeLessThanOrEqual(Math.ceil(windowMs / 1000))
    })

    it.skipIf(!dbUp)(
        'stops touching the row once a key is denied, because the in-process cache short-circuits further hits',
        async () => {
            const key = 'test:no-double-count'
            const windowMs = 60_000
            const max = 1

            await checkRateLimit(key, windowMs, max) // 1st: allowed, count -> 1
            const denied = await checkRateLimit(key, windowMs, max) // 2nd: denied, count -> 2, now cached
            expect(denied.allowed).toBe(false)

            // These would each bump `count` again if the cache weren't
            // short-circuiting them before `store` (the UPSERT) is called.
            await checkRateLimit(key, windowMs, max)
            await checkRateLimit(key, windowMs, max)

            expect(await readCount(key)).toBe(2)
        },
    )

    it.skipIf(!dbUp)('resets to a fresh window once the previous one has actually expired', async () => {
        const key = 'test:window-reset'
        const windowMs = 1200 // short enough to really wait out, not simulate
        const max = 1

        const first = await checkRateLimit(key, windowMs, max)
        expect(first.allowed).toBe(true)
        const blocked = await checkRateLimit(key, windowMs, max)
        expect(blocked.allowed).toBe(false)

        // A real wait, not a DB back-date: the denial cache tracks `resetAt` against the real clock, so back-dating
        // `window_start` alone (as an earlier version did) desyncs cache from row and proves nothing.
        await new Promise((r) => setTimeout(r, windowMs + 200))

        const afterReset = await checkRateLimit(key, windowMs, max)
        expect(afterReset.allowed).toBe(true)
    }, 10_000)

    if (!dbUp) {
        // Present so the skip is visible in vitest's output rather than the file silently reporting fewer tests.
        it('suite skipped: no configured, reachable database (set NUXT_DATABASE_URL / run `battlestack up`)', () => {
            expect(dbUp).toBe(false)
        })
    }
})
