import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users, type Role } from '#server/database/schema/users'
import { webauthnCredentials, webauthnChallenges } from '#server/database/schema/auth-passkeys'
import { CHALLENGE_TTL_MS } from '#server/utils/passkey-constants'
import { createDbSession } from '#server/utils/auth'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineWebAuthnAuthenticateEventHandler({
    async storeChallenge(_event, challenge, attemptId) {
        await db.insert(webauthnChallenges).values({
            challenge,
            purpose: `auth:${attemptId}`,
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        })
    },

    async getChallenge(_event, attemptId) {
        const purpose = `auth:${attemptId}`
        const [row] = await db
            .select()
            .from(webauthnChallenges)
            .where(eq(webauthnChallenges.purpose, purpose))
            .limit(1)
        if (!row || new Date(row.expiresAt) < new Date()) {
            throw createError({ statusCode: 400, message: 'Challenge not found or expired' })
        }
        await db.delete(webauthnChallenges).where(eq(webauthnChallenges.id, row.id))
        return row.challenge
    },

    async allowCredentials(_event, userName) {
        const [user] = await db.select().from(users).where(eq(users.email, userName)).limit(1)
        if (!user) return []

        const creds = await db
            .select()
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.userId, user.id))

        return creds.map((c) => ({
            id: c.id,
            transports: c.transports
                ? (JSON.parse(c.transports) as AuthenticatorTransport[])
                : undefined,
        }))
    },

    async getCredential(_event, credentialID) {
        const [cred] = await db
            .select()
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.id, credentialID))
            .limit(1)
        // Browser presented a passkey from the OS keychain with no matching server record (stale device, reset DB, re-installed app).
        // Return 401 + actionable message so the client can prompt for password.
        if (!cred) {
            throw createError({
                statusCode: 401,
                statusMessage:
                    'This passkey is no longer registered. Sign in with your password, then re-add the passkey from Security.',
            })
        }
        return {
            id: cred.id,
            publicKey: cred.publicKey,
            counter: cred.counter,
            backedUp: cred.backedUp === 'true',
            transports: cred.transports
                ? (JSON.parse(cred.transports) as AuthenticatorTransport[])
                : undefined,
        }
    },

    async onSuccess(event, { credential, authenticationInfo }) {
        await db
            .update(webauthnCredentials)
            .set({ counter: authenticationInfo.newCounter, lastUsedAt: new Date() })
            .where(eq(webauthnCredentials.id, credential.id))

        const [cred] = await db
            .select()
            .from(webauthnCredentials)
            .where(eq(webauthnCredentials.id, credential.id))
            .limit(1)
        if (!cred) {
            throw createError({ statusCode: 500, message: 'Credential disappeared mid-auth' })
        }

        const [user] = await db.select().from(users).where(eq(users.id, cred.userId)).limit(1)
        // Credential row points at a user that no longer exists (deleted account).
        // Treat the credential as stale and prune so subsequent attempts fail fast.
        if (!user) {
            await db.delete(webauthnCredentials).where(eq(webauthnCredentials.id, cred.id))
            throw createError({
                statusCode: 401,
                statusMessage:
                    'This passkey is no longer registered. Sign in with your password, then re-add the passkey from Security.',
            })
        }

        const sessionId = await createDbSession(user.id, event)
        await setUserSession(event, {
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role as Role,
                theme: user.theme,
                locale: user.locale,
            },
            secure: { sessionId },
            loggedInAt: Date.now(),
        })
        await tryLogAudit(event, 'user.passkey.login', user.id, {
            credentialId: cred.id,
            label: cred.label ?? null,
            deviceType: cred.deviceType ?? null,
        })
    },
})
