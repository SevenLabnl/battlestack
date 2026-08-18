import { describe, expect, it } from 'vitest'
import type { RunContext } from '@battlestack/core'
import { mastraFeature } from '../src/features/mastra.js'
import { mockRunContext } from './test-utils.js'

function envOf(state: RunContext['state']) {
    const ctx = mockRunContext({ state })
    const vars = mastraFeature.collectEnv!(ctx) ?? []
    return Object.fromEntries(vars.map((v) => [v.key, v]))
}

describe('nuxt4:mastra collectEnv — generic AI gateway vars', () => {
    it('emits the five NUXT_AI_GATEWAY* vars with the key marked secret', () => {
        const env = envOf({})
        expect(Object.keys(env).sort()).toEqual([
            'NUXT_AI_GATEWAY_CHAT_MODEL',
            'NUXT_AI_GATEWAY_EMBEDDING_MODEL',
            'NUXT_AI_GATEWAY_HEADERS',
            'NUXT_AI_GATEWAY_KEY',
            'NUXT_AI_GATEWAY_URL',
        ])
        expect(env.NUXT_AI_GATEWAY_KEY!.secret).toBe(true)
        // Control: a fresh scaffold must not emit the legacy names at all.
        expect(env.NUXT_LITELLM_URL).toBeUndefined()
        expect(env.NUXT_LITELLM_KEY).toBeUndefined()
    })

    it('leaves the URL blank on a non-interactive scaffold but keeps the sluis example', () => {
        const env = envOf({})
        expect(env.NUXT_AI_GATEWAY_URL!.value).toBe('')
        expect(env.NUXT_AI_GATEWAY_URL!.example).toBe('https://api.sluis.ai')
    })

    it('carries prompt answers into the emitted values', () => {
        const env = envOf({
            aiGatewayPreset: 'sluis',
            aiGatewayUrl: 'https://api.sluis.ai',
            aiGatewayKey: 'sk_live_x',
            aiGatewayChatModel: 'mistral/mistral-large-latest',
        })
        expect(env.NUXT_AI_GATEWAY_URL!.value).toBe('https://api.sluis.ai')
        expect(env.NUXT_AI_GATEWAY_KEY!.value).toBe('sk_live_x')
        expect(env.NUXT_AI_GATEWAY_CHAT_MODEL!.value).toBe('mistral/mistral-large-latest')
    })

    it('falls back to the sluis chat alias when no answer was given', () => {
        const env = envOf({})
        expect(env.NUXT_AI_GATEWAY_CHAT_MODEL!.value).toBe('sluis/chat')
    })
})
