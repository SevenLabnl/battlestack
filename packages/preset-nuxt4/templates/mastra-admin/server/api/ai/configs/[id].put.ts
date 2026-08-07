import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { aiModelConfigs } from '#server/database/schema/ai'
import { Role } from '#server/database/schema/users'
import { requireRole, requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { invalidateActiveModel } from '#server/mastra/utils/ai-model'

const schema = z.object({
    model: z.string().min(1, 'Model is required').max(200),
})

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)

    const id = requireRouterParam(event, 'id')

    const { model } = await readValidatedBody(event, schema.parse)

    const [updated] = await db
        .update(aiModelConfigs)
        .set({ model, updatedAt: new Date() })
        .where(eq(aiModelConfigs.id, id))
        .returning({
            id: aiModelConfigs.id,
            key: aiModelConfigs.key,
            name: aiModelConfigs.name,
            description: aiModelConfigs.description,
            model: aiModelConfigs.model,
        })

    if (!updated) {
        throw createError({ statusCode: 404, statusMessage: 'Model config not found' })
    }

    // Drop the in-process cache so subsequent agent calls pick up the new model.
    invalidateActiveModel(updated.key as 'chat' | 'embedding')

    await tryLogAudit(event, 'ai.model-config.updated', null, {
        configId: updated.id,
        key: updated.key,
        model: updated.model,
    })

    return updated
})
