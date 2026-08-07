import { count, desc, eq, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { files } from '#server/database/schema/files'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
})

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const { limit, offset } = await getValidatedQuery(event, querySchema.parse)

    const where: SQL | undefined = user.role === 'admin' ? undefined : eq(files.userId, user.id)

    const baseSelect = db
        .select({
            id: files.id,
            userId: files.userId,
            bucket: files.bucket,
            key: files.key,
            size: files.size,
            mime: files.mime,
            etag: files.etag,
            createdAt: files.createdAt,
        })
        .from(files)
    const rowsQuery = where ? baseSelect.where(where) : baseSelect

    const baseCount = db.select({ n: count() }).from(files)
    const countQuery = where ? baseCount.where(where) : baseCount

    const [rows, totalRow] = await Promise.all([
        rowsQuery.orderBy(desc(files.createdAt)).limit(limit).offset(offset),
        countQuery,
    ])

    return {
        rows,
        total: Number(totalRow[0]?.n ?? 0),
        limit,
        offset,
    }
})
