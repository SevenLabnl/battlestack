import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { users, Role } from '#server/database/schema/users'
import { requireRole } from '#server/utils/auth'
import { hashUserPassword } from '#server/utils/password'
import { checkPasswordPolicy } from '#server/utils/password-policy'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.object({
    email: z.email().toLowerCase().trim(),
    password: z.string().min(1),
    name: z.string().max(80).default(''),
    role: z.enum(Role).default(Role.User),
})

export default defineEventHandler(async (event) => {
    const session = await requireRole(event, Role.Admin)
    const body = await readValidatedBody(event, schema.parse)

    const policy = checkPasswordPolicy(body.password)
    if (!policy.valid) {
        throw createError({ statusCode: 400, statusMessage: policy.error })
    }

    const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, body.email))
        .limit(1)
    if (existing) {
        throw createError({ statusCode: 409, statusMessage: 'Email already exists' })
    }

    const passwordHash = await hashUserPassword(body.password)
    let created
    try {
        ;[created] = await db
            .insert(users)
            .values({
                email: body.email,
                passwordHash,
                name: body.name,
                role: body.role,
            })
            .returning({
                id: users.id,
                email: users.email,
                name: users.name,
                role: users.role,
                createdAt: users.createdAt,
            })
    } catch (err) {
        // 23505 = unique_violation: a concurrent request inserted the same email between the existence check and this
        // insert (TOCTOU). Surface as 409 instead of letting the raw DB error escape as a 500.
        if ((err as { code?: string }).code === '23505') {
            throw createError({ statusCode: 409, statusMessage: 'Email already exists' })
        }
        throw err
    }

    if (!created) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create user' })
    }

    await tryLogAudit(event, 'user.signup', created.id, {
        createdBy: session.user.id,
        role: body.role,
    })
    return created
})
