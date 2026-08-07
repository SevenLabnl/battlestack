import type { H3Event } from 'h3'
import { db } from '#server/database/client'
import { sql } from 'drizzle-orm'
import { checkEnvVars } from '#server/utils/health-checks'

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

    const sessionPassword = String(
        (config.session as { password?: unknown } | undefined)?.password ?? '',
    )
    const databaseUrl = String((config as Record<string, unknown>).databaseUrl ?? '')
    const missingEnv = checkEnvVars(sessionPassword, databaseUrl)
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
    try {
        await Promise.race([
            db.execute(sql`select 1`),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`db ping > ${dbTimeoutMs}ms`)), dbTimeoutMs),
            ),
        ])
        dbCheck = { ok: true, latencyMs: Date.now() - dbStart }
    } catch (err) {
        dbCheck = {
            ok: false,
            error: err instanceof Error ? err.message : 'db check failed',
        }
    }

    return respond(
        event,
        {
            status: dbCheck.ok ? 'ok' : 'degraded',
            version,
            checks: { env: { ok: true }, db: dbCheck },
        },
        failOnDegraded,
    )
})

function respond(event: H3Event, body: HealthBody, failOnDegraded: boolean): HealthBody {
    if (body.status !== 'ok' && failOnDegraded) setResponseStatus(event, 503)
    return body
}
