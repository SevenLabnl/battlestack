import { desc, eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { auditEvents } from '#server/database/schema/audit-log'

/** Recent audit events for the calling user. Capped at 50 rows. */
export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const rows = await db
        .select({
            id: auditEvents.id,
            action: auditEvents.action,
            ip: auditEvents.ip,
            userAgent: auditEvents.userAgent,
            metadata: auditEvents.metadata,
            createdAt: auditEvents.createdAt,
        })
        .from(auditEvents)
        .where(eq(auditEvents.userId, user.id))
        .orderBy(desc(auditEvents.createdAt))
        .limit(50)
    return { rows }
})
