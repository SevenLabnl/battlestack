import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { agents, aiModelConfigs } from '#server/database/schema/ai'
import { Role } from '#server/database/schema/users'
import { requireRole, requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { invalidateAgentCache } from '#server/mastra/utils/agent-runtime'

// `promptKey: null` detaches the prompt (falls back to code default instructions); omitted fields are left unchanged.
// `.partial()` after requiring at least one editable field keeps a no-op PUT from succeeding.
const schema = z
    .object({
        modelConfigKey: z.string().min(1).max(200),
        promptKey: z.string().min(1).max(200).nullable(),
        enabled: z.boolean(),
    })
    .partial()
    .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' })

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)

    const id = requireRouterParam(event, 'id')
    const body = await readValidatedBody(event, schema.parse)

    // Guard the link: the model config must exist (the prompt link is soft: an unknown key falls back to code defaults at runtime, never errors).
    if (body.modelConfigKey !== undefined) {
        const [cfg] = await db
            .select({ key: aiModelConfigs.key })
            .from(aiModelConfigs)
            .where(eq(aiModelConfigs.key, body.modelConfigKey))
            .limit(1)
        if (!cfg) {
            throw createError({
                statusCode: 400,
                statusMessage: `Unknown model config key: ${body.modelConfigKey}`,
            })
        }
    }

    const [updated] = await db
        .update(agents)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(agents.id, id))
        .returning({
            id: agents.id,
            key: agents.key,
            name: agents.name,
            description: agents.description,
            modelConfigKey: agents.modelConfigKey,
            promptKey: agents.promptKey,
            enabled: agents.enabled,
        })

    if (!updated) {
        throw createError({ statusCode: 404, statusMessage: 'Agent not found' })
    }

    // Drop the cached link so the next agent call picks up the new model/prompt.
    invalidateAgentCache(updated.key)

    await tryLogAudit(event, 'ai.agent.updated', null, {
        agentId: updated.id,
        key: updated.key,
        modelConfigKey: updated.modelConfigKey,
        promptKey: updated.promptKey,
        enabled: updated.enabled,
    })

    return updated
})
