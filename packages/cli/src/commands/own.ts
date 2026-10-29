import path from 'node:path'
import pc from 'picocolors'
import type { Ora } from 'ora'
import { ui } from '@battlestack/tui'
import {
    CLIError,
    ErrorCode,
    exists,
    findProjectRoot,
    hashFile,
    MANIFEST_PATH,
    readManifest,
    writeJson,
    type InstalledFeatureRecord,
    type ParsedArgs,
    type ProjectManifest,
    type ReservedCommand,
} from '@battlestack/core'

/** Ownership is per path, so `own` and `disown` act on every feature that tracks it. */
function featuresForPath(manifest: ProjectManifest, rel: string): InstalledFeatureRecord[] {
    return manifest.features.filter((f) => rel in f.files || (f.ownedByUser ?? []).includes(rel))
}

function normalize(projectRoot: string, raw: string): string {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(projectRoot, raw)
    return path.relative(projectRoot, abs).split(path.sep).join('/')
}

async function persist(projectRoot: string, manifest: ProjectManifest): Promise<void> {
    manifest.updatedAt = new Date().toISOString()
    await writeJson(path.join(projectRoot, MANIFEST_PATH), manifest)
}

export const ownReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'own',
    usage: 'battlestack own <path...>',
    label: 'claim a file as user-owned (pull skips it)',
    group: 'Lifecycle',
}

export const disownReservedMeta: Omit<ReservedCommand, 'run'> = {
    name: 'disown',
    usage: 'battlestack disown <path...>',
    label: 'return ownership to battlestack (pull manages it)',
    group: 'Lifecycle',
}

export async function ownCommand(args: ParsedArgs, _loader: Ora): Promise<void> {
    const paths = collectPaths(args)
    if (paths.length === 0) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Usage: battlestack own <path> [path...]',
        )
    }

    const projectRoot = await requireProjectRoot()
    const manifest = await readManifest(projectRoot)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    let mutated = false
    const lines: string[] = []
    for (const raw of paths) {
        const rel = normalize(projectRoot, raw)
        const features = featuresForPath(manifest, rel)
        if (features.length === 0) {
            const suggestions = suggest(manifest, rel)
            const hint = suggestions.length
                ? ` Did you mean: ${suggestions.slice(0, 3).join(', ')}?`
                : ''
            throw new CLIError(
                ErrorCode.UNKNOWN_FEATURE,
                `${rel} is not tracked by any feature.${hint}`,
            )
        }
        const claimed: string[] = []
        for (const feature of features) {
            const list = feature.ownedByUser ?? []
            if (list.includes(rel)) continue
            list.push(rel)
            feature.ownedByUser = list
            claimed.push(feature.id)
        }
        if (claimed.length === 0) {
            const note = pc.dim(`${rel} already owned (${features.map((f) => f.id).join(', ')})`)
            lines.push(`${ui.sym.skip} ${note}`)
            continue
        }
        mutated = true
        const owned = pc.dim(`owned (${claimed.join(', ')})`)
        lines.push(`${ui.sym.ok} ${rel} ${owned}`)
    }

    if (mutated) await persist(projectRoot, manifest)
    ui.section('battlestack own')
    for (const line of lines) console.log('  ' + line)
    ui.blank()
}

export async function disownCommand(args: ParsedArgs, _loader: Ora): Promise<void> {
    const paths = collectPaths(args)
    if (paths.length === 0) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Usage: battlestack disown <path> [path...]',
        )
    }

    const projectRoot = await requireProjectRoot()
    const manifest = await readManifest(projectRoot)
    if (!manifest) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            `No manifest at ${projectRoot}/.battlestack/manifest.json`,
        )
    }

    let mutated = false
    const lines: string[] = []
    for (const raw of paths) {
        const rel = normalize(projectRoot, raw)
        const features = featuresForPath(manifest, rel)
        if (features.length === 0) {
            throw new CLIError(
                ErrorCode.UNKNOWN_FEATURE,
                `${rel} is not tracked by any feature.`,
            )
        }
        const owners = features.filter((f) => (f.ownedByUser ?? []).includes(rel))
        if (owners.length === 0) {
            const note = pc.dim(`was not owned (${features.map((f) => f.id).join(', ')}), no change`)
            lines.push(`${ui.sym.warn} ${rel} ${note}`)
            continue
        }
        const abs = path.join(projectRoot, rel)
        if (!(await exists(abs))) {
            throw new CLIError(
                ErrorCode.SCAFFOLD_FAILED,
                `${rel} does not exist on disk; cannot rebase its hash. Restore the file first or remove it from the manifest manually.`,
            )
        }
        const currentHash = await hashFile(abs)
        // Every tracker's baseline moves, or a non-owner's stale hash reads as drift right away.
        for (const feature of features) {
            // A feature that only owns the path no longer ships it; tracking it would let its next update delete the file as obsolete.
            if (rel in feature.files) feature.files[rel] = currentHash
            const list = (feature.ownedByUser ?? []).filter((p) => p !== rel)
            if (list.length > 0) feature.ownedByUser = list
            else delete feature.ownedByUser
        }
        mutated = true
        const note = pc.dim(`disowned (${owners.map((f) => f.id).join(', ')}); baseline hash refreshed`)
        lines.push(`${ui.sym.ok} ${rel} ${note}`)
    }

    if (mutated) await persist(projectRoot, manifest)
    ui.section('battlestack disown')
    for (const line of lines) console.log('  ' + line)
    ui.blank()
}

function collectPaths(args: ParsedArgs): string[] {
    return args.positionals.slice(1)
}

function suggest(manifest: ProjectManifest, target: string): string[] {
    const all: string[] = []
    for (const f of manifest.features) all.push(...Object.keys(f.files), ...(f.ownedByUser ?? []))
    const lower = target.toLowerCase()
    return [...new Set(all)]
        .filter((p) => p.toLowerCase().includes(lower) || lower.includes(path.basename(p).toLowerCase()))
        .slice(0, 5)
}

async function requireProjectRoot(): Promise<string> {
    const root = await findProjectRoot(process.cwd())
    if (!root) {
        throw new CLIError(
            ErrorCode.SCAFFOLD_FAILED,
            'Not inside a battlestack project (no .battlestack/manifest.json found).',
        )
    }
    return root
}
