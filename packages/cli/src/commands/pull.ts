import { readFile } from 'node:fs/promises'
import path from 'node:path'
import pc from 'picocolors'
import type { Ora } from 'ora'
import { confirmOverwriteOwned, ui } from '@battlestack/tui'
import { formatAndReconcile } from './format-project.js'
import {
    baseDirIsTracked,
    isGitRepo,
    missingAtStart,
    needsAttention,
    NEEDS_ATTENTION_EXIT_CODE,
    newlyAddedFiles,
    preflight,
    pruneStoredBases,
    recordedAtStart,
    repairOverwrites,
    writeReport,
    type PullSummary,
} from './pull-safety.js'
import {
    acquireProjectLock,
    buildRunContext,
    CLIError,
    ErrorCode,
    exists,
    findProjectRoot,
    queueObsoleteDeletions,
    readManifest,
    recordOwned,
    removeQueuedObsoleteFiles,
    skillsOutcome,
    toPosixRel,
    updateLedger,
    UPDATING_STATE_KEY,
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
import { generatePulledMigration, hashSchemaFiles } from '@battlestack/preset-nuxt4'

/** Static metadata only. `run` is built per-dispatch in `project.ts`. */
export const pullReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'pull',
    usage: 'battlestack pull',
    label: 'pull template + config changes (drift-aware)',
    group: 'Sync with upstream',
    helpExtra: [
        ['battlestack pull --force', 'overwrite drifted files (saves `.battlestack/pull/<path>.bak`)'],
        ['battlestack pull --overwrite', 'overwrite EVERY shipped file, no artefacts (confirms first if any are `own`ed)'],
        ['battlestack pull --skills-only', 'refresh ONLY AI-agent skills (skip everything else)'],
        ['battlestack pull --no-skills', 'skip the AI-agent skill refresh'],
        ['battlestack pull --no-format', 'skip the trailing prettier pass'],
        ['battlestack pull --skip-install', 'skip the dependency install'],
        ['battlestack pull --allow-dirty', 'pull into a working tree with uncommitted changes'],
    ],
}

export const upgradeReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'upgrade',
    usage: 'battlestack upgrade',
    label: 'alias for `pull` (picks up feature version bumps)',
    group: 'Sync with upstream',
}

/** Per-feature report lists, gathered for the closing summary and `REPORT.md`. */
type Collected = Required<Pick<UpdateReport, 'backups' | 'unmanaged' | 'actions' | 'restoredDeleted'>>

function collect(c: Collected, report: UpdateReport): void {
    c.backups.push(...(report.backups ?? []))
    c.unmanaged.push(...(report.unmanaged ?? []))
    c.actions.push(...(report.actions ?? []))
    c.restoredDeleted.push(...(report.restoredDeleted ?? []))
}

type LedgerMark = Record<'merged' | 'conflicts' | 'staged', number>

function markLedger(ctx: RunContext): LedgerMark {
    const { merged, conflicts, staged } = updateLedger(ctx)
    return { merged: merged.length, conflicts: conflicts.length, staged: staged.length }
}

/** The report's list plus what the drift-aware writers put in the ledger since `mark`, for writes whose report a feature did not return. */
function withLedger(ctx: RunContext, mark: LedgerMark, kind: keyof LedgerMark, reported: string[] = []): number {
    const since = updateLedger(ctx)[kind].slice(mark[kind])
    return new Set([...reported, ...since].map(toPosixRel)).size
}

