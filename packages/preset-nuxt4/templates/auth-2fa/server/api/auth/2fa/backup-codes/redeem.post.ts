import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database/client'
import { backupCodes } from '#server/database/schema/auth-2fa'
import { hashBackupCode } from '#server/utils/backup-codes'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.object({
    code: z.string().min(8).max(32),
})

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const { code } = await readValidatedBody(event, schema.parse)

    const hash = hashBackupCode(code)
    const updated = await db
        .update(backupCodes)
        .set({ usedAt: new Date() })
        .where(
            and(
                eq(backupCodes.userId, user.id),
                eq(backupCodes.codeHash, hash),
                isNull(backupCodes.usedAt),
            ),
        )
        .returning({ id: backupCodes.id })

    if (updated.length === 0) {
        await tryLogAudit(event, 'user.backup-codes.redeem-failed', user.id)
        throw createError({ statusCode: 401, statusMessage: 'Invalid or already-used code' })
    }

    await tryLogAudit(event, 'user.backup-codes.redeemed', user.id)
    return { ok: true }
})
