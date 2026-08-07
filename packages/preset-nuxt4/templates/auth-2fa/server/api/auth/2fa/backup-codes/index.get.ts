import { and, count, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database/client'
import { backupCodes } from '#server/database/schema/auth-2fa'

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const [unused] = await db
        .select({ value: count() })
        .from(backupCodes)
        .where(and(eq(backupCodes.userId, user.id), isNull(backupCodes.usedAt)))
    return { unused: Number(unused?.value ?? 0) }
})
