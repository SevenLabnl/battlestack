/**
 * Admin bootstrap only, and deliberately manual: it creates and mutates accounts, which no rollout should do as a side effect.
 * The advisory lock is what stops two callers both reading "not seeded" and racing into the unique constraint on `users.email`.
 */
import { hash } from '@node-rs/argon2'
import postgres from 'postgres'

/** Must match ADVISORY_LOCK.SEED in server/utils/advisory-locks.ts, the registry of every key. */
const SEED_ADVISORY_LOCK_KEY = 6_154_321_001_001_002

if (
    process.env.NODE_ENV === 'production' &&
    process.env.SEED_ALLOW_PRODUCTION !== 'true' &&
    process.env.SEED_FORCE !== 'true'
) {
    console.error(
        '[seed] refusing to run with NODE_ENV=production. ' +
            'Set SEED_ALLOW_PRODUCTION=true to override.',
    )
    process.exit(1)
}

const url = process.env.NUXT_DATABASE_URL
if (!url) {
    console.error('[seed] NUXT_DATABASE_URL is not set')
    process.exit(1)
}

const email = process.env.SEED_ADMIN_EMAIL
const password = process.env.SEED_ADMIN_PASSWORD
if (!email || !password) {
    console.log('[seed] SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set, skipped')
    process.exit(0)
}

const sql = postgres(url, { max: 1, onnotice: () => {} })
let locked = false
try {
    // Taken before the marker is read, so no other seeder can split the check from the insert it guards. Postgres
    // frees session locks on disconnect, so the `process.exit(0)` below, which skips `finally`, still cannot leak it.
    await sql`SELECT pg_advisory_lock(${SEED_ADVISORY_LOCK_KEY})`
    locked = true
    await ensureSeededMarkerTable(sql)
    if (await alreadySeeded(sql) && process.env.SEED_FORCE !== 'true') {
        console.log('[seed] already seeded, skipped (set SEED_FORCE=true to override)')
        process.exit(0)
    }

    const existing = await sql`SELECT id, role FROM users WHERE email = ${email} LIMIT 1`
    if (existing.length === 0) {
        const passwordHash = await hash(password)
        await sql`INSERT INTO users (email, password_hash, role) VALUES (${email}, ${passwordHash}, 'admin')`
        console.log(`[seed] admin created: ${email}`)
    } else {
        if (existing[0].role !== 'admin') {
            await sql`UPDATE users SET role = 'admin' WHERE email = ${email}`
            console.log(`[seed] admin role promoted: ${email}`)
        }
        if (process.env.SEED_ADMIN_RESET_PASSWORD === 'true') {
            const passwordHash = await hash(password)
            await sql`UPDATE users SET password_hash = ${passwordHash} WHERE email = ${email}`
            console.log(`[seed] admin password reset: ${email}`)
        }
    }

    await markSeeded(sql)
} catch (err) {
    console.error('[seed] failed', err)
    process.exitCode = 1
} finally {
    if (locked) {
        await sql`SELECT pg_advisory_unlock(${SEED_ADVISORY_LOCK_KEY})`.catch(() => undefined)
    }
    await sql.end({ timeout: 5 })
}

async function ensureSeededMarkerTable(sql) {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS drizzle`)
    await sql.unsafe(`
        CREATE TABLE IF NOT EXISTS drizzle.__battlestack_seeded (
            id integer PRIMARY KEY DEFAULT 1,
            seeded_at timestamp NOT NULL DEFAULT now(),
            CHECK (id = 1)
        )
    `)
}

async function alreadySeeded(sql) {
    const rows = await sql`SELECT 1 FROM drizzle.__battlestack_seeded WHERE id = 1`
    return rows.length > 0
}

async function markSeeded(sql) {
    await sql`
        INSERT INTO drizzle.__battlestack_seeded (id) VALUES (1)
        ON CONFLICT (id) DO UPDATE SET seeded_at = now()
    `
}
