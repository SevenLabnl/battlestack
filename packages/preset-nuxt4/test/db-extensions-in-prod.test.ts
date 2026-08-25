import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * `server/database/extensions/*.sql` (CREATE EXTENSION vector, CREATE SCHEMA mastra) must run
 * before any drizzle DDL in EVERY flow, or the first migration with a `vector(N)` column fails
 * in the one environment nobody exercises locally: production. These tests pin the three prod
 * pieces together: the migrator applies them, the boot plugin applies them, and the Dockerfile
 * stages them into the image. Deleting one silently reintroduces the manual
 * "hand-edit CREATE EXTENSION into 0000_*.sql" step.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const templates = path.resolve(here, '..', 'templates')

const BOOT_PLUGIN = path.join(templates, 'database/server/plugins/00-db-migrate-on-boot.ts')
const STANDALONE = path.join(templates, 'database/tools/migrate.mjs')

describe('db extensions in prod', () => {
    it('the standalone migrator applies extensions before ensuring the migrations table', async () => {
        const src = await readFile(STANDALONE, 'utf8')
        const applyAt = src.indexOf('await applyExtensions(sql, extensionsDir)')
        const ensureAt = src.indexOf('await ensureMigrationsTable(sql)')
        expect(applyAt).toBeGreaterThan(-1)
        expect(ensureAt).toBeGreaterThan(-1)
        expect(applyAt).toBeLessThan(ensureAt)
        // Container default must match the Dockerfile's COPY destination.
        expect(src).toContain("process.env.DB_EXTENSIONS_DIR ?? '/app/extensions'")
    })

    it('the boot plugin applies extensions before the baseline/migrate pass', async () => {
        const src = await readFile(BOOT_PLUGIN, 'utf8')
        const applyAt = src.indexOf('await applyExtensions(client)')
        const baselineAt = src.indexOf('await baselineIfPushManaged(client, migrationsFolder)')
        expect(applyAt).toBeGreaterThan(-1)
        expect(baselineAt).toBeGreaterThan(-1)
        expect(applyAt).toBeLessThan(baselineAt)
        // Both layouts: /app/extensions in the container, server/database/extensions in dev.
        expect(src).toContain("path.resolve('extensions')")
        expect(src).toContain("path.resolve('server/database/extensions')")
    })

    it('the Dockerfile stages extensions into /app/extensions for the runtime image', async () => {
        const dockerSrc = await readFile(
            path.resolve(here, '..', 'src', 'features', 'docker.ts'),
            'utf8',
        )
        expect(dockerSrc).toContain('cp -R /app/server/database/extensions/. /app/dist-tools/extensions/')
        expect(dockerSrc).toContain(
            'COPY --from=build --chown=node:node /app/dist-tools/extensions/ /app/extensions/',
        )
    })
})
