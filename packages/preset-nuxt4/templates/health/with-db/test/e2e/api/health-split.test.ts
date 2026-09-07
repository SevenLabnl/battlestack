import { describe, expect, it } from 'vitest'
import { apiGet, BASE_URL, isServerUp } from '~~/test/helpers/setup'

const serverUp = await isServerUp()

interface LiveResponse {
    status: 'ok'
}

interface ReadyResponse {
    status: 'ok' | 'degraded'
    env: { ok: boolean; missing?: string[] }
    db?: { ok: boolean; latencyMs?: number; error?: string }
}

describe('e2e: /api/health/live (with-db)', () => {
    it.skipIf(!serverUp)('answers 200 and nothing else', async () => {
        const { status, data } = await apiGet<LiveResponse>('/api/health/live')
        expect(status).toBe(200)
        expect(data?.status).toBe('ok')
    })

    // If a future change adds a dependency check to /live, this test is the thing
    // that objects: those checks belong in /api/health/ready.
    it.skipIf(!serverUp)('reports nothing about its dependencies', async () => {
        const { data } = await apiGet<Record<string, unknown>>('/api/health/live')
        expect(Object.keys(data ?? {})).toEqual(['status'])
    })
})

describe('e2e: /api/health/ready (with-db)', () => {
    it.skipIf(!serverUp)('checks env and the database and says so', async () => {
        const { status, data } = await apiGet<ReadyResponse>('/api/health/ready')
        // 503 is a valid answer — the test asserts shape, not that this environment
        // happens to be configured with a healthy database.
        expect([200, 503]).toContain(status)
        expect(data).toBeTruthy()
        expect(['ok', 'degraded']).toContain(data!.status)
        expect(typeof data!.env.ok).toBe('boolean')
        if (data!.env.ok) {
            // The db ping only runs once env passes.
            expect(typeof data!.db?.ok).toBe('boolean')
            expect(data!.status === 'ok').toBe(data!.db!.ok)
        } else {
            expect(data!.status).toBe('degraded')
            expect(data!.db).toBeUndefined()
        }
    })
})

if (!serverUp) {
    it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
        expect(BASE_URL).toBeTypeOf('string')
    })
}
