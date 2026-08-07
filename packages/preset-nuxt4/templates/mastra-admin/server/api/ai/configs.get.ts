import { db } from '#server/database/client'
import { aiModelConfigs } from '#server/database/schema/ai'
import { Role } from '#server/database/schema/users'
import { requireRole } from '#server/utils/auth'

export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)

    return db
        .select({
            id: aiModelConfigs.id,
            key: aiModelConfigs.key,
            name: aiModelConfigs.name,
            description: aiModelConfigs.description,
            model: aiModelConfigs.model,
        })
        .from(aiModelConfigs)
        .orderBy(aiModelConfigs.key)
})
