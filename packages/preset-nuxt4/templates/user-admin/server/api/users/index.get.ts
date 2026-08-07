import { ilike, desc, count, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { users, Role } from '#server/database/schema/users'
import { requireRole } from '#server/utils/auth'

const querySchema = z.object({
    search: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
})

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)

    const { search, limit, offset } = await getValidatedQuery(event, querySchema.parse)

    const cols = {
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
    }

    const where: SQL | undefined = search ? ilike(users.email, `%${search}%`) : undefined

    const baseSelect = db.select(cols).from(users)
    const rowsQuery = where ? baseSelect.where(where) : baseSelect

    const baseCount = db.select({ n: count() }).from(users)
    const countQuery = where ? baseCount.where(where) : baseCount

    const [rows, totalRow] = await Promise.all([
        rowsQuery.orderBy(desc(users.createdAt)).limit(limit).offset(offset),
        countQuery,
    ])

    return {
        rows,
        total: Number(totalRow[0]?.n ?? 0),
        limit,
        offset,
    }
})
