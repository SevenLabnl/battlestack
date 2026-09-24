import { describe, expect, it } from 'vitest'
import { apiGet, BASE_URL, isServerUp } from '~~/test/helpers/setup'

const serverUp = await isServerUp()

interface HealthResponse {
    status: 'ok' | 'degraded'
    version: string
    commit: string
    builtAt: string
    checks: {
        env: { ok: boolean; missing?: string[] }
        db?: { ok: boolean; latencyMs?: number; error?: string }
    }
}

describe('e2e: /api/health (with-db)', () => {
    it.skipIf(!serverUp)('returns 200 ok when env + db are healthy', async () => {
        const { status, data } = await apiGet<HealthResponse>('/api/health')
        // 503 is also valid if DB happens to be down: the test asserts SHAPE, not that the dev environment is healthy.
        expect([200, 503]).toContain(status)
        expect(data).toBeTruthy()
        expect(['ok', 'degraded']).toContain(data!.status)
        expect(typeof data!.version).toBe('string')
        // Present as a key even when the build supplied nothing: an absent field and an
        // unknown commit are different answers, and monitoring has to tell them apart.
        expect(typeof data!.commit).toBe('string')
        expect(typeof data!.builtAt).toBe('string')
        expect(data!.checks).toBeTruthy()
        expect(typeof data!.checks.env).toBe('object')
    })

    it.skipIf(!serverUp)('payload includes the db check', async () => {
        const { data } = await apiGet<HealthResponse>('/api/health')
        expect(data?.checks.db).toBeTruthy()
        expect(typeof data!.checks.db!.ok).toBe('boolean')
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
