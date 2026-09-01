/**
 * Proves the cross-replica cache bus actually works, against a REAL Postgres, by running
 * real replica processes that share one database.
 *
 * Companion to `scripts/migrate-lock-race.mjs`, which covers boot-time advisory locks. This
 * one covers the other half of replica safety: a config change made on one replica reaching
 * every other one.
 *
 * It cannot be a vitest test, for the same reason the migrate race isn't: the code under test
 * is template payload that resolves `postgres` and `drizzle-orm` from a scaffolded project's
 * own `node_modules`, which this repo doesn't have.
 *
 * ---------------------------------------------------------------------------
 * THE NEGATIVE CONTROL IS THE POINT. Read this before changing anything below.
 *
 *   A test for a PROPAGATION property must run twice, once with the mechanism and once with
 *   it removed, and must FAIL when the removed-mechanism run passes.
 *
 * A propagation test fails vacuously in a way you cannot see from the outside: if the cache
 * entry was going to disappear anyway, every replica reports success and the run is
 * indistinguishable from a real pass. The TTL is the specific hazard here, since expiry and
 * invalidation look identical from the outside. So `TTL_MS` is set far beyond any run's
 * lifetime: inside a scenario, nothing but the mechanism under test can drop an entry.
 *
 * Each scenario strips exactly one thing for its control, never more, so a tripped control
 * points at one mechanism rather than at "something changed".
 *
 * If a control stops tripping, that is a RED result about the test, never a reason to relax
 * the assertion.
 * ---------------------------------------------------------------------------
 *
 * Usage:
 *   NUXT_DATABASE_URL=postgres://user:pass@host:port/db \
 *     node scripts/replica-race.mjs --project <scaffolded-project-dir>
 *
 * `--project` supplies `server/utils/cache-bus.ts`, `server/database/client.ts` and a
 * `node_modules` with `postgres`, `drizzle-orm` and `tsx`. It is read, never written; the
 * run happens in a temp directory that symlinks into it. The database is only used for
 * LISTEN/NOTIFY and is never written to.
 */
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Concurrent replicas per scenario. More than 2 so "every replica" is a real claim. */
const REPLICAS = 4
/**
 * Cache TTL for the harness. Deliberately far longer than any run: if an entry can expire on
 * its own, a scenario proves nothing and its control cannot trip. See the header.
 */
const TTL_MS = 600_000
/** How long a replica waits for its entry to disappear before reporting it stale. */
const WINDOW_MS = 8_000

/**
 * One replica: subscribe exactly as `server/plugins/02-cache-invalidation.ts` does, cache an
 * entry, then report whether it disappears within the window.
 */
const REPLICA_SRC = `import {
    CACHE_INVALIDATION_CHANNEL,
    applyRemoteInvalidation,
    createTtlCache,
    dropAllLocal,
} from './server/utils/cache-bus'
import { sql } from './server/database/client'

const cache = createTtlCache<string>('race', Number(process.env.RACE_TTL_MS))

if (process.env.RACE_LISTEN === '1') {
    await sql.listen(
        CACHE_INVALIDATION_CHANNEL,
        (payload) => applyRemoteInvalidation(payload),
        process.env.RACE_ONLISTEN === '1' ? () => dropAllLocal() : undefined,
    )
}

// Seeded after subscribing, so the first onlisten cannot clear it before the run starts.
cache.set('k', 'v0')
console.log('READY')

const deadline = Date.now() + Number(process.env.RACE_WINDOW_MS)
let dropped = false
while (Date.now() < deadline) {
    if (cache.get('k') === undefined) { dropped = true; break }
    await new Promise((r) => setTimeout(r, 25))
}
console.log(dropped ? 'DROPPED' : 'STALE')
await sql.end({ timeout: 5 })
`

/** The admin write: invalidate through the same helper the endpoints call. */
const PUBLISH_SRC = `import { invalidate } from './server/utils/cache-bus'
import { sql } from './server/database/client'

await invalidate('race', 'k')
await sql.end({ timeout: 5 })
`

const url = process.env.NUXT_DATABASE_URL
if (!url) {
    console.error('[replica-race] NUXT_DATABASE_URL is not set')
    process.exit(2)
}

const projectFlag = process.argv.indexOf('--project')
const projectDir = projectFlag !== -1 ? path.resolve(process.argv[projectFlag + 1] ?? '') : null
if (!projectDir || !existsSync(projectDir)) {
    console.error('[replica-race] pass --project <scaffolded-project-dir>')
    process.exit(2)
}

const cacheBus = path.join(projectDir, 'server', 'utils', 'cache-bus.ts')
const tsxBin = path.join(projectDir, 'node_modules', '.bin', 'tsx')
for (const p of [cacheBus, tsxBin, path.join(projectDir, 'node_modules', 'postgres')]) {
    if (!existsSync(p)) {
        console.error(`[replica-race] missing ${p} — is --project a scaffolded, installed project`
            + ' with nuxt4:database enabled?')
        process.exit(2)
    }
}

const failures = []
const log = (m) => console.log(`[replica-race] ${m}`)
let queryCounter = 0

const work = await mkdtemp(path.join(tmpdir(), 'battlestack-replica-race-'))
try {
    await runAll()
} finally {
    await rm(work, { recursive: true, force: true })
}

if (failures.length > 0) {
    console.error(`\n[replica-race] FAILED\n${failures.map((f) => `  - ${f}`).join('\n')}`)
    process.exit(1)
}
log('OK — invalidations reach every replica, and the race can prove it.')

