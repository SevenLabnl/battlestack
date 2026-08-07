import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users, Role } from '#server/database/schema/users'
import { requireRole, requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineEventHandler(async (event) => {
    const session = await requireRole(event, Role.Admin)
    const id = requireRouterParam(event, 'id')

    const sessionUserId = session.user.id
    if (sessionUserId === id) {
        throw createError({
            statusCode: 400,
            statusMessage: 'You cannot delete your own account',
        })
    }

    const result = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id })
    if (result.length === 0) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    await tryLogAudit(event, 'user.deleted', null, {
        targetUserId: id,
        deletedBy: sessionUserId,
    })
    return { ok: true }
})
