import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { totpSecrets, backupCodes } from '#server/database/schema/auth-2fa'
import { verifyEncryptedTotp } from '#server/utils/totp'
import { hashBackupCode } from '#server/utils/backup-codes'
import { consumeMfaChallenge } from '#server/utils/mfa-challenge'
import { rateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'
import { createDbSession } from '#server/utils/auth'

const TOTP_PATTERN = /^\d{6}$/
// Backup codes are 4 groups of 4 hex chars joined by `-` (19 chars). Accept
// dashless paste too; server canonicalises to the stored dashed form before hashing.
const BACKUP_PATTERN = /^[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}$/i

const schema = z.object({
    mfaToken: z.string().min(1),
    code: z
        .string()
        .min(6)
        .max(19)
        .refine((v) => TOTP_PATTERN.test(v) || BACKUP_PATTERN.test(v), {
            message: 'Code must be a 6-digit TOTP or a backup code',
        }),
})

function canonicaliseBackupCode(raw: string): string {
    const stripped = raw.toLowerCase().replace(/-/g, '')
    return stripped.match(/.{4}/g)?.join('-') ?? raw
}

export default defineEventHandler(async (event) => {
    await rateLimit(event, { name: 'auth:2fa', ...RATE_LIMIT_POLICIES.MFA_CHALLENGE })

    const { mfaToken, code } = await readValidatedBody(event, schema.parse)

    const userId = consumeMfaChallenge(mfaToken)
    if (!userId) {
        throw createError({ statusCode: 401, statusMessage: 'Invalid or expired challenge' })
    }

    // No initializer: both branches below always assign `ok` (or throw), so `= false` would be a dead store that fails
    // eslint's `no-useless-assignment` and would silently mask a future branch that forgets to assign.
    let ok: boolean
    if (TOTP_PATTERN.test(code)) {
        const [secret] = await db
            .select()
            .from(totpSecrets)
            .where(eq(totpSecrets.userId, userId))
            .limit(1)
        if (!secret || !secret.enabled) {
            throw createError({ statusCode: 401, statusMessage: 'Invalid or expired challenge' })
        }
        ok = verifyEncryptedTotp(secret.encryptedSecret, code)
    } else {
        const canonical = canonicaliseBackupCode(code)
        const hash = hashBackupCode(canonical)
        const updated = await db
            .update(backupCodes)
            .set({ usedAt: new Date() })
            .where(
                and(
                    eq(backupCodes.userId, userId),
                    eq(backupCodes.codeHash, hash),
                    isNull(backupCodes.usedAt),
                ),
            )
            .returning({ id: backupCodes.id })
        ok = updated.length > 0
    }

    if (!ok) throw createError({ statusCode: 401, statusMessage: 'Invalid 2FA code' })

    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    if (!user) throw createError({ statusCode: 404, statusMessage: 'User not found' })

    const sessionId = await createDbSession(user.id, event)
    await setUserSession(event, {
        user: { id: user.id, email: user.email },
        secure: { sessionId },
        loggedInAt: Date.now(),
    })
    return { ok: true }
})
