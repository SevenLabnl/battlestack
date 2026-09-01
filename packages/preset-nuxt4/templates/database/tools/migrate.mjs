/**
 * Standalone migrator, tracking state in `drizzle.__drizzle_migrations` so it interoperates with drizzle-kit. Concurrency-safe only because of the
 * advisory lock: without it, co-rolling replicas both read an empty `applied` set, both run the same DDL, and the loser exits non-zero on "already exists".
 */
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import postgres from 'postgres'

/** Must match ADVISORY_LOCK.MIGRATE in server/utils/advisory-locks.ts, the registry of every key. */
const MIGRATE_ADVISORY_LOCK_KEY = 6_154_321_001_001_001

const url = process.env.NUXT_DATABASE_URL
if (!url) {
    console.error('[migrate] NUXT_DATABASE_URL is not set')
    process.exit(1)
}

const migrationsDir = process.env.DRIZZLE_MIGRATIONS_DIR ?? '/app/migrations'
const extensionsDir = process.env.DB_EXTENSIONS_DIR ?? '/app/extensions'

const sql = postgres(url, { max: 1, onnotice: () => {} })
let locked = false
try {
    // Taken before the first read, so nobody decides what to apply from a snapshot
    // another process is about to invalidate. Other migrators block here until release.
    await sql`SELECT pg_advisory_lock(${MIGRATE_ADVISORY_LOCK_KEY})`
    locked = true
    await applyExtensions(sql, extensionsDir)
    await ensureMigrationsTable(sql)
    const applied = await loadApplied(sql)
    const journal = await loadJournal(migrationsDir)
    const files = journal === null
        ? await loadLooseSqlFiles(migrationsDir)
        : journalToFiles(journal, migrationsDir)
    // Push-vs-migrate drift guard: empty journal plus existing tables means `db:push` synced the schema,
    // so replaying would fail with "already exists". Baseline instead, writing journal rows and no DDL.
    if (applied.size === 0 && files.length > 0 && (await hasExistingTables(sql))) {
        await baselineMigrations(sql, files)
    } else {
        await applyMigrations(sql, applied, files)
    }
    console.log('[migrate] done')
} catch (err) {
    console.error('[migrate] failed', err)
    process.exitCode = 1
} finally {
    if (locked) {
        await sql`SELECT pg_advisory_unlock(${MIGRATE_ADVISORY_LOCK_KEY})`.catch(() => undefined)
    }
    await sql.end({ timeout: 5 })
}

/**
 * Runs `extensions/*.sql` (CREATE EXTENSION / CREATE SCHEMA) before any migration: drizzle's
 * generated SQL never contains them, so e.g. a `vector(N)` column would fail without this.
 * The files ship idempotent (`IF NOT EXISTS`), so rerunning them on every invocation is safe.
 */
async function applyExtensions(sql, dir) {
    const names = (await readdir(dir).catch(() => []))
        .filter((f) => f.endsWith('.sql'))
        .sort((a, b) => a.localeCompare(b))
    for (const name of names) {
        const body = (await readFile(path.join(dir, name), 'utf8')).trim()
        if (!body) continue
        console.log(`[migrate] extension ${name}`)
        await sql.unsafe(body)
    }
}

async function ensureMigrationsTable(sql) {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`)
    await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
        )
    `)
}

async function loadApplied(sql) {
    const rows = await sql`SELECT hash FROM drizzle.__drizzle_migrations`
    return new Set(rows.map((r) => r.hash))
}

async function loadJournal(dir) {
    try {
        const raw = await readFile(path.join(dir, 'meta', '_journal.json'), 'utf8')
        return JSON.parse(raw)
    } catch {
        return null
    }
}

function journalToFiles(journal, dir) {
    const entries = Array.isArray(journal?.entries) ? journal.entries : []
    return entries.map((e) => ({
        name: e.tag,
        absPath: path.join(dir, `${e.tag}.sql`),
        when: e.when,
    }))
}

async function loadLooseSqlFiles(dir) {
    const names = (await readdir(dir).catch(() => []))
        .filter((f) => f.endsWith('.sql'))
        .sort()
    return names.map((f) => ({ name: f.replace(/\.sql$/, ''), absPath: path.join(dir, f) }))
}

async function hasExistingTables(sql) {
    const [{ exists }] = await sql`
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ) AS exists`
    return exists === true
}

// Record migrations as applied without executing them: journal rows only, no DDL, no data touched.
async function baselineMigrations(sql, files) {
    for (const { name, absPath, when } of files) {
        const body = await readFile(absPath, 'utf8')
        const hash = createHash('sha256').update(body).digest('hex')
        await sql`
            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
            VALUES (${hash}, ${when ?? Date.now()})`
        console.log(`[migrate] baselined ${name}`)
    }
    console.warn(
        `[migrate] baselined ${files.length} migration(s); schema was push-managed `
        + '(journal empty, tables present). Verify the schema is current: run `pnpm run db:push` once if unsure.',
    )
}

async function applyMigrations(sql, applied, files) {
    let applied_count = 0
    for (const { name, absPath } of files) {
        const body = await readFile(absPath, 'utf8')
        const hash = createHash('sha256').update(body).digest('hex')
        if (applied.has(hash)) continue
        console.log(`[migrate] applying ${name}`)
        await sql.begin(async (tx) => {
            for (const stmt of splitDrizzleSql(body)) {
                if (stmt.trim().length > 0) await tx.unsafe(stmt)
            }
            await tx`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`
        })
        applied_count++
    }
    console.log(`[migrate] applied ${applied_count} migration(s)`)
}

function splitDrizzleSql(body) {
    return body.split(/--> statement-breakpoint/g)
}
