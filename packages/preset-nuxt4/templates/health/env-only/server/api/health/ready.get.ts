import type { H3Event } from 'h3'
import { checkEnvVars } from '#server/utils/health-checks'

/**
 * Readiness: no database in this variant, so the only thing worth gating traffic on is
 * config — a pod that booted without a valid session password stays out of the Service
 * while the previous rollout keeps serving. A restart cannot fix missing env, which is
 * why this check is not in `/api/health/live`.
 */
export default defineEventHandler((event: H3Event) => {
    const config = useRuntimeConfig(event)
    const sessionPassword = String(
        (config.session as { password?: unknown } | undefined)?.password ?? '',
    )
    const missingEnv = checkEnvVars(sessionPassword)
    if (missingEnv.length > 0) {
        setResponseStatus(event, 503)
        return {
            status: 'degraded' as const,
            env: { ok: false, missing: missingEnv },
        }
    }
    return { status: 'ok' as const, env: { ok: true } }
})
