/** `<provider>/<model>` form required by Mastra's gateway router. */
export const DEFAULT_CHAT_MODEL = 'openai/gpt-4o-mini'
export const DEFAULT_EMBEDDING_MODEL = 'openai/text-embedding-3-small'

/** Substrings that classify a model id as embedding. */
export const EMBEDDING_PATTERNS = [
    'embedding',
    'embed',
    'text-embedding',
    'voyage',
    'cohere-embed',
] as const
