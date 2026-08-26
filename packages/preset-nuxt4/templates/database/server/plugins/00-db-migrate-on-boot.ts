import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate as runMigrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * The single migration path, identical under `nuxt dev` and in the container, so no manual or initContainer step exists to forget.
 * The advisory lock is what makes multi-replica rollouts safe: the other replicas block, then no-op. Disable via `NUXT_DISABLE_DB_MIGRATE_ON_BOOT`.
 */
const MIGRATE_ADVISORY_LOCK_KEY = 6_154_321_001_001_001

export default defineNitroPlugin(async () => {
    const config = useRuntimeConfig()
    if (config.disableDbMigrateOnBoot === true || String(config.disableDbMigrateOnBoot) === 'true') {
        console.log('[db-migrate-on-boot] disabled via runtimeConfig.disableDbMigrateOnBoot')
        return
    }
    const connectionString = String(config.databaseUrl ?? '')
    if (!connectionString) {
        console.warn('[db-migrate-on-boot] no runtimeConfig.databaseUrl, skipping')
        return
    }
    // No journal is the normal state for a `db:push`-managed project. That skips migrating, not
    // the extensions: a project can ship `CREATE SCHEMA mastra` with no migrations of its own, and
    // returning here would leave it unapplied. drizzle-orm's migrator would otherwise throw
    // "Can't find meta/_journal.json", so it stays gated on the journal below.
    const migrationsFolder = pickMigrationsFolder()
    const extensionFiles = await listExtensionFiles()
    if (!migrationsFolder && extensionFiles.length === 0) return

    const client = postgres(connectionString, { max: 1 })
    const db = drizzle(client)
    try {
        // The lock spans this one connection, so other pods block here until release; a no-op migrate returns in well under a second.
        await client`SELECT pg_advisory_lock(${MIGRATE_ADVISORY_LOCK_KEY})`
        await applyExtensions(client, extensionFiles)
        if (migrationsFolder) {
            await baselineIfPushManaged(client, migrationsFolder)
            const t0 = Date.now()
            await runMigrate(db, { migrationsFolder })
            const ms = Date.now() - t0
            if (ms > 50) console.log(`[db-migrate-on-boot] migrations up to date (${ms}ms)`)
        }
    } catch (err) {
        // Deliberately not rethrown: crash-looping the pod hides the logs. Stale schema surfaces as clearer per-query errors downstream.
        console.error('[db-migrate-on-boot] migration failed:', err)
    } finally {
        try {
            await client`SELECT pg_advisory_unlock(${MIGRATE_ADVISORY_LOCK_KEY})`
        } catch {
            /* connection already closed */
        }
        await client.end({ timeout: 5 }).catch(() => undefined)
    }
})

/**
 * Runs `extensions/*.sql` (CREATE EXTENSION / CREATE SCHEMA) before migrating: drizzle's generated
 * SQL never contains them, so e.g. a `vector(N)` column would fail without the extension in place.
 * The files ship idempotent (`IF NOT EXISTS`), so rerunning them on every boot is safe.
 */
async function applyExtensions(
    client: ReturnType<typeof postgres>,
    files: string[],
): Promise<void> {
    for (const absPath of files) {
        const body = (await readFile(absPath, 'utf8')).trim()
        if (!body) continue
        await client.unsafe(body)
    }
}

/** Absolute paths of every `*.sql` in the first candidate folder that holds one, lexically sorted. */
async function listExtensionFiles(): Promise<string[]> {
    const candidates = [
        // production container layout: Dockerfile stages extensions to /app/extensions
        path.resolve('extensions'),
        // dev layout (`nuxt dev` runs from the project root)
        path.resolve('server/database/extensions'),
    ]
    // Require an actual `.sql`, not just the directory: the Dockerfile always creates an (often
    // empty) `/app/extensions`, the same reason `pickMigrationsFolder` requires the journal.
    for (const dir of candidates) {
        if (!existsSync(dir)) continue
        const names = (await readdir(dir).catch(() => [] as string[]))
            .filter((f) => f.endsWith('.sql'))
            .sort((a, b) => a.localeCompare(b))
        if (names.length > 0) return names.map((name) => path.join(dir, name))
    }
    return []
}

/**
 * Push-vs-migrate drift guard: a `db:push` database has the full schema but an empty journal, so replaying `0000_*`
 * fails with "already exists". Empty journal plus existing tables means record every migration as applied, executing nothing.
 */
async function baselineIfPushManaged(
    client: ReturnType<typeof postgres>,
    migrationsFolder: string,
): Promise<void> {
    const journalRows = await client`
        SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS "hasJournal"`
    if (journalRows[0]?.hasJournal === true) {
        const countRows = await client`
            SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`
        if (Number(countRows[0]?.count ?? 0) > 0) return // journal in use: normal migrate path
    }

    const tableRows = await client`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ) AS "hasTables"`
    if (tableRows[0]?.hasTables !== true) return // fresh database: let migrations run for real

    const journalRaw = await readFile(
        path.join(migrationsFolder, 'meta', '_journal.json'),
        'utf8',
    ).catch(() => null)
    if (!journalRaw) return
    const entries = (JSON.parse(journalRaw)?.entries ?? []) as Array<{ tag: string; when: number }>
    if (entries.length === 0) return

    // Same schema/table/hash drizzle-orm's migrator uses, so it interoperates.
    await client`CREATE SCHEMA IF NOT EXISTS drizzle`
    await client`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )`
    for (const entry of entries) {
        const body = await readFile(path.join(migrationsFolder, `${entry.tag}.sql`), 'utf8')
        const hash = createHash('sha256').update(body).digest('hex')
        await client`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${hash}, ${entry.when})`
    }
    console.warn(
        `[db-migrate-on-boot] baselined ${entries.length} migration(s); schema was push-managed `
        + '(journal empty, tables present). Verify the schema is current: run `pnpm run db:push` once if unsure.',
    )
}

function pickMigrationsFolder(): string | null {
    const candidates = [
        // production container layout: Dockerfile stages migrations to /app/migrations
        path.resolve('migrations'),
        // dev layout (`nuxt dev` runs from the project root)
        path.resolve('server/database/migrations'),
    ]
    // Require the journal, not just the directory: the Dockerfile always creates an (often empty)
    // `/app/migrations`, so only a folder with `meta/_journal.json` is a real drizzle migrations dir.
    for (const c of candidates) {
        if (existsSync(path.join(c, 'meta', '_journal.json'))) return c
    }
    return null
}
