#!/usr/bin/env node
import path from 'node:path'
import os from 'node:os'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Ora } from 'ora'
import {
    CLIError,
    discoverPlugins,
    ErrorCode,
    findProjectRoot,
    loadPlugins,
    notifyIfOutdated,
    setHostServices,
    wrapError,
    type LoadResult,
    type RunContext,
} from '@battlestack/core'
import { installUiPort, ui } from '@battlestack/tui'
import { parseArgs } from './cli/args.js'
import { printHelp } from './cli/help.js'
import { bootstrapProject } from './commands/install.js'
import { doctorCommand } from './commands/doctor.js'
import { gatewayUp, registerProject } from './commands/gateway.js'
import { projectCommand } from './commands/project.js'
import { selfUpdateCommand } from './commands/self-update.js'
import { pluginAdd, pluginList, pluginRemove } from './plugin-store.js'

const BATTLESTACK_HOME = process.env.BATTLESTACK_HOME ?? path.join(os.homedir(), '.battlestack')

/** Presets shipped with the CLI itself, resolved from our own deps. */
const BUNDLED = ['@battlestack/preset-nuxt4']

const VERSION = readVersion()

function readVersion(): string {
    try {
        const here = path.dirname(fileURLToPath(import.meta.url))
        const pkgPath = path.resolve(here, '..', 'package.json')
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
        return pkg.version ?? '0.0.0'
    } catch {
        return '0.0.0'
    }
}

async function boot(): Promise<LoadResult> {
    const sources = await discoverPlugins({
        bundled: BUNDLED,
        bundledBasedir: path.dirname(fileURLToPath(import.meta.url)),
        battlestackHome: BATTLESTACK_HOME,
        projectDir: process.cwd(),
    })
    return loadPlugins(sources)
}

/** Boots, runs one report, then surfaces load warnings once. */
async function show(print: (result: LoadResult) => void): Promise<void> {
    const result = await boot()
    print(result)
    for (const w of result.warnings) console.log(`  ! ${w}`)
}

function printPlugins(result: LoadResult): void {
    console.log('Loaded plugins:')
    for (const p of result.plugins) console.log(`  ${p.name}  (via ${p.via})`)
    for (const s of result.skipped) {
        console.log(`  ! skipped ${s.specifier} (via ${s.via}): ${s.error}`)
    }
}

function printTemplates(result: LoadResult): void {
    console.log('Templates (resolved feature lists):')
    for (const t of result.registries.templates.all()) {
        console.log(`  ${t.fqid}  (${t.label})`)
        for (const fid of t.requiredFeatures) console.log(`      - ${fid} (required)`)
        for (const fid of t.optionalFeatures) console.log(`      - ${fid} (optional)`)
    }
}

function printFeatures(result: LoadResult): void {
    console.log('Available features (fully-qualified id / bare id):')
    for (const f of result.registries.features.all()) {
        console.log(`  ${f.fqid.padEnd(26)} ${f.label.padEnd(30)} (bare: ${f.id})`)
    }
    console.log('\nDeploy targets:')
    for (const t of result.registries.deployTargets.all()) {
        console.log(`  ${t.fqid.padEnd(26)} ${t.label.padEnd(30)} [${t.origin.plugin}]`)
    }
}

/** What `skills add` would receive for a project with every feature enabled. */
function printSkills(result: LoadResult): void {
    const ctx: RunContext = {
        projectName: '',
        projectDir: process.cwd(),
        framework: { id: '', label: '', supportedFeatures: [] },
        template: { id: '', label: '', framework: '', requiredFeatures: [], optionalFeatures: [] },
        enabledFeatures: new Set(result.registries.features.all().map((f) => f.fqid)),
        state: {},
        debug: false,
        dryRun: true,
        registries: result.registries,
    }
    const sources = new Set<string>()
    for (const f of result.registries.features.all()) {
        for (const s of f.collectSkills?.(ctx) ?? []) sources.add(s)
    }
    console.log('Skill sources (all features enabled):')
    for (const s of sources) console.log(`  ${s}`)
}

/**
 * Dispatches to a plugin-contributed `BattlestackCommand`.
 * @returns false when no plugin registered that id.
 */
async function dispatchPluginCommand(
    id: string,
    args: string[],
    loader: Ora,
    result: LoadResult,
): Promise<boolean> {
    if (!result.registries.commands.has(id)) return false
    const cmd = result.registries.commands.get(id)
    // Re-parsed so positionals line up as `[name] [template]` however the CLI reached it.
    await cmd.run({ args, parsed: parseArgs(args), loader, registries: result.registries })
    return true
}

