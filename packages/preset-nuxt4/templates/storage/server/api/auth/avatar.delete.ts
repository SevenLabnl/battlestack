import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { deleteObject } from '#server/utils/storage'

export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)

    const [existing] = await db
        .select({ avatarKey: users.avatarKey })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1)

    if (existing?.avatarKey) {
        try {
            await deleteObject(existing.avatarKey)
        } catch {
            // S3 delete is best-effort
        }
        await db
            .update(users)
            .set({ avatarKey: null, updatedAt: new Date() })
            .where(eq(users.id, session.user.id))
    }

    return { ok: true }
})
