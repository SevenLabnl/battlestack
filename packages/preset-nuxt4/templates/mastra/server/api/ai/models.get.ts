import { litellmEndpoints } from '#server/mastra/gateways/litellm'

// LiteLLM's `/v1/models` returns either `{data: [...]}` or a bare array depending on deployment; handle both.
// `/model_group/info` has richer metadata but is admin-only and 403s under virtual keys, so mode is inferred from the model id instead.
interface OpenAIModelEntry {
    id?: string
}

type Mode = 'chat' | 'embedding' | 'unknown'

export default defineEventHandler(async () => {
    let root: string
    let apiKey: string
    try {
        ;({ root, apiKey } = litellmEndpoints())
    } catch {
        return { models: [] }
    }

    if (!root || !apiKey) return { models: [] }

    try {
        const raw = await $fetch<{ data?: OpenAIModelEntry[] } | OpenAIModelEntry[]>(
            `${root}/v1/models`,
            { headers: { Authorization: `Bearer ${apiKey}` } },
        )
        const entries = Array.isArray(raw) ? raw : (raw.data ?? [])
        const models = entries
            .map((m) => m.id)
            .filter((id): id is string => Boolean(id))
            // Wildcards (`openai/*`) and pixel-prefixed image variants are not invocable, drop them from the picker.
            .filter((id) => !id.includes('*'))
            .filter((id) => !/\/(low|medium|high|standard|hd)\//.test(id.toLowerCase()))
            .filter((id) => !/\/\d+-x-\d+\//.test(id.toLowerCase()))
            .map((id) => ({
                id,
                mode: classifyMode(id),
                supportsFunctionCalling: false,
                supportsVision: false,
                supportsReasoning: false,
            }))
            .sort((a, b) => a.id.localeCompare(b.id))
        return { models }
    } catch {
        return { models: [] }
    }
})

function classifyMode(id: string): Mode {
    const lower = id.toLowerCase()
    if (lower.includes('embed') || lower.startsWith('voyage') || lower.includes('/voyage')) {
        return 'embedding'
    }
    if (
        lower.includes('whisper') ||
        lower.includes('tts') ||
        lower.includes('dall-e') ||
        lower.includes('moderation') ||
        lower.includes('transcribe') ||
        lower.includes('gpt-image') ||
        lower.includes('sora')
    ) {
        return 'unknown'
    }
    return 'chat'
}
