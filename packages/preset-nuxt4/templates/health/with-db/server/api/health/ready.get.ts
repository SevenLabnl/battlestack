import type { H3Event } from 'h3'
import { db } from '#server/database/client'
import { sql } from 'drizzle-orm'

/**
 * Readiness: can this instance serve traffic right now? Failing takes the pod out of
 * the Service and reverses on its own once the database returns — the right place for
 * the DB ping, unlike liveness. Same timeout knob as `/api/health`, which stays as the
 * richer endpoint for humans and monitoring.
 */
export default defineEventHandler(async (event: H3Event) => {
    const config = useRuntimeConfig(event)
    const dbTimeoutMs = Number(config.health.dbTimeoutMs ?? 1000)

    const started = Date.now()
    try {
        await Promise.race([
            db.execute(sql`select 1`),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`db ping > ${dbTimeoutMs}ms`)), dbTimeoutMs),
            ),
        ])
    } catch (err) {
        setResponseStatus(event, 503)
        return {
            status: 'degraded' as const,
            db: { ok: false, error: err instanceof Error ? err.message : 'db check failed' },
        }
    }

    return { status: 'ok' as const, db: { ok: true, latencyMs: Date.now() - started } }
})
