import pc from 'picocolors'
import type { Ora } from 'ora'
import { confirmOverwriteOwned, ui } from '@battlestack/tui'
import {
    acquireProjectLock,
    buildRunContext,
    CLIError,
    ErrorCode,
    findProjectRoot,
    readManifest,
    writeManifest,
    type BattlestackRegistries,
    type EnvDiff,
    type Feature,
    type InstalledFeatureRecord,
    type ParsedArgs,
    type ProjectManifest,
    type ReservedCommand,
    type RunContext,
    type UpdateReport,
} from '@battlestack/core'

/** Static metadata only. `run` is built per-dispatch in `project.ts`. */
export const pullReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'pull',
    usage: 'battlestack pull',
    label: 'pull template + config changes (drift-aware)',
    group: 'Sync with upstream',
    helpExtra: [
        ['battlestack pull --force', 'overwrite drifted files (saves `<file>.battlestack.bak`)'],
        ['battlestack pull --overwrite', 'overwrite EVERY shipped file, no artefacts (confirms first if any are `own`ed)'],
        ['battlestack pull --skills-only', 'refresh ONLY AI-agent skills (skip everything else)'],
        ['battlestack pull --no-skills', 'skip the AI-agent skill refresh'],
        ['battlestack pull --no-format', 'skip the trailing prettier pass'],
        ['battlestack pull --skip-install', 'skip the dependency install'],
    ],
}

export const upgradeReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'upgrade',
    usage: 'battlestack upgrade',
    label: 'alias for `pull` (picks up feature version bumps)',
    group: 'Sync with upstream',
}

function printReport(featureId: string, report: UpdateReport): void {
    if (report.written.length > 0) {
        ui.dim(`  ${featureId}: ${report.written.length} file(s) written`)
    }
    if (report.skipped.length > 0) {
        console.log(
            pc.yellow(`  ${ui.sym.warn} ${featureId}: ${report.skipped.length} file(s) skipped (manual merge):`),
        )
        for (const f of report.skipped) console.log(pc.yellow(`      ${f}`))
    }
    if (report.restoredDeleted && report.restoredDeleted.length > 0) {
        console.log(
            pc.yellow(
                `  ${ui.sym.warn} ${featureId}: restored ${report.restoredDeleted.length} file(s) you had deleted. `
                + `To drop this feature for good, run \`battlestack remove ${featureId}\` (pull won't restore it then).`,
            ),
        )
    }
    for (const note of report.notes) {
        ui.dim(`  ${featureId}: ${note}`)
    }
}

/** Seeds `structuralFiles` into `prev.ownedByUser`. */
function seedOwnedFromStructural(
    ctx: RunContext,
    feature: Feature,
    record: InstalledFeatureRecord,
): InstalledFeatureRecord {
    if (!feature.structuralFiles) return record
    return {
        ...record,
        ownedByUser: Array.from(
            new Set([
                ...(record.ownedByUser ?? []),
                ...feature.structuralFiles(ctx),
            ]),
        ),
    }
}

/** Files `--overwrite` will clobber that the user claimed via `own` or `structuralFiles()`. */
function collectAtRiskOwnedFiles(
    ctx: RunContext,
    records: readonly InstalledFeatureRecord[],
    registries: BattlestackRegistries,
): Array<{ featureId: string, files: string[] }> {
    const atRisk: Array<{ featureId: string, files: string[] }> = []
    for (const record of records) {
        if (!registries.features.has(record.id)) continue
        const feature = registries.features.get(record.id)
        if (feature.upgradable === false) continue
        if (!feature.update) continue
        const seeded = seedOwnedFromStructural(ctx, feature, record)
        if (seeded.ownedByUser && seeded.ownedByUser.length > 0) {
            atRisk.push({ featureId: record.id, files: seeded.ownedByUser })
        }
    }
    return atRisk
}

