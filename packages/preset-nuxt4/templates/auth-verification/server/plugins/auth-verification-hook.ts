import { issueVerificationEmail } from '#server/utils/email-verification'

/**
 * Bridges `nuxt:auth`'s signup (`auth:user-registered` hook) to this feature's verification email without `nuxt:auth` importing it.
 * Best-effort: a failure here never breaks the signup response; the user can re-request via `/api/auth/resend-verification`.
 */
export default defineNitroPlugin((nitroApp) => {
    nitroApp.hooks.hook('auth:user-registered', async (user) => {
        try {
            await issueVerificationEmail(user.id, user.email, user.locale)
        } catch (err) {
            console.error('[auth-verification] verification email hook failed', err)
        }
    })
})
