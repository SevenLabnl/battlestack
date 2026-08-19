import { describe, expect, it, afterEach, vi } from 'vitest'
import { fetchGatewayModelsDetailed, isEmbeddingModel, unifyModelIds } from '../src/utils/ai-gateway.js'

describe('unifyModelIds', () => {
    it('dedupes repeated ids (one row per backend)', () => {
        expect(
            unifyModelIds([
                'gemini/gemini-2.5-flash',
                'gemini/gemini-2.5-flash',
                'gemini/gemini-2.5-flash',
                'openai/gpt-4o',
                'openai/gpt-4o',
                'anthropic/claude-sonnet-4-6',
            ]),
        ).toEqual([
            'gemini/gemini-2.5-flash',
            'openai/gpt-4o',
            'anthropic/claude-sonnet-4-6',
        ])
    })

    it('preserves first-seen order', () => {
        expect(unifyModelIds(['c', 'a', 'b', 'a', 'c'])).toEqual(['c', 'a', 'b'])
    })

    it('drops empty strings', () => {
        expect(unifyModelIds(['', 'gpt-4o', ''])).toEqual(['gpt-4o'])
    })

    it('drops bare form when prefixed form exists', () => {
        expect(
            unifyModelIds([
                'openai/gpt-5.6-luna',
                'gpt-5.6-luna',
                'gemini/gemini-2.5-flash',
                'gemini-2.5-flash',
                'standalone-model',
            ]),
        ).toEqual([
            'openai/gpt-5.6-luna',
            'gemini/gemini-2.5-flash',
            'standalone-model',
        ])
    })

    it('drops wildcard entries', () => {
        expect(unifyModelIds(['*', 'openai/*', 'openai/gpt-4o'])).toEqual([
            'openai/gpt-4o',
        ])
    })
})

describe('isEmbeddingModel', () => {
    it.each([
        ['text-embedding-3-small', true],
        ['voyage-3', true],
        ['cohere-embed-english-v3', true],
        ['gpt-5.6-luna', false],
        ['claude-sonnet-4-6', false],
    ])('classifies %s -> %s', (id, expected) => {
        expect(isEmbeddingModel(id)).toBe(expected)
    })
})

describe('fetchGatewayModelsDetailed', () => {
    const original = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = original
    })

    it('returns null models on non-ok response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as never) as never
        const { models } = await fetchGatewayModelsDetailed('k', 'https://x.test')
        expect(models).toBeNull()
    })

    it('classifies returned models into chat + embedding', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'gpt-5.6-luna' },
                    { id: 'text-embedding-3-small' },
                    { id: 'claude-sonnet-4-6' },
                    { id: 'voyage-3' },
                ],
            }),
        } as never) as never
        const { models } = await fetchGatewayModelsDetailed('k', 'https://x.test')
        expect(models?.chat).toEqual(['claude-sonnet-4-6', 'gpt-5.6-luna'])
        expect(models?.embedding).toEqual(['text-embedding-3-small', 'voyage-3'])
    })

    it('dedupes repeated backends to one row per id (chat + embedding)', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'gemini/gemini-2.5-flash' },
                    { id: 'gemini/gemini-2.5-flash' },
                    { id: 'gemini/gemini-2.5-flash' },
                    { id: 'openai/gpt-5.6-luna' },
                    { id: 'openai/gpt-5.6-luna' },
                    { id: 'voyage/voyage-3' },
                    { id: 'voyage/voyage-3' },
                ],
            }),
        } as never) as never
        const { models } = await fetchGatewayModelsDetailed('k', 'https://x.test')
        expect(models?.chat).toEqual(['gemini/gemini-2.5-flash', 'openai/gpt-5.6-luna'])
        expect(models?.embedding).toEqual(['voyage/voyage-3'])
    })

    it('dedupes embedding models even when they outnumber chat entries', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    // 7 backends per embedding model
                    ...Array(7).fill({ id: 'gemini/text-embedding-004' }),
                    ...Array(7).fill({ id: 'openai/text-embedding-3-small' }),
                    ...Array(3).fill({ id: 'voyage/voyage-3' }),
                    { id: 'gemini/gemini-2.5-flash' },
                ],
            }),
        } as never) as never
        const { models } = await fetchGatewayModelsDetailed('k', 'https://x.test')
        expect(models?.chat).toEqual(['gemini/gemini-2.5-flash'])
        expect(models?.embedding).toEqual([
            'gemini/text-embedding-004',
            'openai/text-embedding-3-small',
            'voyage/voyage-3',
        ])
    })

    it('strips trailing slashes when building /v1/models URL', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: [] }),
        } as never)
        globalThis.fetch = fetchSpy as never
        await fetchGatewayModelsDetailed('k', 'https://x.test///')
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://x.test/v1/models',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer k' }),
            }),
        )
    })

    it('accepts a base URL that already ends in /v1 (sluis.ai docs spell it that way)', async () => {
        const fetchSpy = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ data: [] }),
        } as never)
        globalThis.fetch = fetchSpy as never
        await fetchGatewayModelsDetailed('k', 'https://api.sluis.ai/v1')
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://api.sluis.ai/v1/models',
            expect.anything(),
        )
    })

    it('returns null models on fetch throw', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as never
        const { models } = await fetchGatewayModelsDetailed('k', 'https://x.test')
        expect(models).toBeNull()
    })
})
