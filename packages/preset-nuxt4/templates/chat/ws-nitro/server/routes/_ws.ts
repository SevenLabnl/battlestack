import { and, eq, gt } from 'drizzle-orm'
import { db } from '#server/database/client'
import { sessions } from '#server/database/schema/sessions'
import { mastra } from '#server/mastra'
import { gatewayConfigError } from '#server/mastra/gateways/openai-compat'
import { checkRateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'

type ChatMessage = { role: 'user', content: string } | { role: 'assistant', content: string }

/** No `system` role: Mastra appends it after the agent's DB-managed instructions. */
function parseMessages(payload: unknown): ChatMessage[] | null {
    const messages = (payload as { messages?: unknown } | null)?.messages
    if (!Array.isArray(messages) || messages.length === 0 || messages.length > 200) return null
    const valid = messages.every((m) =>
        (m?.role === 'user' || m?.role === 'assistant')
        && typeof m.content === 'string'
        && m.content.length > 0
        && m.content.length <= 32_000)
    return valid ? messages.map((m): ChatMessage => ({ role: m.role, content: m.content })) : null
}

/**
 * The upgrade is a GET, so the origin-check middleware never sees it. Without this a page on
 * another origin could open a socket that carries the user's cookie.
 */
function originAllowed(headers: Headers): boolean {
    const allowed = String(useRuntimeConfig().allowedOrigins ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    if (allowed.length === 0) return true
    const origin = headers.get('origin') ?? ''
    return allowed.some((o) => origin === o || origin.startsWith(`${o}/`))
}

/** The sealed cookie outlives a revoked or expired session, so the `sessions` row decides. */
async function isSessionLive(sessionId: string, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
        .limit(1)
    return row !== undefined
}

export default defineWebSocketHandler({
    async upgrade(request) {
        if (!originAllowed(request.headers)) return new Response('Origin not allowed', { status: 403 })
        // h3 cannot create a session outside a request handler, so a missing or unreadable
        // cookie throws here instead of returning an empty session.
        const session = await getUserSession({ request, context: request.context }).catch(() => null)
        const userId = session?.user?.id
        const sessionId = (session as { secure?: { sessionId?: string } } | null)?.secure?.sessionId
        if (!userId || !sessionId || !(await isSessionLive(sessionId, userId))) {
            return new Response('Unauthorized', { status: 401 })
        }
        request.context.userId = userId
        request.context.sessionId = sessionId
    },

    async message(peer, message) {
        try {
            const userId = peer.context.userId as string | undefined
            const sessionId = peer.context.sessionId as string | undefined
            if (!userId || !sessionId || !(await isSessionLive(sessionId, userId))) {
                peer.send(JSON.stringify({ type: 'error', code: 'UNAUTHORIZED', message: 'Your session has ended. Sign in again.' }))
                peer.close(4401, 'Unauthorized')
                return
            }
            if (useRuntimeConfig().rateLimitDisabled !== true) {
                const limit = await checkRateLimit(`chat:${userId}`, RATE_LIMIT_POLICIES.CHAT_MESSAGE.windowMs, RATE_LIMIT_POLICIES.CHAT_MESSAGE.max)
                if (!limit.allowed) {
                    peer.send(JSON.stringify({ type: 'error', code: 'RATE_LIMITED', message: 'Too many messages. Wait a moment and try again.' }))
                    return
                }
            }

            const messages = parseMessages(JSON.parse(typeof message === 'string' ? message : message.text()))
            if (!messages) {
                peer.send(JSON.stringify({ type: 'error', message: 'Invalid chat message' }))
                return
            }

            // Fail fast before invoking Mastra so its retry loop + stack trace
            // doesn't spam server logs when env config is incomplete. The check lives in
            // the gateway module and resolves config exactly like the gateway itself will.
            const configError = gatewayConfigError()
            if (configError) {
                peer.send(JSON.stringify({
                    type: 'error',
                    code: configError.code,
                    message: configError.message,
                }))
                return
            }

            const agent = mastra.getAgent('default')
            const stream = await agent.stream(messages)

            for await (const chunk of stream.textStream) {
                peer.send(JSON.stringify({ type: 'delta', content: chunk }))
            }
            peer.send(JSON.stringify({ type: 'done' }))
        } catch (err) {
            peer.send(
                JSON.stringify({
                    type: 'error',
                    message: err instanceof Error ? err.message : 'unknown',
                }),
            )
        }
    },
})
