/**
 * 32 is `iron-webcrypto`'s `minPasswordlength`; below it every seal/unseal call throws. The boot guard and `nuxt4:health`
 * import this so they cannot drift, but `battlestack login` (CLI process, cannot import) repeats it: update both by hand.
 */
export const MIN_SESSION_PASSWORD_LENGTH = 32

export function isValidSessionPassword(password: string): boolean {
    return password.length >= MIN_SESSION_PASSWORD_LENGTH
}

/**
 * Callers MUST pass `import.meta.dev`, never `process.env.NODE_ENV`: the latter is statically inlined at build time (verified by grepping a
 * real `.output`), so a guard keyed on it bakes in the build machine's env. `=== true` is deliberate, so anything else still validates.
 */
export function assertValidSessionPasswordUnlessDev(isDevBuild: boolean, password: string): void {
    if (isDevBuild === true) return
    if (isValidSessionPassword(password)) return

    throw new Error(
        `NUXT_SESSION_PASSWORD is ${password ? 'too short' : 'not set'} `
        + `(needs >= ${MIN_SESSION_PASSWORD_LENGTH} characters). It seals every session `
        + 'cookie: without a valid value, nuxt-auth-utils throws on every login and '
        + 'every session check. Separately, and just as important: it MUST be the '
        + 'exact same value on every running instance (deliver it via one shared '
        + 'secret, e.g. a k8s Secret through `envFrom`, and never generated per-pod), '
        + 'or a session sealed by one instance fails to validate on another. This '
        + 'check can only catch absence/length from where it runs, not cross-instance '
        + 'mismatch; that part is on the deployment, not this guard.',
    )
}
