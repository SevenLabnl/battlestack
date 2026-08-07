import { eq } from 'drizzle-orm'
import { aiModelConfigs } from '../schema/ai'
import { getDefaultModelConfigs } from '../../mastra/utils/model-configs'
import type { db as Db } from '../client'

/**
 * Seed default `ai_model_configs` rows via `getDefaultModelConfigs()`, shared with the boot-time sync (`10-sync-ai-on-boot.ts`) so `db:seed` and boot converge on the same rows.
 */
export default async function seed(db: typeof Db): Promise<void> {
    for (const row of getDefaultModelConfigs()) {
        const [existing] = await db
            .select()
            .from(aiModelConfigs)
            .where(eq(aiModelConfigs.key, row.key))
            .limit(1)
        if (existing) continue
        await db.insert(aiModelConfigs).values(row)
        console.log(`  ai_model_config seeded: ${row.key} -> ${row.model}`)
    }
}
