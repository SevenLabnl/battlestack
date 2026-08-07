import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { users, type Role } from '#server/database/schema/users'

const schema = z.object({
    name: z.string().max(80).default(''),
    theme: z.enum(['light', 'dark', 'system']),
    locale: z.enum(['nl', 'en']),
})

export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)
    const body = await readValidatedBody(event, schema.parse)

    const [updated] = await db
        .update(users)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(users.id, session.user.id))
        .returning({
            id: users.id,
            email: users.email,
            name: users.name,
            role: users.role,
            theme: users.theme,
            locale: users.locale,
        })

    if (!updated) {
        throw createError({ statusCode: 404, statusMessage: 'User not found' })
    }

    await setUserSession(event, {
        user: { ...updated, role: updated.role as Role },
    })
    return updated
})
