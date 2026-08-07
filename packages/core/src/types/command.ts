import type { Ora } from 'ora'
import type { RunContext } from './run-context.js'
import type { ParsedArgs } from './cli.js'

export interface ProjectCommand {
    label: string
    description?: string
    run(ctx: RunContext): Promise<void>
}

/** A reserved subcommand. Dispatch and `battlestack --help` both render from this object. */
export interface ReservedCommand {
    /** Dispatch name (what the user types as the first positional). */
    name: string
    /** Display form for help, including arg placeholders. */
    usage: string
    label: string
    group: string
    /** Extra help rows rendered directly under this command's row. */
    helpExtra?: Array<[string, string]>
    run(args: ParsedArgs, loader: Ora): Promise<void>
}
