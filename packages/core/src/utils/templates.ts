import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPatch } from 'diff'
import { dropRecordedFile, hashFile, recordCreated, recordFile, recordOwned } from '../manifest.js'
import type { InstalledFeatureRecord } from '../types/feature.js'
import type { RunContext } from '../types/run-context.js'
import type { UpdateReport } from '../types/update-report.js'
import { writeFileEnsured, exists } from './fs.js'

function templatesRootFor(callerUrl: string): string {
    return path.dirname(fileURLToPath(callerUrl))
}

/** Resolves relative to the calling feature's directory. `callerUrl` is `import.meta.url`. */
export function templatesDir(callerUrl: string, ...segments: string[]): string {
    return path.join(templatesRootFor(callerUrl), ...segments)
}

/** Copy `<feature-dir>/../templates/<templateName>` into the project, recording hashes. */
export async function emitTemplate(
    ctx: RunContext,
    featureId: string,
    callerUrl: string,
    templateName: string,
): Promise<void> {
    const src = templatesDir(callerUrl, '..', 'templates', templateName)
    await copyTemplateDirRecorded(ctx, featureId, src)
}

/** `emitTemplate` for the `update(ctx, prev)` half of the contract. */
export async function emitTemplateUpdate(
    ctx: RunContext,
    featureId: string,
    callerUrl: string,
    templateName: string,
    prev: InstalledFeatureRecord | null,
): Promise<UpdateReport> {
    const src = templatesDir(callerUrl, '..', 'templates', templateName)
    return updateFromTemplateDir(ctx, featureId, src, prev)
}

/** `opts.keepRels` lists feature paths that live outside every subtree. */
export async function emitTemplateUpdateMany(
    ctx: RunContext,
    featureId: string,
    callerUrl: string,
    templateNames: string[],
    prev: InstalledFeatureRecord | null,
    opts: { keepRels?: string[] } = {},
): Promise<UpdateReport> {
    const srcDirs = templateNames.map((name) =>
        templatesDir(callerUrl, '..', 'templates', name),
    )
    return updateFromTemplateDirs(ctx, featureId, srcDirs, prev, opts.keepRels)
}

// A `.test.ts` outside a `test/` directory.
function isColocatedTest(absPath: string): boolean {
    if (!absPath.endsWith('.test.ts')) return false
    return !/[\\/]test[\\/]/.test(absPath)
}

// Finder droppings, Vim swapfiles, Thumbs.db and stray `battlestack pull` merge artifacts.
function isJunkFile(absPath: string): boolean {
    const base = absPath.split(/[\\/]/).pop() ?? ''
    if (base === '.DS_Store') return true
    if (base === 'Thumbs.db') return true
    if (/^\..+\.swp$/.test(base)) return true
    if (/\.battlestack(\.(bak|new|patch))?$/.test(base)) return true
    return false
}

/** Template filenames that npm's packer would drop, mapped back to their real names on copy. */
const PACK_SAFE_ALIASES: Record<string, string> = {
    'npmrc.template': '.npmrc',
}

function restorePackSafeName(name: string): string {
    return PACK_SAFE_ALIASES[name] ?? name
}

export async function copyTemplateDir(srcDir: string, destDir: string): Promise<string[]> {
    const written: string[] = []
    const entries = await readdir(srcDir, { withFileTypes: true })
    await mkdir(destDir, { recursive: true })

    for (const entry of entries) {
        const src = path.join(srcDir, entry.name)
        const dest = path.join(destDir, restorePackSafeName(entry.name))
        if (entry.isDirectory()) {
            const sub = await copyTemplateDir(src, dest)
            written.push(...sub)
        } else if (entry.isFile()) {
            if (isColocatedTest(src) || isJunkFile(src)) continue
            await copyFile(src, dest)
            written.push(dest)
        }
    }
    return written
}

export async function copyTemplateFile(src: string, dest: string): Promise<void> {
    await mkdir(path.dirname(dest), { recursive: true })
    await copyFile(src, dest)
}

/** String-substitution render. Marker syntax: `__VAR__`. */
export async function renderTemplate(
    src: string,
    dest: string,
    vars: Record<string, string>,
): Promise<void> {
    const raw = await readFile(src, 'utf8')
    let out = raw
    for (const [k, v] of Object.entries(vars)) {
        out = out.split(`__${k}__`).join(v)
    }
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, out, 'utf8')
}

