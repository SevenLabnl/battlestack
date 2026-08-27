import path from 'node:path'
import pc from 'picocolors'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    buildRunContext,
    CLIError,
    ErrorCode,
    readManifest,
    reconcileProjectName,
    STAGE_ORDER,
    type BattlestackRegistries,
    type ParsedArgs,
    type ProjectCommand,
    type ProjectManifest,
    type ReservedCommand,
    type RunContext,
} from '@battlestack/core'
import { dispatchPluginCommand, pluginCommandGroups, SCAFFOLD_ONLY } from '../cli/plugin-commands.js'
import { addCommand, addReservedMeta, removeCommand, removeReservedMeta } from './add-remove.js'
import { describeCommand, describeReservedMeta } from './describe.js'
import { doctorCommand, doctorReservedMeta } from './doctor.js'
import { cleanupCommand, cleanupReservedMeta } from './cleanup.js'
import { bumpCommand, bumpReservedMeta } from './bump.js'
import { pullCommand, pullReservedMeta, upgradeReservedMeta } from './pull.js'
import { syncCommand, syncReservedMeta } from './sync.js'
import { installCommand, installReservedMeta } from './install.js'
import { gatewayCommand, gatewayReservedMetas, mitmCommand } from './gateway.js'
import { disownCommand, disownReservedMeta, ownCommand, ownReservedMeta } from './own.js'

/** Reserved subcommands, outside the per-feature `projectCommands()` map. */
export const RESERVED_COMMANDS: Array<Omit<ReservedCommand, 'run'>> = [
    describeReservedMeta,
    doctorReservedMeta,
    cleanupReservedMeta,
    pullReservedMeta,
    upgradeReservedMeta,
    bumpReservedMeta,
    syncReservedMeta,
    installReservedMeta,
    addReservedMeta,
    removeReservedMeta,
    ownReservedMeta,
    disownReservedMeta,
    ...gatewayReservedMetas,
]

/** The name → runner map for this invocation's `registries`. */
function buildReservedRunners(
    registries: BattlestackRegistries,
): Record<string, (args: ParsedArgs, loader: Ora) => Promise<void>> {
    return {
        'describe': (args, loader) => describeCommand(args, loader, registries),
        'doctor': (args, loader) => doctorCommand(args, loader, registries),
        'cleanup': (args, loader) => cleanupCommand(args, loader),
        'pull': (args, loader) => pullCommand(args, loader, registries),
        'upgrade': (args, loader) => pullCommand(args, loader, registries),
        'bump': (args, loader) => bumpCommand(args, loader, registries),
        'sync': (args, loader) => syncCommand(args, loader, registries),
        'install': (args, loader) => installCommand(args, loader, registries),
        // The feature id arrives as the second positional. The command reads `projectName`.
        'add': (args, loader) => addCommand({ ...args, projectName: args.secondPositional }, loader, registries),
        'remove': (args, loader) => removeCommand({ ...args, projectName: args.secondPositional }, loader, registries),
        'own': (args, loader) => ownCommand(args, loader),
        'disown': (args, loader) => disownCommand(args, loader),
        'gateway:up': (args, loader) => gatewayCommand({ ...args, secondPositional: 'up' }, loader),
        'gateway:down': (args, loader) => gatewayCommand({ ...args, secondPositional: 'down' }, loader),
        'gateway:status': (args, loader) => gatewayCommand({ ...args, secondPositional: 'status' }, loader),
        'mitm': (args, loader) => mitmCommand(args, loader),
        'mitm:stop': (args, loader) => mitmCommand({ ...args, secondPositional: 'stop' }, loader),
    }
}

/** `projectCommands()` from every manifest feature. The earlier-stage feature wins a conflict. */
function buildCommandMap(
    ctx: RunContext,
    manifest: ProjectManifest,
    registries: BattlestackRegistries,
): { commands: Map<string, { feature: string, cmd: ProjectCommand }>, ordered: string[] } {
    const commands = new Map<string, { feature: string, cmd: ProjectCommand }>()
    const ordered: string[] = []

    const sortedFeatures = [...manifest.features]
        .filter((f) => registries.features.has(f.id))
        .map((f) => registries.features.get(f.id))
        .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))

    for (const feature of sortedFeatures) {
        const map = feature.projectCommands?.(ctx) ?? {}
        if (!map) continue
        for (const [name, cmd] of Object.entries(map)) {
            if (!commands.has(name)) {
                commands.set(name, { feature: feature.id, cmd })
                ordered.push(name)
            }
        }
    }

    return { commands, ordered }
}

/** Grouped per-feature commands for in-project `--help`. Returns [] on an unreadable manifest. */
export async function collectFeatureCommandHelp(
    projectRoot: string,
    registries: BattlestackRegistries,
): Promise<Array<{ feature: string, commands: Array<[string, string]> }>> {
    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) return []
    const ctx = buildRunContext({
        projectDir: projectRoot,
        manifest,
        debug: false,
        dryRun: true,
    }, registries)
    const { commands, ordered } = buildCommandMap(ctx, manifest, registries)
    const grouped = new Map<string, Array<[string, string]>>()
    for (const name of ordered) {
        const entry = commands.get(name)!
        const list = grouped.get(entry.feature) ?? []
        list.push([`battlestack ${name}`, entry.cmd.label])
        grouped.set(entry.feature, list)
    }
    return [...grouped].map(([feature, cmds]) => ({ feature, commands: cmds }))
}

