/**
 * A copy, not an import: `nuxt4:database` does not require `nuxt4:auth`, and without auth importing its
 * `app-secret.ts` would ENOENT the Nitro build. Keep in sync by hand, as in the `env-only` variant.
 */
const MIN_APP_SECRET_LENGTH = 32

/**
 * `undefined` = auth not installed (no `session` runtimeConfig, which nuxt-auth-utils registers); `checkEnvVars` treats that as not-applicable.
 * Takes `unknown`: without auth, `NitroRuntimeConfig` has no `session` key, so any structural type here rejects it.
 */
export function appSecretFrom(config: unknown): string | undefined {
    const { session, appSecret } = config as { session?: unknown, appSecret?: unknown }
    return session === undefined ? undefined : String(appSecret ?? '')
}

/**
 * Split out of `health.get.ts` so it is importable from the "unit" vitest project, where that file's top-level
 * `defineEventHandler` would throw. Checks LENGTH, not just presence: a too-short value used to fail later, at seal time.
 *
 * `undefined` means auth is not installed and the session check is not-applicable: `nuxt4:database` does not
 * require `nuxt4:auth`, so a db-without-auth scaffold is valid and must not fail readiness over a secret
 * nothing reads. The database URL is always required, because this variant ships exactly when the db feature is on.
 */
export function checkEnvVars(appSecret: string | undefined, databaseUrl: string): string[] {
    const missing: string[] = []
    if (!databaseUrl) missing.push('NUXT_DATABASE_URL')
    if (appSecret !== undefined && appSecret.length < MIN_APP_SECRET_LENGTH) {
        missing.push('NUXT_APP_SECRET')
    }
    return missing
}
