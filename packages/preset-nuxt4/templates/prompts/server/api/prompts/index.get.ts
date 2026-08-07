import { count, desc } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { prompts } from '#server/database/schema/prompts'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
})

export default defineEventHandler(async (event) => {
    await requireUserSession(event)
    const { limit, offset } = await getValidatedQuery(event, querySchema.parse)

    const [rows, totalRow] = await Promise.all([
        db
            .select({
                id: prompts.id,
                key: prompts.key,
                name: prompts.name,
                description: prompts.description,
                content: prompts.content,
                version: prompts.version,
                updatedAt: prompts.updatedAt,
            })
            .from(prompts)
            .orderBy(desc(prompts.updatedAt))
            .limit(limit)
            .offset(offset),
        db.select({ n: count() }).from(prompts),
    ])

    return {
        rows,
        total: Number(totalRow[0]?.n ?? 0),
        limit,
        offset,
    }
})
