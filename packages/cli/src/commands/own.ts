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

function featureForPath(
    manifest: ProjectManifest,
    rel: string,
): InstalledFeatureRecord | null {
    for (const f of manifest.features) {
        if (rel in f.files) return f
    }
    return null
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
        const feature = featureForPath(manifest, rel)
        if (!feature) {
            const suggestions = suggest(manifest, rel)
            const hint = suggestions.length
                ? ` Did you mean: ${suggestions.slice(0, 3).join(', ')}?`
                : ''
            throw new CLIError(
                ErrorCode.UNKNOWN_FEATURE,
                `${rel} is not tracked by any feature.${hint}`,
            )
        }
        const list = feature.ownedByUser ?? []
        if (list.includes(rel)) {
            const note = pc.dim(`${rel} already owned (${feature.id})`)
            lines.push(`${ui.sym.skip} ${note}`)
            continue
        }
        list.push(rel)
        feature.ownedByUser = list
        mutated = true
        const owned = pc.dim(`owned (${feature.id})`)
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
        const feature = featureForPath(manifest, rel)
        if (!feature) {
            throw new CLIError(
                ErrorCode.UNKNOWN_FEATURE,
                `${rel} is not tracked by any feature.`,
            )
        }
        const list = feature.ownedByUser ?? []
        if (!list.includes(rel)) {
            const note = pc.dim(`was not owned (${feature.id}), no change`)
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
        feature.files[rel] = currentHash
        feature.ownedByUser = list.filter((p) => p !== rel)
        if (feature.ownedByUser.length === 0) delete feature.ownedByUser
        mutated = true
        const note = pc.dim(`disowned (${feature.id}); baseline hash refreshed`)
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
    for (const f of manifest.features) all.push(...Object.keys(f.files))
    const lower = target.toLowerCase()
    return all
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
