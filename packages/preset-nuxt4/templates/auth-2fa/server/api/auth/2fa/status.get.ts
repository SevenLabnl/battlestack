import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { totpSecrets } from '#server/database/schema/auth-2fa'

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const [row] = await db
        .select({ enabled: totpSecrets.enabled, enabledAt: totpSecrets.enabledAt })
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, user.id))
        .limit(1)
    return { enabled: row?.enabled ?? false, enabledAt: row?.enabledAt ?? null }
})
