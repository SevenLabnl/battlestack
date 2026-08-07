import type { Ora } from 'ora'
import type { BattlestackRegistries, ParsedArgs, ReservedCommand } from '@battlestack/core'
import { ui } from '@battlestack/tui'
import { pullCommand } from './pull.js'
import { bumpCommand } from './bump.js'
import { doctorCommand } from './doctor.js'

/** Static metadata only. `run` is built per-dispatch in `project.ts`. */
export const syncReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'sync',
    usage: 'battlestack sync',
    label: 'pull + bump + doctor',
    group: 'Sync with upstream',
}

/** `pull`, then `bump`, then `doctor`. Each step no-ops when there is nothing to do. */
export async function syncCommand(args: ParsedArgs, loader: Ora, registries: BattlestackRegistries): Promise<void> {
    ui.section('Sync')
    ui.dim('pull → bump → doctor')

    ui.section('1/3 · Pull')
    ui.dim('Apply boilerplate template + config changes.')
    await pullCommand(args, loader, registries)

    ui.section('2/3 · Bump')
    ui.dim('Refresh npm deps.')
    await bumpCommand(args, loader, registries)

    ui.section('3/3 · Doctor')
    ui.dim('Final health check.')
    await doctorCommand(args, loader, registries)
}
