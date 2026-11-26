import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ownedAnywhere, reconcilePostFormat, snapshotTrackedHashes, toPosixRel, type BattlestackRegistries, type ProjectManifest, type RunContext } from '@battlestack/core'
import { formatProject } from '@battlestack/preset-nuxt4'

/** Runs `eslint --fix` over the project and re-records tracked files that were pristine before it. */
export async function formatAndReconcile(
    ctx: RunContext,
    manifest: ProjectManifest,
    registries: BattlestackRegistries,
): Promise<void> {
    // Keyed bare: `record.id` is the manifest fqid, but state maps (and `reconcilePostFormat`'s
    // writes, which `writeManifest` reads back) key on the bare feature id.
    const tracked = manifest.features
        .filter((record) => registries.features.has(record.id))
        .map((record) => {
            const bareId = registries.features.get(record.id).id
            return {
                featureId: bareId,
                recorded: (ctx.state[`files:${bareId}`] as Record<string, string>) ?? record.files,
                owned: new Set(record.ownedByUser ?? []),
            }
        })
    const preHashes = await snapshotTrackedHashes(ctx, tracked)
    const owned = await snapshotOwned(ctx, manifest)
    await formatProject(ctx)
    // eslint runs over the whole project, so an owned file gets its own bytes back.
    for (const [rel, bytes] of owned) {
        const abs = path.join(ctx.projectDir, rel)
        const now = await readFile(abs).catch(() => null)
        if (now && !now.equals(bytes)) await writeFile(abs, bytes)
    }
    await reconcilePostFormat(ctx, tracked, preHashes)
}

async function snapshotOwned(ctx: RunContext, manifest: ProjectManifest): Promise<Map<string, Buffer>> {
    const out = new Map<string, Buffer>()
    if (ctx.state.overwrite === true) return out
    const rels = new Set([...ownedAnywhere(ctx), ...manifest.features.flatMap((f) => (f.ownedByUser ?? []).map(toPosixRel))])
    for (const rel of rels) {
        const bytes = await readFile(path.join(ctx.projectDir, rel)).catch(() => null)
        if (bytes) out.set(rel, bytes)
    }
    return out
}
