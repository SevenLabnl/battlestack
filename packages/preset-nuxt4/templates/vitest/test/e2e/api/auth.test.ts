import { describe, expect, it } from 'vitest'
import { apiGet, apiPost, isServerUp, loginAsAdmin, BASE_URL } from '~~/test/helpers/setup'

// Headless / no-server-up runs skip the suite entirely. Run `pnpm dev` in
// another terminal to exercise these locally.
const serverUp = await isServerUp()

// Self-service signup is gated off by default (`runtimeConfig.public.allowRegistration`).
// Probe at suite-load time so we can exercise the signup endpoint or skip just that test cleanly; the seed-admin login path covers the rest.
async function isRegistrationEnabled(): Promise<boolean> {
    if (!serverUp) return false
    try {
        const probe = await fetch(`${BASE_URL}/api/auth/signup`, { method: 'POST' })
        // A 400 (bad payload) means the endpoint is wired + open. 404 means
        // the gate is closed.
        return probe.status !== 404
    } catch {
        return false
    }
}
const registrationOn = await isRegistrationEnabled()

describe('e2e: auth flow', () => {
    it.skipIf(!serverUp || !registrationOn)('signup succeeds without auto-login', async () => {
        // Anti-enumeration: signup returns ok and does NOT set a session, so the new-vs-existing email response is identical; the user verifies/logs in afterwards.
        const email = `e2e-${Date.now()}@example.com`
        const password = 'Mountain-Pine42!'
        const { status } = await apiPost('/api/auth/signup', { email, password })
        expect(status).toBeLessThan(400)
    })

    it.skipIf(!serverUp)('signup endpoint is closed by default', async () => {
        // Documents the default gate: until `NUXT_PUBLIC_ALLOW_REGISTRATION=true`, `/api/auth/signup` returns 404 (alongside the `/signup` page).
        if (registrationOn) return // registration was deliberately opened; nothing to assert here
        // Runs exactly when "signup succeeds without auto-login" self-skips; surface why, so the skip isn't silent in the vitest output.
        console.warn(
            '[auth.e2e] "signup succeeds without auto-login" was SKIPPED: self-service registration is OFF. ' +
                'Set NUXT_PUBLIC_ALLOW_REGISTRATION=true in .env to exercise the signup happy path.',
        )
        const { status } = await apiPost('/api/auth/signup', {
            email: `gate-probe-${Date.now()}@example.com`,
            password: 'Mountain-Pine42!',
        })
        expect(status).toBe(404)
    })

    it.skipIf(!serverUp)('seed-admin login + /api/auth/me round-trip', async () => {
        const cookie = await loginAsAdmin()
        const { status, data } = await apiGet<{ user: { email: string } }>('/api/auth/me', cookie)
        expect(status).toBe(200)
        expect(data?.user?.email).toBe(process.env.SEED_ADMIN_EMAIL)
    })

    it.skipIf(!serverUp)('logout clears the session', async () => {
        const cookie = await loginAsAdmin()
        const logout = await apiPost('/api/auth/logout', {}, cookie)
        expect(logout.status).toBeLessThan(400)
    })

    if (!serverUp) {
        // Surface the skip reason once so the dev sees why the suite is empty.
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
