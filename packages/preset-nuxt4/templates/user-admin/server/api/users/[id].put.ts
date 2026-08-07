import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { users, Role } from '#server/database/schema/users'
import { hashUserPassword } from '#server/utils/password'
import { checkPasswordPolicy } from '#server/utils/password-policy'
import { requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.strictObject({
    email: z.email().toLowerCase().trim().optional(),
    name: z.string().max(80).optional(),
    password: z.string().min(1).optional(),
    role: z.enum(Role).optional(),
})

export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)
    const id = requireRouterParam(event, 'id')

    const isAdmin = session.user.role === Role.Admin
    const isSelf = session.user.id === id

    if (!isAdmin && !isSelf) {
        throw createError({ statusCode: 403, statusMessage: 'Insufficient permissions' })
    }

    const body = await readValidatedBody(event, schema.parse)

    if (body.role !== undefined && !isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: 'Only admins may change role',
        })
    }

    if (body.password) {
        const policy = checkPasswordPolicy(body.password)
        if (!policy.valid) {
            throw createError({ statusCode: 400, statusMessage: policy.error })
        }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() }
    if (body.email !== undefined) patch.email = body.email
    if (body.name !== undefined) patch.name = body.name
    if (body.password) patch.passwordHash = await hashUserPassword(body.password)
    if (body.role !== undefined) patch.role = body.role

    const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1)
    if (!existing) throw createError({ statusCode: 404, statusMessage: 'User not found' })

    const [updated] = await db.update(users).set(patch).where(eq(users.id, id)).returning({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        createdAt: users.createdAt,
    })

    if (!updated) throw createError({ statusCode: 500, statusMessage: 'Update failed' })

    if (body.email && body.email !== existing.email) {
        await tryLogAudit(event, 'user.email.changed', id, {
            from: existing.email,
            to: body.email,
        })
    }
    if (body.password) {
        await tryLogAudit(event, 'user.password.changed', id)
    }
    if (body.role && body.role !== existing.role) {
        await tryLogAudit(event, 'user.role.changed', id, {
            from: existing.role,
            to: body.role,
            changedBy: session.user.id,
        })
    }

    return updated
})
