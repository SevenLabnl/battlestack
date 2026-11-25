import { fetchGatewayModelIds } from '#server/mastra/gateways/openai-compat'
import { reasoningSupport } from '#server/mastra/utils/reasoning'

// Model list for the admin picker, via the gateway module's shared `/v1/models` fetch.
// Richer metadata endpoints tend to be admin-only (LiteLLM's `/model_group/info` 403s under virtual keys), so mode is inferred from the model id instead.
type Mode = 'chat' | 'embedding' | 'unknown'

export default defineEventHandler(async () => {
    const ids = await fetchGatewayModelIds()
    const models = ids
        // Pixel-prefixed image variants are not invocable, drop them from the picker.
        .filter((id) => !/\/(low|medium|high|standard|hd)\//.test(id.toLowerCase()))
        .filter((id) => !/\/\d+-x-\d+\//.test(id.toLowerCase()))
        .map((id) => {
            const mode = classifyMode(id)
            const reasoning = mode === 'chat' ? reasoningSupport(id) : null
            return {
                id,
                mode,
                supportsFunctionCalling: false,
                supportsVision: false,
                supportsReasoning: reasoning !== null,
                reasoningEfforts: reasoning?.levels ?? [],
                defaultReasoningEffort: reasoning?.defaultLevel ?? null,
            }
        })
        .sort((a, b) => a.id.localeCompare(b.id))
    return { models }
})

function classifyMode(id: string): Mode {
    const lower = id.toLowerCase()
    if (lower.includes('embed') || lower.startsWith('voyage') || lower.includes('/voyage')) {
        return 'embedding'
    }
    if (
        lower.includes('whisper')
        || lower.includes('tts')
        || lower.includes('dall-e')
        || lower.includes('moderation')
        || lower.includes('transcribe')
        || lower.includes('gpt-image')
        || lower.includes('sora')
    ) {
        return 'unknown'
    }
    return 'chat'
}
