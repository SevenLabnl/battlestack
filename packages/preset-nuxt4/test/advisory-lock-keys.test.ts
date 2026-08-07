import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The boot plugin and standalone migrator declare the lock key in files that cannot import
 * each other; they race on deploy and serialise only if it matches. The seed key must DIFFER.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const dbTemplates = path.resolve(here, '..', 'templates', 'database')

const BOOT_PLUGIN = path.join(dbTemplates, 'server/plugins/00-db-migrate-on-boot.ts')
const STANDALONE = path.join(dbTemplates, 'tools/migrate.mjs')
const SEEDER = path.join(dbTemplates, 'tools/seed.mjs')

async function lockKey(file: string, constName: string): Promise<string> {
    const src = await readFile(file, 'utf8')
    const m = new RegExp(`const ${constName}\\s*=\\s*([0-9_]+)`).exec(src)
    if (!m) {
        throw new Error(
            `could not find ${constName} in ${path.relative(dbTemplates, file)}. If the constant `
            + 'was renamed, update this test; do not delete it. It is the only thing keeping the '
            + 'boot plugin and the standalone migrator on the same lock.',
        )
    }
    // Normalize numeric separators so 6_154_321 and 6154321 compare equal.
    return m[1]!.replaceAll('_', '')
}

describe('migration advisory-lock keys', () => {
    it('the boot plugin and the standalone migrator use the same key', async () => {
        const boot = await lockKey(BOOT_PLUGIN, 'MIGRATE_ADVISORY_LOCK_KEY')
        const standalone = await lockKey(STANDALONE, 'MIGRATE_ADVISORY_LOCK_KEY')
        expect(standalone).toBe(boot)
    })

    it('the key is a valid Postgres bigint advisory-lock key', async () => {
        // `pg_advisory_lock(bigint)`: an overflowed key fails at runtime, on deploy, in
        // the one code path nobody exercises locally.
        const boot = BigInt(await lockKey(BOOT_PLUGIN, 'MIGRATE_ADVISORY_LOCK_KEY'))
        expect(boot).toBeGreaterThan(0n)
        expect(boot).toBeLessThanOrEqual(2n ** 63n - 1n)
    })

    it('the seed lock is a DIFFERENT key, so seeding never blocks migrating', async () => {
        const migrate = await lockKey(BOOT_PLUGIN, 'MIGRATE_ADVISORY_LOCK_KEY')
        const seed = await lockKey(SEEDER, 'SEED_ADVISORY_LOCK_KEY')
        expect(seed).not.toBe(migrate)
    })
})
