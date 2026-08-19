// Single source for the env-derived model defaults. Deliberately import-free and reading
// `process.env` directly: consumed by runtime fallback (`ai-model.ts`), boot-time DB seeding
// (`model-configs.ts`), and the standalone seed runner / `mastra dev` Studio, none of which
// share a Nitro runtime context.

/** Host serving the `sluis/*` managed aliases. */
const SLUIS_HOST = 'sluis.ai'

/** Chat model for a gateway whose catalogue is unknown. Widely served by OpenAI-compatible proxies. */
const FALLBACK_CHAT_MODEL = 'openai/gpt-5.6-luna'

export function envModelDefault(kind: 'chat' | 'embedding'): string {
    if (kind === 'embedding') {
        return process.env.NUXT_AI_GATEWAY_EMBEDDING_MODEL || 'openai/text-embedding-3-small'
    }
    const explicit = process.env.NUXT_AI_GATEWAY_CHAT_MODEL?.trim()
    if (explicit) return explicit
    // `sluis/chat` is a sluis.ai managed alias, so only a sluis gateway can serve it.
    // Anything else gets a concrete vendor id its upstream has a chance of routing.
    return gatewayIsSluis() ? 'sluis/chat' : FALLBACK_CHAT_MODEL
}

/** Whether `NUXT_AI_GATEWAY_URL` points at sluis.ai. Never throws: an unset or malformed URL is not sluis. */
function gatewayIsSluis(): boolean {
    const raw = process.env.NUXT_AI_GATEWAY_URL?.trim()
    if (!raw) return false
    try {
        const host = new URL(raw).hostname.toLowerCase()
        return host === SLUIS_HOST || host.endsWith(`.${SLUIS_HOST}`)
    } catch {
        return false
    }
}
