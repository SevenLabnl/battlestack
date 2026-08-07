import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users, type Role } from '#server/database/schema/users'
import { createDbSession, type SessionUser } from '#server/utils/auth'
import { isMagicLoginAllowed } from '#server/utils/magic-login-guard'

/**
 * Dev-only magic-link login, signed with the SAME secret that seals session cookies, so a forgeable signature is total compromise. Two guards stack:
 * `import.meta.dev` (never `process.env.NODE_ENV`, inlined at build time, so production compiles the body out) and a local-host check that 404s a tunnel.
 */
const bodySchema = z.object({
    token: z.string().min(1),
    sig: z.string().min(1),
})

export default defineEventHandler(async (event) => {
    const host = getRequestHeader(event, 'host') ?? ''
    if (!isMagicLoginAllowed(import.meta.dev, host)) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }

    const config = useRuntimeConfig(event)
    const secret = String((config.session as { password?: unknown } | undefined)?.password ?? '')
    if (!secret) {
        throw createError({
            statusCode: 500,
            statusMessage: 'runtimeConfig.session.password is not set',
        })
    }

    const { token, sig } = await readValidatedBody(event, bodySchema.parse)

    const expected = createHmac('sha256', secret).update(token).digest('hex')
    const sigBuf = Buffer.from(sig, 'hex')
    const expBuf = Buffer.from(expected, 'hex')
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
        throw createError({ statusCode: 401, statusMessage: 'Invalid signature' })
    }

    let payload: { email?: unknown; exp?: unknown }
    try {
        payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
    } catch {
        throw createError({ statusCode: 400, statusMessage: 'Malformed token' })
    }

    const exp = typeof payload.exp === 'number' ? payload.exp : 0
    if (exp * 1000 < Date.now()) {
        throw createError({ statusCode: 401, statusMessage: 'Token expired' })
    }

    const email = String(payload.email ?? '').trim().toLowerCase()
    if (!email) {
        throw createError({ statusCode: 400, statusMessage: 'Missing email in token' })
    }

    const [row] = await db
        .select({ id: users.id, email: users.email, name: users.name, role: users.role })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

    if (!row) {
        throw createError({ statusCode: 404, statusMessage: `User not found: ${email}` })
    }

    const sessionId = await createDbSession(row.id, event)
    const sessionUser: SessionUser = {
        id: row.id,
        email: row.email,
        name: row.name ?? undefined,
        // drizzle widens the `text` column to string; only Role values are ever written here.
        role: (row.role ?? undefined) as Role | undefined,
    }

    await setUserSession(event, {
        user: sessionUser,
        secure: { sessionId },
    })

    return { ok: true }
})
