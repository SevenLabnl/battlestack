/**
 * Proves the migration advisory lock actually serialises concurrent migrators,
 * against a REAL Postgres, by racing real `tools/migrate.mjs` processes.
 *
 * Why this exists: `STATUS.md` claimed "advisory locks so concurrent replicas
 * can't both migrate. Verified against real Postgres" — but nothing in the repo
 * or in the template payload referenced `pg_advisory`, `migrate.mjs` or
 * `00-db-migrate-on-boot` at all. That sub-claim had zero automated coverage.
 * The lock turned out to be correct; this is what makes it stay correct.
 *
 * It cannot be a vitest test: the code under test is template payload that
 * ships into a scaffolded project and resolves `postgres` from that project's
 * own `node_modules`, which this repo doesn't have. Same reason
 * `scripts/pack-smoke.mjs` is a script — the real thing, run deliberately.
 *
 * ---------------------------------------------------------------------------
 * THE NEGATIVE CONTROL IS THE POINT. Read this before changing anything below.
 *
 * General rule, reusable well beyond this file:
 *
 *   A test for a MUTUAL-EXCLUSION property must run twice — once with the
 *   mechanism and once with it removed — and must FAIL when the removed-
 *   mechanism run passes. Ship the control as part of the test, not as a
 *   one-time manual check.
 *
 * Why it has to be structural rather than a habit: concurrency tests fail
 * vacuously in a way that is invisible from the outside. An ordinary assertion
 * that stops testing anything usually goes green while the suite still *looks*
 * like it covers the case; a race that never actually races goes green because
 * the interleaving it needed simply didn't occur that run. Nothing about the
 * output distinguishes "the lock worked" from "nothing contended". You cannot
 * eyeball the difference, so the test has to detect it for you.
 *
 * This is not hypothetical. The first version of this race passed with the lock
 * AND passed with the lock removed: six `node` processes start with enough
 * jitter that the winner finished migrating before the others got around to
 * reading the applied set, so they never contended. It proved nothing and was
 * indistinguishable from a real pass.
 *
 * Two things fix that, and both are load-bearing:
 *   1. `pg_sleep(WIDEN_SECONDS)` inside the first migration widens the DDL
 *      window so every process has certainly read an empty applied-set before
 *      the first one commits.
 *   2. Every scenario is ALSO run against a copy of the migrator with the
 *      `pg_advisory_lock` call stripped out, and this script FAILS if that copy
 *      passes. A race that can't tell the lock is missing is not a test.
 *
 * Step 2 then caught a second vacuous scenario on its own, which is the point:
 * the baseline path runs no DDL, so `pg_sleep` could not widen it and those
 * processes weren't contending either. The control refused to certify until the
 * window was widened a different way (by migration COUNT — see
 * `BASELINE_MIGRATIONS`). A human reviewer would not have caught that; the
 * control did, unprompted.
 *
 * Corollary for whoever maintains this: if a scenario's control stops tripping,
 * that is a RED result about the test, never a reason to relax the assertion.
 * Widen the window until the control trips again.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   NUXT_DATABASE_URL=postgres://user:pass@host:port/db \
 *     node scripts/migrate-lock-race.mjs --project <scaffolded-project-dir>
 *
 * `--project` supplies the `tools/migrate.mjs` that actually ships plus a
 * `node_modules` containing `postgres`. It is read, never written; the race
 * runs from a temp directory. The target database IS written to — it drops and
 * recreates `public.widgets` and the `drizzle` schema. Point it at a throwaway.
 */
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Concurrent migrators per scenario. More than 2 so "one winner" is a real claim. */
const RACERS = 6
/** Seconds the first migration's DDL is held open. Must exceed process-start jitter. */
const WIDEN_SECONDS = 3
/**
 * Migrations in the baseline-path scenario. That path runs no DDL, so
 * `pg_sleep` can't widen it — it only reads, hashes and inserts one row per
 * migration. Its window is therefore proportional to the file count, and it
 * has to stay wide enough to beat process-start jitter or the negative control
 * won't trip. Tuned empirically: 40 was too few, this is comfortably over.
 */
const BASELINE_MIGRATIONS = 400

const url = process.env.NUXT_DATABASE_URL
if (!url) {
    console.error('[lock-race] NUXT_DATABASE_URL is not set')
    process.exit(2)
}

const projectFlag = process.argv.indexOf('--project')
const projectDir = projectFlag !== -1 ? path.resolve(process.argv[projectFlag + 1] ?? '') : null
if (!projectDir || !existsSync(projectDir)) {
    console.error('[lock-race] pass --project <scaffolded-project-dir>')
    process.exit(2)
}

