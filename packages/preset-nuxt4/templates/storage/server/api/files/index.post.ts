import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { files } from '#server/database/schema/files'
import { bucket, headObject } from '#server/utils/storage'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.object({
    key: z.string().min(1).max(1024),
})

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const { key } = await readValidatedBody(event, schema.parse)

    const head = await headObject(key).catch(() => null)
    if (!head) {
        throw createError({ statusCode: 404, statusMessage: 'Object not found in bucket' })
    }

    const [existing] = await db.select().from(files).where(eq(files.key, key)).limit(1)
    if (existing) return existing

    const [row] = await db
        .insert(files)
        .values({
            userId: user.id,
            bucket: bucket(),
            key,
            size: head.ContentLength ?? 0,
            mime: head.ContentType ?? null,
            etag: head.ETag?.replace(/"/g, '') ?? null,
        })
        .returning()

    await tryLogAudit(event, 'file.uploaded', user.id, {
        key,
        size: head.ContentLength,
    })

    return row
})
