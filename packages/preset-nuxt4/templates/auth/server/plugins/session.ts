import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { sessions } from '#server/database/schema/sessions'
import { users } from '#server/database/schema/users'

export default defineNitroPlugin(() => {
    sessionHooks.hook('fetch', async (session) => {
        const sessionId = (session as { secure?: { sessionId?: string } }).secure?.sessionId
        if (!sessionId) return

        const [row] = await db
            .select({ session: sessions, user: users })
            .from(sessions)
            .where(eq(sessions.id, sessionId))
            .innerJoin(users, eq(sessions.userId, users.id))
            .limit(1)

        if (!row || new Date(row.session.expiresAt) < new Date()) {
            delete (session as { user?: unknown }).user
            delete (session as { secure?: unknown }).secure
            if (row) {
                await db.delete(sessions).where(eq(sessions.id, sessionId))
            }
            return
        }

        await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, sessionId))
        ;(session as { user?: unknown }).user = {
            id: row.user.id,
            name: row.user.name,
            email: row.user.email,
            role: row.user.role,
            theme: row.user.theme,
            locale: row.user.locale,
        }
    })

    sessionHooks.hook('clear', async (session) => {
        const sessionId = (session as { secure?: { sessionId?: string } }).secure?.sessionId
        if (!sessionId) return
        await db.delete(sessions).where(eq(sessions.id, sessionId))
    })
})
