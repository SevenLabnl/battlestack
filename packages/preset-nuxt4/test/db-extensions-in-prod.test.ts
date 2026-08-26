import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BattlestackRegistries, type Feature } from '@battlestack/core'
import { databaseFeature } from '../src/features/database.js'
import { dockerFeature } from '../src/features/docker.js'
import { mockRunContext } from './test-utils.js'

/**
 * `server/database/extensions/*.sql` (CREATE EXTENSION vector, CREATE SCHEMA mastra) must run
 * before any drizzle DDL in EVERY flow, or the first migration with a `vector(N)` column fails
 * in the one environment nobody exercises locally: production. These tests pin the three prod
 * pieces together: the migrator applies them, the boot plugin applies them, and the Dockerfile
 * stages them into the image. Deleting one silently reintroduces the manual
 * "hand-edit CREATE EXTENSION into 0000_*.sql" step.
 *
 * The two template files are scaffold payload — excluded from this repo's tsconfig and never
 * imported here — so they can only be asserted as text. The Dockerfile is not: it is rendered
 * by `dockerFeature`, so that one runs the feature and reads the file it produced.
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const templates = path.resolve(here, '..', 'templates')

const BOOT_PLUGIN = path.join(templates, 'database/server/plugins/00-db-migrate-on-boot.ts')
const STANDALONE = path.join(templates, 'database/tools/migrate.mjs')

function registryWith(features: Feature[]): BattlestackRegistries {
    const registries = new BattlestackRegistries()
    for (const f of features) {
        registries.features.register(f, { plugin: 'test', namespace: 'test' })
    }
    return registries
}

let projectDir: string

beforeEach(async () => {
    projectDir = await mkdtemp(path.join(os.tmpdir(), 'battlestack-db-ext-test-'))
})

afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true })
})

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
        const applyAt = src.indexOf('await applyExtensions(client, extensionFiles)')
        const baselineAt = src.indexOf('await baselineIfPushManaged(client, migrationsFolder)')
        expect(applyAt).toBeGreaterThan(-1)
        expect(baselineAt).toBeGreaterThan(-1)
        expect(applyAt).toBeLessThan(baselineAt)
        // Both layouts: /app/extensions in the container, server/database/extensions in dev.
        expect(src).toContain("path.resolve('extensions')")
        expect(src).toContain("path.resolve('server/database/extensions')")
    })

    it('the boot plugin still applies extensions when the project has no migrations journal', async () => {
        const src = await readFile(BOOT_PLUGIN, 'utf8')
        // A `db:push`-managed project (empty journal) must not skip the extension DDL: a project
        // can ship `CREATE SCHEMA mastra` with no migrations of its own. Returning early on a
        // missing journal is what left it unapplied.
        expect(src).not.toMatch(/if\s*\(!migrationsFolder\)\s*\{[\s\S]{0,200}?\breturn\b/)
        expect(src).toContain('if (!migrationsFolder && extensionFiles.length === 0) return')
        const applyAt = src.indexOf('await applyExtensions(client, extensionFiles)')
        const migrateGateAt = src.indexOf('if (migrationsFolder) {')
        expect(migrateGateAt).toBeGreaterThan(-1)
        expect(applyAt).toBeLessThan(migrateGateAt)
    })

    it('the rendered Dockerfile stages extensions into /app/extensions for the runtime image', async () => {
        const ctx = mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:docker', 'nuxt4:database']),
            state: { packageManager: 'pnpm' },
            registries: registryWith([dockerFeature, databaseFeature]),
        })
        await dockerFeature.execute(ctx)
        const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8')
        expect(dockerfile).toContain('cp -R /app/server/database/extensions/. /app/dist-tools/extensions/')
        expect(dockerfile).toContain(
            'COPY --from=build --chown=node:node /app/dist-tools/extensions/ /app/extensions/',
        )
    })

    it('omits the extensions staging when the database feature is off', async () => {
        const ctx = mockRunContext({
            projectDir,
            enabledFeatures: new Set(['shared:docker']),
            state: { packageManager: 'pnpm' },
            registries: registryWith([dockerFeature, databaseFeature]),
        })
        await dockerFeature.execute(ctx)
        const dockerfile = await readFile(path.join(projectDir, 'Dockerfile'), 'utf8')
        expect(dockerfile).not.toContain('/app/extensions')
    })
})
