// Default `ai_model_configs` rows: single source of truth shared by `db:seed` and the boot-time sync plugin so dev/staging/prod converge on the same baseline.
// Reads `process.env` directly (not `useRuntimeConfig`) so it also works in the standalone seed runner.

export interface DefaultModelConfig {
    key: string
    name: string
    description: string
    model: string
}

export function getDefaultModelConfigs(): DefaultModelConfig[] {
    return [
        {
            key: 'chat',
            name: 'Chat',
            description: 'Default chat model used by interactive agents.',
            model: process.env.NUXT_LITELLM_CHAT_MODEL || 'openai/gpt-4o-mini',
        },
        {
            key: 'embedding',
            name: 'Embedding',
            description: 'Default embedding model used by RAG ingestion + query.',
            model: process.env.NUXT_LITELLM_EMBEDDING_MODEL || 'openai/text-embedding-3-small',
        },
    ]
}
