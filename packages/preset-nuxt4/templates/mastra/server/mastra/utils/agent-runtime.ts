import { eq, sql } from 'drizzle-orm'
// Relative imports so `mastra dev` (standalone bundler) can resolve these too;
// `#server/*` is a Nuxt/Nitro alias that doesn't exist inside Mastra's bundle.
import { db } from '../../database/client'
import { agents } from '../../database/schema/ai'
import { getActiveModelId } from './ai-model'
import { getDefaultPrompts } from '../../utils/prompts/defaults'
import { getAgentDefinition } from '../agents/registry'
import { createTtlCache, invalidate } from '../../utils/cache-bus'

interface AgentLink {
    modelConfigKey: string
    promptKey: string | null
}

const CACHE_NAMESPACE = 'agent-runtime'
/** Ceiling on how long an admin edit can stay invisible if its NOTIFY is never delivered. */
const TTL_MS = 30_000

const cache = createTtlCache<AgentLink>(CACHE_NAMESPACE, TTL_MS)

/**
 * Read an agent's DB row (the admin-editable link); returns null when the row is absent or the `agents` table doesn't exist yet (schema pulled but not migrated).
 * Callers fall back to the code registry either way, so the agent keeps working (backwards compatible).
 */
async function readAgentLink(agentKey: string): Promise<AgentLink | null> {
    const cached = cache.get(agentKey)
    if (cached !== undefined) return cached
    // Captured before the query; see `ai-model.ts`.
    const generation = cache.generation()
    try {
        const [row] = await db
            .select({ modelConfigKey: agents.modelConfigKey, promptKey: agents.promptKey })
            .from(agents)
            .where(eq(agents.key, agentKey))
            .limit(1)
        if (!row) return null
        const value: AgentLink = { modelConfigKey: row.modelConfigKey, promptKey: row.promptKey }
        cache.set(agentKey, value, generation)
        return value
    } catch {
        return null
    }
}

/**
 * Mastra router model id for an agent: resolves the linked `model_config_key` (admin-editable, falling back to the code registry then `chat`).
 * Pass the result as the agent's `model` factory.
 */
export async function getAgentModelId(agentKey: string): Promise<string> {
    const link = await readAgentLink(agentKey)
    const modelConfigKey = link?.modelConfigKey || getAgentDefinition(agentKey).modelConfigKey
    return getActiveModelId(modelConfigKey)
}

/**
 * Resolves an agent's linked prompt, falling back to the code default when there is no prompt, no row, or no `prompts` table at all.
 * Pass the result as the agent's `instructions` factory.
 */
export async function getAgentInstructions(agentKey: string): Promise<string> {
    const def = getAgentDefinition(agentKey)
    const link = await readAgentLink(agentKey)
    // Use the DB link's prompt when there's a row; otherwise the code default.
    const promptKey = link ? link.promptKey : def.promptKey
    if (!promptKey) return def.defaultInstructions
    const content = await resolvePromptContent(promptKey)
    return content ?? def.defaultInstructions
}

/**
 * Resolve a prompt's content by key: prefers the admin-editable `prompts` table when it exists (the `nuxt:prompts` feature), else the code defaults registry.
 * The `to_regclass` guard keeps this safe when the table is absent.
 */
async function resolvePromptContent(promptKey: string): Promise<string | null> {
    try {
        const reg = await db.execute(sql`select to_regclass('public.prompts') as t`)
        const exists = (reg as unknown as Array<{ t: string | null }>)[0]?.t
        if (exists) {
            const rows = await db.execute(
                sql`select content from prompts where key = ${promptKey} limit 1`,
            )
            const content = (rows as unknown as Array<{ content: string }>)[0]?.content
            if (typeof content === 'string' && content.length > 0) return content
        }
    } catch {
        // table missing / db error → fall through to the defaults registry
    }
    const def = getDefaultPrompts().find((p) => p.key === promptKey)
    return def ? def.defaultContent : null
}

/**
 * Drops an agent link from the cache on every replica so the next resolve re-reads the DB.
 * Call it after any write to `agents`, and await it before responding.
 */
export async function invalidateAgentCache(agentKey?: string): Promise<void> {
    await invalidate(CACHE_NAMESPACE, agentKey)
}
