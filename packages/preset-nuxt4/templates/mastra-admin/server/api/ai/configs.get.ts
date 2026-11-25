import { db } from '#server/database/client'
import { aiModelConfigs } from '#server/database/schema/ai'
import { Role } from '#server/database/schema/users'
import { requireRole } from '#server/utils/auth'
import { withReasoningSupport } from '#server/mastra/utils/reasoning'

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)

    const rows = await db
        .select({
            id: aiModelConfigs.id,
            key: aiModelConfigs.key,
            name: aiModelConfigs.name,
            description: aiModelConfigs.description,
            model: aiModelConfigs.model,
            reasoningEffort: aiModelConfigs.reasoningEffort,
        })
        .from(aiModelConfigs)
        .orderBy(aiModelConfigs.key)
    return rows.map(withReasoningSupport)
})
