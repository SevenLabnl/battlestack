import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { backupCodes, totpSecrets } from '#server/database/schema/auth-2fa'
import { generateBackupCodes, hashBackupCode } from '#server/utils/backup-codes'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)

    const [totp] = await db
        .select({ enabled: totpSecrets.enabled })
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, user.id))
        .limit(1)
    if (!totp?.enabled) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Enable two-factor authentication before generating backup codes',
        })
    }

    const codes = generateBackupCodes()

    await db.delete(backupCodes).where(eq(backupCodes.userId, user.id))
    await db.insert(backupCodes).values(
        codes.map((c) => ({
            userId: user.id,
            codeHash: hashBackupCode(c),
        })),
    )

    await tryLogAudit(event, 'user.backup-codes.generated', user.id, {
        count: codes.length,
    })

    setResponseHeaders(event, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
    })
    return { codes }
})
