import { db } from '#server/database/client'
import { agents } from '#server/database/schema/ai'
import { Role } from '#server/database/schema/users'
import { requireRole } from '#server/utils/auth'

/** List registered agents and their model-config + prompt links (admin only). */
export default defineEventHandler(async (event) => {
    await requireRole(event, Role.Admin)

    return db
        .select({
            id: agents.id,
            key: agents.key,
            name: agents.name,
            description: agents.description,
            modelConfigKey: agents.modelConfigKey,
            promptKey: agents.promptKey,
            enabled: agents.enabled,
        })
        .from(agents)
        .orderBy(agents.key)
})