/** Throws on failure unless `failureIsNonFatal` is set. */
async function pullOneFeature(
    ctx: RunContext,
    record: InstalledFeatureRecord,
    args: ParsedArgs,
    loader: Ora,
    registries: BattlestackRegistries,
): Promise<void> {
    if (!registries.features.has(record.id)) {
        ui.warn(`feature "${record.id}" no longer exists in the CLI, skipped`)
        return
    }
    const feature = registries.features.get(record.id)

    if (feature.upgradable === false) {
        ui.skip(`${feature.label} (install-only)`)
        return
    }

    const sameVersion = feature.version === record.version
    // `--force` bypasses the version gate. `--overwrite` only sets drift policy.
    if (sameVersion && !args.force) {
        ui.skip(`${feature.label} (${feature.version}, up to date)`)
        return
    }

    if (!feature.update) {
        const fileCount = Object.keys(record.files ?? {}).length
        if (fileCount > 0 && args.debug) {
            ui.warn(
                `${feature.label}: ${record.version} → ${feature.version}, no update() but ${fileCount} tracked file(s); run \`battlestack doctor\` if you suspect drift`,
            )
        } else {
            ui.dim(`  ${feature.label} (${record.version} → ${feature.version}, metadata-only)`)
        }
        return
    }

    const arrow = sameVersion
        ? `${feature.version} (forced)`
        : `${record.version} → ${feature.version}`
    loader.start(`${feature.label} ${arrow}`)
    try {
        const report = ctx.dryRun
            ? { written: [], skipped: [], notes: ['dry-run'] }
            : await feature.update(ctx, seedOwnedFromStructural(ctx, feature, record))
        loader.succeed(`${feature.label} ${arrow}`)
        printReport(feature.id, report)
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        loader.fail(`${feature.label}: ${msg}`)
        if (!feature.failureIsNonFatal) throw error
    }
}

/**
 * Applies a template switch onto the manifest, throwing on unknown ids or cross-framework switches.
 * @returns true only if the manifest was mutated.
 */
async function maybeSwitchTemplate(
    manifest: ProjectManifest,
    requestedId: string | undefined,
    registries: BattlestackRegistries,
): Promise<boolean> {
    if (!requestedId) return false
    if (requestedId === manifest.template) return false

    const known = registries.templates.all().some((t) => t.id === requestedId)
    if (!known) {
        throw new CLIError(
            ErrorCode.UNKNOWN_TEMPLATE,
            `Unknown template "${requestedId}". Run \`battlestack --help\` for available templates.`,
        )
    }
    const target = registries.templates.get(requestedId)
    if (target.framework !== manifest.framework) {
        throw new CLIError(
            ErrorCode.UNSUPPORTED_FEATURE,
            `Template "${requestedId}" targets framework "${target.framework}", `
            + `but this project is on "${manifest.framework}". Cross-framework switches are not supported.`,
        )
    }

    ui.section(`Switching template: ${manifest.template} → ${requestedId}`)
    ui.dim(target.description ?? '')
    manifest.template = requestedId
    return true
}

/** Executes, records and enables any feature in `wanted` missing from `manifest.features`. */
async function rehydrateMissingFeatures(
    manifest: ProjectManifest,
    ctx: RunContext,
    wanted: readonly string[],
    label: string,
    loader: Ora,
    registries: BattlestackRegistries,
): Promise<void> {
    const present = new Set(manifest.features.map((f) => f.id))
    const optedOut = new Set(manifest.optedOut ?? [])
    for (const id of wanted) {
        if (present.has(id)) continue
        if (optedOut.has(id)) {
            const featLabel = registries.features.has(id) ? registries.features.get(id).label : id
            ui.dim(`  ${featLabel} skipped (removed via \`battlestack remove\`; \`battlestack add ${id}\` to restore)`)
            continue
        }
        if (!registries.features.has(id)) continue
        const feature = registries.features.get(id)
        if (ctx.dryRun) {
            ui.dim(`  + ${feature.label} ${feature.version} (${label}, dry-run)`)
            continue
        }
        loader.start(`${feature.label} ${feature.version} (${label})`)
        try {
            ctx.enabledFeatures.add(id)
            await feature.execute(ctx)
            manifest.features.push({ id, version: feature.version, files: {} })
            present.add(id)
            loader.succeed(`${feature.label} ${feature.version} (${label})`)
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error)
            loader.fail(`${feature.label}: ${msg}`)
            if (!feature.failureIsNonFatal) throw error
        }
    }
}

/** Env-aggregator findings. `.env` is never overwritten. */
function printEnvDiff(envDiff: EnvDiff | undefined): void {
    if (!envDiff) return
    if (envDiff.regenerated && envDiff.regenerated.length > 0) {
        ui.blank()
        ui.ok('Generated secrets that were still placeholders')
        for (const k of envDiff.regenerated) ui.bullet(k)
    }
    if (envDiff.newKeys.length > 0) {
        ui.blank()
        ui.warn('Verify these new env keys in .env')
        for (const k of envDiff.newKeys) ui.bullet(k)
    }
    if (envDiff.valueChanged.length > 0) {
        ui.blank()
        ui.warn('Consider updating these existing env keys')
        for (const c of envDiff.valueChanged) {
            const current = pc.dim(`(currently: ${c.current})`)
            ui.bullet(`${c.key}=${c.recommended}  ${current}`)
        }
    }
    if (envDiff.newKeys.length + envDiff.valueChanged.length > 0) {
        ui.dim('  .env values you set are preserved; update manually to adopt the new defaults.')
        ui.blank()
    }
}

