import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { aiModelConfigs } from '#server/database/schema/ai'
import { Role } from '#server/database/schema/users'
import { requireRole, requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { invalidateActiveModel } from '#server/mastra/utils/ai-model'
import { effectiveReasoningEffort, withReasoningSupport } from '#server/mastra/utils/reasoning'

const schema = z.object({
    model: z.string().min(1, 'Model is required').max(200).optional(),
    // null resets to the model's provider default.
    reasoningEffort: z.string().max(20).nullable().optional(),
}).refine((body) => body.model !== undefined || body.reasoningEffort !== undefined, {
    message: 'Nothing to update',
})

const columns = {
    id: aiModelConfigs.id,
    key: aiModelConfigs.key,
    name: aiModelConfigs.name,
    description: aiModelConfigs.description,
    model: aiModelConfigs.model,
    reasoningEffort: aiModelConfigs.reasoningEffort,
}

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)

    const id = requireRouterParam(event, 'id')

    const body = await readValidatedBody(event, schema.parse)

    const [current] = await db.select(columns).from(aiModelConfigs).where(eq(aiModelConfigs.id, id)).limit(1)
    if (!current) {
        throw createError({ statusCode: 404, statusMessage: 'Model config not found' })
    }

    const model = body.model ?? current.model
    const requested = body.reasoningEffort === undefined ? current.reasoningEffort : body.reasoningEffort
    const reasoningEffort = effectiveReasoningEffort(model, requested)
    if (body.reasoningEffort && !reasoningEffort) {
        throw createError({
            statusCode: 400,
            statusMessage: `Model "${model}" does not support reasoning effort "${body.reasoningEffort}"`,
        })
    }

    // A model switch drops an effort the new model does not accept.
    const [updated] = await db
        .update(aiModelConfigs)
        .set({ model, reasoningEffort, updatedAt: new Date() })
        .where(eq(aiModelConfigs.id, id))
        .returning(columns)

    if (!updated) {
        throw createError({ statusCode: 404, statusMessage: 'Model config not found' })
    }

    await invalidateActiveModel(updated.key)

    await tryLogAudit(event, 'ai.model-config.updated', null, {
        configId: updated.id,
        key: updated.key,
        model: updated.model,
        reasoningEffort: updated.reasoningEffort,
    })

    return withReasoningSupport(updated)
})
