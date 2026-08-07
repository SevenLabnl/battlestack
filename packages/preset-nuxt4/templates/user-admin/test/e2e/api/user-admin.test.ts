import { describe, expect, it } from 'vitest'
import {
    apiDelete,
    apiGet,
    apiPost,
    apiPut,
    BASE_URL,
    createTestUser,
    isServerUp,
    loginAsAdmin,
} from '~~/test/helpers/setup'

const serverUp = await isServerUp()

describe('e2e: user admin CRUD', () => {
    it.skipIf(!serverUp)('admin lists users', async () => {
        const cookie = await loginAsAdmin()
        const { status, data } = await apiGet<{
            rows: Array<{ id: string }>
            total: number
            limit: number
            offset: number
        }>('/api/users', cookie)
        expect(status).toBe(200)
        expect(Array.isArray(data?.rows)).toBe(true)
        expect(typeof data?.total).toBe('number')
    })

    it.skipIf(!serverUp)('non-admin is forbidden from /api/users', async () => {
        const adminCookie = await loginAsAdmin()
        const newUser = await createTestUser(adminCookie, { role: 'user' })
        const { status } = await apiGet('/api/users', newUser.cookie)
        expect(status).toBe(403)
    })

    it.skipIf(!serverUp)('admin can update + delete a user', async () => {
        const adminCookie = await loginAsAdmin()
        const newUser = await createTestUser(adminCookie)

        const updated = await apiPut(
            `/api/users/${newUser.id}`,
            { name: 'Updated Name' },
            adminCookie,
        )
        expect(updated.status).toBe(200)

        const removed = await apiDelete(`/api/users/${newUser.id}`, adminCookie)
        expect(removed.status).toBeLessThan(400)
    })

    it.skipIf(!serverUp)('rejects payload with invalid role', async () => {
        const cookie = await loginAsAdmin()
        const { status } = await apiPost(
            '/api/users',
            {
                name: 'Bad',
                email: `e2e-bad-${Date.now()}@example.com`,
                password: 'Mountain-Pine42!',
                role: 'wizard',
            },
            cookie,
        )
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
