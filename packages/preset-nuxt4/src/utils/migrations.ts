import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { exists, hashFile, isFeatureEnabled, resolveProjectPM, run, type RunContext } from '@battlestack/core'
import { ui } from '@battlestack/tui'

/** Drizzle migrations for scaffold and `pull`: production applies only the committed SQL. */

/**
 * Runs `db:generate`. `drizzle-kit generate` is offline (no database needed), but it does
 * need node_modules. Never throws: the caller reports the failure and the run goes on.
 */
export async function generateMigration(ctx: RunContext): Promise<boolean> {
    try {
        const pm = await resolveProjectPM({
            projectDir: ctx.projectDir,
            fallback: String(ctx.state.packageManager ?? 'pnpm'),
        })
        await run(pm, ['run', 'db:generate'], { cwd: ctx.projectDir, inherit: ctx.debug })
        return true
    } catch (err) {
        if (ctx.debug) console.error(err)
        return false
    }
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
 */
export async function generatePulledMigration(ctx: RunContext, schemaBefore: Map<string, string>): Promise<void> {
    if (!isFeatureEnabled(ctx, 'nuxt4:database')) return
    const schemaAfter = await hashSchemaFiles(ctx.projectDir)
    const changed = schemaAfter.size !== schemaBefore.size
        || [...schemaAfter].some(([file, hash]) => schemaBefore.get(file) !== hash)
    if (!changed) return
    if (!ctx.state.skipInstall && await generateMigration(ctx)) {
        ui.ok('Schema changed: ran db:generate, commit the new SQL in server/database/migrations/')
        return
    }
    ui.warn('Schema changed but no migration was generated. Run `pnpm run db:generate` and commit the SQL before you deploy')
}