/** Drifted files emit `.battlestack.patch`. Pristine files are overwritten. */
export async function pullCommand(args: ParsedArgs, loader: Ora, registries: BattlestackRegistries): Promise<void> {
    const projectDir = await findProjectRoot(process.cwd())
    if (!projectDir) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Not inside a battlestack project (no .battlestack/manifest.json found in this directory or any parent).',
        )
    }
    const manifest = await readManifest(projectDir, registries)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectDir}/.battlestack/manifest.json`,
        )
    }

    const releaseLock = await acquireProjectLock(projectDir, 'battlestack pull')
    try {
        // Orphan features are dropped from ctx. Warnings are deferred to the end.
        const orphans = manifest.features.filter((f) => !registries.features.has(f.id))
        if (orphans.length > 0) {
            manifest.features = manifest.features.filter((f) => registries.features.has(f.id))
        }

        const templateSwitched = await maybeSwitchTemplate(manifest, args.template, registries)

        const ctx = buildRunContext({
            projectDir,
            manifest,
            debug: args.debug,
            dryRun: args.dryRun,
            state: {
                skipInstall: args.skipInstall,
                force: args.force,
                overwrite: args.overwrite,
                // `--no-skills` skips the skill refresh.
                skipSkills: !args.skills,
            },
        }, registries)

        // `--skills-only`: skills only, skipping template updates, dep install and formatting.
        if (args.skillsOnly) {
            const { collectSkillSources, installSkills } = await import('@battlestack/core')
            await installSkills(ctx, collectSkillSources(ctx, registries))
            ui.blank()
            ui.ok('Skills refreshed (--skills-only)')
            return
        }

        // Snapshotted before rehydration mutates the list. The update pass runs only over these.
        const existingRecords = [...manifest.features]

        // `--overwrite` clobbers owned files too, so confirm before anything below writes a byte.
        if (ctx.state.overwrite === true && !ctx.dryRun) {
            const atRisk = collectAtRiskOwnedFiles(ctx, existingRecords, registries)
            if (atRisk.length > 0) {
                const proceed = await confirmOverwriteOwned(args, atRisk)
                if (!proceed) {
                    throw new CLIError(
                        ErrorCode.USER_ABORTED,
                        'Aborted; re-run without `--overwrite`, or `battlestack disown <path>` first '
                        + 'if you want those specific files reset too without the rest.',
                    )
                }
            }
        }

        // Rehydration runs before the update pass, whose doc aggregator reads enabled features.
        await rehydrateMissingFeatures(
            manifest,
            ctx,
            ctx.template.requiredFeatures ?? [],
            'new required',
            loader,
            registries,
        )

        if (templateSwitched) {
            const defaults = ctx.template.defaultEnabledOptional ?? []
            await rehydrateMissingFeatures(manifest, ctx, defaults, 'new default-on', loader, registries)
        }

        for (const record of existingRecords) {
            await pullOneFeature(ctx, record, args, loader, registries)
        }

        if (!ctx.dryRun) {
            // `--no-format` skips the format pass and its drift re-baseline.
            if (args.format) {
                const { formatProject } = await import('@battlestack/preset-nuxt4')
                const { snapshotTrackedHashes, reconcilePostFormat } = await import('@battlestack/core')
                // Snapshot precedes formatting: only pristine→reformatted files are re-recorded.
                const tracked = manifest.features.map((record) => ({
                    featureId: record.id,
                    recorded: (ctx.state[`files:${record.id}`] as Record<string, string>) ?? record.files,
                    owned: new Set(record.ownedByUser ?? []),
                }))
                const preHashes = await snapshotTrackedHashes(ctx, tracked)
                await formatProject(ctx)
                await reconcilePostFormat(ctx, tracked, preHashes)
            }
            await writeManifest(ctx)
        }

        if (orphans.length > 0) {
            ui.blank()
            for (const f of orphans) {
                ui.warn(`feature "${f.id}" no longer exists in the CLI, removed from manifest`)
            }
        }

        ui.blank()
        ui.ok('Update complete')
        printEnvDiff(ctx.state['env:diff'] as EnvDiff | undefined)
    } finally {
        await releaseLock()
    }
}
