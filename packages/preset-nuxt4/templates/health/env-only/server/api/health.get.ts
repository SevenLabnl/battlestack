import type { H3Event } from 'h3'
import { checkEnvVars, sessionPasswordFrom } from '#server/utils/health-checks'

type HealthBody = {
    status: 'ok' | 'degraded'
    version: string
    checks: Record<string, unknown>
}

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event)
    const failOnDegraded = config.health.failOnDegraded !== false
    const version =
        ((config.public as Record<string, unknown> | undefined)?.appVersion as
            | string
            | undefined) ?? 'dev'

    const missingEnv = checkEnvVars(sessionPasswordFrom(config))
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

    return respond(
        event,
        {
            status: 'ok',
            version,
            checks: { env: { ok: true } },
        },
        failOnDegraded,
    )
})

function respond(event: H3Event, body: HealthBody, failOnDegraded: boolean): HealthBody {
    if (body.status !== 'ok' && failOnDegraded) setResponseStatus(event, 503)
    return body
}
