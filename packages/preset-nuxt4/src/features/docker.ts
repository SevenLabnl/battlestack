import path from 'node:path'
import { readFile } from 'node:fs/promises'
import pc from 'picocolors'
import {
    hashFile,
    isFeatureEnabled,
    recordFile,
    readLocalState,
    type BuildSecret,
    type Feature,
    type ProjectCommand,
    type RunContext,
    type PackageManager,
} from '@battlestack/core'
import { templatesDir } from '@battlestack/core/utils/templates.js'
import { writeFileEnsured } from '@battlestack/core/utils/fs.js'
import { run } from '@battlestack/core/utils/run.js'
import { resolvePort } from '@battlestack/core/utils/port-alloc.js'
import { pmInstallGlobalCommands, resolveProjectPM } from '@battlestack/core/utils/package-manager.js'
import { STAGE } from '@battlestack/core/constants/stages.js'
import { ui } from '@battlestack/tui'

// Profile-gated `app` service in the shared docker-compose.yml.
const PROFILE_FLAGS = ['--profile', 'prod']

/** Production Dockerfile and `battlestack prod` commands, reusing the existing docker-compose.yml. */
export const dockerFeature: Feature = {
    id: 'shared:docker',
    // 1.1.0: stages server/database/extensions into /app/extensions so migrate.mjs and the
    // boot migrator can apply CREATE EXTENSION / CREATE SCHEMA before migrations.
    version: '1.1.0',
    label: 'Production Dockerfile + prod commands',
    stage: STAGE.GITIGNORE,
    failureIsNonFatal: true,

    collectDocs(ctx) {
        const lines = [
            'Multi-stage build at `Dockerfile`. Build stage installs deps + compiles Nitro; runtime stage ships only `.output/` and runs as the unprivileged `node` user on port 3000.',
            '',
            'A profile-gated `app` service lives in the existing `docker-compose.yml` (only activated via `--profile prod`, so `battlestack dev`/`battlestack up` ignore it). `battlestack prod` builds the image, starts db + app, and exposes the app on the project\'s allocated port.',
            '',
            '```bash',
            'battlestack prod         # build + up -d',
            'battlestack prod:logs    # tail app logs',
            'battlestack prod:down    # stop',
            '```',
        ]
        const buildSecrets = collectBuildSecrets(ctx)
        if (buildSecrets.length > 0) {
            const names = buildSecrets.map((s) => `\`${s.env ?? s.id}\``).join(', ')
            const plural = buildSecrets.length > 1 ? 's' : ''
            lines.push(
                '',
                `\`battlestack prod\` forwards ${names} from your env as build secret${plural}.`,
            )
        }
        return [
            {
                heading: 'Docker (production image)',
                body: lines.join('\n'),
                targets: ['readme', 'agents'] as const satisfies Array<'readme' | 'agents'>,
            },
        ]
    },

    async execute(ctx) {
        await emit(ctx)
    },

    async update(ctx, _prev) {
        await emit(ctx)
        return { written: ['Dockerfile'], skipped: [], notes: [] }
    },

    projectCommands(): Record<string, ProjectCommand> {
        const compose = (args: string[]) => async (ctx: RunContext) => {
            const passthrough = ctx.state.passthrough ?? []
            await run('docker', ['compose', ...PROFILE_FLAGS, ...args, ...passthrough], {
                cwd: ctx.projectDir,
                inherit: true,
            })
        }
        const prodUp = async (ctx: RunContext): Promise<void> => {
            if (isFeatureEnabled(ctx, 'nuxt4:database')) {
                await ensureDbAndSeed(ctx)
            }
            const env: Record<string, string> = {}
            for (const secret of collectBuildSecrets(ctx)) {
                const envName = secret.env ?? secret.id
                const value = process.env[envName]
                if (value) env[envName] = value
            }
            await run('docker', ['compose', ...PROFILE_FLAGS, 'build', 'app'], {
                cwd: ctx.projectDir,
                inherit: true,
                env,
            })
            await run('docker', ['compose', ...PROFILE_FLAGS, 'up', '-d'], {
                cwd: ctx.projectDir,
                inherit: true,
            })
            await printProdReady(ctx)
        }
        return {
            'prod': { label: 'Build prod image + start (build + up -d)', run: prodUp },
            'production': { label: 'Alias for prod', run: prodUp },
            'prod:up': { label: 'Start prod stack (no rebuild)', run: compose(['up', '-d']) },
            'prod:down': { label: 'Stop prod stack', run: compose(['down']) },
            'prod:logs': { label: 'Tail prod app logs', run: compose(['logs', '-f', 'app']) },
            'prod:build': { label: 'Build prod image (no run)', run: compose(['build', 'app']) },
            'prod:ps': { label: 'Show prod stack status', run: compose(['ps']) },
        }
    },
}