function printReport(ctx: RunContext, featureId: string, report: UpdateReport, mark: LedgerMark): void {
    const merged = withLedger(ctx, mark, 'merged', report.merged)
    const conflicts = withLedger(ctx, mark, 'conflicts', report.conflicts)
    const staged = withLedger(ctx, mark, 'staged', report.skipped)
    const counts = [
        [report.written.length, 'written'],
        [merged, 'merged'],
        [conflicts, 'with conflicts'],
        [staged, 'staged'],
    ].filter(([n]) => (n as number) > 0).map(([n, label]) => `${n} ${label}`)
    if (counts.length > 0) {
        const line = `  ${featureId}: ${counts.join(', ')}`
        if (conflicts + staged > 0) console.log(pc.yellow(line))
        else ui.dim(line)
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

/** Throws on failure unless `failureIsNonFatal` is set. False when the feature could not run: unregistered, or failed. */
async function pullOneFeature(
    ctx: RunContext,
    record: InstalledFeatureRecord,
    args: ParsedArgs,
    loader: Ora,
    registries: BattlestackRegistries,
    /** Set after `battlestack rename`: every feature re-renders, at unchanged versions too. */
    renamedFrom: string | undefined,
    collected: Collected,
): Promise<boolean> {
    if (!registries.features.has(record.id)) {
        ui.warn(`feature "${record.id}" is not registered by any loaded plugin, skipped`)
        return false
    }
    const feature = registries.features.get(record.id)

    if (feature.upgradable === false) {
        ui.skip(`${feature.label} (install-only)`)
        return true
    }

    const sameVersion = feature.version === record.version
    // `--force` bypasses the version gate. `--overwrite` only sets drift policy.
    if (sameVersion && ((!args.force && !renamedFrom) || !feature.update)) {
        ui.skip(`${feature.label} (${feature.version}, up to date)`)
        return true
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
        return true
    }

    const arrow = sameVersion
        ? `${feature.version} (${args.force ? 'forced' : 'project renamed'})`
        : `${record.version} → ${feature.version}`
    loader.start(`${feature.label} ${arrow}`)
    const mark = markLedger(ctx)
    try {
        const report = ctx.dryRun
            ? { written: [], skipped: [], notes: ['dry-run'] }
            : await feature.update(ctx, seedOwnedFromStructural(ctx, feature, record))
        // Mirrors the scaffold orchestrator, which records ownership after `execute`. Without it a
        // structural file that first arrives through an upgrade is tracked but never owned, so the
        // client's own replacement of it is reported as drift needing a manual merge on every later
        // bump, while the same file on a freshly scaffolded project is left alone silently.
        if (!ctx.dryRun && feature.structuralFiles) {
            for (const rel of feature.structuralFiles(ctx)) {
                recordOwned(ctx, feature.id, rel)
            }
        }
        loader.succeed(`${feature.label} ${arrow}`)
        collect(collected, report)
        printReport(ctx, feature.id, report, mark)
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        loader.fail(`${feature.label}: ${msg}`)
        if (!feature.failureIsNonFatal) throw error
        return false
    }
    return true
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

/** Tracked files that still name the project by `name`: owned, edited or seed-once files a re-render leaves alone. */
async function filesStillNaming(projectDir: string, manifest: ProjectManifest, name: string): Promise<string[]> {
    const pattern = new RegExp(`(?<![a-z0-9_-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9_-])`)
    const rels = new Set(manifest.features.flatMap((f) => [...Object.keys(f.files ?? {}), ...(f.ownedByUser ?? [])]))
    const hits: string[] = []
    for (const rel of [...rels].sort()) {
        let content: string
        try {
            content = await readFile(path.join(projectDir, rel), 'utf8')
        } catch {
            continue // Recorded but gone from disk: nothing left to rename.
        }
        if (pattern.test(content)) hits.push(rel)
    }
    return hits
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

    const releaseLock = await acquireProjectLock(projectDir, 'battlestack pull', { dryRun: args.dryRun })
    try {
        const safety = args.dryRun || args.skillsOnly
            ? { git: false, clean: false }
            : await preflight(projectDir, manifest, { allowDirty: args.allowDirty === true, replacing: args.force || args.overwrite })
        const startRecorded = recordedAtStart(manifest)
        const missingBefore = await missingAtStart(projectDir, startRecorded)

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
                [UPDATING_STATE_KEY]: !args.dryRun,
            },
        }, registries)

        // Pre-primed like `battlestack add` (see add-remove.ts): each feature's update can
        // then see which rels the OTHER installed features track — required both for
        // re-baselining shared files it rewrites and for leaving alone a shared file whose
        // final content belongs to a later-ordered feature (e.g. nuxt4:landing-shell's app
        // shell over nuxt4:nuxt-ui's). Keyed bare, matching `ctx.state` conventions.
        for (const f of manifest.features) {
            if (!registries.features.has(f.id)) continue
            const bare = registries.features.get(f.id).id
            ctx.state[`files:${bare}`] = { ...f.files }
            if (f.ownedByUser) ctx.state[`owned:${bare}`] = [...f.ownedByUser]
        }

        // `--skills-only`: skills only, skipping template updates, dep install and formatting.
        if (args.skillsOnly) {
            const { collectSkillSources, installSkills } = await import('@battlestack/core')
            await installSkills(ctx, collectSkillSources(ctx, registries))
            ui.blank()
            const outcome = skillsOutcome(ctx, 'Skills refreshed (--skills-only)')
            if (outcome.ok) ui.ok(outcome.line)
            else ui.warn(outcome.line)
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

        // Before anything writes: the schema files this pull changes need a migration.
        const schemaBefore = await hashSchemaFiles(projectDir)

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

        const renamedFrom = manifest.renderedName && manifest.renderedName !== ctx.projectName
            ? manifest.renderedName
            : undefined
        if (renamedFrom) ui.info(`Project renamed ${renamedFrom} → ${ctx.projectName}: re-rendering every feature`)

        queueObsoleteDeletions(ctx)
        const collected: Collected = { backups: [], unmanaged: [], actions: [], restoredDeleted: [] }
        // An orphan's files were not re-rendered either, so they still carry the old name.
        let renderedAll = orphans.length === 0
        for (const record of existingRecords) {
            if (!(await pullOneFeature(ctx, record, args, loader, registries, renamedFrom, collected))) renderedAll = false
        }
        for (const rel of await removeQueuedObsoleteFiles(ctx)) ui.dim(`  removed obsolete file: ${rel}`)

        // Compares against HEAD, so uncommitted edits would read as feature output.
        const repairs = safety.clean && !ctx.dryRun ? await repairOverwrites(ctx, startRecorded, registries) : []
        if (!ctx.dryRun && !safety.clean && !args.force && !args.overwrite) {
            ui.warn(safety.git
                ? 'Uncommitted changes (--allow-dirty), so local edits a feature writes over cannot be detected.'
                : 'Not a git repository with a commit, so local edits a feature writes over cannot be detected.')
        }

        if (!ctx.dryRun) {
            // `--no-format` skips the format pass and its drift re-baseline.
            if (args.format) {
                await formatAndReconcile(ctx, manifest, registries)
            }
            // A feature that did not run still carries the old name, so the rename stays pending.
            await writeManifest(ctx, { rendered: renderedAll })
            const written = await readManifest(projectDir, registries)
            if (written) await pruneStoredBases(projectDir, written)
            if (safety.git && baseDirIsTracked(projectDir)) {
                updateLedger(ctx).actions.push('`.battlestack/base/` is now a local cache that git ignores. Stop tracking it: `git rm -r --cached .battlestack/base`')
            }
            await generatePulledMigration(ctx, schemaBefore)
        }

        if (renamedFrom && !ctx.dryRun) {
            const after = await readManifest(projectDir, registries)
            const stale = after ? await filesStillNaming(projectDir, after, renamedFrom) : []
            if (stale.length > 0) {
                ui.blank()
                ui.warn(`These files still name the project ${renamedFrom}; pull leaves files you own, files you edited (listed in .battlestack/pull/REPORT.md) and files written only once`)
                for (const rel of stale) ui.bullet(rel)
                ui.dim(`  Untracked files can name it too: git grep -n ${renamedFrom}`)
            }
        }

        if (orphans.length > 0) {
            ui.blank()
            for (const f of orphans) {
                // Deliberately not "no longer exists": the commonest cause is a plugin that
                // did not load, and a project's whole devops layer can hang off one such
                // feature. Stating removal as an upstream fact invites the reader to accept
                // it. `plugins` is the command that distinguishes the two.
                ui.warn(
                    `feature "${f.id}" is not registered by any loaded plugin. Its record stays in the manifest `
                    + 'and its files were not updated. `battlestack plugins` shows why a plugin failed to load',
                )
            }
        }

        printEnvDiff(ctx.state['env:diff'] as EnvDiff | undefined)
        if (ctx.dryRun) {
            ui.blank()
            ui.ok('Dry run complete. Nothing was written.')
            return
        }

        const ledger = updateLedger(ctx)
        const restored = [...collected.restoredDeleted]
        for (const rel of missingBefore) {
            if (await exists(path.join(projectDir, rel))) restored.push(rel)
        }
        const summary: PullSummary = {
            merged: ledger.merged,
            conflicts: ledger.conflicts,
            staged: ledger.staged,
            backups: collected.backups,
            unmanaged: collected.unmanaged,
            restored: [...new Set(restored.map(toPosixRel))],
            added: safety.git ? newlyAddedFiles(ctx) : [],
            orphans: orphans.map((f) => f.id),
            actions: [...new Set([...collected.actions, ...ledger.actions])],
            formatError: ctx.state['format:error'] as string | undefined,
            repairs,
        }
        const reportPath = await writeReport(projectDir, summary)
        ui.blank()
        const outcome = skillsOutcome(ctx, needsAttention(summary) ? 'Update finished, with work left' : 'Update complete')
        if (outcome.ok && !needsAttention(summary)) ui.ok(outcome.line)
        else ui.warn(outcome.line)
        const tally = [
            [summary.merged.length, 'merged'],
            [summary.conflicts.length, 'with conflicts'],
            [summary.staged.length, 'staged'],
            [summary.backups.length, 'backed up'],
            [summary.added.length, 'new'],
        ].filter(([n]) => (n as number) > 0).map(([n, label]) => `${n} ${label}`)
        if (tally.length > 0) ui.dim(`  Files: ${tally.join(', ')}.`)
        ui.dim(`  Next steps: ${reportPath}`)
        if (needsAttention(summary)) process.exitCode = NEEDS_ATTENTION_EXIT_CODE
    } finally {
        await releaseLock()
    }
}
