import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { webauthnCredentials } from '#server/database/schema/auth-passkeys'

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    return db
        .select({
            id: webauthnCredentials.id,
            label: webauthnCredentials.label,
            deviceType: webauthnCredentials.deviceType,
            lastUsedAt: webauthnCredentials.lastUsedAt,
            createdAt: webauthnCredentials.createdAt,
        })
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, user.id))
})
