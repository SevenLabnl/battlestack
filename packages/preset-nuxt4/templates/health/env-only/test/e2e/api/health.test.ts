import { describe, expect, it } from 'vitest'
import { apiGet, BASE_URL, isServerUp } from '~~/test/helpers/setup'

const serverUp = await isServerUp()

interface HealthResponse {
    status: 'ok' | 'degraded'
    version: string
    checks: {
        env: { ok: boolean; missing?: string[] }
    }
}

describe('e2e: /api/health (env-only)', () => {
    it.skipIf(!serverUp)('returns the expected payload shape', async () => {
        const { status, data } = await apiGet<HealthResponse>('/api/health')
        expect([200, 503]).toContain(status)
        expect(data).toBeTruthy()
        expect(['ok', 'degraded']).toContain(data!.status)
        expect(typeof data!.version).toBe('string')
        expect(typeof data!.checks.env).toBe('object')
    })

    it.skipIf(!serverUp)('omits the db check entirely', async () => {
        const { data } = await apiGet<HealthResponse>('/api/health')
        expect((data as Record<string, unknown> | null)?.checks).toBeTruthy()
        const checks = (data as { checks: Record<string, unknown> } | null)?.checks
        expect(checks && 'db' in checks).toBe(false)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})