async function rmIfExists(p: string): Promise<void> {
    if (!(await exists(p))) return
    await rm(p, { force: true })
}

type ArtifactSuffix = '.new' | '.patch' | '.bak'

/** Merge-artifact path under `.battlestack/pull/`, outside the source tree. */
function stagedArtifact(ctx: RunContext, rel: string, suffix: ArtifactSuffix): string {
    return path.join(ctx.projectDir, '.battlestack', 'pull', rel + suffix)
}

/** Removes staged artifacts and legacy in-tree `*.battlestack.{new,patch,bak}`. */
async function clearArtifacts(ctx: RunContext, dest: string, rel: string): Promise<void> {
    await rmIfExists(stagedArtifact(ctx, rel, '.new'))
    await rmIfExists(stagedArtifact(ctx, rel, '.patch'))
    await rmIfExists(stagedArtifact(ctx, rel, '.bak'))
    await rmIfExists(`${dest}.battlestack.new`)
    await rmIfExists(`${dest}.battlestack.patch`)
    await rmIfExists(`${dest}.battlestack.bak`)
}

/**
 * `owned` claimed via `battlestack own`, `missing` recorded but absent on disk,
 * `pristine` hash matches recorded, `drifted` edited since install.
 */
export type FileState = 'owned' | 'missing' | 'pristine' | 'drifted'

export async function classifyFileState(
    absPath: string,
    recordedHash: string,
    isOwned: boolean,
): Promise<FileState> {
    if (isOwned) return 'owned'
    if (!(await exists(absPath))) return 'missing'
    const currentHash = await hashFile(absPath)
    return currentHash === recordedHash ? 'pristine' : 'drifted'
}

function sha256(content: string | Buffer): string {
    return createHash('sha256').update(content).digest('hex')
}

async function* walkTemplateFiles(
    srcDir: string,
    base = '',
): AsyncGenerator<{ src: string, rel: string }> {
    const entries = await readdir(srcDir, { withFileTypes: true })
    for (const entry of entries) {
        const src = path.join(srcDir, entry.name)
        const name = restorePackSafeName(entry.name)
        const rel = base ? path.join(base, name) : name
        if (entry.isDirectory()) {
            yield* walkTemplateFiles(src, rel)
        } else if (entry.isFile()) {
            if (isColocatedTest(src) || isJunkFile(src)) continue
            yield { src, rel }
        }
    }
}

/** Records each emitted file's hash in `ctx.state`. */
export async function copyTemplateDirRecorded(
    ctx: RunContext,
    featureId: string,
    srcDir: string,
): Promise<void> {
    for await (const { src, rel } of walkTemplateFiles(srcDir)) {
        const dest = path.join(ctx.projectDir, rel)
        await mkdir(path.dirname(dest), { recursive: true })
        const preexisted = await exists(dest)
        const buf = await readFile(src)
        await writeFile(dest, buf)
        recordFile(ctx, featureId, rel, sha256(buf))
        if (!preexisted) recordCreated(ctx, featureId, rel)
    }
}

/** A feature's tracked files for the format-reconciliation pass. */
export interface TrackedFeatureFiles {
    featureId: string
    /** rel → recorded baseline hash (from ctx.state this run, else the manifest). */
    recorded: Record<string, string>
    /** rels the user owns; never re-baselined or treated as drift. */
    owned: Set<string>
}

/** Key for the pre-format snapshot map. */
function snapKey(featureId: string, rel: string): string {
    return `${featureId}\u0000${rel}`
}

/** On-disk hashes of tracked, non-owned files, taken before `formatProject` runs. */
export async function snapshotTrackedHashes(
    ctx: RunContext,
    features: TrackedFeatureFiles[],
): Promise<Map<string, string>> {
    const snap = new Map<string, string>()
    for (const f of features) {
        for (const rel of Object.keys(f.recorded)) {
            if (f.owned.has(rel)) continue
            const abs = path.join(ctx.projectDir, rel)
            if (await exists(abs)) snap.set(snapKey(f.featureId, rel), await hashFile(abs))
        }
    }
    return snap
}

