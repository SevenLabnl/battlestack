import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { sessions } from '#server/database/schema/sessions'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineEventHandler(async (event) => {
    const session = await getUserSession(event)
    const userId = session.user?.id ?? null
    const sessionId = (session as { secure?: { sessionId?: string } }).secure?.sessionId
    if (sessionId) {
        await db.delete(sessions).where(eq(sessions.id, sessionId))
    }
    await clearUserSession(event)
    await tryLogAudit(event, 'user.logout', userId)
    return { ok: true }
})
