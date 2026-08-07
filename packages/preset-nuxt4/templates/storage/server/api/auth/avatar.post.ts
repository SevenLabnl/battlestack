import { PutObjectCommand } from '@aws-sdk/client-s3'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import {
    getClient,
    bucket,
    newObjectKey,
    createDownloadUrl,
    deleteObject,
} from '#server/utils/storage'

const MAX_SIZE = 5 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/gif'])

export default defineEventHandler(async (event) => {
    const session = await requireUserSession(event)

    const parts = await readMultipartFormData(event)
    const filePart = parts?.find((p) => p.name === 'file')
    if (!filePart?.data) throw createError({ statusCode: 400, statusMessage: 'Missing file' })

    const contentType = filePart.type || 'application/octet-stream'
    if (!ALLOWED_TYPES.has(contentType)) {
        throw createError({ statusCode: 422, statusMessage: 'Only image files are allowed' })
    }
    if (filePart.data.length > MAX_SIZE) {
        throw createError({ statusCode: 413, statusMessage: 'File too large (max 5 MB)' })
    }

    const filename = filePart.filename || 'avatar'
    const ext = filename.includes('.') ? filename.split('.').pop() : undefined
    const key = newObjectKey('avatars', ext)

    await getClient().send(
        new PutObjectCommand({
            Bucket: bucket(),
            Key: key,
            Body: filePart.data,
            ContentType: contentType,
            ContentLength: filePart.data.length,
        }),
    )

    const [existing] = await db
        .select({ avatarKey: users.avatarKey })
        .from(users)
        .where(eq(users.id, session.user.id))
        .limit(1)

    await db
        .update(users)
        .set({ avatarKey: key, updatedAt: new Date() })
        .where(eq(users.id, session.user.id))

    if (existing?.avatarKey) {
        try {
            await deleteObject(existing.avatarKey)
        } catch {
            // old avatar delete is best-effort
        }
    }

    const avatarUrl = await createDownloadUrl(key, 60 * 60)
    return { avatarUrl }
})
