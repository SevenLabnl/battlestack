/**
 * Nuxt's `deriveSecret` floor; below it every session read or write throws. The boot guard imports this;
 * `battlestack login` and both `nuxt4:health` variants cannot, so they repeat it: update them by hand.
 */
export const MIN_APP_SECRET_LENGTH = 32

export function isValidAppSecret(secret: string): boolean {
    return secret.length >= MIN_APP_SECRET_LENGTH
}

/**
 * Callers MUST pass `import.meta.dev`, never `process.env.NODE_ENV`: the latter is statically inlined at build time (verified by grepping a
 * real `.output`), so a guard keyed on it bakes in the build machine's env. `=== true` is deliberate, so anything else still validates.
 */
export function assertValidAppSecretUnlessDev(isDevBuild: boolean, secret: string): void {
    if (isDevBuild === true) return
    if (isValidAppSecret(secret)) return

    throw new Error(
        `NUXT_APP_SECRET is ${secret ? 'too short' : 'not set'} `
        + `(needs >= ${MIN_APP_SECRET_LENGTH} characters). nuxt-auth-utils derives the session `
        + 'cookie key from it: without a valid value, every login and every session check '
        + 'fails. Nuxt only generates one in development. Separately, and just as important: '
        + 'it MUST be the exact same value on every running instance (deliver it via one shared '
        + 'secret, e.g. a k8s Secret through `envFrom`, and never generated per-pod), '
        + 'or a session sealed by one instance fails to validate on another. This '
        + 'check can only catch absence/length from where it runs, not cross-instance '
        + 'mismatch; that part is on the deployment, not this guard.',
    )
}
