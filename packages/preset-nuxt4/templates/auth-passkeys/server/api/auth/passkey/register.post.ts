import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { webauthnCredentials, webauthnChallenges } from '#server/database/schema/auth-passkeys'
import { CHALLENGE_TTL_MS } from '#server/utils/passkey-constants'
import { tryLogAudit } from '#server/utils/audit-bridge'

export default defineWebAuthnRegisterEventHandler({
    async storeChallenge(_event, challenge, attemptId) {
        await db.insert(webauthnChallenges).values({
            challenge,
            purpose: `register:${attemptId}`,
            expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        })
    },

    async getChallenge(_event, attemptId) {
        const purpose = `register:${attemptId}`
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

    validateUser: (user) =>
        z
            .object({
                userName: z.email().toLowerCase().trim(),
                displayName: z.string().min(1).trim(),
            })
            .parseAsync(user),

    async onSuccess(event, { user, credential }) {
        const session = await getUserSession(event)
        if (!session.user?.id) {
            throw createError({
                statusCode: 401,
                message: 'Sign in before registering a passkey',
            })
        }

        await db.insert(webauthnCredentials).values({
            id: credential.id,
            userId: session.user.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            backedUp: credential.backedUp ? 'true' : 'false',
            transports: JSON.stringify(credential.transports ?? []),
            label: user.displayName,
        })

        await tryLogAudit(event, 'user.passkey.registered', session.user.id, {
            credentialId: credential.id,
            label: user.displayName,
        })
    },
})
