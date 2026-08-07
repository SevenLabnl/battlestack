import { and, eq, gt, desc } from 'drizzle-orm'
import { db } from '#server/database/client'
import { sessions } from '#server/database/schema/sessions'

/** Active (non-expired) sessions for the calling user. Marks the current session. */
export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)
    const currentId = (session.secure as { sessionId?: string } | undefined)?.sessionId ?? null

    const rows = await db
        .select({
            id: sessions.id,
            userAgent: sessions.userAgent,
            ip: sessions.ip,
            lastSeenAt: sessions.lastSeenAt,
            createdAt: sessions.createdAt,
            expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(and(eq(sessions.userId, session.user.id), gt(sessions.expiresAt, new Date())))
        .orderBy(desc(sessions.lastSeenAt))

    return {
        rows: rows.map((r) => ({ ...r, current: r.id === currentId })),
    }
})
