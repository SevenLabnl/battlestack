import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database/client'
import { backupCodes, totpSecrets } from '#server/database/schema/auth-2fa'
import { decryptSecret, verifyTotp } from '#server/utils/totp'
import { generateBackupCodes, hashBackupCode } from '#server/utils/backup-codes'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.object({
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
})

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const { code } = await readValidatedBody(event, schema.parse)

    const [row] = await db
        .select({
            id: totpSecrets.userId,
            enc: totpSecrets.encryptedSecret,
            setupExpiresAt: totpSecrets.setupExpiresAt,
        })
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, user.id))
        .limit(1)
    if (!row) throw createError({ statusCode: 404, statusMessage: 'No TOTP setup in progress' })
    if (row.setupExpiresAt && new Date(row.setupExpiresAt) < new Date()) {
        throw createError({
            statusCode: 410,
            statusMessage: 'Setup expired. Start over from /auth/2fa/setup.',
        })
    }

    const ok = verifyTotp(decryptSecret(row.enc), code)
    if (!ok) throw createError({ statusCode: 401, statusMessage: 'Invalid code' })

    const updated = await db
        .update(totpSecrets)
        .set({ enabled: true, enabledAt: new Date(), setupExpiresAt: null })
        .where(and(eq(totpSecrets.userId, user.id), isNull(totpSecrets.enabledAt)))
        .returning({ userId: totpSecrets.userId })

    if (updated.length === 0) {
        throw createError({ statusCode: 409, statusMessage: '2FA already enabled' })
    }

    // Mint backup codes as part of the same enable step. Stored hashed; plaintext
    // returned once. Replaces any prior set (clean slate on re-enable).
    const codes = generateBackupCodes()
    await db.delete(backupCodes).where(eq(backupCodes.userId, user.id))
    await db
        .insert(backupCodes)
        .values(codes.map((c) => ({ userId: user.id, codeHash: hashBackupCode(c) })))

    await tryLogAudit(event, 'user.totp.enabled', user.id)
    await tryLogAudit(event, 'user.backup-codes.generated', user.id, { count: codes.length })

    setResponseHeaders(event, {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
    })
    return { ok: true, backupCodes: codes }
})
