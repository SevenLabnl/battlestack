/**
 * A copy, not an import: `nuxt4:database` does not require `nuxt4:auth`, and without auth importing its
 * `session-password.ts` would ENOENT the Nitro build. Keep in sync by hand, as in the `env-only` variant.
 */
const MIN_SESSION_PASSWORD_LENGTH = 32

/**
 * `undefined` = auth not installed (no `session` runtimeConfig); `checkEnvVars` treats that as not-applicable.
 * Takes `unknown`: without auth, `NitroRuntimeConfig` has no `session` key, so any structural type here rejects it.
 */
export function sessionPasswordFrom(config: unknown): string | undefined {
    const session = (config as { session?: { password?: unknown } }).session
    return session === undefined ? undefined : String(session.password ?? '')
}

/**
 * Split out of `health.get.ts` so it is importable from the "unit" vitest project, where that file's top-level
 * `defineEventHandler` would throw. Checks LENGTH, not just presence: a too-short value used to fail later, at seal time.
 *
 * `undefined` means auth is not installed and the session check is not-applicable: `nuxt4:database` does not
 * require `nuxt4:auth`, so a db-without-auth scaffold is valid and must not fail readiness over a password
 * nothing reads. The database URL is always required, because this variant ships exactly when the db feature is on.
 */
export function checkEnvVars(sessionPassword: string | undefined, databaseUrl: string): string[] {
    const missing: string[] = []
    if (!databaseUrl) missing.push('NUXT_DATABASE_URL')
    if (sessionPassword !== undefined && sessionPassword.length < MIN_SESSION_PASSWORD_LENGTH) {
        missing.push('NUXT_SESSION_PASSWORD')
    }
    return missing
}