const shippedMigrator = path.join(projectDir, 'tools', 'migrate.mjs')
const projectModules = path.join(projectDir, 'node_modules')
for (const p of [shippedMigrator, path.join(projectModules, 'postgres')]) {
    if (!existsSync(p)) {
        console.error(`[lock-race] missing ${p} — is --project a scaffolded, installed project?`)
        process.exit(2)
    }
}

const failures = []
const log = (m) => console.log(`[lock-race] ${m}`)
let queryCounter = 0

const work = await mkdtemp(path.join(tmpdir(), 'battlestack-lock-race-'))
try {
    await runAll()
} finally {
    await rm(work, { recursive: true, force: true })
}

if (failures.length > 0) {
    console.error(`\n[lock-race] FAILED\n${failures.map((f) => `  - ${f}`).join('\n')}`)
    process.exit(1)
}
log('OK — the advisory lock serialises concurrent migrators, and the race can prove it.')

async function runAll() {
    log(`work dir: ${work}`)
    // Resolve `postgres` from the scaffolded project without copying it.
    await writeFile(path.join(work, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
    const modulesLink = path.join(work, 'node_modules')
    await execFileAsync('ln', ['-s', projectModules, modulesLink])

    // The migrator exactly as it ships, and the same file with the lock removed.
    const locked = path.join(work, 'migrate.mjs')
    const unlocked = path.join(work, 'migrate-nolock.mjs')
    const source = await readFile(shippedMigrator, 'utf8')
    await writeFile(locked, source, 'utf8')

    const LOCK_CALL = 'await sql`SELECT pg_advisory_lock(${MIGRATE_ADVISORY_LOCK_KEY})`'
    if (!source.includes(LOCK_CALL)) {
        failures.push(
            `could not find the advisory-lock call in ${shippedMigrator}. Either the migrator `
            + 'was refactored (update LOCK_CALL here) or the lock is gone. Refusing to report a '
            + 'pass built on a negative control that strips nothing.',
        )
        return
    }
    // Replaced with a round-trip rather than deleted, so the unlocked copy keeps
    // the same statement count and connection behaviour — the lock is the only
    // difference between the two runs.
    await writeFile(unlocked, source.replace(LOCK_CALL, 'await sql`SELECT 1`'), 'utf8')

    const migrationsDir = path.join(work, 'migrations')
    await mkdir(path.join(migrationsDir, 'meta'), { recursive: true })
    await writeFile(
        path.join(migrationsDir, '0000_init.sql'),
        'CREATE TABLE "widgets" ("id" serial PRIMARY KEY NOT NULL, "name" text NOT NULL);\n'
        + `--> statement-breakpoint\nSELECT pg_sleep(${WIDEN_SECONDS});\n`,
        'utf8',
    )
    await writeFile(
        path.join(migrationsDir, '0001_add_col.sql'),
        'ALTER TABLE "widgets" ADD COLUMN "colour" text;\n',
        'utf8',
    )
    await writeFile(
        path.join(migrationsDir, 'meta', '_journal.json'),
        JSON.stringify({
            version: '7',
            dialect: 'postgresql',
            entries: [
                { idx: 0, version: '7', when: 1_750_000_000_000, tag: '0000_init', breakpoints: true },
                { idx: 1, version: '7', when: 1_750_000_001_000, tag: '0001_add_col', breakpoints: true },
            ],
        }),
        'utf8',
    )

    const env = { ...process.env, NUXT_DATABASE_URL: url, DRIZZLE_MIGRATIONS_DIR: migrationsDir }

    // --- scenario 1: virgin database, migrations must be applied exactly once
    await scenario({
        name: 'virgin database',
        seed: async () => { await psql('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP TABLE IF EXISTS widgets;') },
        locked, unlocked, env,
        // With the lock: one process runs the DDL, the rest observe it applied.
        check: async (runs) => {
            const problems = []
            const ddl = runs.filter((r) => r.stdout.includes('applying 0000_init')).length
            if (ddl !== 1) problems.push(`${ddl} processes ran the DDL, expected exactly 1`)
            const failed = runs.filter((r) => r.code !== 0).length
            if (failed !== 0) problems.push(`${failed} processes exited non-zero, expected 0`)
            const rows = Number(await psql('SELECT count(*) FROM drizzle.__drizzle_migrations;'))
            if (rows !== 2) problems.push(`${rows} journal rows, expected 2`)
            const cols = (await psql(
                'SELECT string_agg(column_name, \'\',\'\' ORDER BY ordinal_position) '
                + 'FROM information_schema.columns WHERE table_name = \'\'widgets\'\';',
            )).trim()
            // Guards against "nothing failed because nothing happened".
            if (cols !== 'id,name,colour') problems.push(`widgets columns are "${cols}", expected "id,name,colour"`)
            return problems
        },
    })

    // --- scenario 2: push-managed schema, baseline path must record each
    // migration exactly once. The migrator's own header calls this out: "on the
    // baseline path both would insert duplicate journal rows".
    const baselineDir = path.join(work, 'migrations-baseline')
    await mkdir(path.join(baselineDir, 'meta'), { recursive: true })
    const baselineEntries = []
    for (let i = 0; i < BASELINE_MIGRATIONS; i++) {
        const tag = `${String(i).padStart(4, '0')}_noop`
        // Distinct bodies so each hashes differently — identical files would
        // collide into one hash and hide duplicate inserts.
        await writeFile(path.join(baselineDir, `${tag}.sql`), `SELECT ${i};\n`, 'utf8')
        baselineEntries.push({ idx: i, version: '7', when: 1_750_000_000_000 + i, tag, breakpoints: true })
    }
    await writeFile(
        path.join(baselineDir, 'meta', '_journal.json'),
        JSON.stringify({ version: '7', dialect: 'postgresql', entries: baselineEntries }),
        'utf8',
    )

    await scenario({
        name: 'push-managed schema (baseline path)',
        seed: async () => {
            await psql('DROP SCHEMA IF EXISTS drizzle CASCADE; DROP TABLE IF EXISTS widgets;')
            await psql('CREATE TABLE "widgets" ("id" serial PRIMARY KEY NOT NULL, '
                + '"name" text NOT NULL, "colour" text);')
        },
        locked,
        unlocked,
        env: { ...env, DRIZZLE_MIGRATIONS_DIR: baselineDir },
        check: async (runs) => {
            const problems = []
            const baseliners = runs.filter((r) => r.stdout.includes('baselined 0000_noop')).length
            if (baseliners !== 1) problems.push(`${baseliners} processes baselined, expected exactly 1`)
            const rows = Number(await psql('SELECT count(*) FROM drizzle.__drizzle_migrations;'))
            if (rows !== BASELINE_MIGRATIONS) {
                problems.push(
                    `${rows} journal rows, expected ${BASELINE_MIGRATIONS} `
                    + '(duplicates mean the baseline path was not serialised)',
                )
            }
            return problems
        },
    })
}

/**
 * Run one scenario twice: once against the shipped migrator (must pass) and
 * once against the lock-stripped copy (must FAIL — see the header).
 */
async function scenario({ name, seed, locked, unlocked, env, check }) {
    log(`scenario: ${name}`)

    await seed()
    const lockedProblems = await check(await race(locked, env))
    if (lockedProblems.length > 0) {
        failures.push(`${name}: with the advisory lock — ${lockedProblems.join('; ')}`)
    } else {
        log('  with lock: clean')
    }

    await seed()
    const unlockedProblems = await check(await race(unlocked, env))
    if (unlockedProblems.length === 0) {
        failures.push(
            `${name}: NEGATIVE CONTROL DID NOT TRIP — the same race passed with the advisory `
            + 'lock stripped out, so a pass with the lock proves nothing. The processes are not '
            + `actually contending; raise WIDEN_SECONDS (currently ${WIDEN_SECONDS}) or RACERS `
            + `(currently ${RACERS}).`,
        )
    } else {
        log(`  without lock: breaks as expected (${unlockedProblems.join('; ')})`)
    }
}

/** Launch RACERS migrators simultaneously; resolve once all have exited. */
async function race(script, env) {
    return Promise.all(Array.from({ length: RACERS }, () =>
        execFileAsync('node', [script], { cwd: work, env })
            .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
            .catch((err) => ({ code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' }))))
}

/**
 * One-off query via the shipped migrator's own `postgres` client, so this
 * script needs no `psql` binary and no extra dependency of its own.
 */
async function psql(statement) {
    const runner = path.join(work, `q-${queryCounter++}.mjs`)
    await writeFile(
        runner,
        'import postgres from \'postgres\'\n'
        + 'const sql = postgres(process.env.NUXT_DATABASE_URL, { max: 1, onnotice: () => {} })\n'
        + `const rows = await sql.unsafe(\`${statement.replaceAll('\'\'', '\'')}\`)\n`
        + 'if (rows.length > 0) process.stdout.write(String(Object.values(rows[0])[0] ?? \'\'))\n'
        + 'await sql.end({ timeout: 5 })\n',
        'utf8',
    )
    const { stdout } = await execFileAsync('node', [runner], {
        cwd: work,
        env: { ...process.env, NUXT_DATABASE_URL: url },
    })
    return stdout
}
