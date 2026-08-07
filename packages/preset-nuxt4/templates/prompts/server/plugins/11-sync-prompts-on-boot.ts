import { eq, sql } from 'drizzle-orm'
import { db } from '#server/database/client'
import { prompts } from '#server/database/schema/prompts'
import { getDefaultPrompts } from '#server/utils/prompts/defaults'

/**
 * Counterpart to `10-sync-ai-on-boot`: guarantees a row per registry prompt every boot, without the dev-only `db:seed`.
 * Additive and edit-safe: refreshes `default_content`, never overwrites admin-edited `content`; the advisory lock serialises replicas.
 */
const SYNC_ADVISORY_LOCK_KEY = 6_154_321_001_001_003

export default defineNitroPlugin(async () => {
    const config = useRuntimeConfig()
    if (!String(config.databaseUrl ?? '')) {
        console.warn('[sync-prompts-on-boot] no runtimeConfig.databaseUrl, skipping')
        return
    }

    try {
        await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_advisory_xact_lock(${SYNC_ADVISORY_LOCK_KEY})`)
            for (const p of getDefaultPrompts()) {
                const [existing] = await tx
                    .select({ id: prompts.id, defaultContent: prompts.defaultContent })
                    .from(prompts)
                    .where(eq(prompts.key, p.key))
                    .limit(1)

                if (!existing) {
                    await tx.insert(prompts).values({
                        key: p.key,
                        name: p.name,
                        description: p.description,
                        content: p.defaultContent,
                        defaultContent: p.defaultContent,
                    })
                    console.log(`[sync-prompts-on-boot] prompt registered: ${p.key}`)
                    continue
                }

                // Keep the reset baseline current without touching admin edits.
                if (existing.defaultContent !== p.defaultContent) {
                    await tx
                        .update(prompts)
                        .set({ defaultContent: p.defaultContent })
                        .where(eq(prompts.key, p.key))
                    console.log(`[sync-prompts-on-boot] prompt defaultContent refreshed: ${p.key}`)
                }
            }
        })
    } catch (err) {
        console.error('[sync-prompts-on-boot] failed:', err)
    }
})
