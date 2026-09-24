import type { H3Event } from 'h3'
import { db } from '#server/database/client'
import { sql } from 'drizzle-orm'
import { checkEnvVars, sessionPasswordFrom } from '#server/utils/health-checks'
import { bootState } from '#server/utils/boot-tasks'

type HealthBody = {
    status: 'ok' | 'degraded'
    version: string
    checks: Record<string, unknown>
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    const failOnDegraded = config.health.failOnDegraded !== false
    const dbTimeoutMs = Number(config.health.dbTimeoutMs ?? 1000)
    const version =
        ((config.public as Record<string, unknown> | undefined)?.appVersion as
            | string
            | undefined) ?? 'dev'

    const databaseUrl = String((config as Record<string, unknown>).databaseUrl ?? '')
    const missingEnv = checkEnvVars(sessionPasswordFrom(config), databaseUrl)
    if (missingEnv.length > 0) {
        return respond(
            event,
            {
                status: 'degraded',
                version,
                checks: { env: { ok: false, missing: missingEnv } },
            },
            failOnDegraded,
        )
    }

    const dbStart = Date.now()
    let dbCheck: { ok: boolean; latencyMs?: number; error?: string }
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        await Promise.race([
            db.execute(sql`select 1`),
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error(`db ping > ${dbTimeoutMs}ms`)), dbTimeoutMs)
            }),
        ])
        dbCheck = { ok: true, latencyMs: Date.now() - dbStart }
    } catch (err) {
        dbCheck = {
            ok: false,
            error: err instanceof Error ? err.message : 'db check failed',
        }
    } finally {
        clearTimeout(timer)
    }

    const boot = bootState()
    const bootCheck = boot.ready ? { ok: true } : { ok: false, pending: boot.pending, failed: boot.failed }

    return respond(
        event,
        {
            status: dbCheck.ok && boot.ready ? 'ok' : 'degraded',
            version,
            checks: { env: { ok: true }, boot: bootCheck, db: dbCheck },
        },
        failOnDegraded,
    )
})

function respond(event: H3Event, body: HealthBody, failOnDegraded: boolean): HealthBody {
    if (body.status !== 'ok' && failOnDegraded) setResponseStatus(event, 503)
    return body
}
