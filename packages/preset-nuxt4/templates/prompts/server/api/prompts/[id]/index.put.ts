import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { prompts } from '#server/database/schema/prompts'
import { Role } from '#server/database/schema/users'
import { requireRole, requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { invalidatePromptCache } from '#server/utils/prompts'

const schema = z.object({
    content: z.string().min(1, 'Content is required').max(10_000),
})

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)
    const id = requireRouterParam(event, 'id')

    const { content } = await readValidatedBody(event, schema.parse)

    const [updated] = await db
        .update(prompts)
        .set({
            content,
            version: sql`${prompts.version} + 1`,
            updatedAt: new Date(),
        })
        .where(eq(prompts.id, id))
        .returning({
            id: prompts.id,
            key: prompts.key,
            name: prompts.name,
            description: prompts.description,
            content: prompts.content,
            version: prompts.version,
            updatedAt: prompts.updatedAt,
        })

    if (!updated) {
        throw createError({ statusCode: 404, statusMessage: 'Prompt not found' })
    }

    await invalidatePromptCache(updated.key)

    await tryLogAudit(event, 'prompt.updated', null, {
        promptId: updated.id,
        key: updated.key,
        version: updated.version,
    })
    return updated
})