async function main(): Promise<void> {
    installUiPort()
    setHostServices({ bootstrapProject, gatewayUp, registerProject })

    const rawArgv = process.argv.slice(2)
    const args = parseArgs(rawArgv)

    if (args.version) {
        console.log(VERSION)
        return
    }

    // Runs inside a project or not: it upgrades the globally-installed CLI, not deps.
    if (args.projectName === 'self-update' || args.projectName === 'update') {
        try {
            await selfUpdateCommand({
                packageManager: args.packageManager,
                tag: args.template,
                force: args.force,
            })
        } catch (error) {
            const cliError
                = error instanceof CLIError ? error : wrapError(error, ErrorCode.SCAFFOLD_FAILED)
            ui.printError(
                cliError.getUserMessage(),
                cliError.getRecoveryHint(),
                args.debug ? String(cliError.stack ?? cliError) : undefined,
            )
            process.exitCode = 1
        }
        return
    }

    // Plugin-store management, project-agnostic.
    if (args.projectName === 'plugin') {
        const [sub, spec] = args.positionals.slice(1)
        if (sub === 'add' && spec) await pluginAdd(BATTLESTACK_HOME, spec)
        else if (sub === 'remove' && spec) await pluginRemove(BATTLESTACK_HOME, spec)
        else if (sub === 'list') await pluginList(BATTLESTACK_HOME)
        else console.error('usage: battlestack plugin <add|remove> <package> | battlestack plugin list')
        return
    }

    // Introspection builtins: always available, no project needed.
    if (args.projectName === 'plugins') return show(printPlugins)
    if (args.projectName === 'templates') return show(printTemplates)
    if (args.projectName === 'features') return show(printFeatures)
    if (args.projectName === 'skills') return show(printSkills)
    // Bare `battlestack help` mirrors `--help` outside a project.
    if (args.projectName === 'help') {
        const result = await boot()
        for (const w of result.warnings) console.log(`  ! ${w}`)
        const projectRoot = await findProjectRoot(process.cwd())
        ui.banner(VERSION)
        await printHelp(projectRoot ? 'project' : 'scaffold', result.registries, projectRoot ?? undefined)
        return
    }

    const result = await boot()
    for (const w of result.warnings) console.log(`  ! ${w}`)
    const registries = result.registries

    const loader = ui.spinner()

    try {
        // Intercepted before mode detection, and routed via the plugin registry.
        if (args.projectName === 'init' && !args.help) {
            const dispatched = await dispatchPluginCommand('init', rawArgv.slice(1), loader, result)
            if (!dispatched) {
                ui.printError('No "init" command available. Is @battlestack/preset-nuxt4 installed?')
                process.exitCode = 1
            }
            return
        }

        // `--scaffold` forces create mode, else detect via .battlestack/manifest.json.
        const projectRoot = args.scaffold ? null : await findProjectRoot(process.cwd())

        // Outside a project, `doctor` self-diagnoses the CLI install and host environment.
        if (args.projectName === 'doctor' && !projectRoot && !args.help) {
            await doctorCommand(args, loader, registries)
            return
        }

        if (args.help) {
            if (!projectRoot) {
                ui.banner(VERSION)
                await printHelp('scaffold', registries)
                return
            }
            // Inside a project, `--help` lists rather than executes.
            await projectCommand({ ...args, projectName: undefined }, loader, projectRoot, registries)
            return
        }

        if (projectRoot) {
            await projectCommand(args, loader, projectRoot, registries)
        } else {
            ui.banner(VERSION)
            // A recognized plugin command beats treating the positional as a project name.
            const asCommand = args.projectName && registries.commands.has(args.projectName)
                ? await dispatchPluginCommand(args.projectName, rawArgv.slice(1), loader, result)
                : false
            if (!asCommand) {
                const dispatched = await dispatchPluginCommand('create', rawArgv, loader, result)
                if (!dispatched) {
                    throw new CLIError(
                        ErrorCode.SCAFFOLD_FAILED,
                        'No "create" command available. Is @battlestack/preset-nuxt4 installed?',
                    )
                }
            }
        }

        // Best-effort, cached daily.
        await notifyIfOutdated(VERSION)
    } catch (error) {
        const cliError
            = error instanceof CLIError ? error : wrapError(error, ErrorCode.SCAFFOLD_FAILED)
        if (loader.isSpinning) loader.stop()
        ui.printError(
            cliError.getUserMessage(),
            cliError.getRecoveryHint(),
            args.debug ? formatDebug(cliError) : undefined,
        )
        process.exitCode = 1
    }
}

function formatDebug(err: CLIError): string {
    const parts: string[] = [String(err.stack ?? err)]
    if (err.cause) {
        const causeStack = (err.cause as Error)?.stack
        parts.push(causeStack ?? JSON.stringify(err.cause))
    }
    return parts.join('\n')
}

await main()
