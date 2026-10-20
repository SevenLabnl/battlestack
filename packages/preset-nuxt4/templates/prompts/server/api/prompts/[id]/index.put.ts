import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { prompts } from '#server/database/schema/prompts'
import { Role } from '#server/database/schema/users'
import { requireRole, requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { invalidatePromptCache } from '#server/utils/prompts'

// The column is `text`; this only stops runaway input. Real agent prompts run past 15,000 characters.
const MAX_CONTENT = 100_000

const schema = z.object({
    content: z.string().min(1, 'Content is required').max(MAX_CONTENT, `Content is longer than ${MAX_CONTENT.toLocaleString('en')} characters`),
})

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)
    const id = requireRouterParam(event, 'id')

    const parsed = schema.safeParse(await readBody(event))
    if (!parsed.success) {
        throw createError({ statusCode: 400, statusMessage: parsed.error.issues[0]?.message ?? 'Invalid prompt' })
    }
    const { content } = parsed.data

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