async function runAll() {
    log(`work dir: ${work}`)
    await writeFile(path.join(work, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8')
    // Symlinked rather than copied so the code under test is the project's real file.
    await symlink(path.join(projectDir, 'node_modules'), path.join(work, 'node_modules'))
    await symlink(path.join(projectDir, 'server'), path.join(work, 'server'))
    await writeFile(path.join(work, 'replica.ts'), REPLICA_SRC, 'utf8')
    await writeFile(path.join(work, 'publish.ts'), PUBLISH_SRC, 'utf8')

    await scenario({
        name: 'an admin edit reaches every replica',
        // The mechanism: each replica subscribes to the invalidation channel.
        withMechanism: { RACE_LISTEN: '1', RACE_ONLISTEN: '1' },
        // The control strips only the subscription.
        withoutMechanism: { RACE_LISTEN: '0', RACE_ONLISTEN: '1' },
        act: async () => { await runNode('publish.ts') },
    })

    await scenario({
        name: 'a replica that lost its listener heals on reconnect',
        // The mechanism: the third `sql.listen` argument drops every cache on (re)connect,
        // because anything published while the connection was down was never delivered.
        withMechanism: { RACE_LISTEN: '1', RACE_ONLISTEN: '1' },
        // The control strips only that callback; the replica still listens.
        withoutMechanism: { RACE_LISTEN: '1', RACE_ONLISTEN: '0' },
        // No NOTIFY at all: the only thing that can clear an entry here is the reconnect.
        act: async () => {
            await psql(
                'SELECT pg_terminate_backend(pid) FROM pg_stat_activity '
                + 'WHERE datname = current_database() AND pid <> pg_backend_pid() '
                + "AND query ILIKE ''listen %''",
            )
        },
    })
}

/**
 * Run one scenario twice: with the mechanism (every replica must drop its entry) and with it
 * stripped (every replica must keep it). A control that does not trip fails the run.
 */
async function scenario({ name, withMechanism, withoutMechanism, act }) {
    log(`scenario: ${name}`)

    const live = await race(withMechanism, act)
    const stale = live.filter((r) => r !== 'DROPPED')
    if (stale.length > 0) {
        failures.push(`${name}: with the mechanism — ${stale.length}/${REPLICAS} replicas did not `
            + `drop the entry (${live.join(', ')})`)
    } else {
        log(`  with mechanism: all ${REPLICAS} replicas dropped the entry`)
    }

    const control = await race(withoutMechanism, act)
    const dropped = control.filter((r) => r === 'DROPPED')
    if (dropped.length > 0) {
        failures.push(`${name}: NEGATIVE CONTROL DID NOT TRIP — ${dropped.length}/${REPLICAS} `
            + 'replicas dropped the entry with the mechanism stripped out, so a pass with it '
            + 'proves nothing. Something other than the mechanism is clearing the cache; check '
            + `that TTL_MS (${TTL_MS}) still far exceeds WINDOW_MS (${WINDOW_MS}).`)
    } else {
        log('  without mechanism: entry stays stale, as expected')
    }
}

/**
 * Start REPLICAS processes, wait until all report READY, run `act`, then collect each
 * replica's verdict.
 */
async function race(env, act) {
    const procs = Array.from({ length: REPLICAS }, () => startReplica(env))
    try {
        await Promise.all(procs.map((p) => p.ready))
        await act()
        return await Promise.all(procs.map((p) => p.verdict))
    } finally {
        for (const p of procs) p.child.kill()
    }
}

/** One replica process. Resolves `ready` on its READY line and `verdict` on its result line. */
function startReplica(env) {
    const child = spawn(tsxBin, ['replica.ts'], {
        cwd: work,
        env: {
            ...process.env,
            NUXT_DATABASE_URL: url,
            RACE_TTL_MS: String(TTL_MS),
            RACE_WINDOW_MS: String(WINDOW_MS),
            ...env,
        },
    })

    let resolveReady
    let resolveVerdict
    const ready = new Promise((r) => { resolveReady = r })
    const verdict = new Promise((r) => { resolveVerdict = r })

    let buffer = ''
    child.stdout.on('data', (chunk) => {
        buffer += chunk
        let nl
        while ((nl = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, nl).trim()
            buffer = buffer.slice(nl + 1)
            if (line === 'READY') resolveReady()
            else if (line === 'DROPPED' || line === 'STALE') resolveVerdict(line)
        }
    })
    child.stderr.on('data', (chunk) => process.stderr.write(`[replica] ${chunk}`))
    child.on('exit', () => {
        // Unblocks the run rather than hanging if a replica died before reporting.
        resolveReady()
        resolveVerdict('EXITED')
    })

    return { child, ready, verdict }
}

function runNode(script) {
    return execFileAsync(tsxBin, [script], {
        cwd: work,
        env: { ...process.env, NUXT_DATABASE_URL: url, RACE_TTL_MS: String(TTL_MS) },
    })
}

/** One-off query through the project's own `postgres`, so this script needs no `psql`. */
async function psql(statement) {
    const runner = path.join(work, `q-${queryCounter++}.mjs`)
    await writeFile(
        runner,
        'import postgres from \'postgres\'\n'
        + 'const sql = postgres(process.env.NUXT_DATABASE_URL, { max: 1, onnotice: () => {} })\n'
        + `await sql.unsafe(\`${statement.replaceAll('\'\'', '\'')}\`)\n`
        + 'await sql.end({ timeout: 5 })\n',
        'utf8',
    )
    await execFileAsync('node', [runner], {
        cwd: work,
        env: { ...process.env, NUXT_DATABASE_URL: url },
    })
}
