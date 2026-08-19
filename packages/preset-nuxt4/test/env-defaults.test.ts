import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FALLBACK_CHAT_MODEL } from '@battlestack/core/constants/ai.js'
// Imported, not grepped: this template is import-free plain TS, so its actual behaviour is
// reachable from here. The host check below is the part source-text assertions cannot verify.
import { envModelDefault } from '../templates/mastra/server/mastra/utils/env-defaults.js'

const KEYS = ['NUXT_AI_GATEWAY_CHAT_MODEL', 'NUXT_AI_GATEWAY_EMBEDDING_MODEL', 'NUXT_AI_GATEWAY_URL'] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    for (const k of KEYS) delete process.env[k]
})

afterEach(() => {
    for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
})

describe('envModelDefault(chat)', () => {
    it('prefers an explicit chat model over any fallback', () => {
        process.env.NUXT_AI_GATEWAY_URL = 'https://api.sluis.ai'
        process.env.NUXT_AI_GATEWAY_CHAT_MODEL = 'mistral/mistral-large-latest'
        expect(envModelDefault('chat')).toBe('mistral/mistral-large-latest')
    })

    it('ignores a whitespace-only chat model', () => {
        process.env.NUXT_AI_GATEWAY_CHAT_MODEL = '   '
        expect(envModelDefault('chat')).toBe(FALLBACK_CHAT_MODEL)
    })

    it.each([
        'https://api.sluis.ai',
        'https://api.sluis.ai/v1',
        'https://sluis.ai',
        'HTTPS://API.SLUIS.AI/v1',
    ])('serves the managed alias on a sluis gateway (%s)', (url) => {
        process.env.NUXT_AI_GATEWAY_URL = url
        expect(envModelDefault('chat')).toBe('sluis/chat')
    })

    it.each([
        ['a LiteLLM proxy', 'http://litellm.internal:4000/v1'],
        ['OpenAI directly', 'https://api.openai.com/v1'],
        ['an unset URL', ''],
        ['a malformed URL', 'not-a-url'],
        // Host-matched, not substring-matched.
        ['a lookalike host', 'https://sluis.ai.evil.test/v1'],
        ['a host merely containing the name', 'https://notsluis.ai/v1'],
    ])('falls back to a concrete vendor id for %s', (_label, url) => {
        if (url) process.env.NUXT_AI_GATEWAY_URL = url
        expect(envModelDefault('chat')).toBe(FALLBACK_CHAT_MODEL)
    })
})

describe('envModelDefault(embedding)', () => {
    it('is gateway-independent: sluis serves no embedding alias', () => {
        process.env.NUXT_AI_GATEWAY_URL = 'https://api.sluis.ai'
        expect(envModelDefault('embedding')).toBe('openai/text-embedding-3-small')
    })

    it('prefers an explicit embedding model', () => {
        process.env.NUXT_AI_GATEWAY_EMBEDDING_MODEL = 'bedrock/cohere-embed-v4'
        expect(envModelDefault('embedding')).toBe('bedrock/cohere-embed-v4')
    })
})
