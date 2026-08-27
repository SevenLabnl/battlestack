import path from 'node:path'
import { fileURLToPath } from 'node:url'
import prompts from 'prompts'
import {
    acquireProjectLock,
    CLIError,
    enabledHas,
    ErrorCode,
    probeAndFreezePorts,
    projectPorts,
    resolvePackageManager,
    resolveProjectPM,
    run,
    runFeatures,
    writeLocalState,
    type BattlestackRegistries,
    type CommandContext,
    type ParsedArgs,
    type PortAssignment,
    type RunContext,
} from '@battlestack/core'
import { describePortAttribution } from '@battlestack/core/utils/port-diagnosis.js'
import { formatProject } from '../features/install.js'
import { validateBaseDir, validateProjectName } from '@battlestack/core/utils/validation.js'
import { enforcePreflight, runEnvPreflight } from '@battlestack/core/utils/preflight.js'
import { describeStale, detectStale, recreateProject } from '@battlestack/core/utils/recreate.js'
import {
    confirmProceed,
    isNonInteractive,
    printResolvedSettingsSummary,
    promptFramework,
    promptGateway,
    promptPackageManager,
    promptProjectName,
    promptTemplate,
    resolveOptionalFeatures,
    runFeaturePromptHooks,
    ui,
} from '@battlestack/tui'

// commands -> src -> preset-nuxt4 -> packages -> <root>.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')

