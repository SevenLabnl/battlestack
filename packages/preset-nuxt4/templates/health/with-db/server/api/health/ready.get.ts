import type { H3Event } from 'h3'
import { db } from '#server/database/client'
import { sql } from 'drizzle-orm'
import { checkEnvVars, sessionPasswordFrom } from '#server/utils/health-checks'

/**
 * Readiness: can this instance serve traffic right now? Failing takes the pod out of
 * the Service and reverses on its own — the right place for the DB ping, unlike
 * liveness. Config gates readiness too, same rule as the env-only variant: a restart
 * cannot fix missing env (so it must never fail liveness), but a pod that cannot seal
 * sessions should not join the Service either. Same timeout knob as `/api/health`,
 * which stays as the richer endpoint for humans and monitoring.
 */
export default defineEventHandler(async (event: H3Event) => {
    const config = useRuntimeConfig(event)
    const dbTimeoutMs = Number(config.health.dbTimeoutMs ?? 1000)

    const databaseUrl = String((config as Record<string, unknown>).databaseUrl ?? '')
    const missingEnv = checkEnvVars(sessionPasswordFrom(config), databaseUrl)
    if (missingEnv.length > 0) {
        setResponseStatus(event, 503)
        return {
            status: 'degraded' as const,
            env: { ok: false, missing: missingEnv },
        }
    }

    const started = Date.now()
    // The kubelet hits this every few seconds: an uncleared race timer would keep the
    // process holding `dbTimeoutMs` of pending timers per probe and delay SIGTERM drain.
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            db.execute(sql`select 1`),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`db ping > ${dbTimeoutMs}ms`)), dbTimeoutMs)
            }),
        ])
    } catch (err) {
        setResponseStatus(event, 503)
        return {
            status: 'degraded' as const,
            env: { ok: true },
            db: { ok: false, error: err instanceof Error ? err.message : 'db check failed' },
        }
    } finally {
        clearTimeout(timer)
    }

    return {
        status: 'ok' as const,
        env: { ok: true },
        db: { ok: true, latencyMs: Date.now() - started },
    }
})
