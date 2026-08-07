import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { users } from '#server/database/schema/users'
import { totpSecrets } from '#server/database/schema/auth-2fa'
import { encryptSecret, generateTotpSecret, otpauthUrl } from '#server/utils/totp'

const SETUP_TTL_MS = 15 * 60 * 1000

export default defineEventHandler(async (event) => {
    const { user } = await requireUserSession(event)
    const userId = user.id

    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'Pragma', 'no-cache')

    const [existing] = await db
        .select()
        .from(totpSecrets)
        .where(eq(totpSecrets.userId, userId))
        .limit(1)

    if (existing?.enabled) {
        throw createError({
            statusCode: 409,
            statusMessage: '2FA is already enabled. Disable it before re-setting up.',
        })
    }

    const secret = generateTotpSecret()
    const encryptedSecret = encryptSecret(secret)
    const setupExpiresAt = new Date(Date.now() + SETUP_TTL_MS)

    if (existing) {
        await db
            .update(totpSecrets)
            .set({ encryptedSecret, enabled: false, createdAt: new Date(), setupExpiresAt })
            .where(eq(totpSecrets.userId, userId))
    } else {
        await db.insert(totpSecrets).values({ userId, encryptedSecret, setupExpiresAt })
    }

    const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
    const issuer = String(useRuntimeConfig().public?.appName ?? 'Battlestack App')

    return {
        secret,
        otpauthUrl: otpauthUrl(secret, u?.email ?? userId, issuer),
    }
})
