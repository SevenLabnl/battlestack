import type { H3Event } from 'h3'
import { checkEnvVars, sessionPasswordFrom } from '#server/utils/health-checks'

/**
 * Readiness: no database in this variant, so the only thing worth gating traffic on is
 * config — a pod that booted without a valid session password stays out of the Service
 * while the previous rollout keeps serving. A restart cannot fix missing env, which is
 * why this check is not in `/api/health/live`. Only applicable config gates: absent
 * `session` runtimeConfig means auth is not installed and there is nothing to check.
 */
export default defineEventHandler((event: H3Event) => {
    const config = useRuntimeConfig(event)
    const missingEnv = checkEnvVars(sessionPasswordFrom(config))
    if (missingEnv.length > 0) {
        setResponseStatus(event, 503)
        return {
            status: 'degraded' as const,
            env: { ok: false, missing: missingEnv },
        }
    }
    return { status: 'ok' as const, env: { ok: true } }
})
