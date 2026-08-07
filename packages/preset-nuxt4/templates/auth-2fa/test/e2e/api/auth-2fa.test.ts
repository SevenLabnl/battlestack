import { describe, expect, it } from 'vitest'
import {
    apiGet,
    apiPost,
    BASE_URL,
    createTestUser,
    isServerUp,
    loginAsAdmin,
} from '~~/test/helpers/setup'

const serverUp = await isServerUp()

// Setup → verify → disable round trip without a real authenticator app. Verify itself is covered in `server/utils/totp.ts` unit tests.
// Here: the HTTP contract, setup returns secret + URL, status reflects disabled until verify, disable refuses without a current code.
describe('e2e: auth-2fa', () => {
    it.skipIf(!serverUp)('status reports disabled before setup', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status, data } = await apiGet<{ enabled: boolean }>(
            '/api/auth/2fa/status',
            user.cookie,
        )
        expect(status).toBe(200)
        expect(data?.enabled).toBe(false)
    })

    it.skipIf(!serverUp)('setup returns a secret + provisioning URL', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status, data } = await apiPost<{ secret: string; otpauthUrl: string }>(
            '/api/auth/2fa/setup',
            {},
            user.cookie,
        )
        expect(status).toBe(200)
        expect(typeof data?.secret).toBe('string')
        expect(typeof data?.otpauthUrl).toBe('string')
        expect(data?.otpauthUrl).toContain('otpauth://')
    })

    it.skipIf(!serverUp)('verify rejects an invalid code', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        await apiPost('/api/auth/2fa/setup', {}, user.cookie)
        const { status } = await apiPost('/api/auth/2fa/verify', { code: '000000' }, user.cookie)
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })

    it.skipIf(!serverUp)('disable refuses when no code is provided', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status } = await apiPost('/api/auth/2fa/disable', {}, user.cookie)
        expect(status).toBeGreaterThanOrEqual(400)
    })

    it.skipIf(!serverUp)('backup-codes status requires a session', async () => {
        const { status } = await apiGet('/api/auth/2fa/backup-codes')
        expect(status).toBe(401)
    })

    it.skipIf(!serverUp)('backup-codes generate refuses when 2FA is not enabled', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status } = await apiPost('/api/auth/2fa/backup-codes/generate', {}, user.cookie)
        // 400: TOTP must be enabled first.
        expect(status).toBe(400)
    })

    it.skipIf(!serverUp)('backup-codes redeem rejects bogus codes', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status } = await apiPost(
            '/api/auth/2fa/backup-codes/redeem',
            { code: 'aaaa-bbbb-cccc-dddd' },
            user.cookie,
        )
        expect(status).toBe(401)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
