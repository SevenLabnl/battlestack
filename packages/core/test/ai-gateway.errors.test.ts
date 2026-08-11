import { afterEach, describe, expect, it } from 'vitest'
import { describeGatewayError, fetchGatewayModelsDetailed } from '../src/utils/ai-gateway.js'

const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH
})

describe('fetchGatewayModelsDetailed', () => {
    function mockFetch(impl: (input: Parameters<typeof fetch>[0]) => Promise<Response> | Response): void {
        globalThis.fetch = ((input: Parameters<typeof fetch>[0]) =>
            Promise.resolve(impl(input) as Response | Promise<Response>)) as typeof fetch
    }

    it('parses chat + embedding models on a successful response', async () => {
        mockFetch(() =>
            new Response(
                JSON.stringify({
                    data: [
                        { id: 'gpt-4o' },
                        { id: 'text-embedding-3-small' },
                        { id: 'claude-opus-4' },
                    ],
                }),
                { status: 200 },
            ),
        )
        const { models, error } = await fetchGatewayModelsDetailed('key', 'http://x')
        expect(error).toBeNull()
        expect(models?.chat).toContain('gpt-4o')
        expect(models?.embedding).toContain('text-embedding-3-small')
    })

    it('returns http error on 401', async () => {
        mockFetch(() => new Response('forbidden', { status: 401, statusText: 'Unauthorized' }))
        const { error } = await fetchGatewayModelsDetailed('bad', 'http://x')
        expect(error?.kind).toBe('http')
        if (error?.kind === 'http') expect(error.status).toBe(401)
    })

    it('returns empty when the response has no models', async () => {
        mockFetch(() => new Response(JSON.stringify({ data: [] }), { status: 200 }))
        const { error } = await fetchGatewayModelsDetailed('k', 'http://x')
        expect(error?.kind).toBe('empty')
    })

    it('returns parse error on non-json body', async () => {
        mockFetch(() => new Response('<html>500</html>', { status: 200 }))
        const { error } = await fetchGatewayModelsDetailed('k', 'http://x')
        expect(error?.kind).toBe('parse')
    })

    it('returns network error on fetch throw', async () => {
        globalThis.fetch = (() => Promise.reject(new Error('ENOTFOUND'))) as typeof fetch
        const { error } = await fetchGatewayModelsDetailed('k', 'http://nowhere')
        expect(error?.kind).toBe('network')
    })

    it('returns timeout on AbortError', async () => {
        globalThis.fetch = (() => {
            const e = new Error('aborted')
            e.name = 'AbortError'
            return Promise.reject(e)
        }) as typeof fetch
        const { error } = await fetchGatewayModelsDetailed('k', 'http://x', 50)
        expect(error?.kind).toBe('timeout')
    })
})

describe('describeGatewayError', () => {
    it('produces an actionable string per error kind', () => {
        expect(describeGatewayError({ kind: 'timeout' })).toMatch(/timed out/i)
        expect(describeGatewayError({ kind: 'network', message: 'down' })).toMatch(/network/i)
        expect(describeGatewayError({ kind: 'http', status: 401, statusText: 'no' })).toMatch(
            /rejected the key/i,
        )
        expect(describeGatewayError({ kind: 'http', status: 500, statusText: 'oops' })).toMatch(
            /500/,
        )
        expect(describeGatewayError({ kind: 'parse', message: 'bad' })).toMatch(/not valid JSON/i)
        expect(describeGatewayError({ kind: 'empty' })).toMatch(/no models/i)
    })

    it('names the gateway via the label parameter', () => {
        const msg = describeGatewayError({ kind: 'empty' }, 'sluis.ai')
        expect(msg).toMatch(/sluis\.ai/)
        // Control: the generic default label must not leak in alongside the custom one.
        expect(msg).not.toMatch(/AI gateway/)
    })

    it('defaults the label to "AI gateway"', () => {
        expect(describeGatewayError({ kind: 'timeout' })).toMatch(/^AI gateway/)
    })

    it('points auth failures at NUXT_AI_GATEWAY_KEY', () => {
        expect(describeGatewayError({ kind: 'http', status: 403, statusText: 'no' })).toMatch(
            /NUXT_AI_GATEWAY_KEY/,
        )
    })
})
