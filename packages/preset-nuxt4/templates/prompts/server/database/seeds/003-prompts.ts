import { eq } from 'drizzle-orm'
import { prompts } from '../schema/prompts'
import { getDefaultPrompts } from '../../utils/prompts/defaults'
import type { db as Db } from '../client'

/** Seed `prompts` rows from the registry. Never overwrites admin-edited `content`. */
export default async function seed(db: typeof Db): Promise<void> {
    const defaults = getDefaultPrompts()

    for (const p of defaults) {
        const [existing] = await db.select().from(prompts).where(eq(prompts.key, p.key)).limit(1)

        if (!existing) {
            await db.insert(prompts).values({
                key: p.key,
                name: p.name,
                description: p.description,
                content: p.defaultContent,
                defaultContent: p.defaultContent,
            })
            console.log(`  prompt seeded: ${p.key}`)
            continue
        }

        if (existing.defaultContent !== p.defaultContent) {
            await db
                .update(prompts)
                .set({ defaultContent: p.defaultContent })
                .where(eq(prompts.key, p.key))
            console.log(`  prompt defaultContent refreshed: ${p.key}`)
        }
    }
}
