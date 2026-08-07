import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { emailVerificationTokens, userEmailVerified } from '#server/database/schema/email-verification'
import { sendEmail } from '#server/utils/email'
import { rateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { emailContent } from '#server/utils/email-templates'

// Public (mirrors forgot-password): a login-blocked user has no session, so this can't require one. Always returns
// `{ ok: true }`, never revealing whether the email exists or is verified (no account enumeration). Rate-limited by IP.
const schema = z.object({ email: z.email().toLowerCase().trim() })
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

export default defineEventHandler(async (event) => {
    await rateLimit(event, { name: 'resend-verification', ...RATE_LIMIT_POLICIES.VERIFY_EMAIL })

    const { email } = await readValidatedBody(event, schema.parse)

    const base = String(useRuntimeConfig().public?.appUrl ?? '')
    if (!base) {
        throw createError({
            statusCode: 500,
            statusMessage: 'NUXT_PUBLIC_APP_URL not set: cannot build verification link.',
        })
    }

    const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (u) {
        const [already] = await db
            .select({ userId: userEmailVerified.userId })
            .from(userEmailVerified)
            .where(eq(userEmailVerified.userId, u.id))
            .limit(1)
        if (!already) {
            const token = randomBytes(32).toString('hex')
            const tokenHash = createHash('sha256').update(token).digest('hex')
            await db.insert(emailVerificationTokens).values({
                userId: u.id,
                tokenHash,
                expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            })
            const link = `${base}/verify-email?token=${token}`
            const body = emailContent('verify-email', u.locale, { link, ttlMs: TOKEN_TTL_MS })
            await sendEmail({ to: u.email, ...body })
            await tryLogAudit(event, 'user.email.verification.resent', u.id)
        }
    }

    return { ok: true }
})
