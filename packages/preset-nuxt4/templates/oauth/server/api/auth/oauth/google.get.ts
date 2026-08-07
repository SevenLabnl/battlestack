import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users, Role, type Role as RoleT } from '#server/database/schema/users'
import { oauthAccounts } from '#server/database/schema/oauth-accounts'
import { createDbSession } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineOAuthGoogleEventHandler({
    async onSuccess(event, { user: g }) {
        const providerUserId = String(g.sub)
        const email = (g.email as string | undefined) ?? ''
        if (!email) {
            throw createError({
                statusCode: 400,
                statusMessage: 'Google account did not return an email',
            })
        }

        const [link] = await db
            .select()
            .from(oauthAccounts)
            .where(eq(oauthAccounts.providerUserId, providerUserId))
            .limit(1)

        let user
        if (link) {
            ;[user] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1)
        } else {
            const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1)
            if (existing) {
                user = existing
            } else {
                ;[user] = await db
                    .insert(users)
                    .values({
                        email,
                        name: (g.name as string | undefined) ?? email.split('@')[0],
                        passwordHash: '',
                        role: Role.User,
                    })
                    .returning()
            }
            await db.insert(oauthAccounts).values({
                userId: user!.id,
                provider: 'google',
                providerUserId,
            })
        }

        if (!user) {
            throw createError({ statusCode: 500, statusMessage: 'Failed to resolve user' })
        }

        const sessionId = await createDbSession(user.id, event)
        await setUserSession(event, {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role as RoleT,
            },
            secure: { sessionId },
            loggedInAt: Date.now(),
        })
        await tryLogAudit(event, 'auth.oauth.signin', user.id, { provider: 'google' })
        return sendRedirect(event, '/dashboard')
    },
    onError(event, error) {
        console.error('[oauth:google] callback error', error)
        return sendRedirect(event, '/login?error=oauth')
    },
})
