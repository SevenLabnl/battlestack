/** `<provider>/<model>` form required by Mastra's gateway router. */
export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small'

/**
 * Gateway presets offered at scaffold time. Every preset speaks the OpenAI shape, so
 * `custom` covers a LiteLLM proxy, OpenAI itself, or any other compatible endpoint.
 * A preset carries no model defaults when its catalogue is unknown; the scaffold asks.
 */
export const GATEWAY_PRESETS = {
    sluis: {
        label: 'sluis.ai (hosted, EU data residency)',
        url: 'https://api.sluis.ai',
        /** Managed alias, resolved per-tenant by sluis.ai rather than pinned to one vendor model. */
        chatModel: 'sluis/chat',
    },
    custom: {
        label: 'Custom OpenAI-compatible gateway (LiteLLM proxy, OpenAI, ...)',
        url: undefined,
        chatModel: undefined,
    },
} as const

export type GatewayPreset = keyof typeof GATEWAY_PRESETS

export const DEFAULT_GATEWAY_PRESET: GatewayPreset = 'sluis'

/**
 * Chat model a preset scaffolds with, or undefined when the user has to name one.
 * Deliberately does NOT default an absent preset: an ESC-cancelled preset select must not
 * silently inherit the hosted preset's alias. Callers wanting the default say so.
 */
export function presetChatModel(preset: GatewayPreset | undefined): string | undefined {
    return preset ? GATEWAY_PRESETS[preset].chatModel : undefined
}

/** Substrings that classify a model id as embedding. */
export const EMBEDDING_PATTERNS = [
    'embedding',
    'embed',
    'text-embedding',
    'voyage',
    'cohere-embed',
] as const
