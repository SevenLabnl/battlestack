/**
 * A copy, not an import: this env-only variant ships exactly when `nuxt4:auth` is absent, so importing its
 * `session-password.ts` would ENOENT the Nitro build. Keep in sync by hand; the `with-db` variant imports the real one.
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
 * `undefined` means auth is not installed, and MUST short-circuit to "nothing missing": `nuxt4:auth` requires
 * `nuxt4:database`, and this variant ships exactly when the database is absent, so demanding a session password
 * here is unsatisfiable by construction — wired to a readiness probe it would keep every pod out of the Service.
 */
export function checkEnvVars(sessionPassword: string | undefined): string[] {
    if (sessionPassword === undefined) return []
    return sessionPassword.length >= MIN_SESSION_PASSWORD_LENGTH ? [] : ['NUXT_SESSION_PASSWORD']
}
