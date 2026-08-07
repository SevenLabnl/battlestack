import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { backupCodes, totpSecrets } from '#server/database/schema/auth-2fa'
import { verifyEncryptedTotp } from '#server/utils/totp'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.object({
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
})

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const { code } = await readValidatedBody(event, schema.parse)

    const [row] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, user.id))
        .limit(1)

    if (!row || !row.enabled) {
        throw createError({ statusCode: 404, statusMessage: '2FA is not enabled' })
    }

    if (!verifyEncryptedTotp(row.encryptedSecret, code)) {
        throw createError({ statusCode: 401, statusMessage: 'Invalid code' })
    }

    await db.delete(totpSecrets).where(eq(totpSecrets.userId, user.id))
    await db.delete(backupCodes).where(eq(backupCodes.userId, user.id))
    await tryLogAudit(event, 'user.totp.disabled', user.id)
    return { ok: true }
})
