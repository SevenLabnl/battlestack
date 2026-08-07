import path from 'node:path'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    addArgs,
    CLIError,
    ErrorCode,
    findProjectRoot,
    readManifest,
    run,
    type BattlestackRegistries,
    type PackageManager,
    type ParsedArgs,
    type ReservedCommand,
    type RunContext,
} from '@battlestack/core'

/** Static metadata only. `run` is built per-dispatch in `project.ts`. */
export const bumpReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'bump',
    usage: 'battlestack bump',
    label: 'bump npm deps to latest',
    group: 'Sync with upstream',
}

/** Bumps every feature-tracked npm dep to `@latest`. */
export async function bumpCommand(args: ParsedArgs, _loader: Ora, registries: BattlestackRegistries): Promise<void> {
    const projectRoot = await findProjectRoot(process.cwd())
    if (!projectRoot) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Not inside a battlestack project (no .battlestack/manifest.json found).',
        )
    }

    const manifest = await readManifest(projectRoot, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    const pm = manifest.packageManager as PackageManager
    const ctx = buildCtx(projectRoot, manifest, pm, args, registries)

    const prod = new Set<string>()
    const dev = new Set<string>()

    for (const record of manifest.features) {
        if (!registries.features.has(record.id)) continue
        const feature = registries.features.get(record.id)
        const deps = feature.collectDeps?.(ctx)
        for (const d of deps?.prod ?? []) prod.add(toUpgradeSpec(d))
        for (const d of deps?.dev ?? []) dev.add(toUpgradeSpec(d))
    }

    ui.section('Bump')
    if (prod.size === 0 && dev.size === 0) {
        ui.skip('No deps tracked by features, nothing to upgrade')
        return
    }

    ui.info(`Upgrading ${prod.size} prod + ${dev.size} dev deps via ${pm}`)
    ui.blank()

    if (args.dryRun) {
        if (prod.size) ui.warn(`would: ${pm} ${addArgs(pm, [...prod], false).join(' ')}`)
        if (dev.size) ui.warn(`would: ${pm} ${addArgs(pm, [...dev], true).join(' ')}`)
        return
    }

    if (prod.size) {
        await run(pm, addArgs(pm, [...prod], false), {
            cwd: projectRoot,
            inherit: true,
        })
    }
    if (dev.size) {
        await run(pm, addArgs(pm, [...dev], true), {
            cwd: projectRoot,
            inherit: true,
        })
    }

    ui.blank()
    ui.ok('Upgrade complete')
    ui.blank()
}

function buildCtx(
    projectRoot: string,
    manifest: { framework: string, template: string, features: Array<{ id: string }> },
    pm: PackageManager,
    args: ParsedArgs,
    registries: BattlestackRegistries,
): RunContext {
    return {
        projectName: path.basename(projectRoot),
        projectDir: projectRoot,
        framework: registries.frameworks.get(manifest.framework),
        template: registries.templates.get(manifest.template),
        enabledFeatures: new Set(manifest.features.map((f) => f.id)),
        state: { packageManager: pm, skipInstall: args.skipInstall },
        debug: args.debug,
        dryRun: args.dryRun,
        registries,
    }
}

/** A `collectDeps` spec as an `<pm> add` argument. Bare names get `@latest`. */
function toUpgradeSpec(spec: string): string {
    const lastAt = spec.lastIndexOf('@')
    if (lastAt > 0) return spec
    return `${spec}@latest`
}
