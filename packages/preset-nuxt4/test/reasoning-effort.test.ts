import { describe, expect, it } from 'vitest'
import {
    effectiveReasoningEffort,
    fallbackReasoningSupport,
    gatewayReasoningSupport,
    resolveReasoningSupport,
} from '../templates/mastra/server/mastra/utils/reasoning.js'

describe('fallbackReasoningSupport', () => {
    it('defaults Mistral Large to high in every stored id form', () => {
        for (const id of ['mistral-large-latest', 'mistral/mistral-large-latest', 'gateway/mistral/mistral-large-4']) {
            expect(fallbackReasoningSupport(id)?.defaultLevel, id).toBe('high')
        }
        expect(fallbackReasoningSupport('mistral/mistral-large-latest')?.levels).not.toContain('none')
    })

    it('gives each OpenAI generation only the levels it accepts', () => {
        expect(fallbackReasoningSupport('openai/gpt-5-mini')?.levels).toEqual(['minimal', 'low', 'medium', 'high'])
        expect(fallbackReasoningSupport('openai/gpt-5.1')?.levels).not.toContain('xhigh')
        expect(fallbackReasoningSupport('openai/gpt-5.5')?.levels).toContain('xhigh')
        expect(fallbackReasoningSupport('openai/gpt-5.6-luna')?.levels).toContain('none')
        expect(fallbackReasoningSupport('openai/gpt-6-astra')?.levels).toEqual(['low', 'medium', 'high', 'xhigh'])
        expect(fallbackReasoningSupport('openai/gpt-6.1-terra')?.levels).toContain('none')
        for (const id of ['openai/gpt-6.2-sol', 'openai/gpt-6.2-astra', 'openai/gpt-6.1-sol']) {
            expect(fallbackReasoningSupport(id)?.levels, id).toEqual(['low', 'medium', 'high', 'xhigh'])
        }
    })

    it('covers Claude, Gemini and open-weight families', () => {
        expect(fallbackReasoningSupport('anthropic/claude-opus-5-5')?.levels).toContain('max')
        expect(fallbackReasoningSupport('anthropic/claude-opus-5-5')?.levels).not.toContain('none')
        expect(fallbackReasoningSupport('anthropic/claude-sonnet-5')?.defaultLevel).toBe('none')
        expect(fallbackReasoningSupport('vertex/gemini-4-neon')?.levels).toContain('xhigh')
        expect(fallbackReasoningSupport('vertex/gemini-4-argon')?.levels).toEqual(['low', 'medium', 'high'])
        expect(fallbackReasoningSupport('vertex/gemini-3.5-flash-lite')?.defaultLevel).toBe('minimal')
        expect(fallbackReasoningSupport('nebius/zai-org/GLM-5.3')?.levels).toEqual(['low', 'high', 'max'])
        expect(fallbackReasoningSupport('nebius/openai/gpt-oss-120b')?.defaultLevel).toBe('medium')
    })

    it('has no selector for models without a level to set', () => {
        for (const id of ['moonshot/kimi-k3', 'deepseek/deepseek-v4-pro', 'xai/grok-4.7', 'mistral/magistral-medium-latest', 'sluis/chat', 'mistral/mistral-large-2512']) {
            expect(fallbackReasoningSupport(id), id).toBeNull()
        }
    })
})

describe('gatewayReasoningSupport', () => {
    it('reads the levels, off switch and default a gateway reports', () => {
        expect(gatewayReasoningSupport({ reasoning_efforts: ['low', 'medium', 'high'], reasoning_off: true, reasoning_default: 'high' }))
            .toEqual({ levels: ['none', 'low', 'medium', 'high'], defaultLevel: 'high' })
    })

    it('treats an empty list as no level to choose, and null as unknown', () => {
        expect(gatewayReasoningSupport({ reasoning_efforts: [], reasoning_off: false })).toBeNull()
        expect(gatewayReasoningSupport({ reasoning_efforts: null })).toBeUndefined()
        expect(gatewayReasoningSupport(null)).toBeUndefined()
    })
})

describe('resolveReasoningSupport', () => {
    it('prefers the gateway over the table', () => {
        const support = resolveReasoningSupport('vertex/gemini-4-argon', { reasoning_efforts: ['low', 'high'], reasoning_off: false, reasoning_default: null })
        expect(support?.levels).toEqual(['low', 'high'])
    })

    it('falls back to the table when the gateway does not know', () => {
        expect(resolveReasoningSupport('openai/gpt-6-astra', { reasoning_efforts: null })?.levels).toEqual(['low', 'medium', 'high', 'xhigh'])
    })

    it('follows the gateway when it says there is no level, even for a model the table knows', () => {
        expect(resolveReasoningSupport('bedrock/eu.anthropic.claude-opus-4-8', { reasoning_efforts: [], reasoning_off: false })).toBeNull()
    })

    it('hides a selector whose only choice is the default off', () => {
        expect(resolveReasoningSupport('anthropic/claude-haiku-4-5', { reasoning_efforts: [], reasoning_off: true, reasoning_default: 'none' })).toBeNull()
    })
})

describe('effectiveReasoningEffort', () => {
    const mistral = fallbackReasoningSupport('mistral/mistral-large-latest')

    it('passes a supported level through', () => {
        expect(effectiveReasoningEffort(mistral, 'low')).toBe('low')
    })

    it('omits an unset value or one the model would reject', () => {
        expect(effectiveReasoningEffort(mistral, null)).toBeNull()
        expect(effectiveReasoningEffort(mistral, 'none')).toBeNull()
        expect(effectiveReasoningEffort(null, 'high')).toBeNull()
    })
})
