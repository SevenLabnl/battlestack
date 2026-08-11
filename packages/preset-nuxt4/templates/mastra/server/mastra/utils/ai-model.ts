import { eq } from 'drizzle-orm'
// Relative imports so `mastra dev` (standalone bundler) can resolve these too;
// `#server/*` is a Nuxt/Nitro alias that doesn't exist inside Mastra's bundle.
import { db } from '../../database/client'
import { aiModelConfigs } from '../../database/schema/ai'

interface CacheEntry {
    value: string
    expires: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 30_000

// Reads `process.env` directly (not `useRuntimeConfig`) since this is reachable from Mastra Studio's standalone process, which has no Nitro runtime context.
// `key === 'embedding'` falls back to the embedding env default; every other key (chat + custom configs) falls back to the chat model env.
// The `NUXT_LITELLM_*` names are a legacy fallback for projects scaffolded before the generic-gateway rename.
function readFallback(key: string): string {
    if (key === 'embedding') {
        return process.env.NUXT_AI_GATEWAY_EMBEDDING_MODEL
            || process.env.NUXT_LITELLM_EMBEDDING_MODEL
            || 'openai/text-embedding-3-small'
    }
    return process.env.NUXT_AI_GATEWAY_CHAT_MODEL
        || process.env.NUXT_LITELLM_CHAT_MODEL
        || 'openai/gpt-4o-mini'
}

/**
 * Returns the full `gateway/<provider>/<model>` id Mastra requires, since it throws on shorter forms; a bare DB value gets a provider inferred.
 * Embeddings bypass this and call `gatewayEmbedding(rawId)` directly, because Mastra core has no embedding gateway.
 */
export async function getActiveModelId(key: string): Promise<string> {
    const cached = cache.get(key)
    if (cached && cached.expires > Date.now()) return cached.value
    try {
        const [row] = await db
            .select({ model: aiModelConfigs.model })
            .from(aiModelConfigs)
            .where(eq(aiModelConfigs.key, key))
            .limit(1)
        const raw = row?.model?.trim() || readFallback(key)
        const value = toRouterId(raw)
        cache.set(key, { value, expires: Date.now() + TTL_MS })
        return value
    } catch {
        return toRouterId(readFallback(key))
    }
}

// Embeddings reuse the `ai_model_configs.key = 'embedding'` row but resolve to a RAW id (no `gateway/` prefix) since Mastra core doesn't gateway embedding models.
// Cached under a distinct key so it never collides with the (prefixed) chat lookup.
const EMBEDDING_CACHE_KEY = 'embedding:raw'

/**
 * Active embedding model id (raw `<provider>/<model>`), DB-backed via the `embedding` row of `ai_model_configs` (editable at `/dashboard/settings/ai`).
 * Falls back to `fallback` (e.g. `runtimeConfig.rag.embeddingModel`), then the env default; this is what makes the admin Embedding setting actually drive RAG.
 */
export async function getActiveEmbeddingModelId(fallback?: string): Promise<string> {
    const cached = cache.get(EMBEDDING_CACHE_KEY)
    if (cached && cached.expires > Date.now()) return cached.value
    try {
        const [row] = await db
            .select({ model: aiModelConfigs.model })
            .from(aiModelConfigs)
            .where(eq(aiModelConfigs.key, 'embedding'))
            .limit(1)
        const value = row?.model?.trim() || fallback?.trim() || readFallback('embedding')
        cache.set(EMBEDDING_CACHE_KEY, { value, expires: Date.now() + TTL_MS })
        return value
    } catch {
        return fallback?.trim() || readFallback('embedding')
    }
}

/**
 * Build the Mastra router id `gateway/<provider>/<model>` from a DB-stored value: already-prefixed strings, bare names (provider inferred), or `<provider>/<model>` shorthand.
 * A legacy `litellm/` prefix (rows written before the generic-gateway rename) is stripped and re-prefixed, so switching gateways never bricks stored ids.
 */
function toRouterId(stored: string): string {
    if (stored.startsWith('gateway/')) return stored
    const bare = stored.startsWith('litellm/') ? stored.slice('litellm/'.length) : stored
    if (bare.includes('/')) return `gateway/${bare}`
    const provider = inferProviderFromName(bare) ?? 'openai'
    return `gateway/${provider}/${bare}`
}

function inferProviderFromName(modelGroup: string): string | null {
    const name = modelGroup.toLowerCase()
    if (
        name.startsWith('gpt-') ||
        name.startsWith('o1') ||
        name.startsWith('o3') ||
        name === 'chatgpt-4o-latest' ||
        name.startsWith('babbage') ||
        name.startsWith('davinci')
    ) {
        return 'openai'
    }
    if (name.startsWith('claude')) return 'anthropic'
    if (name.startsWith('gemini')) return 'gemini'
    if (name.startsWith('command') || name.startsWith('c4ai')) return 'cohere'
    if (
        name.startsWith('mistral') ||
        name.startsWith('mixtral') ||
        name.startsWith('codestral') ||
        name.startsWith('open-mistral') ||
        name.startsWith('open-mixtral')
    ) {
        return 'mistral'
    }
    if (name.startsWith('grok')) return 'xai'
    if (name.startsWith('deepseek')) return 'deepseek'
    if (name.startsWith('llama')) return 'meta'
    if (name.startsWith('voyage')) return 'voyage'
    return null
}

/** Drop cached entry so the next call re-reads the DB. Called from the admin PUT endpoint. */
export function invalidateActiveModel(key?: string): void {
    if (key) {
        cache.delete(key)
        // The `embedding` config is cached twice: prefixed (via getActiveModelId)
        // and raw (via getActiveEmbeddingModelId). Clear both.
        if (key === 'embedding') cache.delete(EMBEDDING_CACHE_KEY)
    } else {
        cache.clear()
    }
}
