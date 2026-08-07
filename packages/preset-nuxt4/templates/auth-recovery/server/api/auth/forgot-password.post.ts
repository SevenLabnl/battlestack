import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { createHash, randomBytes } from 'node:crypto'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { passwordResetTokens } from '#server/database/schema/auth-recovery'
import { sendEmail } from '#server/utils/email'
import { rateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { emailContent } from '#server/utils/email-templates'

const schema = z.object({
    email: z.email().toLowerCase().trim(),
})

const TOKEN_TTL_MS = 60 * 60 * 1000

export default defineEventHandler(async (event) => {
    await rateLimit(event, { name: 'forgot-password', ...RATE_LIMIT_POLICIES.PASSWORD_RESET })

    const { email } = await readValidatedBody(event, schema.parse)
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)

    if (user) {
        const token = randomBytes(32).toString('hex')
        const tokenHash = createHash('sha256').update(token).digest('hex')

        await db.insert(passwordResetTokens).values({
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
        })

        const base = String(useRuntimeConfig().public?.appUrl ?? '')
        if (!base) {
            throw createError({
                statusCode: 500,
                statusMessage: 'NUXT_PUBLIC_APP_URL not set: cannot build reset link.',
            })
        }
        const link = `${base}/reset-password?token=${token}`
        const body = emailContent('reset-password', user.locale, { link, ttlMs: TOKEN_TTL_MS })

        await sendEmail({ to: email, ...body })

        await tryLogAudit(event, 'user.password.reset.requested', user.id)
    }

    return { ok: true }
})
