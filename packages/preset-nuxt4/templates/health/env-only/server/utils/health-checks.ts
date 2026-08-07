/**
 * A copy, not an import: this env-only variant ships exactly when `nuxt4:auth` is absent, so importing its
 * `session-password.ts` would ENOENT the Nitro build. Keep in sync by hand; the `with-db` variant imports the real one.
 */
const MIN_SESSION_PASSWORD_LENGTH = 32

/**
 * Split out of `health.get.ts` so it is importable from the "unit" vitest project, where that file's top-level
 * `defineEventHandler` would throw. Checks LENGTH, not just presence: a too-short value used to fail later, at seal time.
 */
export function checkEnvVars(sessionPassword: string): string[] {
    return sessionPassword.length >= MIN_SESSION_PASSWORD_LENGTH ? [] : ['NUXT_SESSION_PASSWORD']
}
