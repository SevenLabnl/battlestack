// Single source for the env-derived model defaults. Deliberately import-free and reading
// `process.env` directly: consumed by runtime fallback (`ai-model.ts`), boot-time DB seeding
// (`model-configs.ts`), and the standalone seed runner / `mastra dev` Studio, none of which
// share a Nitro runtime context.

export function envModelDefault(kind: 'chat' | 'embedding'): string {
    if (kind === 'embedding') {
        return process.env.NUXT_AI_GATEWAY_EMBEDDING_MODEL || 'openai/text-embedding-3-small'
    }
    // Last-resort fallback only: the scaffold writes NUXT_AI_GATEWAY_CHAT_MODEL for every
    // project. `sluis/chat` is the default preset's managed alias, so a project on another
    // gateway that blanks the var gets an id its upstream will reject. Set the var.
    return process.env.NUXT_AI_GATEWAY_CHAT_MODEL || 'sluis/chat'
}
