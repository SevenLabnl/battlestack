import type { Ora } from 'ora'
import { STAGE_ORDER } from './constants/stages.js'
import type { Feature } from './types/feature.js'
import type { RunContext } from './types/run-context.js'
import { getUiPort } from './ui-port.js'

/** Host-injected formatting hook, run after every feature and before the manifest is persisted. */
export type PostRunFormatter = (ctx: RunContext) => Promise<void>

export interface RunFeaturesOptions {
    format?: PostRunFormatter
}

export function resolveExecutionOrder(ctx: RunContext): Feature[] {
    const candidates: Feature[] = []
    for (const id of ctx.enabledFeatures) {
        const feature = ctx.registries.features.get(id)
        if (feature.frameworks && !feature.frameworks.includes(ctx.framework.id)) continue
        candidates.push(feature)
    }
    return topoOrder(candidates, ctx.debug)
}

/** Topological sort over stage + before/after/requires. The graph is keyed on bare `f.id`. */
export function topoOrder(features: Feature[], debug = false): Feature[] {
    const byId = new Map(features.map((f) => [f.id, f]))
    const incoming = new Map<string, Set<string>>()
    for (const f of features) incoming.set(f.id, new Set())

    const addEdge = (from: string, to: string): void => {
        if (!byId.has(from) || !byId.has(to)) return
        if (from === to) return
        incoming.get(to)!.add(from)
    }

    for (const f of features) {
        for (const r of f.requires ?? []) addEdge(r, f.id)
        for (const a of f.after ?? []) addEdge(a, f.id)
        for (const b of f.before ?? []) addEdge(f.id, b)
    }

    // Ready-set Kahn's, stage-then-id for stable output.
    const ready: string[] = []
    for (const [id, ins] of incoming) {
        if (ins.size === 0) ready.push(id)
    }
    sortReady(ready, byId)

    const ordered: Feature[] = []
    while (ready.length > 0) {
        const id = ready.shift()!
        const f = byId.get(id)!
        ordered.push(f)
        for (const [other, ins] of incoming) {
            if (ins.has(id)) {
                ins.delete(id)
                if (ins.size === 0) {
                    ready.push(other)
                    sortReady(ready, byId)
                }
            }
        }
    }

    if (ordered.length !== features.length) {
        const remaining = features.filter((f) => !ordered.includes(f)).map((f) => f.id)
        throw new Error(`Cyclic feature dependency among: ${remaining.join(', ')}`)
    }

    if (debug) {
        const trace = ordered.map((f) => `${f.id}@${f.stage}`).join(' → ')
        getUiPort().debug('feature order: ' + trace)
    }

    return ordered
}

function sortReady(ready: string[], byId: Map<string, Feature>): void {
    ready.sort((a, b) => {
        const fa = byId.get(a)!
        const fb = byId.get(b)!
        const sa = STAGE_ORDER.indexOf(fa.stage)
        const sb = STAGE_ORDER.indexOf(fb.stage)
        if (sa !== sb) return sa - sb
        return a.localeCompare(b)
    })
}

function validateRunContext(ctx: RunContext): void {
    if (!ctx.projectDir || typeof ctx.projectDir !== 'string') {
        throw new Error('RunContext.projectDir must be a non-empty string')
    }
    if (!ctx.framework?.id) {
        throw new Error('RunContext.framework.id is required')
    }
    if (!ctx.template?.id) {
        throw new Error('RunContext.template.id is required')
    }
    if (!(ctx.enabledFeatures instanceof Set)) {
        throw new TypeError('RunContext.enabledFeatures must be a Set<string>')
    }
    if (!ctx.registries) {
        throw new Error('RunContext.registries is required')
    }
}

export async function runFeatures(
    ctx: RunContext,
    loader: Ora,
    opts: RunFeaturesOptions = {},
): Promise<void> {
    validateRunContext(ctx)
    const ordered = resolveExecutionOrder(ctx)
    const verbose = ctx.state.verbose === true

    const ui = getUiPort()
    ui.setActiveSpinner(loader)
    if (!verbose) loader.start('Scaffolding…')

    let crashed = false
    try {
        for (const feature of ordered) {
            if (verbose) loader.start(feature.label)
            else loader.text = feature.label
            try {
                if (ctx.dryRun) {
                    if (verbose) loader.info(`${feature.label} (dry-run)`)
                    continue
                }
                await feature.execute(ctx)
                if (feature.structuralFiles) {
                    const { recordOwned } = await import('./manifest.js')
                    for (const rel of feature.structuralFiles(ctx)) {
                        recordOwned(ctx, feature.id, rel)
                    }
                }
                if (verbose) loader.succeed(feature.label)
            } catch (error) {
                if (feature.failureIsNonFatal) {
                    const msg = error instanceof Error ? error.message : String(error)
                    loader.warn(`${feature.label} skipped: ${msg}`)
                    if (!verbose) loader.start('Scaffolding…')
                    continue
                }
                loader.fail(feature.label)
                crashed = true
                const msg = error instanceof Error ? error.message : String(error)
                throw new Error(`Feature ${feature.id} failed: ${msg}`, { cause: error })
            }
        }

        if (!crashed && !ctx.dryRun && opts.format) {
            const { snapshotTrackedHashes, reconcilePostFormat } = await import('./utils/templates.js')
            const tracked = ordered.map((feature) => ({
                featureId: feature.id,
                recorded: (ctx.state[`files:${feature.id}`] as Record<string, string>) ?? {},
                owned: new Set((ctx.state[`owned:${feature.id}`] as string[]) ?? []),
            }))
            const preHashes = await snapshotTrackedHashes(ctx, tracked)
            await opts.format(ctx)
            await reconcilePostFormat(ctx, tracked, preHashes)
        }

        if (!verbose) loader.succeed('Scaffold complete')
    } finally {
        ui.setActiveSpinner(null)
        // A manifest is written on every path, including failure.
        if (!ctx.dryRun) {
            try {
                const { writeManifest } = await import('./manifest.js')
                await writeManifest(ctx, { incomplete: crashed })
            } catch {
                // Best-effort.
            }
        }
    }
}
