/** The two guards `magic-login.post.ts` stacks, pulled out as pure checks with no H3/Nitro dependency so they unit-test directly. */
const LOCAL_HOST_PATTERNS = [
    /^localhost$/i,
    /^127\.0\.0\.1$/,
    /^::1$/,
    /^0\.0\.0\.0$/,
    /\.local$/i,
    /\.battlestack\.test$/i,
]

/**
 * Strip a trailing `:<port>`, but never from a bare IPv6 address. Fixes a real bug: the naive `replace(/:.+$/, '')`
 * turned `::1` into `''`, so `isLocalHost('::1')`, a value Node really does hand you on loopback, returned false.
 */
function stripPort(hostHeader: string): string {
    const bracketed = /^\[(.+)]:\d+$/.exec(hostHeader) ?? /^\[(.+)]$/.exec(hostHeader)
    if (bracketed) return bracketed[1]!
    // More than one colon and no brackets means a bare IPv6 address, which can never carry a port, so nothing to strip.
    if (hostHeader.split(':').length > 2) return hostHeader
    return hostHeader.replace(/:\d+$/, '')
}

export function isLocalHost(hostHeader: string): boolean {
    const name = stripPort(hostHeader.trim())
    if (!name) return false
    return LOCAL_HOST_PATTERNS.some((rx) => rx.test(name))
}

/**
 * Fails closed by construction: phrased as "allowed = dev AND local", and `=== true`, so no garbage `isDevBuild` can evaluate to allowed.
 * Callers must pass `import.meta.dev`, never `process.env.NODE_ENV`: the latter is inlined at build time and cannot be fixed at deploy time.
 */
export function isMagicLoginAllowed(isDevBuild: boolean, hostHeader: string): boolean {
    return isDevBuild === true && isLocalHost(hostHeader)
}
