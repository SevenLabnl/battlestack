import pc from 'picocolors'
import { ui } from '@battlestack/tui'
import { claimedProjectCommands, collectFeatureCommandHelp, RESERVED_COMMANDS } from '../commands/project.js'
import { pluginCommandGroups } from './plugin-commands.js'
import type { BattlestackRegistries, HelpMode } from '@battlestack/core'

/** `printScaffoldHelp`'s template ids and examples are preset-nuxt-specific. */
export async function printHelp(
    mode: HelpMode = 'scaffold',
    registries: BattlestackRegistries,
    projectRoot?: string,
): Promise<void> {
    if (mode === 'project') {
        await printProjectHelp(registries, projectRoot)
    } else {
        printScaffoldHelp(registries)
    }
}

/**
 * Plugin-contributed commands, one block per owning plugin. Scaffold-only ids
 * are excluded, plus anything in `claimed` that would lose dispatch anyway.
 */
function printPluginCommandHelp(registries: BattlestackRegistries, claimed?: ReadonlySet<string>): void {
    for (const { plugin, commands } of pluginCommandGroups(registries, claimed)) {
        ui.blank()
        ui.plain(pc.bold(plugin))
        ui.kv(
            commands.map((cmd) => [`battlestack ${cmd.usage ?? cmd.id}`, cmd.description] as [string, string]),
            '  ',
        )
    }
}

function printScaffoldHelp(registries: BattlestackRegistries): void {
    ui.section('battlestack')
    ui.dim(`${ui.TAGLINE}.`)

    ui.blank()
    ui.plain(pc.bold('Usage'))
    ui.dim('  battlestack [name] [template] [options]')

    ui.blank()
    ui.plain(pc.bold('Templates'))
    ui.dim('  nuxt4-minimal · nuxt4-fullstack · nuxt4-ai')

    ui.blank()
    ui.plain(pc.bold('Common options'))
    ui.kv(
        [
            ['-t, --template <id>', 'same as positional, wins when both set'],
            ['    --pm <pm>', 'pnpm (default) · bun · npm'],
            ['    --features <a,b>', 'force-enable optional features'],
            ['    --disable <a,b>', 'force-disable optional features'],
            ['    --gateway', 'opt into Traefik gateway + https://<name>.battlestack.test'],
            ['    --cwd <dir>', 'parent dir (default: cwd)'],
            ['-y, --yes', 'accept every prompt default (CI)'],
            ['    --skip-install', 'skip dep install'],
            ['    --force', 'recreate if a project with the same name already exists'],
            ['    --dry-run', 'show plan, write nothing'],
            ['-V, --verbose', 'per-feature spinner lines + maintenance hints'],
            ['-d, --debug', 'full debug logging (implies --verbose)'],
            ['-h, --help', 'this help'],
            ['    --version', 'print version (-v is --volumes)'],
        ],
        '  ',
    )

    ui.blank()
    ui.plain(pc.bold('Examples'))
    ui.kv(
        [
            ['battlestack my-app', 'prompts for template + features'],
            ['battlestack my-app nuxt4-fullstack', 'positional template, prompts for the rest'],
            ['battlestack my-app nuxt4-fullstack --pm bun -y', 'fully non-interactive'],
            ['battlestack my-app --disable nuxt4:storage,nuxt4:rag', 'opt-out at scaffold time'],
            ['battlestack init -t nuxt4-fullstack', 'adopt the current dir into project mode (writes manifest)'],
            ['battlestack self-update', 'upgrade the globally-installed CLI to the latest release'],
            ['battlestack self-update --force', 'opt out of pnpm release-age gate; install true latest now'],
        ],
        '  ',
    )

    printPluginCommandHelp(registries)

    ui.blank()
    ui.dim('Inside a generated project, run `battlestack --help` for maintenance commands.')
    ui.blank()
}

async function printProjectHelp(registries: BattlestackRegistries, projectRoot?: string): Promise<void> {
    ui.section('battlestack')
    ui.dim('Project maintenance.')

    ui.blank()
    ui.plain(pc.bold('Usage'))
    ui.dim('  battlestack <command> [options]')

    ui.blank()
    ui.plain(pc.bold('Discovery'))
    ui.kv(
        [
            ['battlestack', 'list every command available in this project'],
            ['battlestack --help', 'this help'],
        ],
        '  ',
    )

    // Rendered from the same descriptors that drive dispatch.
    const groups = new Map<string, Array<[string, string]>>()
    for (const cmd of RESERVED_COMMANDS) {
        const list = groups.get(cmd.group) ?? []
        list.push([cmd.usage, cmd.label])
        for (const row of cmd.helpExtra ?? []) list.push(row)
        groups.set(cmd.group, list)
    }
    for (const [group, rows] of groups) {
        if (group === 'Discovery') {
            // Merged into the static Discovery block above.
            ui.kv(rows, '  ')
            continue
        }
        ui.blank()
        ui.plain(pc.bold(group))
        ui.kv(rows, '  ')
    }

    // The feature commands this project's manifest has.
    if (projectRoot) {
        try {
            const features = await collectFeatureCommandHelp(projectRoot, registries)
            for (const { feature, commands } of features) {
                ui.blank()
                ui.plain(pc.bold(feature))
                ui.kv(commands, '  ')
            }
        } catch {
            ui.blank()
            ui.dim('Per-feature commands (`battlestack dev`, `battlestack db:push`, …): see `battlestack` with no args.')
        }
    } else {
        ui.blank()
        ui.dim('Per-feature commands (`battlestack dev`, `battlestack db:push`, …): see `battlestack` with no args.')
    }

    printPluginCommandHelp(registries, await claimedProjectCommands(registries, projectRoot))
    ui.blank()
}
