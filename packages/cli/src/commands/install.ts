import path from 'node:path'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    buildRunContext,
    CLIError,
    ErrorCode,
    exists,
    findProjectRoot,
    installArgs,
    isFeatureEnabled,
    readManifest,
    run,
    spawnSyncResolved as safeSpawnSync,
    type BattlestackRegistries,
    type EnvDiff,
    type PackageManager,
    type ParsedArgs,
    type ReservedCommand,
    type RunContext,
} from '@battlestack/core'
import { applyDbExtensions } from '@battlestack/core/utils/db.js'
import { applyEnv } from '@battlestack/preset-nuxt4'

/** Static metadata only. `run` is built per-dispatch in `project.ts`. */
export const installReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'install',
    usage: 'battlestack install',
    label: 'post-clone bootstrap (.env → install → db:push)',
    group: 'Lifecycle',
}

/** .env → install → db up + push. Seeding stays manual. */
export async function installCommand(args: ParsedArgs, _loader: Ora, registries: BattlestackRegistries): Promise<void> {
    const projectRoot = await findProjectRoot(process.cwd())
    if (!projectRoot) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Not inside a battlestack project (no .battlestack/manifest.json found in this directory or any parent).',
        )
    }

    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    const pm = manifest.packageManager as PackageManager
    const ctx = buildRunContext({
        projectDir: projectRoot,
        manifest,
        debug: args.debug,
        dryRun: args.dryRun,
    }, registries)

    ui.section('Install')
    ui.dim(projectRoot)

    await bootstrapProject(ctx, pm)

    ui.section('Done')
    ui.ok('Install complete')
    ui.blank()
    ui.plain(ui.color.title('Next steps'))
    const rows: Array<[string, string]> = []
    if (isFeatureEnabled(ctx, 'nuxt4:database')) {
        rows.push([ui.cmd('battlestack db:seed'), 'one-time, creates the admin user'])
    }
    rows.push([ui.cmd('battlestack dev'), 'start the dev server'])
    ui.kv(rows)
    ui.blank()
}

/** Local `.env`, deps, and — unless `includeDb` is false — the database up plus schema. */
export async function bootstrapProject(
    ctx: RunContext,
    pm: PackageManager,
    opts: { includeDb?: boolean } = {},
): Promise<void> {
    await ensureEnv(ctx)
    await ensureDeps(ctx, pm)
    if ((opts.includeDb ?? true) && isFeatureEnabled(ctx, 'nuxt4:database')) {
        await ensureDb(ctx, pm)
    }
}

/**
 * Sets up the local-dev `.env` only. `.env.example` is read as a base, never written back.
 * A missing `.env` is rebuilt with dev values and fresh secrets; a present one only gains gaps.
 */
async function ensureEnv(ctx: RunContext): Promise<void> {
    const envPath = path.join(ctx.projectDir, '.env')
    const present = await exists(envPath)

    if (ctx.dryRun) {
        ui.info(present
            ? 'dry-run: would reconcile .env (append any missing feature keys)'
            : 'dry-run: would write .env for local dev (.env.example left untouched)')
        return
    }

    ui.step(present
        ? 'Reconciling .env (appending any missing feature keys)'
        : 'Writing .env for local dev (generating secrets; .env.example untouched)')
    // `applyEnv` is called directly so `writeExample: false` reaches it.
    const diff = await applyEnv(ctx, { writeExample: false })
    ctx.state['env:diff'] = diff

    reportEnvDiff(diff, present)
}

/** Prints what `ensureEnv` did: a confirm for a new file, the appended keys for an existing one. */
function reportEnvDiff(diff: EnvDiff | undefined, present: boolean): void {
    if (!present) {
        ui.ok('.env written')
        return
    }
    const added = diff?.newKeys ?? []
    const changed = diff?.valueChanged ?? []
    const regenerated = diff?.regenerated ?? []
    if (added.length === 0 && changed.length === 0 && regenerated.length === 0) {
        ui.skip('.env present, already in sync')
        return
    }
    if (regenerated.length > 0) {
        ui.ok(`Generated ${regenerated.length} secret(s) that were still placeholders:`)
        for (const k of regenerated) ui.bullet(k)
    }
    if (added.length > 0) {
        ui.ok(`.env reconciled: appended ${added.length} missing key(s) under a "# Added by battlestack" block`)
        for (const k of added) ui.bullet(k)
        ui.dim('  verify the appended values before running the app')
    }
    if (changed.length > 0) {
        ui.warn('Empty keys have recommended defaults; set them manually:')
        for (const c of changed) ui.bullet(`${c.key}=${c.recommended}`)
    }
}

