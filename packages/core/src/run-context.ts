import path from 'node:path'
import type { Ora } from 'ora'
import type { BattlestackRegistries } from './registry.js'
import type { RunContext } from './types/run-context.js'
import type { ProjectManifest } from './types/project-manifest.js'
import type { FeatureState } from './types/feature.js'
import type { PackageManager } from './types/package-manager.js'

/** No-op `Ora` stand-in for callers that need a loader-shaped object but no spinner. */
export function silentLoader(): Ora {
    return { start() {}, succeed() {}, fail() {}, info() {}, warn() {} } as never
}

/** Membership test that matches an authored id against a set holding fqids. */
export function enabledHas(
    enabled: ReadonlySet<string>,
    id: string,
    registries?: BattlestackRegistries,
): boolean {
    if (enabled.has(id)) return true
    if (registries?.features.has(id)) return enabled.has(registries.features.get(id).fqid)
    return false
}

/** `enabledHas` bound to a `RunContext` (the common case inside feature hooks). */
export function isFeatureEnabled(ctx: RunContext, id: string): boolean {
    return enabledHas(ctx.enabledFeatures, id, ctx.registries)
}

interface BuildOpts {
    projectDir: string
    manifest: ProjectManifest
    debug?: boolean
    dryRun?: boolean
    state?: Partial<FeatureState>
}

/** Builds a `RunContext` from a project manifest. `registries` is stashed on the result. */
export function buildRunContext(opts: BuildOpts, registries: BattlestackRegistries): RunContext {
    return {
        projectName: path.basename(opts.projectDir),
        projectDir: opts.projectDir,
        framework: registries.frameworks.get(opts.manifest.framework),
        template: registries.templates.get(opts.manifest.template),
        enabledFeatures: new Set(opts.manifest.features.map((f) => f.id)),
        state: {
            packageManager: opts.manifest.packageManager as PackageManager,
            ...opts.state,
        },
        debug: opts.debug ?? false,
        dryRun: opts.dryRun ?? false,
        registries,
    }
}
