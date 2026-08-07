import { eq } from 'drizzle-orm'
import { db } from '#server/database/client'
import { prompts } from '#server/database/schema/prompts'
import { getDefaultPrompts } from '#server/utils/prompts/defaults'

const cache = new Map<string, string>()

export async function getPromptByKey(key: string): Promise<string> {
    const cached = cache.get(key)
    if (cached !== undefined) return cached

    const [row] = await db
        .select({ content: prompts.content })
        .from(prompts)
        .where(eq(prompts.key, key))
        .limit(1)

    if (row) {
        cache.set(key, row.content)
        return row.content
    }

    const defaults = getDefaultPrompts()
    const def = defaults.find((p) => p.key === key)
    if (def) return def.defaultContent

    throw new Error(`Unknown prompt key: ${key}`)
}

export function invalidatePromptCache(key?: string): void {
    if (key === undefined) cache.clear()
    else cache.delete(key)
}
