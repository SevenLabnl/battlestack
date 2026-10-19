import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { exists, hashFile, isFeatureEnabled, resolveProjectPM, run, updateLedger, type RunContext } from '@battlestack/core'
import { ui } from '@battlestack/tui'

/** Drizzle migrations for scaffold and `pull`: production applies only the committed SQL. */

const SCHEMA_DIR = 'server/database/schema/'
const MIGRATIONS_DIR = path.join('server', 'database', 'migrations')
const GENERATE_BY_HAND = 'run `pnpm run db:generate` and commit the SQL in server/database/migrations/ before you deploy'

export interface GenerateResult {
    /** The new `.sql` files, relative to the migrations folder. Empty when nothing was written. */
    created: string[]
    /** The last line drizzle-kit printed, to explain an empty `created`. */
    lastLine?: string
}

async function migrationFiles(projectDir: string): Promise<Set<string>> {
    const dir = path.join(projectDir, MIGRATIONS_DIR)
    if (!(await exists(dir))) return new Set()
    const entries = await readdir(dir, { recursive: true, withFileTypes: true })
    return new Set(entries
        .filter((e) => e.isFile() && e.name.endsWith('.sql'))
        .map((e) => path.relative(dir, path.join(e.parentPath, e.name))))
}

function lastLineOf(text: string): string | undefined {
    return text.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1)
}

/**
 * Runs `db:generate`. `drizzle-kit generate` is offline (no database needed), but it does
 * need node_modules. Never throws. drizzle-kit exits 0 on a rename prompt without a TTY and on
 * a schema it cannot load, so only a new SQL file counts as success.
 */
export async function generateMigration(ctx: RunContext): Promise<GenerateResult> {
    const before = await migrationFiles(ctx.projectDir)
    let lastLine: string | undefined
    try {
        const pm = await resolveProjectPM({
            projectDir: ctx.projectDir,
            fallback: String(ctx.state.packageManager ?? 'pnpm'),
        })
        const result = await run(pm, ['run', 'db:generate'], { cwd: ctx.projectDir, inherit: ctx.debug })
        lastLine = lastLineOf(result.stderr) ?? lastLineOf(result.stdout)
    } catch (err) {
        if (ctx.debug) console.error(err)
        lastLine = (err as Error).message
    }
    const created = [...await migrationFiles(ctx.projectDir)].filter((f) => !before.has(f)).sort()
    return { created, lastLine }
}

/** Content hash of every file under `server/database/schema/`, keyed by absolute path. */
export async function hashSchemaFiles(projectDir: string): Promise<Map<string, string>> {
    const dir = path.join(projectDir, 'server', 'database', 'schema')
    const hashes = new Map<string, string>()
    if (!(await exists(dir))) return hashes
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const file = path.join(entry.parentPath, entry.name)
        hashes.set(file, await hashFile(file))
    }
    return hashes
}

/**
 * Generates a migration when a pull changed a schema file, which otherwise never reaches the
 * production database. `schemaBefore` is `hashSchemaFiles` from before the pull. Disk is
 * compared rather than update reports, which also list files whose bytes did not change.
 * Anything left to do goes to the update ledger, so it lands in REPORT.md and the exit code.
 */
export async function generatePulledMigration(ctx: RunContext, schemaBefore: Map<string, string>): Promise<void> {
    if (!isFeatureEnabled(ctx, 'nuxt4:database')) return
    const ledger = updateLedger(ctx)

    // A staged or conflicted schema file is not on disk in its new form yet, so generating now
    // would miss its change, and a file with conflict markers does not load at all.
    const pending = [...new Set([...ledger.staged, ...ledger.conflicts])].filter((rel) => rel.startsWith(SCHEMA_DIR)).sort()
    if (pending.length > 0) {
        ledger.actions.push(`Schema files still need your merge (${pending.join(', ')}). Finish them, then ${GENERATE_BY_HAND}`)
        ui.warn('Schema update not applied yet, so no migration was generated. See .battlestack/pull/REPORT.md')
        return
    }

    const schemaAfter = await hashSchemaFiles(ctx.projectDir)
    const changed = schemaAfter.size !== schemaBefore.size
        || [...schemaAfter].some(([file, hash]) => schemaBefore.get(file) !== hash)
    if (!changed) return

    if (ctx.state.skipInstall) {
        ledger.actions.push(`The schema changed and --skip-install skipped db:generate: ${GENERATE_BY_HAND}`)
        ui.warn('Schema changed; --skip-install skipped db:generate. See .battlestack/pull/REPORT.md')
        return
    }
    const { created, lastLine } = await generateMigration(ctx)
    if (created.length > 0) {
        ui.ok(`Schema changed: generated ${created.join(', ')}. Commit it with this pull`)
        return
    }
    const why = lastLine ? ` drizzle-kit said: ${lastLine}.` : ''
    const rename = /tty|interactive/i.test(lastLine ?? '') ? ' A renamed column or table needs the prompt, so run it in a terminal.' : ''
    ledger.actions.push(`The schema changed but db:generate wrote no migration.${why}${rename} To finish, ${GENERATE_BY_HAND}`)
    ui.warn('Schema changed but no migration was generated. See .battlestack/pull/REPORT.md')
}