/** First-run db setup and admin seed for `battlestack prod`. Idempotent. Resolved via the registry. */
async function ensureDbAndSeed(ctx: RunContext): Promise<void> {
    if (!ctx.registries.features.has('nuxt4:database')) return
    const db = ctx.registries.features.get('nuxt4:database')
    const dbUp = db.projectCommands?.(ctx)?.['db:up']
    if (dbUp) {
        try {
            await dbUp.run(ctx)
        } catch (err) {
            ui.warn('`db:up` failed. Prod app may crash on boot. Run `battlestack db:up` then retry')
            if (ctx.debug) console.error(err)
            return
        }
    }
    const { isDatabaseSeeded, markDatabaseSeeded } = await import('./database.js')
    if (await isDatabaseSeeded(ctx.projectDir, db.fqid)) {
        // The manifest flag survives a directory rename; the db volume does not.
        const { usersTablePopulated } = await import('@battlestack/core/utils/db.js')
        if (await usersTablePopulated(ctx.projectDir) !== false) return
        ui.warn('Manifest says seeded but the users table is empty (renamed project → fresh volume?); reseeding')
    }
    ui.step('First-time seed (writing admin user from SEED_* in .env)')
    const pm = await resolveProjectPM({
        projectDir: ctx.projectDir,
        fallback: String(ctx.state.packageManager ?? 'pnpm'),
    })
    try {
        await run(pm, ['run', 'db:seed'], { cwd: ctx.projectDir, inherit: true })
        await markDatabaseSeeded(ctx.projectDir, db.fqid)
    } catch (err) {
        ui.warn('First-time `db:seed` failed. Run `battlestack db:seed` manually after `battlestack prod`')
        if (ctx.debug) console.error(err)
    }
}

async function printProdReady(ctx: RunContext): Promise<void> {
    // The prod compose mapping uses APP_PORT, distinct from the dev server's NUXT_PORT.
    const port = await resolvePort(ctx.projectDir, ctx.projectName, 'app', 'APP_PORT')
    const localUrl = `http://localhost:${port}`
    const local = await readLocalState(ctx.projectDir)
    const gateway
        = local?.gateway?.enabled && local.gateway.hostname
            ? `https://${local.gateway.hostname}`
            : null

    ui.blank()
    ui.ok('Prod stack running')
    const rows: Array<[string, string]> = [['app', pc.cyan(localUrl)]]
    if (gateway) rows.push(['gateway', pc.cyan(gateway)])
    if (isFeatureEnabled(ctx, 'nuxt4:auth')) {
        const mailUi = await resolvePort(ctx.projectDir, ctx.projectName, 'mail-ui')
        rows.push(['mail-ui', pc.cyan(`http://localhost:${mailUi}`)])
    }
    if (isFeatureEnabled(ctx, 'nuxt4:storage')) {
        const s3Console = await resolvePort(ctx.projectDir, ctx.projectName, 's3-console')
        rows.push(['s3-ui', pc.cyan(`http://localhost:${s3Console}`)])
    }
    ui.kv(rows)
    ui.blank()
    ui.kv([
        [ui.cmd('battlestack prod:logs'), 'tail app logs'],
        [ui.cmd('battlestack prod:down'), 'stop stack'],
    ])
    ui.blank()
}

/** `collectBuildSecrets()` across every enabled feature. Order-independent. */
function collectBuildSecrets(ctx: RunContext): BuildSecret[] {
    const secrets: BuildSecret[] = []
    for (const id of ctx.enabledFeatures) {
        const feature = ctx.registries.features.get(id)
        for (const s of feature.collectBuildSecrets?.(ctx) ?? []) secrets.push(s)
    }
    return secrets
}

async function emit(ctx: RunContext): Promise<void> {
    const pm = String(ctx.state.packageManager ?? 'pnpm') as PackageManager
    const buildSecrets = collectBuildSecrets(ctx)
    const hasDatabase = isFeatureEnabled(ctx, 'nuxt4:database')
    const dockerVars = renderVars(pm, buildSecrets, hasDatabase)
    const src = templatesDir(import.meta.url, '..', '..', 'templates', 'docker')

    const dockerfileRaw = await readFile(path.join(src, 'Dockerfile'), 'utf8')
    let dockerfile = dockerfileRaw
    for (const [k, v] of Object.entries(dockerVars)) dockerfile = dockerfile.split(`__${k}__`).join(v)
    const dockerfileDest = path.join(ctx.projectDir, 'Dockerfile')
    await writeFileEnsured(dockerfileDest, dockerfile)
    recordFile(ctx, 'shared:docker', 'Dockerfile', await hashFile(dockerfileDest))
}

