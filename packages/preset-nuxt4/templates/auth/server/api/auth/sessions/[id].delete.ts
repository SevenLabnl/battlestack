import { and, eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { sessions } from '#server/database/schema/sessions'
import { requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

/** Revoke a session belonging to the caller. The current session cannot be revoked here; use logout. */
export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)
    const id = requireRouterParam(event, 'id')
    const currentId = (session.secure as { sessionId?: string } | undefined)?.sessionId ?? null

    if (id === currentId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Cannot revoke current session, use logout.',
        })
    }

    const result = await db
        .delete(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.userId, session.user.id)))
        .returning({ id: sessions.id })

    if (result.length === 0) {
        throw createError({ statusCode: 404, statusMessage: 'Session not found' })
    }

    await tryLogAudit(event, 'user.session.revoked', session.user.id, { sessionId: id })

    return { ok: true }
})
