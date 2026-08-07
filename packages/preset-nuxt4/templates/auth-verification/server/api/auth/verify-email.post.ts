import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { db } from '#server/database/client'
import { emailVerificationTokens, userEmailVerified } from '#server/database/schema/email-verification'
import { tryLogAudit } from '#server/utils/audit-bridge'

const schema = z.object({ token: z.string().min(32).max(128) })

export default defineEventHandler(async (event) => {
    const { token } = await readValidatedBody(event, schema.parse)
    const tokenHash = createHash('sha256').update(token).digest('hex')

    const [row] = await db
        .select()
        .from(emailVerificationTokens)
        .where(
            and(
                eq(emailVerificationTokens.tokenHash, tokenHash),
                isNull(emailVerificationTokens.usedAt),
            ),
        )
        .limit(1)

    if (!row || new Date(row.expiresAt) < new Date()) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid or expired token' })
    }

    await db.insert(userEmailVerified).values({ userId: row.userId }).onConflictDoNothing()
    await db
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, row.id))

    await tryLogAudit(event, 'user.email.verified', row.userId)
    return { ok: true }
})
