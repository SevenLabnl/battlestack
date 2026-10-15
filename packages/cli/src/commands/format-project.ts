import { reconcilePostFormat, snapshotTrackedHashes, type BattlestackRegistries, type ProjectManifest, type RunContext } from '@battlestack/core'
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
    await formatProject(ctx)
    await reconcilePostFormat(ctx, tracked, preHashes)
}
