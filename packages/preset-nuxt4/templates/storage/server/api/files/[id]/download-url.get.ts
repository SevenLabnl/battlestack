import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { files } from '#server/database/schema/files'
import { createDownloadUrl, createPublicUrl } from '#server/utils/storage'
import { requireRouterParam } from '#server/utils/auth'

// `?mode=public` returns a stable, non-expiring URL (only resolves if the object/bucket is public; handy for forwarding to an LLM/agent).
// Default is a time-limited signed URL. `etag` is returned for client-side caching/integrity.
export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const id = requireRouterParam(event, 'id')
    const mode = getQuery(event).mode === 'public' ? 'public' : 'signed'

    const [file] = await db.select().from(files).where(eq(files.id, id)).limit(1)
    if (!file) throw createError({ statusCode: 404, statusMessage: 'Not found' })

    if (file.userId !== user.id && user.role !== 'admin') {
        throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
    }

    if (mode === 'public') {
        return { url: createPublicUrl(file.key, file.bucket), mode, etag: file.etag }
    }
    const url = await createDownloadUrl(file.key)
    return { url, mode, expiresIn: 300, etag: file.etag }
})