/** Re-records tracked files that were pristine before `formatProject` and whose bytes it changed. */
export async function reconcilePostFormat(
    ctx: RunContext,
    features: TrackedFeatureFiles[],
    preHashes: Map<string, string>,
): Promise<void> {
    for (const f of features) {
        const stateKey = `files:${f.featureId}`
        if (!ctx.state[stateKey]) ctx.state[stateKey] = { ...f.recorded }
        for (const rel of Object.keys(f.recorded)) {
            if (f.owned.has(rel)) continue
            const pre = preHashes.get(snapKey(f.featureId, rel))
            if (pre === undefined) continue // absent on disk before formatting
            const recordedHash = f.recorded[rel]
            if (pre !== recordedHash) continue // user-edited before format → real drift, leave it
            const abs = path.join(ctx.projectDir, rel)
            if (!(await exists(abs))) continue
            const post = await hashFile(abs)
            if (post !== recordedHash) recordFile(ctx, f.featureId, rel, post)
        }
    }
}

export async function writeRecorded(
    ctx: RunContext,
    featureId: string,
    relPath: string,
    content: string,
): Promise<void> {
    const dest = path.join(ctx.projectDir, relPath)
    const preexisted = await exists(dest)
    await writeFileEnsured(dest, content)
    recordFile(ctx, featureId, relPath, sha256(content))
    if (!preexisted) recordCreated(ctx, featureId, relPath)
}

/**
 * `owned` carries the recorded hash forward, `missing` writes and records, `converged`
 * disk already matches, `pristine` safe to overwrite, `drifted` staged for manual merge.
 */
type UpdateState = 'owned' | 'missing' | 'converged' | 'pristine' | 'drifted'

async function classifyForUpdate(
    dest: string,
    rel: string,
    newContent: string,
    ownedSet: Set<string>,
    recordedHash: string | undefined,
): Promise<{ state: UpdateState, newHash: string }> {
    const newHash = sha256(newContent)
    if (ownedSet.has(rel)) return { state: 'owned', newHash }
    if (!(await exists(dest))) return { state: 'missing', newHash }

    const currentHash = await hashFile(dest)
    if (currentHash === newHash) return { state: 'converged', newHash }
    if (recordedHash && recordedHash === currentHash) return { state: 'pristine', newHash }
    return { state: 'drifted', newHash }
}

async function applyUpdateState(
    ctx: RunContext,
    featureId: string,
    args: {
        state: UpdateState
        src: string
        dest: string
        rel: string
        newContent: string
        newHash: string
        recordedHash: string | undefined
        report: UpdateReport
    },
): Promise<void> {
    const { state, src, dest, rel, newContent, newHash, recordedHash, report } = args
    const overwrite = ctx.state.overwrite === true

    // `--overwrite` ignores every protection.
    if (overwrite) {
        await mkdir(path.dirname(dest), { recursive: true })
        await writeFile(dest, newContent, 'utf8')
        recordFile(ctx, featureId, rel, newHash)
        report.written.push(rel)
        await clearArtifacts(ctx, dest, rel)
        return
    }

    if (state === 'owned') {
        if (recordedHash) recordFile(ctx, featureId, rel, recordedHash)
        return
    }
    if (state === 'missing') {
        await mkdir(path.dirname(dest), { recursive: true })
        await copyFile(src, dest)
        recordFile(ctx, featureId, rel, await hashFile(dest))
        report.written.push(rel)
        // A recorded hash means the user deleted a tracked file.
        if (recordedHash) (report.restoredDeleted ??= []).push(rel)
        return
    }
    if (state === 'converged') {
        recordFile(ctx, featureId, rel, newHash)
        report.written.push(rel)
        await clearArtifacts(ctx, dest, rel)
        return
    }
    if (state === 'pristine') {
        await writeFile(dest, newContent, 'utf8')
        recordFile(ctx, featureId, rel, newHash)
        report.written.push(rel)
        await clearArtifacts(ctx, dest, rel)
        return
    }
    // drifted + `--force`: overwrite, keeping the user's content as a staged `.bak`.
    if (ctx.state.force === true) {
        const currentContent = await readFile(dest, 'utf8')
        const bakPath = stagedArtifact(ctx, rel, '.bak')
        await rmIfExists(stagedArtifact(ctx, rel, '.new'))
        await rmIfExists(stagedArtifact(ctx, rel, '.patch'))
        await rmIfExists(`${dest}.battlestack.new`)
        await rmIfExists(`${dest}.battlestack.patch`)
        await rmIfExists(`${dest}.battlestack.bak`)
        await mkdir(path.dirname(bakPath), { recursive: true })
        await writeFile(bakPath, currentContent, 'utf8')
        await writeFile(dest, newContent, 'utf8')
        recordFile(ctx, featureId, rel, newHash)
        report.written.push(rel)
        const bakRel = path.relative(ctx.projectDir, bakPath)
        report.notes.push(`${rel}: overwritten (--force); prior content saved to ${bakRel}`)
        return
    }
    // drifted: stage the new version and a patch for manual merge.
    const currentContent = await readFile(dest, 'utf8')
    const newPath = stagedArtifact(ctx, rel, '.new')
    const patchPath = stagedArtifact(ctx, rel, '.patch')
    await mkdir(path.dirname(newPath), { recursive: true })
    await writeFile(newPath, newContent, 'utf8')
    const patch = createPatch(rel, currentContent, newContent, 'current', 'new')
    await writeFile(patchPath, patch, 'utf8')
    // Legacy in-tree artifacts beside the real file.
    await rmIfExists(`${dest}.battlestack.new`)
    await rmIfExists(`${dest}.battlestack.patch`)
    report.skipped.push(rel)
    report.notes.push(
        `${rel}: see ${path.relative(ctx.projectDir, newPath)} and ${path.relative(ctx.projectDir, patchPath)} to merge (re-run with \`battlestack pull --force\` to overwrite)`,
    )
}

