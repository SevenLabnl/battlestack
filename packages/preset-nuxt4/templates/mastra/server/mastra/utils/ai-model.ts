import { eq } from 'drizzle-orm'
// Relative imports so `mastra dev` (standalone bundler) can resolve these too;
// `#server/*` is a Nuxt/Nitro alias that doesn't exist inside Mastra's bundle.
import { db } from '../../database/client'
import { aiModelConfigs } from '../../database/schema/ai'
import { inferProviderFromName } from '../gateways/openai-compat'
import { envModelDefault } from './env-defaults'
import { createTtlCache, invalidate } from '../../utils/cache-bus'

const CACHE_NAMESPACE = 'ai-model'
/** Ceiling on how long an admin edit can stay invisible if its NOTIFY is never delivered. */
const TTL_MS = 30_000

const cache = createTtlCache<string>(CACHE_NAMESPACE, TTL_MS)

// `key === 'embedding'` falls back to the embedding env default; every other key (chat + custom configs) falls back to the chat model env.
function readFallback(key: string): string {
    return envModelDefault(key === 'embedding' ? 'embedding' : 'chat')
}

/**
 * Returns the full `gateway/<provider>/<model>` id Mastra requires, since it throws on shorter forms; a bare DB value gets a provider inferred.
 * Embeddings bypass this and call `gatewayEmbedding(rawId)` directly, because Mastra core has no embedding gateway.
 */
export async function getActiveModelId(key: string): Promise<string> {
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    try {
        const [row] = await db
            .select({ model: aiModelConfigs.model })
            .from(aiModelConfigs)
            .where(eq(aiModelConfigs.key, key))
            .limit(1)
        const raw = row?.model?.trim() || readFallback(key)
        const value = toRouterId(raw)
        cache.set(key, value)
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
    if (cached !== undefined) return cached
    try {
        const [row] = await db
            .select({ model: aiModelConfigs.model })
            .from(aiModelConfigs)
            .where(eq(aiModelConfigs.key, 'embedding'))
            .limit(1)
        const value = row?.model?.trim() || fallback?.trim() || readFallback('embedding')
        cache.set(EMBEDDING_CACHE_KEY, value)
        return value
    } catch {
        return fallback?.trim() || readFallback('embedding')
    }
}

/**
 * Build the Mastra router id `gateway/<provider>/<model>` from a DB-stored value: already-prefixed strings, bare names (provider inferred), or `<provider>/<model>` shorthand.
 * An existing `gateway/` prefix is stripped first and the rest re-normalized, so a malformed
 * two-segment value like `gateway/gpt-5.6-luna` (the admin PUT accepts any string) is repaired
 * instead of short-circuiting into a router id Mastra rejects.
 */
function toRouterId(stored: string): string {
    const bare = stored.startsWith('gateway/') ? stored.slice('gateway/'.length) : stored
    if (bare.includes('/')) return `gateway/${bare}`
    const provider = inferProviderFromName(bare) ?? 'openai'
    return `gateway/${provider}/${bare}`
}


/**
 * Drops a model config from the cache on every replica so the next call re-reads the DB.
 * Call it after any write to `ai_model_configs`, and await it before responding.
 */
export async function invalidateActiveModel(key?: string): Promise<void> {
    if (!key) {
        await invalidate(CACHE_NAMESPACE)
        return
    }
    await invalidate(CACHE_NAMESPACE, key)
    // The `embedding` config is cached twice: prefixed (via getActiveModelId)
    // and raw (via getActiveEmbeddingModelId). Clear both.
    if (key === 'embedding') await invalidate(CACHE_NAMESPACE, EMBEDDING_CACHE_KEY)
}
