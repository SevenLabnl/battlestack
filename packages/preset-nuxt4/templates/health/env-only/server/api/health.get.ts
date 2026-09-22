import type { H3Event } from 'h3'
import { checkEnvVars, sessionPasswordFrom } from '#server/utils/health-checks'

type HealthBody = {
    status: 'ok' | 'degraded'
    version: string
    /** Full commit sha the image was built from, or `''` when the build did not supply one. */
    commit: string
    /** ISO-8601 build timestamp, or `''`. */
    builtAt: string
    checks: Record<string, unknown>
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    const failOnDegraded = config.health.failOnDegraded !== false
    // Same source as the app's footer (`useBuildInfo()`), so the page and the probe can
    // never disagree about which commit is answering.
    const publicConfig = (config.public ?? {}) as Record<string, unknown>
    const version = text(publicConfig.appVersion) || 'dev'
    const commit = text(publicConfig.appCommit)
    const builtAt = text(publicConfig.appBuiltAt)

    const missingEnv = checkEnvVars(sessionPasswordFrom(config))
    if (missingEnv.length > 0) {
        return respond(
            event,
            {
                status: 'degraded',
                version,
                commit,
                builtAt,
                checks: { env: { ok: false, missing: missingEnv } },
            },
            failOnDegraded,
        )
    }

    return respond(
        event,
        {
            status: 'ok',
            version,
            commit,
            builtAt,
            checks: { env: { ok: true } },
        },
        failOnDegraded,
    )
})

function respond(event: H3Event, body: HealthBody, failOnDegraded: boolean): HealthBody {
    if (body.status !== 'ok' && failOnDegraded) setResponseStatus(event, 503)
    return body
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : ''
}
