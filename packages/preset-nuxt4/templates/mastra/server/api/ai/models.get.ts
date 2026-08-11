import { gatewayEndpoints, gatewayHeaders } from '#server/mastra/gateways/openai-compat'

// The gateway's `/v1/models` returns either `{data: [...]}` or a bare array depending on deployment (LiteLLM does both; sluis.ai uses `{data}`); handle both.
// Richer metadata endpoints tend to be admin-only (LiteLLM's `/model_group/info` 403s under virtual keys), so mode is inferred from the model id instead.
interface OpenAIModelEntry {
    id?: string
}

type Mode = 'chat' | 'embedding' | 'unknown'

export default defineEventHandler(async () => {
    let root: string
    let apiKey: string
    try {
        ;({ root, apiKey } = gatewayEndpoints())
    } catch {
        return { models: [] }
    }

    if (!root || !apiKey) return { models: [] }

    try {
        const raw = await $fetch<{ data?: OpenAIModelEntry[] } | OpenAIModelEntry[]>(
            `${root}/v1/models`,
            { headers: { Authorization: `Bearer ${apiKey}`, ...gatewayHeaders() } },
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
