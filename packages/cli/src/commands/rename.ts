import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    CLIError,
    ErrorCode,
    findProjectRoot,
    readManifest,
    renameProject,
    resolveProjectName,
    type ParsedArgs,
    type ReservedCommand,
} from '@battlestack/core'
import { validateProjectName } from '@battlestack/core/utils/validation.js'

export const renameReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'rename',
    usage: 'battlestack rename <name>',
    label: 'rename the project (the directory name does not)',
    group: 'Lifecycle',
}

export async function renameCommand(args: ParsedArgs, _loader: Ora): Promise<void> {
    const name = String(args.secondPositional ?? '').trim()
    if (!name) throw new CLIError(ErrorCode.SCAFFOLD_FAILED, 'Usage: battlestack rename <name>')
    validateProjectName(name)

    const projectRoot = await findProjectRoot(process.cwd())
    const manifest = projectRoot ? await readManifest(projectRoot) : null
    if (!projectRoot || !manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Not inside a battlestack project (no .battlestack/manifest.json found).',
        )
    }

    const current = resolveProjectName(projectRoot, manifest)
    if (current === name) {
        ui.info(`Project is already named ${name}.`)
        return
    }
    if (args.dryRun) {
        ui.info(`dry-run: would rename the project ${current} → ${name}`)
        return
    }

    await renameProject(projectRoot, manifest, name)
    ui.ok(`Project renamed: ${current} → ${name}`)
    ui.dim('  Names derived from it change with it: the docker compose project starts')
    ui.dim(`  fresh containers + volumes (old data stays under ${current}_*), hash-allocated`)
    ui.dim('  port defaults shift, and the gateway hostname follows suit. Ports frozen in')
    ui.dim('  .env stay authoritative. Run `battlestack pull` to regenerate the files that')
    ui.dim('  use the name, then `battlestack cleanup` for what ran under the old one.')
}
