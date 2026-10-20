import { spawnSync } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
    CLIError,
    ErrorCode,
    exists,
    findBase,
    hashContent,
    hasConflictMarkers,
    isBinaryPath,
    ownedAnywhere,
    pruneBases,
    recordedFiles,
    stageUpstream,
    storeBase,
    threeWayMerge,
    toPosixRel,
    trackersOf,
    updateLedger,
    type BattlestackRegistries,
    type ProjectManifest,
    type RunContext,
} from '@battlestack/core'

const PULL_DIR = path.join('.battlestack', 'pull')
export const REPORT_PATH = path.join(PULL_DIR, 'REPORT.md')

/** Exit code for a pull that finished but left work for a person or agent. */
export const NEEDS_ATTENTION_EXIT_CODE = 2

function git(cwd: string, args: string[]): { ok: boolean, out: Buffer } {
    const r = spawnSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return { ok: r.status === 0, out: r.stdout ?? Buffer.alloc(0) }
}

export function isGitRepo(projectDir: string): boolean {
    return git(projectDir, ['rev-parse', '--is-inside-work-tree']).out.toString().trim() === 'true'
        && git(projectDir, ['rev-parse', '--verify', '-q', 'HEAD']).ok
}

/** posix rel → manifest feature id → the hash it recorded, taken before any feature runs. */
export type StartRecords = Map<string, Map<string, string>>

export function recordedAtStart(manifest: ProjectManifest): StartRecords {
    const out: StartRecords = new Map()
    for (const f of manifest.features) {
        for (const [rel, hash] of Object.entries(f.files ?? {})) {
            const posix = toPosixRel(rel)
            if (!out.has(posix)) out.set(posix, new Map())
            out.get(posix)!.set(f.id, hash)
        }
    }
    return out
}

/** Recorded files missing from disk before the pull, so the ones it restores can be reported. */
export async function missingAtStart(projectDir: string, start: StartRecords): Promise<string[]> {
    const missing: string[] = []
    for (const rel of start.keys()) {
        if (!(await exists(path.join(projectDir, rel)))) missing.push(rel)
    }
    return missing
}

/**
 * A pull rewrites files in place, so it starts from a commit: git is the undo, and the
 * overwrite check below compares against HEAD. Unresolved markers from an earlier run block
 * it, unless the run replaces drifted files anyway (`--force`, `--overwrite`).
 */
export async function preflight(
    projectDir: string,
    manifest: ProjectManifest,
    opts: { allowDirty: boolean, replacing?: boolean },
): Promise<{ git: boolean, clean: boolean }> {
    for (const [rel, byFeature] of opts.replacing ? [] : recordedAtStart(manifest)) {
        const abs = path.join(projectDir, rel)
        if (!(await exists(abs))) continue
        const content = await readFile(abs)
        if ([...byFeature.values()].includes(hashContent(content))) continue
        if (hasConflictMarkers(content.toString('utf8'))) {
            throw new CLIError(
                ErrorCode.SCAFFOLD_FAILED,
                `${rel} still has conflict markers from an earlier pull. Resolve them (git diff --check lists them), commit, then pull again.`,
            )
        }
    }

    if (!isGitRepo(projectDir)) return { git: false, clean: false }
    const status = git(projectDir, ['status', '--porcelain', '--untracked-files=normal', '--', '.']).out.toString().trim()
    if (status && opts.allowDirty) return { git: true, clean: false }
    if (status) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'The working tree has uncommitted changes. Commit or stash them first, so the pull can be reviewed and undone with git. '
            + 'Pass --allow-dirty to pull anyway.',
        )
    }
    return { git: true, clean: true }
}

export interface OverwriteRepair {
    rel: string
    featureId: string
    outcome: 'merged' | 'conflicts' | 'staged' | 'backed up' | 'kept yours, owned'
}

/** Bare feature id for a manifest id, which may be an fqid. */
function bareId(registries: BattlestackRegistries, id: string): string {
    return registries.features.has(id) ? registries.features.get(id).id : id
}

/**
 * Catches feature writes that bypassed the drift-aware writers: a tracked or untracked file
 * that held local edits at HEAD and was replaced. The local version is put back and the
 * feature's output is merged into it, or staged when there is no base to merge against. A
 * path owned under any feature only gets the local version back. `--force` keeps the feature
 * output and saves the local version as a `.bak`, as the drift-aware writers do; `--overwrite`
 * takes the output as asked.
 */
