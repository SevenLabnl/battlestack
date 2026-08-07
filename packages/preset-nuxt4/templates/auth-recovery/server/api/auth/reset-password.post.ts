import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { passwordResetTokens } from '#server/database/schema/auth-recovery'
import { hashUserPassword } from '#server/utils/password'
import { rateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.object({
    token: z.string().min(32).max(128),
    password: z.string().min(12).max(256),
})

export default defineEventHandler(async (event) => {
    await rateLimit(event, { name: 'reset-password', ...RATE_LIMIT_POLICIES.RESET_CONSUME })

    const { token, password } = await readValidatedBody(event, schema.parse)
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(
            and(eq(passwordResetTokens.tokenHash, tokenHash), isNull(passwordResetTokens.usedAt)),
        )
        .limit(1)

    if (!row || new Date(row.expiresAt) < new Date()) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid or expired token' })
    }

    const passwordHash = await hashUserPassword(password)
    await db.update(users).set({ passwordHash }).where(eq(users.id, row.userId))
    await db
        .update(passwordResetTokens)
        .set({ usedAt: new Date() })
        .where(eq(passwordResetTokens.id, row.id))

    await tryLogAudit(event, 'user.password.reset.completed', row.userId)
    return { ok: true }
})
