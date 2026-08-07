import { isValidSessionPassword } from '#server/utils/session-password'

/**
 * Split out of `health.get.ts` so it is importable from the "unit" vitest project, where that file's top-level
 * `defineEventHandler` would throw. Checks LENGTH, not just presence: a too-short value used to fail later, at seal time.
 */
export function checkEnvVars(sessionPassword: string, databaseUrl: string): string[] {
    const missing: string[] = []
    if (!databaseUrl) missing.push('NUXT_DATABASE_URL')
    if (!isValidSessionPassword(sessionPassword)) missing.push('NUXT_SESSION_PASSWORD')
    return missing
}
