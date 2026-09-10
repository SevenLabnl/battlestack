import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database/client'
import { aiModelConfigs, agents } from '#server/database/schema/ai'
import { getDefaultModelConfigs } from '#server/mastra/utils/model-configs'
import { getAgentDefinition } from '#server/mastra/agents/registry'
import { mastra } from '#server/mastra'
import { ADVISORY_LOCK } from '#server/utils/advisory-locks'

/**
 * Runs every boot so the `ai_model_configs`/`agents` rows always exist, unlike `db:seed`, which refuses to run in production.
 * Insert-if-missing only, never update or delete, so admin edits survive; the advisory lock serialises replicas during a rollout.
 */
const SYNC_ADVISORY_LOCK_KEY = ADVISORY_LOCK.SYNC_AI

export default defineNitroPlugin(async () => {
    const config = useRuntimeConfig()
    const connectionString = String(config.databaseUrl ?? '')
    if (!connectionString) {
        console.warn('[sync-ai-on-boot] no runtimeConfig.databaseUrl, skipping')
        return
    }

    try {
        // `pg_advisory_xact_lock` auto-releases at transaction end; the transaction pins one pooled connection, so a session-scoped lock would be unsafe across the pool.
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${SYNC_ADVISORY_LOCK_KEY})`)
            await ensureModelConfigs(tx)
            await registerAgents(tx)
        })
    } catch (err) {
        // Don't throw: let the app start so the operator can inspect logs.
        // The `agents` table may not exist yet if the project pulled the schema but hasn't migrated; runtime resolvers fall back, so the app still works.
        console.error('[sync-ai-on-boot] failed:', err)
    }
})

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function ensureModelConfigs(tx: Tx): Promise<void> {
    for (const cfg of getDefaultModelConfigs()) {
        const [existing] = await tx
            .select({ id: aiModelConfigs.id })
            .from(aiModelConfigs)
            .where(eq(aiModelConfigs.key, cfg.key))
            .limit(1)
        if (existing) continue
        await tx.insert(aiModelConfigs).values(cfg).onConflictDoNothing()
        console.log(`[sync-ai-on-boot] ai_model_config registered: ${cfg.key}`)
    }
}

async function registerAgents(tx: Tx): Promise<void> {
    for (const key of liveAgentKeys()) {
        const [existing] = await tx
            .select({ id: agents.id })
            .from(agents)
            .where(eq(agents.key, key))
            .limit(1)
        if (existing) continue
        const def = getAgentDefinition(key)
        await tx.insert(agents).values({
            key: def.key,
            name: def.name,
            description: def.description,
            modelConfigKey: def.modelConfigKey,
            // null → agent registered without a prompt; link one later in admin
            promptKey: def.promptKey,
        }).onConflictDoNothing()
        console.log(`[sync-ai-on-boot] agent registered: ${def.key}`)
    }
}

/**
 * Keys of the agents actually registered on the Mastra instance, so any agent added to the constructor is picked up with no extra wiring.
 * Falls back to the static registry if the Mastra API shape differs.
 */
function liveAgentKeys(): string[] {
    try {
        const all = (mastra as { getAgents?: () => Record<string, unknown> }).getAgents?.()
        const keys = all ? Object.keys(all) : []
        if (keys.length > 0) return keys
    } catch {
        /* fall through */
    }
    return ['default']
}
