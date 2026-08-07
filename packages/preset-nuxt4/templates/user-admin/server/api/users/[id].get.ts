import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users, Role } from '#server/database/schema/users'
import { requireRouterParam } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)
    const id = requireRouterParam(event, 'id')

    if (session.user.role !== Role.Admin && session.user.id !== id) {
        throw createError({ statusCode: 403, statusMessage: 'Insufficient permissions' })
    }

    const [user] = await db
        .select({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)

    if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })
    return user
})