/** Deletes pristine files no longer shipped. User-modified ones stay, with a note. */
async function deleteObsoleteFiles(
    ctx: RunContext,
    prev: InstalledFeatureRecord | null,
    seen: Set<string>,
    report: UpdateReport,
): Promise<void> {
    if (!prev) return
    for (const [rel, recordedHash] of Object.entries(prev.files)) {
        if (seen.has(rel)) continue
        dropRecordedFile(ctx, prev.id, rel)
        const dest = path.join(ctx.projectDir, rel)
        if (!(await exists(dest))) continue
        const currentHash = await hashFile(dest)
        if (currentHash === recordedHash) {
            await rm(dest, { force: true })
            await clearArtifacts(ctx, dest, rel)
            report.notes.push(`removed obsolete file: ${rel}`)
        } else {
            report.notes.push(
                `file no longer shipped but user-modified, left in place: ${rel}`,
            )
        }
    }
}

export async function updateFromTemplateDir(
    ctx: RunContext,
    featureId: string,
    srcDir: string,
    prev: InstalledFeatureRecord | null,
): Promise<UpdateReport> {
    return updateFromTemplateDirs(ctx, featureId, [srcDir], prev)
}

/** Aggregates `seen` across every subtree before the obsolete-file pass. */
export async function updateFromTemplateDirs(
    ctx: RunContext,
    featureId: string,
    srcDirs: string[],
    prev: InstalledFeatureRecord | null,
    keepRels: string[] = [],
): Promise<UpdateReport> {
    const report: UpdateReport = { written: [], skipped: [], notes: [] }
    const seen = new Set<string>(keepRels)
    const ownedSet = new Set(prev?.ownedByUser ?? [])

    // Carry every previously-tracked baseline hash forward.
    if (prev) {
        const seeded = (ctx.state[`files:${featureId}`] as Record<string, string> | undefined) ?? {}
        ctx.state[`files:${featureId}`] = { ...prev.files, ...seeded }
    }

    for (const p of ownedSet) recordOwned(ctx, featureId, p)

    for (const srcDir of srcDirs) {
        for await (const { src, rel } of walkTemplateFiles(srcDir)) {
            seen.add(rel)
            const dest = path.join(ctx.projectDir, rel)
            const recordedHash = prev?.files[rel]
            const newContent = await readFile(src, 'utf8')
            const { state, newHash } = await classifyForUpdate(
                dest,
                rel,
                newContent,
                ownedSet,
                recordedHash,
            )
            await applyUpdateState(ctx, featureId, {
                state,
                src,
                dest,
                rel,
                newContent,
                newHash,
                recordedHash,
                report,
            })
        }
    }

    await deleteObsoleteFiles(ctx, prev, seen, report)
    return report
}

export async function isDir(p: string): Promise<boolean> {
    try {
        const s = await stat(p)
        return s.isDirectory()
    } catch {
        return false
    }
}
