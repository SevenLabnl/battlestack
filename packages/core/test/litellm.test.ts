import { describe, expect, it, afterEach, vi } from 'vitest'
import { fetchLiteLLMModels, isEmbeddingModel, unifyModelIds } from '../src/utils/litellm.js'

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
                'openai/gpt-4o-mini',
                'gpt-4o-mini',
                'gemini/gemini-2.5-flash',
                'gemini-2.5-flash',
                'standalone-model',
            ]),
        ).toEqual([
            'openai/gpt-4o-mini',
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
        ['gpt-4o-mini', false],
        ['claude-sonnet-4-6', false],
    ])('classifies %s -> %s', (id, expected) => {
        expect(isEmbeddingModel(id)).toBe(expected)
    })
})

describe('fetchLiteLLMModels', () => {
    const original = globalThis.fetch
    afterEach(() => {
        globalThis.fetch = original
    })

    it('returns null on non-ok response', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as never) as never
        expect(await fetchLiteLLMModels('k', 'https://x.test')).toBeNull()
    })

    it('classifies returned models into chat + embedding', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                data: [
                    { id: 'gpt-4o-mini' },
                    { id: 'text-embedding-3-small' },
                    { id: 'claude-sonnet-4-6' },
                    { id: 'voyage-3' },
                ],
            }),
        } as never) as never
        const models = await fetchLiteLLMModels('k', 'https://x.test')
        expect(models?.chat).toEqual(['claude-sonnet-4-6', 'gpt-4o-mini'])
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
                    { id: 'openai/gpt-4o-mini' },
                    { id: 'openai/gpt-4o-mini' },
                    { id: 'voyage/voyage-3' },
                    { id: 'voyage/voyage-3' },
                ],
            }),
        } as never) as never
        const models = await fetchLiteLLMModels('k', 'https://x.test')
        expect(models?.chat).toEqual(['gemini/gemini-2.5-flash', 'openai/gpt-4o-mini'])
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
        const models = await fetchLiteLLMModels('k', 'https://x.test')
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
        await fetchLiteLLMModels('k', 'https://x.test///')
        expect(fetchSpy).toHaveBeenCalledWith(
            'https://x.test/v1/models',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer k' }),
            }),
        )
    })

    it('returns null on fetch throw', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network')) as never
        expect(await fetchLiteLLMModels('k', 'https://x.test')).toBeNull()
    })
})