export async function repairOverwrites(
    ctx: RunContext,
    start: StartRecords,
    registries: BattlestackRegistries,
): Promise<OverwriteRepair[]> {
    if (ctx.state.overwrite === true && ctx.state.force !== true) return []
    const ledger = updateLedger(ctx)
    const handled = new Set(ledger.handled)
    const exempt = selfMergedPaths(ctx, registries)
    const owned = ownedAnywhere(ctx)
    const changed = git(ctx.projectDir, ['diff', '--name-only', '-z', '--relative', 'HEAD']).out.toString().split('\0').filter(Boolean)
    const repairs: OverwriteRepair[] = []

    for (const rel of changed) {
        if (handled.has(rel) || isExempt(rel, exempt)) continue
        const trackers = trackersOf(ctx, rel)
        if (trackers.length === 0) continue
        const abs = path.join(ctx.projectDir, rel)
        if (!(await exists(abs))) continue
        // `./` resolves against the project directory, and --filters gives the bytes checkout wrote.
        const head = git(ctx.projectDir, ['cat-file', '--filters', `HEAD:./${rel}`])
        if (!head.ok) continue
        const startByFeature = start.get(rel) ?? new Map<string, string>()
        const before = new Set(startByFeature.values())
        if (before.has(hashContent(head.out))) continue
        // A file battlestack wrote and never checked out matches the committed bytes, not the filtered ones.
        if (before.has(hashContent(git(ctx.projectDir, ['cat-file', '-p', `HEAD:./${rel}`]).out))) continue

        if (owned.has(rel)) {
            await writeFile(abs, head.out)
            repairs.push({ rel, featureId: trackers[0]!.featureId, outcome: 'kept yours, owned' })
            continue
        }

        if (ctx.state.force === true) {
            const bak = path.join(ctx.projectDir, PULL_DIR, `${rel}.bak`)
            await mkdir(path.dirname(bak), { recursive: true })
            await writeFile(bak, head.out)
            repairs.push({ rel, featureId: trackers[0]!.featureId, outcome: 'backed up' })
            continue
        }
        const upstream = await readFile(abs)
        const tracker = trackers.find((t) => t.hash === hashContent(upstream)) ?? trackers[0]!
        const featureId = tracker.featureId
        const base = before.size > 0 ? await findBase(ctx.projectDir, rel, before) : null
        const merged = base
            ? await threeWayMerge(head.out, base, upstream, {
                current: `${rel} (yours)`,
                base: `${rel} (upstream before, ${featureId})`,
                upstream: `${rel} (upstream now, ${featureId})`,
            })
            : null
        if (merged) {
            await storeBase(ctx.projectDir, upstream)
            await writeFile(abs, merged.content)
            repairs.push({ rel, featureId, outcome: merged.conflicts ? 'conflicts' : 'merged' })
            if (merged.conflicts) ledger.conflicts.push(rel)
            else ledger.merged.push(rel)
            continue
        }
        await writeFile(abs, head.out)
        // Not merged, so the record goes back to what this feature recorded before the pull, or away if it had none.
        const previous = [...startByFeature].find(([id]) => bareId(registries, id) === featureId)?.[1]
        if (previous) tracker.files[tracker.rel] = previous
        else delete tracker.files[tracker.rel]
        await stageUpstream(ctx.projectDir, rel, head.out, upstream, { binary: isBinaryPath(rel) })
        ledger.staged.push(rel)
        repairs.push({ rel, featureId, outcome: 'staged' })
    }
    return repairs
}

function selfMergedPaths(ctx: RunContext, registries: BattlestackRegistries): string[] {
    const out: string[] = []
    for (const id of ctx.enabledFeatures) {
        if (!registries.features.has(id)) continue
        out.push(...(registries.features.get(id).selfMergedFiles?.(ctx) ?? []))
    }
    return out
}

function isExempt(rel: string, exempt: string[]): boolean {
    return exempt.some((e) => (e.endsWith('/') ? rel.startsWith(e) : rel === e))
}

/** Recorded files this pull created that git does not know yet. */
export function newlyAddedFiles(ctx: RunContext): string[] {
    const r = git(ctx.projectDir, ['ls-files', '--others', '--exclude-standard', '-z'])
    if (!r.ok) return []
    const recorded = new Set([...recordedFiles(ctx)].map((f) => toPosixRel(f.rel)))
    return r.out.toString().split('\0').filter((f) => recorded.has(f))
}

/** Drops stored bases nothing will merge against any more. */
export async function pruneStoredBases(projectDir: string, manifest: ProjectManifest): Promise<void> {
    const keep = new Set<string>()
    for (const f of manifest.features) {
        for (const [rel, hash] of Object.entries(f.files ?? {})) {
            const abs = path.join(projectDir, rel)
            if (!(await exists(abs))) continue
            if (hashContent(await readFile(abs)) !== hash) keep.add(hash)
        }
    }
    await pruneBases(projectDir, keep)
}


export interface PullSummary {
    merged: string[]
    conflicts: string[]
    staged: string[]
    backups: string[]
    unmanaged: string[]
    restored: string[]
    added: string[]
    orphans: string[]
    actions: string[]
    formatError?: string
    repairs: OverwriteRepair[]
}

export function needsAttention(s: PullSummary): boolean {
    return s.conflicts.length + s.staged.length + s.backups.length + s.orphans.length + s.actions.length + s.unmanaged.length > 0
        || Boolean(s.formatError)
}

const STEPS_TITLE = 'Steps outside this repository'

