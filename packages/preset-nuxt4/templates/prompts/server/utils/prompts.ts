import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { prompts } from '#server/database/schema/prompts'
import { getDefaultPrompts } from '#server/utils/prompts/defaults'
import { createTtlCache, invalidate } from '#server/utils/cache-bus'

const CACHE_NAMESPACE = 'prompts'
/** Ceiling on how long an admin edit can stay invisible if its NOTIFY is never delivered. */
const TTL_MS = 30_000

const cache = createTtlCache<string>(CACHE_NAMESPACE, TTL_MS)

export async function getPromptByKey(key: string): Promise<string> {
    const cached = cache.get(key)
    if (cached !== undefined) return cached

    // Captured before the query so an edit committing mid-flight is not overwritten by the
    // pre-edit content this read is about to return.
    const generation = cache.generation()
    const [row] = await db
        .select({ content: prompts.content })
        .from(prompts)
        .where(eq(prompts.key, key))
        .limit(1)

    if (row) {
        cache.set(key, row.content, generation)
        return row.content
    }

    const defaults = getDefaultPrompts()
    const def = defaults.find((p) => p.key === key)
    if (def) return def.defaultContent

    throw new Error(`Unknown prompt key: ${key}`)
}

/**
 * Drops a prompt from the cache on every replica. Omit `key` to drop all of them.
 * Call it after any write to `prompts.content`, and await it before responding.
 */
export async function invalidatePromptCache(key?: string): Promise<void> {
    await invalidate(CACHE_NAMESPACE, key)
}
