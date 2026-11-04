import { and, eq, gt } from 'drizzle-orm'
import { db } from '#server/database/client'
import { sessions } from '#server/database/schema/sessions'

/**
 * Logout, revoking a device and deleting a user only remove the `sessions` row; the sealed cookie stays valid.
 * nuxt-auth-utils runs the fetch hook (`server/plugins/session.ts`) on its own session fetch only, never in
 * `requireUserSession`, so the row is checked here on every request that carries a session cookie.
 */
export default defineEventHandler(async (event) => {
    const { name } = useRuntimeConfig(event).session as { name?: string }
    if (!getCookie(event, name ?? 'nuxt-auth-session')) return

    const session = await getUserSession(event)
    const userId = session.user?.id
    if (!userId) return
    const sessionId = session.secure?.sessionId
    if (sessionId && await isLive(sessionId, userId)) return

    // Replaces the request's cached session too, so later reads in this request see it empty.
    await clearUserSession(event)
})

async function isLive(sessionId: string, userId: string): Promise<boolean> {
    const [row] = await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), gt(sessions.expiresAt, new Date())))
        .limit(1)
    return row !== undefined
}
