import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { users, type Role } from '#server/database/schema/users'
import { verifyUserPassword } from '#server/utils/password'
import { rateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'
import { createMfaChallenge } from '#server/utils/mfa-challenge'
import { createDbSession } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineEventHandler(async (event) => {
    await rateLimit(event, { name: 'auth:login', ...RATE_LIMIT_POLICIES.LOGIN })

    const body = await readValidatedBody(
        event,
        z.object({ email: z.email(), password: z.string().min(1) }).parse,
    )

    const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1)
    if (!user) {
        await tryLogAudit(event, 'user.login.fail', null, { email: body.email })
        throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
    }

    const ok = await verifyUserPassword(user.passwordHash, body.password)
    if (!ok) {
        await tryLogAudit(event, 'user.login.fail', user.id, { email: body.email })
        throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
    }

    // Optional gate from `nuxt:auth-verification`. The table read is guarded so login still works when that feature is absent.
    if (useRuntimeConfig().public.requireEmailVerification === true && !(await isEmailVerified(user.id))) {
        await tryLogAudit(event, 'user.login.unverified', user.id)
        throw createError({
            statusCode: 403,
            statusMessage: 'Email not verified',
            data: { code: 'EMAIL_NOT_VERIFIED' },
        })
    }

    if (await isTotpEnabled(user.id)) {
        return { requiresMfa: true, mfaToken: createMfaChallenge(user.id) }
    }

    const sessionId = await createDbSession(user.id, event)
    await setUserSession(event, {
        user: { id: user.id, email: user.email, role: user.role as Role },
        secure: { sessionId },
        loggedInAt: Date.now(),
    })
    await tryLogAudit(event, 'user.login.success', user.id)
    return { ok: true }
})

// Returns true when the table is missing, so a project without `nuxt:auth-verification` is never locked out of login.
async function isEmailVerified(userId: string): Promise<boolean> {
    try {
        const rows = await db.execute(
            sql`SELECT 1 FROM user_email_verified WHERE user_id = ${userId} LIMIT 1`,
        )
        return (rows as unknown as unknown[]).length > 0
    } catch {
        return true
    }
}

async function isTotpEnabled(userId: string): Promise<boolean> {
    try {
        const rows = await db.execute(
            sql`SELECT enabled FROM totp_secrets WHERE user_id = ${userId} LIMIT 1`,
        )
        const first = (rows as unknown as Array<{ enabled: boolean }>)[0]
        return first?.enabled === true
    } catch {
        return false
    }
}
