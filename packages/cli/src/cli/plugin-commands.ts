import type { Ora } from 'ora'
import {
    CLIError,
    ErrorCode,
    type BattlestackCommand,
    type BattlestackRegistries,
    type Registered,
} from '@battlestack/core'
import { parseArgs } from './args.js'

/**
 * `create`/`init` belong to the scaffold-mode router; in project mode they
 * would scaffold a nested project into the current one.
 */
export const SCAFFOLD_ONLY: ReadonlySet<string> = new Set(['create', 'init'])

/** What `id` resolved to. Bare ids may match several plugins; fqids never do. */
export type PluginCommandLookup =
    | { kind: 'none' }
    | { kind: 'one', command: Registered<BattlestackCommand> }
    | { kind: 'ambiguous', candidates: string[] }

/**
 * Resolves a bare id or an fqid without throwing. `Registry.get` raises on an
 * ambiguous bare id, which leaves callers unable to tell "absent" from
 * "provided twice" or to word their own recovery hint.
 */
export function lookupPluginCommand(registries: BattlestackRegistries, id: string): PluginCommandLookup {
    const all = registries.commands.all()
    const qualified = all.find((c) => c.fqid === id)
    if (qualified) return { kind: 'one', command: qualified }

    const bare = all.filter((c) => c.id === id)
    if (bare.length === 0) return { kind: 'none' }
    if (bare.length > 1) return { kind: 'ambiguous', candidates: bare.map((c) => c.fqid) }
    return { kind: 'one', command: bare[0]! }
}

/**
 * True when `id` resolves to a scaffold-mode-only command. Checked against the
 * authored id, so the fqid spelling (`nuxt4:create`) cannot slip past the set.
 */
export function isScaffoldOnly(registries: BattlestackRegistries, id: string): boolean {
    const found = lookupPluginCommand(registries, id)
    // An unresolved or ambiguous id is bare, so it is already its own authored id.
    return SCAFFOLD_ONLY.has(found.kind === 'one' ? found.command.id : id)
}

/**
 * Dispatches to a plugin-contributed `BattlestackCommand`. The only place a
 * `CommandContext` is built, so scaffold and project mode agree on its shape.
 * @param args argv with the command token already removed by `stripCommandToken`.
 * @returns false when no plugin registered that id.
 */
export async function dispatchPluginCommand(
    id: string,
    args: string[],
    loader: Ora,
    registries: BattlestackRegistries,
    projectRoot?: string,
): Promise<boolean> {
    const found = lookupPluginCommand(registries, id)
    if (found.kind === 'none') return false
    if (found.kind === 'ambiguous') {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `Ambiguous command "${id}", provided by ${found.candidates.join(', ')}. `
            + `Run it fully qualified: \`battlestack ${found.candidates[0]} …\`.`,
        )
    }

    const cmd = found.command
    // Re-parsed so positionals line up as `[name] [template]` however the CLI reached it.
    const parsed = parseArgs(args)
    if (parsed.dryRun && !cmd.honorsDryRun) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `\`${cmd.fqid}\` does not declare --dry-run support, so running it could write. `
            + 'Re-run without --dry-run. Plugin authors: honor `parsed.dryRun` in `run`, '
            + 'then set `honorsDryRun: true` on the command.',
        )
    }

    await cmd.run({ args, parsed, loader, registries, projectRoot })
    return true
}

/**
 * Plugin commands grouped by owning plugin, minus every name in `claimed`.
 * A built-in or feature command of the same name always wins dispatch, so
 * listing one here would advertise a command the user cannot reach.
 */
export function pluginCommandGroups(
    registries: BattlestackRegistries,
    claimed: ReadonlySet<string> = SCAFFOLD_ONLY,
): Array<{ plugin: string, commands: Registered<BattlestackCommand>[] }> {
    const grouped = new Map<string, Registered<BattlestackCommand>[]>()
    for (const cmd of registries.commands.all()) {
        if (claimed.has(cmd.id) || claimed.has(cmd.fqid)) continue
        const list = grouped.get(cmd.origin.plugin) ?? []
        list.push(cmd)
        grouped.set(cmd.origin.plugin, list)
    }
    return [...grouped].map(([plugin, commands]) => ({ plugin, commands }))
}
