import { createHash, randomBytes } from 'node:crypto'
import { db } from '#server/database/client'
import { emailVerificationTokens } from '#server/database/schema/email-verification'
import { sendEmail } from '#server/utils/email'
import { emailContent } from '#server/utils/email-templates'

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000

/** Issue an email verification token and send the email. */
export async function issueVerificationEmail(
    userId: string,
    email: string,
    locale: string | null = null,
): Promise<void> {
    const token = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(token).digest('hex')

    await db.insert(emailVerificationTokens).values({
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    })

    const base = String(useRuntimeConfig().public?.appUrl ?? '')
    if (!base) {
        throw new Error('NUXT_PUBLIC_APP_URL not set: cannot build verification link.')
    }
    const link = `${base}/verify-email?token=${token}`
    const body = emailContent('verify-email', locale, { link, ttlMs: TOKEN_TTL_MS })

    await sendEmail({ to: email, ...body })
}
