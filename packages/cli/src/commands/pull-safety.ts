import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
    CLIError,
    ErrorCode,
    exists,
    findBase,
    hasConflictMarkers,
    pruneBases,
    storeBase,
    threeWayMerge,
    updateLedger,
    type BattlestackRegistries,
    type ProjectManifest,
    type RunContext,
} from '@battlestack/core'

const PULL_DIR = path.join('.battlestack', 'pull')
export const REPORT_PATH = path.join(PULL_DIR, 'REPORT.md')

/** Exit code for a pull that finished but left work for a person or agent. */
export const NEEDS_ATTENTION_EXIT_CODE = 2

function sha256(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex')
}

function git(cwd: string, args: string[]): { ok: boolean, out: Buffer } {
    const r = spawnSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })
    return { ok: r.status === 0, out: r.stdout ?? Buffer.alloc(0) }
}

export function isGitRepo(projectDir: string): boolean {
    return git(projectDir, ['rev-parse', '--is-inside-work-tree']).out.toString().trim() === 'true'
        && git(projectDir, ['rev-parse', '--verify', '-q', 'HEAD']).ok
}

/** rel → every hash the manifest records for it, taken before any feature runs. */
export function recordedAtStart(manifest: ProjectManifest): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>()
    for (const f of manifest.features) {
        for (const [rel, hash] of Object.entries(f.files ?? {})) {
            const posix = rel.split(path.sep).join('/')
            if (!out.has(posix)) out.set(posix, new Set())
            out.get(posix)!.add(hash)
        }
    }
    return out
}

/**
 * A pull rewrites files in place, so it starts from a commit: git is the undo, and the
 * overwrite check below compares against HEAD. Unresolved markers from an earlier run block it.
 */
export async function preflight(
    projectDir: string,
    manifest: ProjectManifest,
    opts: { allowDirty: boolean },
): Promise<{ git: boolean, clean: boolean }> {
    for (const [rel, hashes] of recordedAtStart(manifest)) {
        const abs = path.join(projectDir, rel)
        if (!(await exists(abs))) continue
        const content = await readFile(abs)
        if (hashes.has(sha256(content))) continue
        if (hasConflictMarkers(content.toString('utf8'))) {
            throw new CLIError(
                ErrorCode.SCAFFOLD_FAILED,
                `${rel} still has conflict markers from an earlier pull. Resolve them (git diff --check lists them), commit, then pull again.`,
            )
        }
    }

    if (!isGitRepo(projectDir)) return { git: false, clean: false }
    const status = git(projectDir, ['status', '--porcelain', '--untracked-files=normal']).out.toString().trim()
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
    outcome: 'merged' | 'conflicts' | 'staged'
}

function featureRecording(ctx: RunContext, rel: string): string | null {
    for (const [key, value] of Object.entries(ctx.state)) {
        if (!key.startsWith('files:') || !value || typeof value !== 'object') continue
        for (const r of Object.keys(value as Record<string, string>)) {
            if (r.split(path.sep).join('/') === rel) return key.slice('files:'.length)
        }
    }
    return null
}

/**
 * Catches feature writes that bypassed the drift-aware writers: a tracked or untracked file
 * that held local edits at HEAD and was replaced. The local version is put back and the
 * feature's output is merged into it, or staged when there is no base to merge against.
 */
export async function repairOverwrites(
    ctx: RunContext,
    startRecorded: Map<string, Set<string>>,
    registries: BattlestackRegistries,
): Promise<OverwriteRepair[]> {
    const ledger = updateLedger(ctx)
    const handled = new Set(ledger.handled)
    const exempt = selfMergedPaths(ctx, registries)
    const changed = git(ctx.projectDir, ['diff', '--name-only', '-z', 'HEAD']).out.toString().split('\0').filter(Boolean)
    const repairs: OverwriteRepair[] = []

    for (const rel of changed) {
        if (handled.has(rel) || isExempt(rel, exempt)) continue
        const featureId = featureRecording(ctx, rel)
        if (!featureId) continue
        const abs = path.join(ctx.projectDir, rel)
        if (!(await exists(abs))) continue
        const head = git(ctx.projectDir, ['show', `HEAD:${rel}`])
        if (!head.ok) continue
        const before = startRecorded.get(rel) ?? new Set<string>()
        if (before.has(sha256(head.out))) continue

        const upstream = await readFile(abs)
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
        // Not merged, so the record goes back to what the file last matched, or away if nothing did.
        const files = ctx.state[`files:${featureId}`] as Record<string, string>
        const previous = [...before][0]
        if (previous) files[rel] = previous
        else delete files[rel]
        const staged = path.join(ctx.projectDir, PULL_DIR, `${rel}.new`)
        await mkdir(path.dirname(staged), { recursive: true })
        await writeFile(staged, upstream)
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

/** Drops stored bases nothing will merge against any more. */
export async function pruneStoredBases(projectDir: string, manifest: ProjectManifest): Promise<void> {
    const keep = new Set<string>()
    for (const f of manifest.features) {
        for (const [rel, hash] of Object.entries(f.files ?? {})) {
            const abs = path.join(projectDir, rel)
            if (!(await exists(abs))) continue
            if (sha256(await readFile(abs)) !== hash) keep.add(hash)
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
    return s.conflicts.length + s.staged.length + s.backups.length + s.orphans.length + s.actions.length > 0
        || Boolean(s.formatError)
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
            'Both your project and upstream changed the same lines. Each file has diff3 markers: `<<<<<<<` your version, `|||||||` upstream before, `=======` upstream now, `>>>>>>>`. Keep your intent and take the upstream change where it does not contradict it. `git diff --check` lists any marker left behind, and pull refuses to run until none are.',
            s.conflicts.map((r) => `\`${r}\``),
        ),
        ...section(
            'Staged for a manual merge',
            'No earlier upstream version of these files was found, so there was nothing to merge against. Your file is unchanged. The new upstream version is in `.battlestack/pull/<path>.new`. Compare the two and carry over what you want. The `.patch` next to it replaces your file wholesale, so do not apply it blindly.',
            s.staged.map((r) => `\`${r}\``),
        ),
        ...section(
            'Local edits a feature wrote over',
            'These features replaced a file that had local edits. Pull put your version back and merged or staged theirs, as listed in the sections above. Check the result.',
            repaired,
        ),
        ...section(
            'Backups of regenerated files',
            'These files are regenerated on every pull. Your edited version was saved here. Move anything worth keeping to `CLAUDE.project.md` or a file of your own, then delete the backup.',
            s.backups.map((r) => `\`${r}\``),
        ),
        ...section(
            'Steps outside this repository',
            'Pull cannot do these for you.',
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
            [...s.added, ...s.restored].map((r) => `\`${r}\``),
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
