import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { hashUserPassword } from '#server/utils/password'
import { rateLimit, RATE_LIMIT_POLICIES } from '#server/utils/rate-limit'
import { checkPasswordPolicy } from '#server/utils/password-policy'
import { tryLogAudit } from '#server/utils/audit-bridge'
import { sendEmail } from '#server/utils/email'
import { emailContent } from '#server/utils/email-templates'

const schema = z.object({
    email: z.email().toLowerCase().trim(),
    password: z.string().min(1, 'Password is required'),
})

export default defineEventHandler(async (event) => {
    // Opt-in via `NUXT_PUBLIC_ALLOW_REGISTRATION=true`. Closed by default so a project ships with only the seed admin.
    const cfg = useRuntimeConfig(event)
    if (cfg.public.allowRegistration !== true) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' })
    }

    await rateLimit(event, { name: 'auth:signup', ...RATE_LIMIT_POLICIES.SIGNUP })

    const { email, password } = await readValidatedBody(event, schema.parse)

    const policy = checkPasswordPolicy(password)
    if (!policy.valid) {
        throw createError({ statusCode: 400, statusMessage: policy.error })
    }

    // Anti-enumeration: identical `{ ok: true }` either way. Do NOT add auto-login here;
    // a session cookie on only the new-user path would itself leak which emails exist.
    const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
    if (existing) {
        // Notify the real owner out-of-band instead of revealing the address.
        try {
            const base = String(useRuntimeConfig().public?.appUrl ?? '')
            if (base) {
                const body = emailContent('account-exists', existing.locale, {
                    link: `${base}/login`,
                    ttlMs: 0,
                })
                await sendEmail({ to: existing.email, ...body })
            }
        } catch (err) {
            console.error('[signup] account-exists notice failed', err)
        }
        await tryLogAudit(event, 'user.signup.duplicate', existing.id)
        return { ok: true }
    }

    const passwordHash = await hashUserPassword(password)
    const [created] = await db.insert(users).values({ email, passwordHash }).returning({
        id: users.id,
        email: users.email,
        role: users.role,
        locale: users.locale,
    })

    if (!created) {
        throw createError({ statusCode: 500, statusMessage: 'Failed to create user' })
    }

    await tryLogAudit(event, 'user.signup', created.id)

    // A hook, not an import: `nuxt:auth-verification` may be absent, and importing
    // `#server/utils/email-verification` would fail the Nitro build with ENOENT when it is.
    await useNitroApp().hooks.callHook('auth:user-registered', {
        id: created.id,
        email: created.email,
        locale: created.locale,
    })

    return { ok: true }
})
