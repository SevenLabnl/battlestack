import { describe, expect, it } from 'vitest'
import {
    apiGet,
    apiPut,
    BASE_URL,
    createTestUser,
    isServerUp,
    loginAsAdmin,
} from '~~/test/helpers/setup'

const serverUp = await isServerUp()

interface ModelConfig {
    id: string
    key: string
    name: string
    description: string
    model: string
}

describe('e2e: ai model admin', () => {
    it.skipIf(!serverUp)('list requires a session', async () => {
        const { status } = await apiGet('/api/ai/configs')
        expect(status).toBe(401)
    })

    it.skipIf(!serverUp)('non-admin is forbidden from /api/ai/configs', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status } = await apiGet('/api/ai/configs', user.cookie)
        expect(status).toBe(403)
    })

    it.skipIf(!serverUp)('admin can list seeded configs', async () => {
        const adminCookie = await loginAsAdmin()
        const { status, data } = await apiGet<ModelConfig[]>('/api/ai/configs', adminCookie)
        expect(status).toBe(200)
        expect(Array.isArray(data)).toBe(true)
    })

    it.skipIf(!serverUp)('non-admin is forbidden from PUT /api/ai/configs/:id', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const list = await apiGet<ModelConfig[]>('/api/ai/configs', adminCookie)
        const target = list.data?.[0]
        if (!target) return
        const { status } = await apiPut(
            `/api/ai/configs/${target.id}`,
            { model: 'openai/gpt-5.6-luna' },
            user.cookie,
        )
        expect(status).toBe(403)
    })

    it.skipIf(!serverUp)('admin can update a config model', async () => {
        const adminCookie = await loginAsAdmin()
        const list = await apiGet<ModelConfig[]>('/api/ai/configs', adminCookie)
        const target = list.data?.[0]
        if (!target) return
        const next = 'openai/gpt-5.6-luna'
        const { status, data } = await apiPut<ModelConfig>(
            `/api/ai/configs/${target.id}`,
            { model: next },
            adminCookie,
        )
        expect(status).toBe(200)
        expect(data?.model).toBe(next)
    })

    it.skipIf(!serverUp)('PUT rejects empty model', async () => {
        const adminCookie = await loginAsAdmin()
        const list = await apiGet<ModelConfig[]>('/api/ai/configs', adminCookie)
        const target = list.data?.[0]
        if (!target) return
        const { status } = await apiPut(`/api/ai/configs/${target.id}`, { model: '' }, adminCookie)
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })

    if (!serverUp) {
        it('e2e suite skipped, no server up at TEST_BASE_URL', () => {
            expect(BASE_URL).toBeTypeOf('string')
        })
    }
})

interface AgentRow {
    id: string
    key: string
    name: string
    modelConfigKey: string
    promptKey: string | null
    enabled: boolean
}

describe('e2e: ai agents admin', () => {
    it.skipIf(!serverUp)('list requires a session', async () => {
        const { status } = await apiGet('/api/ai/agents')
        expect(status).toBe(401)
    })

    it.skipIf(!serverUp)('non-admin is forbidden from /api/ai/agents', async () => {
        const adminCookie = await loginAsAdmin()
        const user = await createTestUser(adminCookie)
        const { status } = await apiGet('/api/ai/agents', user.cookie)
        expect(status).toBe(403)
    })

    it.skipIf(!serverUp)('admin lists agents registered on boot', async () => {
        const adminCookie = await loginAsAdmin()
        const { status, data } = await apiGet<AgentRow[]>('/api/ai/agents', adminCookie)
        expect(status).toBe(200)
        expect(Array.isArray(data)).toBe(true)
        // The boot sync always registers the `default` agent.
        expect(data?.some((a) => a.key === 'default')).toBe(true)
    })

    it.skipIf(!serverUp)('admin can repoint an agent model config', async () => {
        const adminCookie = await loginAsAdmin()
        const list = await apiGet<AgentRow[]>('/api/ai/agents', adminCookie)
        const target = list.data?.[0]
        if (!target) return
        const { status, data } = await apiPut<AgentRow>(
            `/api/ai/agents/${target.id}`,
            { modelConfigKey: 'chat' },
            adminCookie,
        )
        expect(status).toBe(200)
        expect(data?.modelConfigKey).toBe('chat')
    })

    it.skipIf(!serverUp)('admin can detach an agent prompt (promptKey null)', async () => {
        const adminCookie = await loginAsAdmin()
        const list = await apiGet<AgentRow[]>('/api/ai/agents', adminCookie)
        const target = list.data?.[0]
        if (!target) return
        const { status, data } = await apiPut<AgentRow>(
            `/api/ai/agents/${target.id}`,
            { promptKey: null },
            adminCookie,
        )
        expect(status).toBe(200)
        expect(data?.promptKey).toBeNull()
    })

    it.skipIf(!serverUp)('PUT rejects an unknown model config key', async () => {
        const adminCookie = await loginAsAdmin()
        const list = await apiGet<AgentRow[]>('/api/ai/agents', adminCookie)
        const target = list.data?.[0]
        if (!target) return
        const { status } = await apiPut(
            `/api/ai/agents/${target.id}`,
            { modelConfigKey: 'does-not-exist' },
            adminCookie,
        )
        expect(status).toBeGreaterThanOrEqual(400)
        expect(status).toBeLessThan(500)
    })
})
