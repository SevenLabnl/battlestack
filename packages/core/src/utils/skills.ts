import type { BattlestackRegistries } from '../registry.js'
import { run } from './run.js'
import { dlxArgs, dlxBinary, resolveProjectPM } from './package-manager.js'
import { getUiPort } from '../ui-port.js'
import type { RunContext } from '../types/run-context.js'

/** Every skill source declared by the project's enabled features via `Feature.collectSkills`. */
export function collectSkillSources(ctx: RunContext, registries: BattlestackRegistries): string[] {
    const seen = new Set<string>()
    for (const id of ctx.enabledFeatures) {
        if (!registries.features.has(id)) continue
        for (const s of registries.features.get(id).collectSkills?.(ctx) ?? []) {
            if (s) seen.add(s)
        }
    }
    return [...seen]
}

/** Installs or refreshes skill sources via the project's PM `dlx`. Failures warn, never throw. */
export async function installSkills(ctx: RunContext, sources: readonly string[]): Promise<void> {
    // `--no-skills` sets state.skipSkills. `--skip-install` and dry-run also skip.
    if (ctx.dryRun || ctx.state.skipInstall || ctx.state.skipSkills) return
    const unique = [...new Set(sources)].filter(Boolean)
    if (unique.length === 0) return

    const pm = await resolveProjectPM({
        projectDir: ctx.projectDir,
        fallback: String(ctx.state.packageManager ?? 'pnpm'),
    })

    for (const source of unique) {
        try {
            await run(dlxBinary(pm), dlxArgs(pm, ['skills', 'add', source]), {
                cwd: ctx.projectDir,
                inherit: true,
            })
        } catch (err) {
            getUiPort().warn(
                `Skill install skipped: \`skills add ${source}\` failed. `
                + 'Re-run `battlestack pull` once the registry is reachable.',
            )
            if (ctx.debug) console.error(err)
        }
    }
}
