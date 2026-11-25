import { describe, expect, it } from 'vitest'
import { effectiveReasoningEffort, reasoningSupport } from '../templates/mastra/server/mastra/utils/reasoning.js'

describe('reasoningSupport', () => {
    it('defaults Mistral Large to high in every stored id form', () => {
        for (const id of ['mistral-large-latest', 'mistral/mistral-large-latest', 'gateway/mistral/mistral-large-4']) {
            expect(reasoningSupport(id)?.defaultLevel, id).toBe('high')
        }
    })

    it('leaves dated Mistral Large snapshots without a selector', () => {
        expect(reasoningSupport('mistral/mistral-large-2512')).toBeNull()
    })

    it('splits the GPT-5 family by the levels each generation accepts', () => {
        expect(reasoningSupport('openai/gpt-5')?.levels).toContain('minimal')
        expect(reasoningSupport('openai/gpt-5-mini')?.defaultLevel).toBe('medium')
        expect(reasoningSupport('openai/gpt-5.1')?.levels).not.toContain('xhigh')
        expect(reasoningSupport('openai/gpt-5.6-luna')?.levels).toContain('xhigh')
        expect(reasoningSupport('openai/gpt-5.6-luna')?.defaultLevel).toBe('none')
    })

    it('returns null for models it does not know', () => {
        expect(reasoningSupport('sluis/chat')).toBeNull()
        expect(reasoningSupport('openai/gpt-4o')).toBeNull()
        expect(reasoningSupport('')).toBeNull()
    })
})

describe('effectiveReasoningEffort', () => {
    it('passes a supported level through', () => {
        expect(effectiveReasoningEffort('mistral/mistral-large-latest', 'low')).toBe('low')
    })

    it('omits an unset value or one the model would reject', () => {
        expect(effectiveReasoningEffort('mistral/mistral-large-latest', null)).toBeNull()
        expect(effectiveReasoningEffort('mistral/mistral-large-latest', 'xhigh')).toBeNull()
        expect(effectiveReasoningEffort('openai/gpt-4o', 'high')).toBeNull()
    })
})