export async function projectCommand(
    args: ParsedArgs,
    loader: Ora,
    projectRoot: string,
    registries: BattlestackRegistries,
    /** The unparsed argv, forwarded to plugin commands the same way scaffold mode does. */
    rawArgv: string[],
): Promise<void> {
    const requested = args.projectName
    // preCheck runs before reserved-command dispatch.
    await runPreChecks(projectRoot, args, registries)

    const runner = requested ? buildReservedRunners(registries)[requested] : undefined
    if (runner) return runner(args, loader)

    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    const ctx = buildRunContext({
        projectDir: projectRoot,
        manifest,
        debug: args.debug,
        dryRun: args.dryRun,
        state: {
            force: args.force,
            seed: args.seed,
            volumes: args.volumes,
            passthrough: args.passthrough,
            subcommandArg: args.secondPositional,
            browser: args.browser,
        },
    }, registries)

    const { commands, ordered } = buildCommandMap(ctx, manifest, registries)

    if (!requested) {
        printAvailable(commands, ordered, manifest, registries)
        return
    }

    const entry = commands.get(requested)
    if (!entry) {
        // Plugin commands (addCommand) dispatch in project mode too, after built-ins
        // and feature commands miss. Scaffold-only ids are excluded, and the dry-run
        // gate below does not cover this path: `parsed.dryRun` is the plugin's job.
        if (!SCAFFOLD_ONLY.has(requested)
            && await dispatchPluginCommand(requested, rawArgv.slice(1), loader, registries, projectRoot)) {
            return
        }
        ui.fail(`Unknown command: ${requested}`)
        const pluginIds = registries.commands.all().map((c) => c.id).filter((id) => !SCAFFOLD_ONLY.has(id))
        const suggestion = suggestCommand(requested, [...ordered, ...pluginIds])
        if (suggestion) ui.hint(`did you mean: battlestack ${suggestion}?`)
        printAvailable(commands, ordered, manifest, registries)
        throw new CLIError(ErrorCode.SCAFFOLD_FAILED, `Unknown project command: ${requested}`)
    }

    if (ctx.dryRun) {
        ui.info(`dry-run: would execute ${requested} → ${entry.cmd.label}`)
        return
    }

    await entry.cmd.run(ctx)
}

/** Runs each installed feature's `preCheck()`. Errors log under --debug, never abort. */
async function runPreChecks(projectRoot: string, args: ParsedArgs, registries: BattlestackRegistries): Promise<void> {
    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) return

    // A detected rename warns once, then restamps. Skipped under --dry-run, which writes nothing.
    const renamedFrom = args.dryRun ? null : await reconcileProjectName(projectRoot, manifest)
    if (renamedFrom) {
        ui.warn(`Project directory renamed: ${renamedFrom} → ${path.basename(projectRoot)}`)
        ui.dim('  Names derived from the directory changed with it: the docker compose')
        ui.dim(`  project starts fresh containers + volumes (old data stays under ${renamedFrom}_*),`)
        ui.dim('  hash-allocated port defaults shift, and the gateway hostname follows suit.')
        ui.dim('  Ports frozen in .env stay authoritative. Run `battlestack pull` to regenerate')
        ui.dim('  docker-compose.yml, and check `docker volume ls` if data seems missing.')
    }

    const ctx = buildRunContext({
        projectDir: projectRoot,
        manifest,
        debug: args.debug,
        dryRun: args.dryRun,
    }, registries)

    for (const record of manifest.features) {
        if (!registries.features.has(record.id)) continue
        const feature = registries.features.get(record.id)
        if (!feature.preCheck) continue
        try {
            await feature.preCheck(ctx)
        } catch (err) {
            if (args.debug) ui.debug(`preCheck ${record.id} failed: ${(err as Error).message ?? err}`)
        }
    }
}

function printAvailable(
    commands: Map<string, { feature: string, cmd: ProjectCommand }>,
    ordered: string[],
    manifest: ProjectManifest,
    registries: BattlestackRegistries,
): void {
    ui.section('Battlestack project commands')
    ui.dim(`${manifest.framework} / ${manifest.template}`)

    const grouped = new Map<string, { name: string, cmd: ProjectCommand }[]>()
    for (const name of ordered) {
        const entry = commands.get(name)!
        const list = grouped.get(entry.feature) ?? []
        list.push({ name, cmd: entry.cmd })
        grouped.set(entry.feature, list)
    }

    for (const [featureId, list] of grouped) {
        ui.blank()
        ui.plain('  ' + pc.dim(featureId))
        ui.kv(
            list.map(({ name, cmd }) => [name, cmd.label] as [string, string]),
            '    ',
        )
    }

    for (const { plugin, commands: cmds } of pluginCommandGroups(registries)) {
        ui.blank()
        ui.plain('  ' + pc.dim(plugin))
        ui.kv(
            cmds.map((cmd) => [cmd.usage ?? cmd.id, cmd.description] as [string, string]),
            '    ',
        )
    }
    ui.blank()
}

/** The closest command by exact-suffix, else Levenshtein. */
function suggestCommand(input: string, available: string[]): string | null {
    const suffix = available.find((cmd) => cmd.endsWith(':' + input))
    if (suffix) return suffix

    let best: { name: string, dist: number } | null = null
    for (const cmd of available) {
        const d = levenshtein(input.toLowerCase(), cmd.toLowerCase())
        if (d <= 2 && (!best || d < best.dist)) best = { name: cmd, dist: d }
    }
    return best?.name ?? null
}

function levenshtein(a: string, b: string): number {
    if (a === b) return 0
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length
    const row = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        let prev = row[0]!
        row[0] = i
        for (let j = 1; j <= b.length; j++) {
            const next = Math.min(
                row[j]! + 1,
                row[j - 1]! + 1,
                prev + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
            prev = row[j]!
            row[j] = next
        }
    }
    return row[b.length]!
}
