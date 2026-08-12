// Default `ai_model_configs` rows: single source of truth shared by `db:seed` and the boot-time sync plugin so dev/staging/prod converge on the same baseline.
// Env resolution lives in `envModelDefault` (shared with the runtime fallback in `ai-model.ts`) so seeding and fallback can never disagree on a model.

import { envModelDefault } from './env-defaults'

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
            model: envModelDefault('chat'),
        },
        {
            key: 'embedding',
            name: 'Embedding',
            description: 'Default embedding model used by RAG ingestion + query.',
            model: envModelDefault('embedding'),
        },
    ]
}
