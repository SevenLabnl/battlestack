import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { files } from '#server/database/schema/files'
import { deleteObject } from '#server/utils/storage'
import { requireRouterParam } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const id = requireRouterParam(event, 'id')

    const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1)
    if (!file) throw createError({ statusCode: 404, statusMessage: 'Not found' })

    if (file.userId !== user.id && user.role !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }

    await deleteObject(file.key).catch(() => null)
    await db.delete(files).where(eq(files.id, id))

    await tryLogAudit(event, 'file.deleted', user.id, { key: file.key })

    return { ok: true }
})
