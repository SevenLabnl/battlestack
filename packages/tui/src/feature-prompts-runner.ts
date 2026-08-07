import { STAGE_ORDER, type BattlestackRegistries, type Feature, type RunContext } from '@battlestack/core'

/** Invokes each enabled feature's `prompt(ctx)` hook in stage-then-id order. */
export async function runFeaturePromptHooks(
    enabled: Set<string>,
    ctx: RunContext,
    registries: BattlestackRegistries,
): Promise<void> {
    const ordered: Feature[] = []
    for (const id of enabled) {
        if (!registries.features.has(id)) continue
        ordered.push(registries.features.get(id))
    }
    ordered.sort((a, b) => {
        const sa = STAGE_ORDER.indexOf(a.stage)
        const sb = STAGE_ORDER.indexOf(b.stage)
        if (sa !== sb) return sa - sb
        return a.id.localeCompare(b.id)
    })
    for (const feature of ordered) {
        if (!feature.prompt) continue
        await feature.prompt(ctx)
    }
}
