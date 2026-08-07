const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export default defineEventHandler((event) => {
    const method = event.method?.toUpperCase() ?? 'GET'
    if (!MUTATING_METHODS.has(method)) return

    const config = useRuntimeConfig(event)
    const allowedRaw = (config.allowedOrigins as string | undefined) ?? ''
    const allowed = allowedRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    if (allowed.length === 0) return

    const origin = getRequestHeader(event, 'origin') ?? getRequestHeader(event, 'referer') ?? ''
    if (!origin) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Origin required for mutating requests',
        })
    }

    const matches = allowed.some(
        (allowedOrigin) => origin === allowedOrigin || origin.startsWith(`${allowedOrigin}/`),
    )
    if (!matches) throw createError({ statusCode: 403, statusMessage: 'Origin not allowed' })
})
