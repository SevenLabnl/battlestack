import type { Ora } from 'ora'
import type { BattlestackCommand, BattlestackRegistries, Registered } from '@battlestack/core'
import { parseArgs } from './args.js'

/**
 * `create`/`init` belong to the scaffold-mode router; in project mode they
 * would scaffold a nested project into the current one.
 */
export const SCAFFOLD_ONLY: ReadonlySet<string> = new Set(['create', 'init'])

/**
 * Dispatches to a plugin-contributed `BattlestackCommand`. The only place a
 * `CommandContext` is built, so scaffold and project mode agree on its shape.
 * There is no `--dry-run` gate on this path: honoring `parsed.dryRun` is the
 * command's own responsibility.
 * @returns false when no plugin registered that id.
 */
export async function dispatchPluginCommand(
    id: string,
    args: string[],
    loader: Ora,
    registries: BattlestackRegistries,
    projectRoot?: string,
): Promise<boolean> {
    if (!registries.commands.has(id)) return false
    const cmd = registries.commands.get(id)
    // Re-parsed so positionals line up as `[name] [template]` however the CLI reached it.
    await cmd.run({ args, parsed: parseArgs(args), loader, registries, projectRoot })
    return true
}

/** Plugin commands grouped by owning plugin, minus `exclude` ids. */
export function pluginCommandGroups(
    registries: BattlestackRegistries,
    exclude: ReadonlySet<string> = SCAFFOLD_ONLY,
): Array<{ plugin: string, commands: Registered<BattlestackCommand>[] }> {
    const grouped = new Map<string, Registered<BattlestackCommand>[]>()
    for (const cmd of registries.commands.all()) {
        if (exclude.has(cmd.id)) continue
        const list = grouped.get(cmd.origin.plugin) ?? []
        list.push(cmd)
        grouped.set(cmd.origin.plugin, list)
    }
    return [...grouped].map(([plugin, commands]) => ({ plugin, commands }))
}
