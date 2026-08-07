import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { createDownloadUrl } from '#server/utils/storage'

export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)
    const [user] = await db
        .select({ avatarKey: users.avatarKey })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1)
    if (!user?.avatarKey) return { avatarUrl: null }
    const avatarUrl = await createDownloadUrl(user.avatarKey, 60 * 60)
    return { avatarUrl }
})
