import { and, eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { webauthnCredentials } from '#server/database/schema/auth-passkeys'
import { requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const id = requireRouterParam(event, 'id')

    const result = await db
        .delete(webauthnCredentials)
        .where(and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, user.id)))
        .returning()

    if (result.length === 0) throw createError({ statusCode: 404, statusMessage: 'Not found' })
    await tryLogAudit(event, 'user.passkey.removed', user.id, { credentialId: id })
    return { success: true }
})
