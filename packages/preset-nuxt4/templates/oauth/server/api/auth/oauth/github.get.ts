import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users, Role, type Role as RoleT } from '#server/database/schema/users'
import { oauthAccounts } from '#server/database/schema/oauth-accounts'
import { createDbSession } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineOAuthGitHubEventHandler({
    async onSuccess(event, { user: gh }) {
        const providerUserId = String(gh.id)
        const email = (gh.email as string | null) ?? `${gh.login}@users.noreply.github.com`

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
                        name: (gh.name as string | null) ?? gh.login,
                        passwordHash: '',
                        role: Role.User,
                    })
                    .returning()
            }
            await db.insert(oauthAccounts).values({
                userId: user!.id,
                provider: 'github',
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
        await tryLogAudit(event, 'auth.oauth.signin', user.id, { provider: 'github' })
        return sendRedirect(event, '/dashboard')
    },
    onError(event, error) {
        console.error('[oauth:github] callback error', error)
        return sendRedirect(event, '/login?error=oauth')
    },
})
