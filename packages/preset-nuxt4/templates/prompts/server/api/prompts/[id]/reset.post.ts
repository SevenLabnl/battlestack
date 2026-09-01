import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database/client'
import { prompts } from '#server/database/schema/prompts'
import { Role } from '#server/database/schema/users'
import { requireRole, requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { invalidatePromptCache } from '#server/utils/prompts'

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)
    const id = requireRouterParam(event, 'id')

    const [existing] = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1)
    if (!existing) {
        throw createError({ statusCode: 404, statusMessage: 'Prompt not found' })
    }

    const [reset] = await db
        .update(prompts)
        .set({
            content: existing.defaultContent,
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

    if (!reset) {
        throw createError({ statusCode: 500, statusMessage: 'Reset failed' })
    }

    await invalidatePromptCache(reset.key)

    await tryLogAudit(event, 'prompt.reset', null, {
        promptId: reset.id,
        key: reset.key,
        version: reset.version,
    })
    return reset
})
