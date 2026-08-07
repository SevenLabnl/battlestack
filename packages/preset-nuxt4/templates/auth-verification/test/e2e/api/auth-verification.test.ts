import { describe, expect, it } from 'vitest'
import { apiPost, isServerUp, BASE_URL } from '~~/test/helpers/setup'

const serverUp = await isServerUp()

// Verification endpoints are public + anti-enumeration: resend always returns 200 regardless of whether the email exists or is already verified.
// Full token flow requires reading the email outbox (out of scope for an HTTP smoke).
describe('e2e: email verification', () => {
    it.skipIf(!serverUp)('verify-email rejects an unknown token', async () => {
        const { status } = await apiPost('/api/auth/verify-email', {
            token: 'nonexistent-token',
        })
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })

    it.skipIf(!serverUp)('resend-verification returns 200 for unknown email (no session)', async () => {
        const { status } = await apiPost('/api/auth/resend-verification', {
            email: `does-not-exist-${Date.now()}@example.com`,
        })
        expect(status).toBe(200)
    })

    it.skipIf(!serverUp)('resend-verification validates payload shape', async () => {
        const { status } = await apiPost('/api/auth/resend-verification', { email: 'not-an-email' })
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