/** The steps an earlier report lists that the user has not deleted from it yet. */
export async function unfinishedSteps(projectDir: string): Promise<string[]> {
    const dest = path.join(projectDir, REPORT_PATH)
    if (!(await exists(dest))) return []
    const steps: string[] = []
    let inSteps = false
    for (const line of (await readFile(dest, 'utf8')).split(/\r?\n/)) {
        if (line.startsWith('## ')) inSteps = line === `## ${STEPS_TITLE}`
        else if (inSteps && line.startsWith('- ')) steps.push(line.slice(2))
    }
    return steps
}

/** Staged `.new` files (as the rel they belong to) and `.bak` backups still in `.battlestack/pull/`. */
export async function leftoverArtifacts(projectDir: string): Promise<{ staged: string[], backups: string[] }> {
    const dir = path.join(projectDir, PULL_DIR)
    const staged: string[] = []
    const backups: string[] = []
    if (!(await exists(dir))) return { staged, backups }
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue
        const abs = path.join(entry.parentPath, entry.name)
        if (entry.name.endsWith('.new')) staged.push(toPosixRel(path.relative(dir, abs)).slice(0, -'.new'.length))
        else if (entry.name.endsWith('.bak')) backups.push(path.relative(projectDir, abs))
    }
    return { staged: staged.sort(), backups: backups.sort() }
}

function section(title: string, intro: string, items: string[]): string[] {
    if (items.length === 0) return []
    return [`## ${title}`, '', intro, '', ...items.map((i) => `- ${i}`), '']
}

export function renderReport(s: PullSummary): string {
    const repaired = s.repairs.map((r) => `\`${r.rel}\` (${r.featureId}, ${r.outcome})`)
    return [
        '# battlestack pull report',
        '',
        needsAttention(s)
            ? 'This pull left work to finish. Go through the sections in order, then run lint, typecheck and the tests, and commit.'
            : 'Nothing needs attention. Review the diff, run lint, typecheck and the tests, and commit.',
        '',
        ...section(
            'Conflicts',
            'Both your project and upstream changed the same lines. Each file has diff3 markers: `<<<<<<<` your version, `|||||||` upstream before, `=======` upstream now, `>>>>>>>`. Keep your intent and take the upstream change where it does not contradict it. `git diff --check` lists any marker left behind, and pull refuses to run until none are left, except with `--force` or `--overwrite`.',
            s.conflicts.map((r) => `\`${r}\``),
        ),
        ...section(
            'Staged for a manual merge',
            'No earlier upstream version of these files was found, so there was nothing to merge against. Your file is unchanged. The new upstream version is in `.battlestack/pull/<path>.new`. Compare the two and carry over what you want, then delete the `.new` and the `.patch`. The `.patch` replaces your file wholesale, so do not apply it blindly. A later pull lists every `.new` still there.',
            s.staged.map((r) => `\`${r}\``),
        ),
        ...section(
            'Local edits a feature wrote over',
            'These features replaced a file that had local edits. Pull put your version back and merged or staged theirs, as listed in the sections above, or under `--force` kept theirs and saved yours as `.battlestack/pull/<path>.bak`. Check the result.',
            repaired,
        ),
        ...section(
            'Backups of regenerated files',
            'These files are regenerated on every pull. Your edited version was saved here. Move anything worth keeping to `CLAUDE.project.md` or a file of your own, then delete the backup. A later pull lists every backup still there.',
            s.backups.map((r) => `\`${r}\``),
        ),
        ...section(
            STEPS_TITLE,
            'Pull cannot do these for you. Delete a line here once its step is done: a later pull lists again every line still here.',
            s.actions,
        ),
        ...section(
            'Features from plugins that did not load',
            'Their records stay in the manifest and their files were not updated. `battlestack plugins` shows why a plugin failed to load.',
            s.orphans.map((r) => `\`${r}\``),
        ),
        ...(s.formatError
            ? ['## Lint', '', `The eslint pass after the update failed: ${s.formatError}. Conflict markers cause this until they are resolved. Run \`pnpm run lint\` once they are.`, '']
            : []),
        ...section(
            'New files',
            'Pull added these. Check `git log --diff-filter=D -- <path>` for each one: if the project deleted it on purpose, remove the feature with `battlestack remove <feature>` instead of deleting the file again.',
            [...new Set([...s.added, ...s.restored])].map((r) => `\`${r}\``),
        ),
        ...section(
            'Merged cleanly',
            'Your edits and the upstream changes are both in these files. Review the diff.',
            s.merged.map((r) => `\`${r}\``),
        ),
        ...section(
            'No longer managed',
            'Pull stopped tracking these and left them in place because they have local edits. Delete each one that is unused, or keep it as your own.',
            s.unmanaged.map((r) => `\`${r}\``),
        ),
    ].join('\n')
}

export async function writeReport(projectDir: string, s: PullSummary): Promise<string> {
    const dest = path.join(projectDir, REPORT_PATH)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, renderReport(s))
    return REPORT_PATH
}
