/**
 * A copy, not an import: this env-only variant ships exactly when `nuxt4:auth` is absent, so importing its
 * `app-secret.ts` would ENOENT the Nitro build. Keep in sync by hand, as in the `with-db` variant.
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
 * `undefined` means auth is not installed, and MUST short-circuit to "nothing missing": `nuxt4:auth` requires
 * `nuxt4:database`, and this variant ships exactly when the database is absent, so demanding an app secret
 * here is unsatisfiable by construction: wired to a readiness probe it would keep every pod out of the Service.
 */
export function checkEnvVars(appSecret: string | undefined): string[] {
    if (appSecret === undefined) return []
    return appSecret.length >= MIN_APP_SECRET_LENGTH ? [] : ['NUXT_APP_SECRET']
}