function isInsideRepo(target: string): boolean {
    const rel = path.relative(REPO_ROOT, target)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Scaffolds a new project. `context.parsed` positionals are `[name] [template]`. */
export async function createCommand(context: CommandContext): Promise<void> {
    const { parsed: args, loader, registries } = context
    validateEarlyArgs(args, registries)

    ui.section('Project')
    ui.dim('  Name + location, then framework and template.')
    const projectName = await promptProjectName(args.projectName, args.yes)
    validateProjectName(projectName)

    const baseDir = args.cwd ? path.resolve(args.cwd) : process.cwd()
    if (args.cwd) await validateBaseDir(args.cwd)
    const projectDir = path.resolve(baseDir, projectName)

    // `BATTLESTACK_ALLOW_REPO_SCAFFOLD=1` bypasses the repo guard only. Distinct from `--force`.
    const allowRepoScaffold = args.force || process.env.BATTLESTACK_ALLOW_REPO_SCAFFOLD === '1'
    if (isInsideRepo(projectDir) && !allowRepoScaffold) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Refusing to scaffold inside the battlestack repo (${projectDir}). `
            + `Use --cwd <dir> to point elsewhere, or --force to override.`,
        )
    }

    const stale = await detectStale(projectName, projectDir)
    if (stale.dir || stale.docker || stale.incomplete) {
        const summary = describeStale(projectName, projectDir, stale)
        if (!args.force) {
            const nonInteractive = !(process.stdin.isTTY && process.stdout.isTTY) || args.yes
            if (nonInteractive) {
                throw new CLIError(
                    ErrorCode.DIRECTORY_EXISTS,
                    `"${projectName}" already exists (${summary}). `
                    + `Re-run with --force to drop containers + volumes + dir and re-scaffold.`,
                )
            }
            const { choice } = await prompts(
                {
                    type: 'select',
                    name: 'choice',
                    message: `"${projectName}" already exists (${summary}). Recreate?`,
                    initial: 0,
                    choices: [
                        { title: 'Keep existing project (cancel)', value: 'halt' },
                        {
                            title: 'Recreate (drop containers + volumes, wipe dir, re-scaffold)',
                            value: 'recreate',
                        },
                    ],
                },
                {
                    onCancel: () => {
                        ui.warn('Scaffold cancelled')
                        process.exit(0)
                    },
                },
            )
            if (choice !== 'recreate') {
                ui.warn('Scaffold cancelled')
                return
            }
        }
        if (args.verbose) ui.debug(`recreating: ${summary}`)
        await recreateProject(projectName, projectDir)
    }

    if (args.debug) ui.debug(`scaffolding into ${projectDir}`)
    if (args.cwd && args.verbose) ui.debug(`using --cwd ${baseDir}`)

    const framework = await promptFramework(registries, args.framework)
    // `--template` wins over the `<template>` positional.
    const template = await promptTemplate(registries, framework, args.template ?? args.secondPositional)

    if (template.framework !== framework.id) {
        throw new CLIError(
            ErrorCode.UNSUPPORTED_FEATURE,
            `Template "${template.id}" is not compatible with framework "${framework.id}"`,
        )
    }

    // Preflight runs before the feature/pm/gateway prompts.
    ui.section('Preflight')
    ui.dim('  Verifying Node, package manager, and Docker before scaffolding.')
    enforcePreflight(
        await runEnvPreflight({
            pm: await resolvePackageManager(args.packageManager),
            needsDocker: template.requiredFeatures.includes('nuxt4:database'),
        }),
    )

    const enabled = new Set<string>(template.requiredFeatures)

    if (args.disable) {
        for (const id of args.disable) {
            if (template.requiredFeatures.includes(id)) {
                throw new CLIError(
                    ErrorCode.UNSUPPORTED_FEATURE,
                    `Cannot disable required feature "${id}" for template "${template.id}"`,
                )
            }
        }
    }

    ui.section('Features')
    ui.dim('  Toggle the optional modules to scaffold (required ones are always on).')
    const optionalEnabled = await resolveOptionalFeatures(template, args, registries)
    for (const id of optionalEnabled) enabled.add(id)

    for (const id of enabled) {
        if (!registries.features.has(id)) {
            throw new CLIError(ErrorCode.UNKNOWN_FEATURE, `Unknown feature: ${id}`)
        }
        const feature = registries.features.get(id)
        if (feature.frameworks && !feature.frameworks.includes(framework.id)) {
            throw new CLIError(
                ErrorCode.UNSUPPORTED_FEATURE,
                `Feature "${id}" does not support framework "${framework.id}"`,
            )
        }
    }

    const pm = await promptPackageManager({
        explicit: args.packageManager,
        detected: await resolvePackageManager(args.packageManager),
        yes: args.yes,
    })

    const gatewayEnabled = await promptGateway(args.gateway)

    // Ports come from the project's own range. A busy preferred port shifts to the next free slot.
    ui.section('Port check')
    ui.dim('  Each service gets a per-project port, probing for a free one and freezing it in .env.')
    const assignments = await probeAndFreezePorts(projectName, projectPorts(projectName, enabled, registries))
    reportPortAssignments(assignments)

    const ctx: RunContext = {
        projectName,
        projectDir,
        framework,
        template,
        enabledFeatures: enabled,
        state: {
            packageManager: pm,
            skipInstall: args.skipInstall,
            gatewayEnabled,
            verbose: args.verbose,
            nonInteractive: isNonInteractive(args),
        },
        debug: args.debug,
        dryRun: args.dryRun,
        registries,
    }

    // Each feature with a prompt() hook adds its own section header.
    await runFeaturePromptHooks(enabled, ctx, registries)

    ui.section('Confirm')
    ui.dim('  Review the resolved setup before anything is written to disk.')
    printResolvedSettingsSummary({
        template,
        packageManager: pm,
        enabled,
        projectDir,
        state: ctx.state,
        registries,
    })

    if (!(await confirmProceed(args))) {
        ui.warn('Scaffold cancelled')
        return
    }

    ui.section('Scaffolding')
    ui.dim(ctx.dryRun
        ? '  Planning the file, feature and dependency work. Nothing is written.'
        : '  Generating files, applying features, and installing dependencies.')
    const releaseLock = await acquireProjectLock(projectDir, 'battlestack create', { dryRun: ctx.dryRun })
    try {
        await runFeatures(ctx, loader, { format: formatProject })
        await generateInitialMigration(ctx, enabled)
    } finally {
        await releaseLock()
    }

    if (gatewayEnabled && !ctx.dryRun) {
        await writeLocalState(projectDir, {
            gateway: { enabled: true, hostname: `${projectName}.battlestack.test` },
        })
    }

    ui.section('Done')
    if (ctx.dryRun) {
        ui.ok(`Would create ${ui.color.accent(projectName)} at ${ui.color.dim(projectDir)}`)
        ui.dim('  Dry run: nothing was written. Re-run without --dry-run to scaffold.')
        ui.blank()
        return
    }
    ui.dim('  Project ready. Next steps below.')
    ui.ok(`Created ${ui.color.accent(projectName)} at ${ui.color.dim(projectDir)}`)
    printNextSteps(projectDir, enabled, registries, {
        projectName,
        gatewayEnabled,
        adminEmail: typeof ctx.state.adminEmail === 'string' ? ctx.state.adminEmail : undefined,
        adminPassword:
            typeof ctx.state.adminPassword === 'string' ? ctx.state.adminPassword : undefined,
        nonInteractive: isNonInteractive(args),
        verbose: args.verbose,
    })
}

/**
 * Emits the initial `0000_*.sql` migration at scaffold time, so a fresh project deploys to
 * production without a manual `db:generate` first. `drizzle-kit generate` is offline (no
 * database needed), but it does need node_modules, hence the skipInstall guard.
 */
async function generateInitialMigration(ctx: RunContext, enabled: Set<string>): Promise<void> {
    // `enabled` holds canonicalized fqids, so a bare `enabled.has('nuxt4:database')` never matches.
    if (!enabledHas(enabled, 'nuxt4:database', ctx.registries)) return
    if (ctx.dryRun || ctx.state.skipInstall) return
    const pm = await resolveProjectPM({
        projectDir: ctx.projectDir,
        fallback: String(ctx.state.packageManager ?? 'pnpm'),
    })
    try {
        await run(pm, ['run', 'db:generate'], { cwd: ctx.projectDir, inherit: ctx.debug })
        ui.ok('Initial migration generated (server/database/migrations/)')
    } catch (err) {
        ui.warn(
            'db:generate failed (non-fatal). Run `pnpm run db:generate` once before your first deploy',
        )
        if (ctx.debug) console.error(err)
    }
}

/** Reports each port assignment. Only shifted ports get a line. */
function reportPortAssignments(assignments: PortAssignment[]): void {
    for (const a of assignments) {
        if (!a.shifted) continue
        const evidence = a.diagnosis ? describePortAttribution(a.diagnosis.attribution) : 'something else'
        ui.warn(`${a.label}: ${a.preferred} was busy (${evidence}), using ${a.port} instead`)
    }
}

/** "Next steps" tailored to installed features. */
function printNextSteps(
    projectDir: string,
    enabled: Set<string>,
    registries: BattlestackRegistries,
    opts: {
        projectName: string
        gatewayEnabled: boolean
        adminEmail?: string
        adminPassword?: string
        nonInteractive: boolean
        verbose: boolean
    },
): void {
    const rel = path.relative(process.cwd(), projectDir) || projectDir
    const hasDb = enabledHas(enabled, 'nuxt4:database', registries)

    ui.blank()
    ui.plain(ui.color.title('Next steps'))
    ui.kv([
        ['1.', `cd ${ui.color.accent(rel)}`],
        ['2.', `${ui.cmd('battlestack dev')}  ${ui.color.dim('(start dev server, postgres + db:push auto)')}`],
    ])
    if (hasDb) {
        ui.kv([
            [
                '3.',
                `${ui.cmd('battlestack db:seed')}  ${ui.color.dim('(re-run seeds after rotating SEED_* in .env)')}`,
            ],
        ])
    }

    // Credentials are omitted from non-interactive runs.
    if (hasDb && !opts.nonInteractive && opts.adminEmail && opts.adminPassword) {
        ui.blank()
        ui.plain(ui.color.title('Admin login') + ui.color.dim(' (mirrored in .env as SEED_ADMIN_*)'))
        ui.kv([
            ['email', opts.adminEmail],
            ['password', opts.adminPassword],
        ])
        ui.plain(
            ui.color.dim(
                '  Shown once. Rotate via SEED_ADMIN_PASSWORD + `battlestack db:seed`.',
            ),
        )
    }

    if (opts.gatewayEnabled) {
        ui.blank()
        ui.plain(ui.color.title('Gateway') + ui.color.dim(' (battlestack-gateway is on)'))
        ui.kv([
            ['url', `https://${opts.projectName}.battlestack.test`],
            ['disable', 'edit .battlestack/manifest.json (gateway.enabled: false)'],
        ])
    }

    if (opts.verbose) {
        ui.blank()
        ui.plain(ui.color.title('Maintenance'))
        ui.kv([
            ['battlestack', 'list every command in this project'],
            ['battlestack doctor', 'diagnose drift / stale features (read-only)'],
            ['battlestack pull', 'pull boilerplate template + config changes'],
            ['battlestack upgrade', 'alias for `pull` (picks up feature version bumps)'],
            ['battlestack bump', 'bump npm deps to latest'],
            ['battlestack sync', 'pull + bump + doctor in one shot'],
        ])
    } else {
        ui.blank()
        ui.dim('Run `battlestack --help` inside the project for maintenance commands.')
    }
    ui.blank()
}

/** Rejects an unknown `--template`/`--features` before any prompt fires. */
function validateEarlyArgs(args: ParsedArgs, registries: BattlestackRegistries): void {
    if (args.template) {
        if (!registries.templates.all().some((t) => t.id === args.template)) {
            const known = registries.templates
                .all()
                .map((t) => t.id)
                .join(', ')
            throw new CLIError(
                ErrorCode.UNKNOWN_TEMPLATE,
                `Unknown template "${args.template}". Available: ${known}`,
            )
        }
    }
    if (args.framework) {
        if (!registries.frameworks.all().some((f) => f.id === args.framework)) {
            const known = registries.frameworks
                .all()
                .map((f) => f.id)
                .join(', ')
            throw new CLIError(
                ErrorCode.UNKNOWN_FRAMEWORK,
                `Unknown framework "${args.framework}". Available: ${known}`,
            )
        }
    }
    for (const id of [...(args.features ?? []), ...(args.disable ?? [])]) {
        if (!registries.features.has(id)) {
            throw new CLIError(
                ErrorCode.UNKNOWN_FEATURE,
                `Unknown feature "${id}" passed via --features / --disable`,
            )
        }
    }
}