async function ensureDeps(ctx: RunContext, pm: PackageManager): Promise<void> {
    const nm = path.join(ctx.projectDir, 'node_modules')
    if (await exists(nm)) {
        ui.skip('node_modules/ present, skipped')
        return
    }
    if (ctx.dryRun) {
        ui.info(`dry-run: would run ${pm} install`)
        return
    }
    ui.step(`${ui.cmd(pm + ' install')}`)
    await run(pm, installArgs(pm), { cwd: ctx.projectDir, inherit: true })
    ui.ok(`${pm} install complete`)
}

async function ensureDb(ctx: RunContext, pm: string): Promise<void> {
    if (ctx.dryRun) {
        ui.info('dry-run: would start postgres (docker compose up -d) and apply schema (db:migrate / db:push)')
        return
    }
    if (!hasDocker()) {
        ui.fail('Docker not on PATH; install Docker Desktop and re-run')
        return
    }
    ui.step(`${ui.cmd('docker compose up -d')} ${ui.color.dim('(postgres)')}`)
    try {
        await run('docker', ['compose', 'up', '-d'], {
            cwd: ctx.projectDir,
            inherit: true,
        })
    } catch (err) {
        ui.fail('docker compose failed (is the daemon running?)')
        if (ctx.debug) console.error(err)
        return
    }

    ui.step('Waiting for postgres')
    if (!(await waitForPg(ctx.projectDir, pgWaitTiming.budgetMs))) {
        ui.fail(
            `postgres did not become ready within ${Math.round(pgWaitTiming.budgetMs / 1000)}s`,
        )
        return
    }
    ui.ok('postgres ready')

    // Extensions (CREATE EXTENSION / CREATE SCHEMA) precede any drizzle DDL: generated SQL never contains them.
    try {
        await applyDbExtensions(ctx.projectDir)
    } catch (err) {
        ui.fail('applying server/database/extensions/*.sql failed')
        if (ctx.debug) console.error(err)
        return
    }

    const migrationsPresent = await hasSqlMigrations(ctx.projectDir)
    if (migrationsPresent) {
        ui.step(
            `${ui.cmd('db:migrate')} ${ui.color.dim('(apply committed SQL migrations)')}`,
        )
        try {
            await run(pm, ['run', 'db:migrate'], { cwd: ctx.projectDir, inherit: true })
            ui.ok('Migrations applied')
            return
        } catch (err) {
            ui.fail('db:migrate failed')
            if (ctx.debug) console.error(err)
            return
        }
    }

    ui.step(`${ui.cmd('db:push')} ${ui.color.dim('(direct schema sync, dev mode)')}`)
    try {
        await run(pm, ['run', 'db:push'], { cwd: ctx.projectDir, inherit: true })
        ui.ok('Schema applied')
    } catch (err) {
        ui.fail('db:push failed')
        if (ctx.debug) console.error(err)
    }
}

async function hasSqlMigrations(projectDir: string): Promise<boolean> {
    try {
        const { readdir } = await import('node:fs/promises')
        const entries = await readdir(path.join(projectDir, 'server', 'database', 'migrations'))
        return entries.some((e) => e.endsWith('.sql'))
    } catch {
        return false
    }
}

function hasDocker(): boolean {
    return safeSpawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0
}

/** Postgres wait budget and poll interval. Mutable. */
export const pgWaitTiming = { budgetMs: 30_000, pollMs: 500 }

async function waitForPg(projectDir: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const result = safeSpawnSync(
            'docker',
            ['compose', 'exec', '-T', 'db', 'pg_isready', '-U', 'postgres', '-d', 'app'],
            { cwd: projectDir, stdio: 'ignore' },
        )
        if (result.status === 0) return true
        await new Promise((r) => setTimeout(r, pgWaitTiming.pollMs))
    }
    return false
}
