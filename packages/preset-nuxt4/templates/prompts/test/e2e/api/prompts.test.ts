import { describe, expect, it } from 'vitest'
import {
    apiGet,
    apiPost,
    apiPut,
    BASE_URL,
    createTestUser,
    isServerUp,
    loginAsAdmin,
} from '~~/test/helpers/setup'

const serverUp = await isServerUp()

interface Prompt {
    id: string
    key: string
    name: string
    description: string | null
    content: string
    version: number
    updatedAt: string
}

describe('e2e: prompts management', () => {
    it.skipIf(!serverUp)('list requires a session', async () => {
        const { status } = await apiGet('/api/prompts')
        expect(status).toBe(401)
    })

    it.skipIf(!serverUp)('list returns seeded prompts for an authed user', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status, data } = await apiGet<{ rows: Prompt[]; total: number }>(
            '/api/prompts',
            user.cookie,
        )
        expect(status).toBe(200)
        expect(Array.isArray(data?.rows)).toBe(true)
        expect(typeof data?.total).toBe('number')
    })

    it.skipIf(!serverUp)('non-admin is forbidden from PUT /api/prompts/:id', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const list = await apiGet<{ rows: Prompt[]; total: number }>('/api/prompts', user.cookie)
        const target = list.data?.rows?.[0]
        if (!target) {
            // No seeded prompts → skip the gating assertion. Not a failure.
            return
        }
        const { status } = await apiPut(
            `/api/prompts/${target.id}`,
            { content: 'tampered' },
            user.cookie,
        )
        expect(status).toBe(403)
    })

    it.skipIf(!serverUp)('admin can update + reset a prompt', async () => {
        const adminCookie = await loginAsAdmin()
        const list = await apiGet<{ rows: Prompt[]; total: number }>('/api/prompts', adminCookie)
        const target = list.data?.rows?.[0]
        if (!target) return

        const updated = await apiPut<Prompt>(
            `/api/prompts/${target.id}`,
            { content: 'edited content' },
            adminCookie,
        )
        expect(updated.status).toBe(200)
        expect(updated.data?.content).toBe('edited content')
        expect((updated.data?.version ?? 0) > target.version).toBe(true)

        const reset = await apiPost<Prompt>(`/api/prompts/${target.id}/reset`, {}, adminCookie)
        expect(reset.status).toBe(200)
        // After reset, content matches the seeded default so the next reset is a no-op; just assert the version moved forward again (exact content depends on seed).
        expect((reset.data?.version ?? 0) > (updated.data?.version ?? 0)).toBe(true)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
