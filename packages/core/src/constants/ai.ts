/** `<provider>/<model>` form required by Mastra's gateway router. */
// The chat default is the sluis.ai alias: it only makes sense for the sluis
// preset (and the non-interactive scaffold, which points at sluis by example).
// Custom gateways get no hardcoded chat model — the scaffold prompts for one.
export const SLUIS_DEFAULT_CHAT_MODEL = 'sluis/chat'
export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small'

/** Substrings that classify a model id as embedding. */
export const EMBEDDING_PATTERNS = [
    'embedding',
    'embed',
    'text-embedding',
    'voyage',
    'cohere-embed',
] as const
