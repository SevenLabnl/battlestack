import { and, eq, gt } from 'drizzle-orm'
import { db } from '#server/database/client'
import { sessions } from '#server/database/schema/sessions'

/**
 * Logout, revoking a device and deleting a user only remove the `sessions` row; the sealed cookie stays valid.
 * nuxt-auth-utils runs the fetch hook (`server/plugins/session.ts`) on its own session fetch only, never in
 * `requireUserSession`, so the row is checked here on every request that carries a session cookie.
 */
export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig(event).session as { name?: string, cookie?: Record<string, unknown> }
    const cookieName = config.name ?? 'nuxt-session'
    if (!getCookie(event, cookieName)) return

    const session = await getUserSession(event)
    const userId = session.user?.id
    if (!userId) return
    const sessionId = session.secure?.sessionId
    if (sessionId && await isLive(sessionId, userId)) return

    // getUserSession returns a copy, and clearUserSession would let the next call re-read the still-valid
    // cookie, so strip h3's per-request cache in place. Fail closed if it isn't there.
    const cached = (event.context.sessions as Record<string, { data: Record<string, unknown> }> | undefined)?.[cookieName]
    if (!cached) throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
    delete cached.data.user
    delete cached.data.secure
    deleteCookie(event, cookieName, { ...config.cookie, path: '/' })
})

async function isLive(sessionId: string, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
        .limit(1)
    return row !== undefined
}
