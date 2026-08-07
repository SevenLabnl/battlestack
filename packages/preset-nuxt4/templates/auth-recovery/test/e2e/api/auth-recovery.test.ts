import { describe, expect, it } from 'vitest'
import { apiPost, isServerUp, BASE_URL } from '~~/test/helpers/setup'

const serverUp = await isServerUp()

// Recovery endpoints intentionally return 200 even when the email isn't registered (anti-enumeration).
// These tests assert the contract, not the full token flow; token plumbing needs reading the email outbox (out of scope for an HTTP-only smoke).
describe('e2e: auth recovery flow', () => {
    it.skipIf(!serverUp)('forgot-password returns 200 for unknown email', async () => {
        const { status } = await apiPost('/api/auth/forgot-password', {
            email: `does-not-exist-${Date.now()}@example.com`,
        })
        expect(status).toBe(200)
    })

    it.skipIf(!serverUp)('forgot-password validates payload shape', async () => {
        const { status } = await apiPost('/api/auth/forgot-password', { email: 'not-an-email' })
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })

    it.skipIf(!serverUp)('reset-password rejects an unknown token', async () => {
        const { status } = await apiPost('/api/auth/reset-password', {
            token: 'nonexistent-token',
            password: 'Mountain-Pine42!',
        })
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