/** The `RUN` installing the PM. npm ships with the Node base image, so it emits a comment instead. */
function pmBootstrap(pm: PackageManager): string {
    const cmds = pmInstallGlobalCommands(pm)
    return cmds.length > 0
        ? `RUN ${cmds.join(' && ')}`
        : '# npm ships with the node base image, so no PM bootstrap is needed'
}

function renderVars(
    pm: PackageManager,
    buildSecrets: BuildSecret[],
    hasDatabase: boolean,
): Record<string, string> {
    const installCmd = installCommand(pm)
    return {
        LOCKFILE: lockfile(pm),
        PM: pm,
        PM_BOOTSTRAP: pmBootstrap(pm),
        INSTALL_BLOCK: installBlock(installCmd, buildSecrets),
        BUNDLE_TOOLS_BLOCK: hasDatabase ? bundleToolsBlock(pm) : '',
        COPY_TOOLS_BLOCK: hasDatabase ? copyToolsBlock() : '',
    }
}

function bundleToolsBlock(_pm: PackageManager): string {
    return [
        '# Stage standalone migrate/seed scripts + the SQL migrations/extensions dirs for the runtime image.',
        'RUN mkdir -p /app/dist-tools && \\',
        '    cp tools/migrate.mjs /app/dist-tools/migrate.mjs && \\',
        '    cp tools/seed.mjs /app/dist-tools/seed.mjs && \\',
        '    mkdir -p /app/dist-tools/migrations /app/dist-tools/extensions && \\',
        '    if [ -d /app/server/database/migrations ]; then \\',
        '        cp -R /app/server/database/migrations/. /app/dist-tools/migrations/; \\',
        '    fi && \\',
        '    if [ -d /app/server/database/extensions ]; then \\',
        '        cp -R /app/server/database/extensions/. /app/dist-tools/extensions/; \\',
        '    fi',
    ].join('\n')
}

// Describes only what the image ships, not how a deploy target invokes migrate/seed.
function copyToolsBlock(): string {
    return [
        '# Standalone migrate/seed scripts land next to .output/server/index.mjs so',
        '# they resolve postgres + @node-rs/argon2 from .output/server/node_modules.',
        '# A deploy target\'s init step can call `node /app/server/migrate.mjs` and',
        '# `node /app/server/seed.mjs` directly against this runtime image.',
        'COPY --from=build --chown=node:node /app/dist-tools/migrate.mjs /app/server/migrate.mjs',
        'COPY --from=build --chown=node:node /app/dist-tools/seed.mjs /app/server/seed.mjs',
        'COPY --from=build --chown=node:node /app/dist-tools/migrations/ /app/migrations/',
        '# extensions/*.sql (CREATE EXTENSION / CREATE SCHEMA) run before migrations, by both',
        '# migrate.mjs and the boot migrator.',
        'COPY --from=build --chown=node:node /app/dist-tools/extensions/ /app/extensions/',
    ].join('\n')
}

function installCommand(pm: PackageManager): string {
    switch (pm) {
        case 'pnpm': return 'pnpm install --frozen-lockfile'
        case 'bun': return 'bun install --frozen-lockfile'
        case 'npm': return 'npm ci'
    }
}

function lockfile(pm: PackageManager): string {
    switch (pm) {
        case 'pnpm': return 'pnpm-lock.yaml'
        case 'bun': return 'bun.lock'
        case 'npm': return 'package-lock.json'
    }
}

/** Mounts every `collectBuildSecrets()` contribution as a BuildKit secret before installing. */
function installBlock(installCmd: string, secrets: BuildSecret[]): string {
    if (secrets.length === 0) return `RUN ${installCmd}`
    const mounts = secrets.map((s) => `--mount=type=secret,id=${s.id},required=${s.required ?? false}`)
    const exports = secrets.map((s) => {
        const envName = s.env ?? s.id
        return `if [ -f /run/secrets/${s.id} ]; then export ${envName}=$(cat /run/secrets/${s.id}); fi`
    })
    return [
        '# Build secrets injected via BuildKit --mount=type=secret.',
        `RUN ${mounts.join(' \\\n    ')} \\`,
        `    ${exports.join(' && \\\n    ')} && \\`,
        `    ${installCmd}`,
    ].join('\n')
}
