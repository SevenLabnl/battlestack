// Single source for the env-derived model defaults. Deliberately import-free and reading
// `process.env` directly: consumed by runtime fallback (`ai-model.ts`), boot-time DB seeding
// (`model-configs.ts`), and the standalone seed runner / `mastra dev` Studio, none of which
// share a Nitro runtime context.

export function envModelDefault(kind: 'chat' | 'embedding'): string {
    if (kind === 'embedding') {
        return process.env.NUXT_AI_GATEWAY_EMBEDDING_MODEL || 'openai/text-embedding-3-small'
    }
    // `sluis/chat` is the sluis.ai chat alias — the scaffold's built-in preset.
    // Projects on a custom gateway always have NUXT_AI_GATEWAY_CHAT_MODEL set.
    return process.env.NUXT_AI_GATEWAY_CHAT_MODEL || 'sluis/chat'
}
